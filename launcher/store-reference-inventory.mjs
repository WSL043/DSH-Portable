import { lstat, opendir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { normalizeEnvironmentId } from './portable-core.mjs'

const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const emptyObject = value => object(value) && Object.keys(value).length === 0
const absentOrEmpty = value => value === undefined || emptyObject(value)
const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)

// An empty lock has no graph to pin or prune. Unknown keys/shapes continue
// through the normal strict preparation path instead of taking this shortcut.
export function isEmptyStoreLock(lock) {
  return object(lock) && String(lock.lockfileVersion) === '9.0'
    && Object.keys(lock).every(key => ['lockfileVersion', 'settings', 'importers', 'packages', 'snapshots'].includes(key))
    && (lock.settings === undefined || object(lock.settings))
    && object(lock.importers) && Object.keys(lock.importers).join() === '.'
    && object(lock.importers['.'])
    && Object.keys(lock.importers['.']).every(key => dependencyFields.includes(key))
    && dependencyFields.every(field => absentOrEmpty(lock.importers['.'][field]))
    && absentOrEmpty(lock.packages) && absentOrEmpty(lock.snapshots)
}


// Discovery only, never permission to prune. A caller must hold all writers,
// materialize these references offline and revalidate the inventory before GC.
// In particular, successful discovery cannot promise offline recovery of an
// encrypted/exported archive kept outside this installation.
export async function inspectStoreReferences(baseStateRoot, {
  maxEntries = 100000, budgetMs = 5000, signal, parseYaml,
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
      return source
    }
    const emptyHoisted = async (filename, profile, metadataSource) => {
      // Only the current installation may use the profile's manifest and lock.
      // Recovery/backup installations need their own retained installed lock.
      if (!profile || typeof parseYaml !== 'function' || !metadataSource) return false
      const candidateRead = async filename => {
        const info = await stat(filename)
        if (!info?.isFile() || info.size > 8 * 1024 * 1024) return null
        const source = await readFile(filename)
        return source.length <= 8 * 1024 * 1024 ? source : null
      }
      try {
        const manifestSource = await candidateRead(path.join(profile, 'package.json'))
        const lockSource = await candidateRead(path.join(profile, 'pnpm-lock.yaml'))
        if (!manifestSource || !lockSource) return false
        const manifest = JSON.parse(manifestSource.toString('utf8'))
        const lock = parseYaml(lockSource.toString('utf8'))
        const metadata = parseYaml(metadataSource.toString('utf8'))
        if (!object(manifest) || !dependencyFields.every(field => absentOrEmpty(manifest[field]))
          || !['peerDependencies', 'bundledDependencies', 'bundleDependencies'].every(field => manifest[field] === undefined
            || (Array.isArray(manifest[field]) ? manifest[field].length === 0 : emptyObject(manifest[field])))
          || !isEmptyStoreLock(lock) || !object(metadata)
          || metadata.nodeLinker !== 'hoisted' || metadata.packageManager !== 'pnpm@11.11.0'
          || !emptyObject(metadata.hoistedLocations) || !emptyObject(metadata.injectedDeps)
          || !Array.isArray(metadata.pendingBuilds) || metadata.pendingBuilds.length
          || !Array.isArray(metadata.skipped) || metadata.skipped.length
          || typeof metadata.storeDir !== 'string' || canonical(metadata.storeDir) !== canonical(path.join(state.store, 'v11'))
          || typeof metadata.virtualStoreDir !== 'string'
          || canonical(path.resolve(filename, metadata.virtualStoreDir)) !== canonical(path.join(filename, '.pnpm'))) return false
        const extra = []
        for await (const entry of await opendir(filename)) {
          if (!withinBudget(filename) || entry.isSymbolicLink()) return false
          if (entry.name === '.pnpm') {
            if (!entry.isDirectory()) return false
            for await (const _entry of await opendir(path.join(filename, entry.name))) return false
            continue
          }
          if (!entry.isFile() || !['.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json'].includes(entry.name)) return false
          if (entry.name === '.modules.yaml') continue
          const source = await candidateRead(path.join(filename, entry.name))
          if (!source) return false
          const value = JSON.parse(source.toString('utf8'))
          if (entry.name === '.package-map.json') {
            const self = value?.packages?.['.']
            if (!object(value?.packages) || Object.keys(value.packages).join() !== '.'
              || !object(self) || self.url !== '..' || !object(self.dependencies)
              || Object.keys(self.dependencies).length !== 1 || typeof manifest.name !== 'string'
              || self.dependencies[manifest.name] !== '.') return false
          } else if (!object(value?.projects) || Object.keys(value.projects).length > 1
            || (Object.keys(value.projects).length === 1 && canonical(Object.keys(value.projects)[0]) !== canonical(profile))
            || value.settings?.nodeLinker !== 'hoisted' || value.settings?.enableGlobalVirtualStore !== false
            || !Array.isArray(value.pnpmfiles) || value.pnpmfiles.length) return false
          extra.push(path.join(filename, entry.name))
        }
        // These files contributed to the empty-installation proof. Hash them in
        // every inventory and recheck their bytes under the existing writer locks.
        for (const extraFile of extra) await record(extraFile, 'empty-installation-state')
        return true
      } catch { return false }
    }
    const modules = async (filename, profile) => {
      const info = await stat(filename)
      if (!info) return
      if (!info.isDirectory()) { block('invalid-modules-directory', filename); return }
      const metadata = path.join(filename, '.modules.yaml')
      const countBeforeMetadata = state.references.length
      const metadataSource = await record(metadata, 'modules-state')
      if (state.references.length === countBeforeMetadata) block('missing-modules-state', filename)
      // Installed package symlinks are normal. Do not walk them or package code.
      const virtual = path.join(filename, '.pnpm')
      const virtualInfo = await stat(virtual)
      if (!virtualInfo?.isDirectory()) {
        if (!virtualInfo && await emptyHoisted(filename, profile, metadataSource)) {
          state.installations.push({ modules: filename, virtualStore: virtual, metadata, lock: null, empty: true })
          return
        }
        block('missing-installed-lock', filename); return
      }
      const lock = path.join(virtual, 'lock.yaml')
      const count = state.references.length
      await record(lock, 'installed-lock')
      if (state.references.length === count) {
        if (await emptyHoisted(filename, profile, metadataSource))
          state.installations.push({ modules: filename, virtualStore: virtual, metadata, lock: null, empty: true })
        else block('missing-installed-lock', filename)
      } else state.installations.push({ modules: filename, virtualStore: virtual, metadata, lock })
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
          || entry.name.startsWith('.node_modules.dsh-portable-backup-')) await modules(filename,
            entry.name === 'node_modules' && kind === 'profile' && state.profiles.includes(directory) ? directory : null)
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
