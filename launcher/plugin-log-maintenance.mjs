import { lstat, opendir, readdir, unlink, rmdir } from 'node:fs/promises'
import path from 'node:path'

async function directory(filename) {
  try { const info = await lstat(filename); return info.isDirectory() && !info.isSymbolicLink() }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

// Inspect only profile-owned log paths; never descend into dependencies or sessions.
export async function profileLogDirectories(dshHome) {
  const roots = []
  let complete = true
  const checked = async filename => {
    try {
      const info = await lstat(filename)
      if (info.isDirectory() && !info.isSymbolicLink()) return true
      complete = false
      return false
    } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  }
  if (!await checked(path.dirname(dshHome)) || !await checked(dshHome)) return { roots, complete }
  const profiles = path.join(dshHome, 'profiles')
  if (!await checked(profiles)) return { roots, complete }
  let count = 0
  for await (const entry of await opendir(profiles)) {
    if (++count > 64) { complete = false; break }
    if (entry.isSymbolicLink()) { complete = false; continue }
    if (!entry.isDirectory()) continue
    const profile = path.join(profiles, entry.name)
    const manager = path.join(profile, '.plugin-manager')
    const logs = path.join(manager, 'logs')
    if (await checked(profile) && await checked(manager) && await checked(logs)) roots.push({ profile, logs })
  }
  return { roots, complete }
}

// The caller supplies the official runtime's lock, shared with both CLI and UI.
// No fallback lock: unsupported runtimes retain their logs rather than race writers.
export async function maintainPluginLogs(dshHome, withFileLock, {
  now = Date.now(), maxRuns = 30, maxAgeMs = 14 * 86400000,
  maxBytes = 32 * 1024 * 1024, graceMs = 86400000, budgetMs = 1000,
} = {}) {
  const result = { removed: 0, bytes: 0, deferred: 0, protected: 0, limited: false }
  if (typeof withFileLock !== 'function') return { ...result, deferred: 1 }
  const deadline = Date.now() + budgetMs
  const discovery = await profileLogDirectories(dshHome)
  result.limited = !discovery.complete
  for (const { profile, logs } of discovery.roots) {
    if (Date.now() >= deadline) { result.limited = true; break }
    try {
      await withFileLock(path.join(profile, 'package.json'), async () => {
        if (!await directory(profile) || !await directory(path.dirname(logs)) || !await directory(logs)) return
        const runs = []
        let inspected = 0
        for await (const entry of await opendir(logs)) {
          if (++inspected > 2000 || Date.now() >= deadline) { result.limited = true; return }
          if (!/^operation-[A-Za-z0-9]{6}$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) { result.protected++; continue }
          const dir = path.join(logs, entry.name)
          const children = await readdir(dir)
          if (children.length !== 1 || children[0] !== 'pnpm.log') { result.protected++; continue }
          const file = path.join(dir, 'pnpm.log')
          const info = await lstat(file)
          if (!info.isFile() || info.isSymbolicLink()) { result.protected++; continue }
          runs.push({ dir, file, bytes: info.size, mtime: info.mtimeMs })
        }
        runs.sort((a, b) => b.mtime - a.mtime)
        let retainedBytes = 0
        for (let i = 0; i < runs.length; i++) {
          const run = runs[i]
          if (Date.now() >= deadline) { result.limited = true; break }
          const recent = now - run.mtime < graceMs
          if (i === 0 || recent || (i < maxRuns && now - run.mtime < maxAgeMs && retainedBytes + run.bytes <= maxBytes)) {
            retainedBytes += run.bytes; continue
          }
          if (!await directory(logs) || !await directory(run.dir)) { result.protected++; continue }
          const info = await lstat(run.file)
          if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs !== run.mtime || info.size !== run.bytes) { result.protected++; continue }
          await unlink(run.file)
          // Never recursively remove a directory: unknown concurrently added content survives.
          await rmdir(run.dir).catch(() => {})
          result.removed++; result.bytes += run.bytes
        }
      }, { waitMs: 0 })
    } catch { result.deferred++ }
  }
  return result
}
