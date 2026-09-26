import { profileLogDirectories } from './plugin-log-maintenance.mjs'
import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'

// On-demand only. Never follow links or scan sessions/workspaces; bounded work
// avoids turning a storage button into a startup or filesystem-wide scan.
export async function inspectStorage(stateRoot, { maxEntries = 100000, timeoutMs = 5000 } = {}) {
  const root = path.resolve(stateRoot)
  const deadline = Date.now() + timeoutMs
  const ids = ['pnpm-store', 'backups', 'recovery', 'logs']
  // Four independent serial walkers share a deadline and divide the entry budget.
  // A large plugin store must not prevent smaller backup/log categories from
  // being measured. Concurrency remains bounded independently of tree depth.
  const categories = await Promise.all(ids.map(async (id, index) => {
    let visited = 0
    const entryBudget = Math.floor(maxEntries / ids.length) + (index < maxEntries % ids.length ? 1 : 0)
    const result = { id, bytes: 0, files: 0, complete: true, skippedLinks: 0, errors: 0, limited: false }
    const visit = async filename => {
      if (++visited > entryBudget || Date.now() >= deadline) { result.complete = false; result.limited = true; return }
      let info
      try { info = await lstat(filename) } catch (error) {
        if (error.code !== 'ENOENT') { result.complete = false; result.errors++ }
        return
      }
      if (info.isSymbolicLink()) { result.complete = false; result.skippedLinks++; return }
      if (info.isFile()) { result.bytes += info.size; result.files++; return }
      if (!info.isDirectory()) return
      try {
        // Stream large stores rather than allocating the entire directory listing.
        const directory = await opendir(filename)
        for await (const entry of directory) {
          if (visited >= entryBudget || Date.now() >= deadline) { result.complete = false; result.limited = true; break }
          await visit(path.join(filename, entry.name))
        }
      } catch { result.complete = false; result.errors++ }
    }
    const data = path.join(root, 'data')
    try {
      const info = await lstat(data)
      if (!info.isDirectory() || info.isSymbolicLink()) { result.complete = false; result.errors++; return result }
    } catch (error) {
      if (error.code !== 'ENOENT') { result.complete = false; result.errors++ }
      return result
    }
    await visit(path.join(data, id))
    if (id === 'logs') {
      try {
        const home = path.join(data, 'dsh-home')
        const info = await lstat(home)
        if (info.isSymbolicLink() || !info.isDirectory()) { result.complete = false; result.skippedLinks++; return result }
        const discovery = await profileLogDirectories(home)
        if (!discovery.complete) { result.complete = false; result.limited = true }
        for (const { logs } of discovery.roots) await visit(logs)
      } catch (error) {
        if (error.code !== 'ENOENT') { result.complete = false; result.errors++ }
      }
    }
    return result
  }))
  return { schemaVersion: 1, complete: categories.every(item => item.complete), categories }
}
