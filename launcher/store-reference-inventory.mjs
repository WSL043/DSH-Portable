import { lstat, opendir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { normalizeEnvironmentId } from './portable-core.mjs'

// Discovery only, never permission to prune. A caller must hold all writers,
// materialize these references offline and revalidate the inventory before GC.
// In particular, successful discovery cannot promise offline recovery of an
// encrypted/exported archive kept outside this installation.
export async function inspectStoreReferences(baseStateRoot, {
  maxEntries = 100000, budgetMs = 5000, signal,
} = {}) {
  const base = path.resolve(baseStateRoot)
  const result = { schemaVersion: 1, complete: true, environments: [], blockers: [] }
  const deadline = Date.now() + budgetMs
  let entries = 0
  const block = (code, filename) => {
    result.complete = false
    if (result.blockers.length < 32) result.blockers.push({ code, path: path.relative(base, filename) })
  }
  const withinBudget = filename => {
    if (signal?.aborted || ++entries > maxEntries || Date.now() >= deadline) {
      block(signal?.aborted ? 'cancelled' : 'scan-limited', filename)
      return false
    }
    return true
  }
  const stat = async filename => {
    if (!withinBudget(filename)) return null
    try {
      const info = await lstat(filename)
      if (info.isSymbolicLink()) { block('linked-reference', filename); return null }
      return info
    } catch (error) {
      if (error.code !== 'ENOENT') block(error.code || 'unreadable-reference', filename)
      return null
    }
  }
  const roots = [{ id: 'default', root: base }]
  const environmentRoot = path.join(base, 'environments')
  const info = await stat(environmentRoot)
  if (info?.isDirectory()) {
    for await (const entry of await opendir(environmentRoot)) {
      if (!withinBudget(environmentRoot)) break
      const filename = path.join(environmentRoot, entry.name)
      if (entry.isSymbolicLink()) { block('linked-environment', filename); continue }
      if (!entry.isDirectory()) continue
      try {
        const id = normalizeEnvironmentId(entry.name)
        if (id !== entry.name || id === 'default') { block('ambiguous-environment', filename); continue }
        roots.push({ id, root: filename })
      } catch { block('unknown-environment', filename) }
    }
  } else if (info) block('invalid-environments-directory', environmentRoot)

  for (const environment of roots) {
    const data = path.join(environment.root, 'data')
    const state = { id: environment.id, store: path.join(data, 'pnpm-store'), profiles: [], references: [], installations: [], archives: [] }
    result.environments.push(state)
    const dataInfo = await stat(data)
    if (!dataInfo) continue
    if (!dataInfo.isDirectory()) { block('invalid-data-directory', data); continue }
    const storeInfo = await stat(state.store)
    if (storeInfo && !storeInfo.isDirectory()) block('invalid-store-directory', state.store)
    const record = async (filename, kind) => {
      const file = await stat(filename)
      if (!file) return
      if (!file.isFile() || file.size > 8 * 1024 * 1024) { block('invalid-reference-file', filename); return }
      const source = await readFile(filename)
      if (source.length > 8 * 1024 * 1024) { block('invalid-reference-file', filename); return }
      if (kind === 'manifest') {
        try { JSON.parse(source.toString('utf8')) }
        catch { block('invalid-manifest', filename); return }
      }
      state.references.push({ path: filename, kind, size: source.length,
        sha256: createHash('sha256').update(source).digest('hex') })
    }
    const modules = async filename => {
      const info = await stat(filename)
      if (!info) return
      if (!info.isDirectory()) { block('invalid-modules-directory', filename); return }
      const metadata = path.join(filename, '.modules.yaml')
      const countBeforeMetadata = state.references.length
      await record(metadata, 'modules-state')
      if (state.references.length === countBeforeMetadata) block('missing-modules-state', filename)
      // Installed package symlinks are normal. Do not walk them or package code.
      const virtual = path.join(filename, '.pnpm')
      const virtualInfo = await stat(virtual)
      if (!virtualInfo?.isDirectory()) { block('missing-installed-lock', filename); return }
      const lock = path.join(virtual, 'lock.yaml')
      const count = state.references.length
      await record(lock, 'installed-lock')
      if (state.references.length === count) block('missing-installed-lock', filename)
      else state.installations.push({ modules: filename, virtualStore: virtual, metadata, lock })
    }
    const walk = async (directory, kind, depth = 0) => {
      const info = await stat(directory)
      if (!info) return
      if (!info.isDirectory() || depth > 16) { block('unknown-reference-tree', directory); return }
      for await (const entry of await opendir(directory)) {
        if (!withinBudget(directory)) break
        const filename = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) { block('linked-reference', filename); continue }
        if (entry.isFile()) {
          if (entry.name === 'package.json' || /^startup-profile-backup-.*\.json$/.test(entry.name)) await record(filename, 'manifest')
          else if (entry.name === 'pnpm-lock.yaml' || /^pnpm-lock\.yaml\.dsh-portable-recovery-/.test(entry.name)) await record(filename, 'lock')
          else if (entry.name.endsWith('.dshdata')) block('opaque-export', filename)
          continue
        }
        if (!entry.isDirectory()) { block('unknown-reference-entry', filename); continue }
        if (entry.name === 'node_modules' || entry.name.startsWith('node_modules.dsh-portable-recovery-')
          || entry.name.startsWith('.node_modules.dsh-portable-backup-')) await modules(filename)
        else if (entry.name === '.dsh-portable-archives') state.archives.push(filename)
        else if (kind === 'recovery') await walk(filename, kind, depth + 1)
        // Profile settings, logs, sessions and arbitrary plugin files are not dependencies.
      }
    }
    const home = path.join(data, 'dsh-home')
    const homeInfo = await stat(home)
    if (homeInfo && !homeInfo.isDirectory()) block('invalid-home-directory', home)
    if (homeInfo?.isDirectory()) {
      const profiles = path.join(home, 'profiles')
      const profileInfo = await stat(profiles)
      if (profileInfo && !profileInfo.isDirectory()) block('invalid-profiles-directory', profiles)
      if (profileInfo?.isDirectory()) for await (const entry of await opendir(profiles)) {
        if (!withinBudget(profiles)) break
        if (entry.name === 'node_modules') continue // Generated runtime resolver, not a profile.
        const filename = path.join(profiles, entry.name)
        if (entry.isSymbolicLink()) { block('linked-profile', filename); continue }
        if (!entry.isDirectory()) continue
        state.profiles.push(filename)
        await walk(filename, 'profile')
      }
    }
    await walk(path.join(data, 'backups'), 'recovery')
    await walk(path.join(data, 'recovery'), 'recovery')
    // Startup pause backups carry manifests; active transaction journals need a
    // separate validation gate, never infer that a journal is inactive by age.
    await walk(path.join(data, 'runtime'), 'profile')
  }
  return result
}
