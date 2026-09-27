import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, statfs, unlink, writeFile } from 'node:fs/promises'
import { inspectStoreReferences } from './store-reference-inventory.mjs'
import { acquireProductMutationLock, layoutForRoot } from './portable-core.mjs'
import { recordPortableDiagnostic } from './diagnostic-policy.mjs'

const exec = promisify(execFile)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = code => { throw Object.assign(new Error(code), { code }) }
const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
const stable = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies']

async function checkedRead(reference) {
  const info = await lstat(reference.path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) fail('STORE_REFERENCE_CHANGED')
  const bytes = await readFile(reference.path)
  if (digest(bytes) !== reference.sha256) fail('STORE_REFERENCE_CHANGED')
  return bytes.toString('utf8')
}

function dependencyKey(manifest) {
  return stable(Object.fromEntries(dependencyFields.map(field => [field, manifest[field] || {}])))
}

export async function readRetainedArchive(lock, name, specifier, origin) {
  const normalized = specifier.replaceAll('\\', '/')
  const match = /^file:(?:\.\/)?(\.dsh-portable-archives\/(?:sha512-[a-f0-9]+|dsh-chat-manager|dsh-image-viewer)\.tgz)$/.exec(normalized)
  if (!match) fail('STORE_EXTERNAL_REFERENCE')
  const entries = Object.entries(lock.packages || {}).filter(([key, item]) => key.startsWith(`${name}@file:`)
    && item.resolution?.tarball?.replaceAll('\\', '/').replace(/^file:\.\//, 'file:') === `file:${match[1]}`)
  if (entries.length !== 1) fail('STORE_ARCHIVE_IDENTITY')
  const entry = entries[0][1]
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.resolution.integrity || '')
    || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version || '')) fail('STORE_ARCHIVE_IDENTITY')
  const archive = path.join(origin, match[1])
  const parent = await lstat(path.dirname(archive)), info = await lstat(archive)
  if (parent.isSymbolicLink() || !parent.isDirectory() || info.isSymbolicLink() || !info.isFile()
    || info.size > 64 * 1024 * 1024) fail('STORE_EXTERNAL_REFERENCE')
  const integrity = 'sha512-' + createHash('sha512').update(await readFile(archive)).digest('base64')
  if (integrity !== entry.resolution.integrity) fail('STORE_ARCHIVE_IDENTITY')
  return { source: archive, relative: match[1], version: entry.version }
}

async function loadRuntime(runtimeRoot) {
  const require = createRequire(path.join(runtimeRoot, 'app/package.json'))
  const pnpmPackage = path.join(runtimeRoot, 'app/node_modules/pnpm/package.json')
  if (JSON.parse(await readFile(pnpmPackage, 'utf8')).version !== '11.11.0') fail('STORE_PNPM_UNSUPPORTED')
  const atomic = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href)
  return { parse: require('yaml').parse, withFileLock: atomic.withFileLock,
    pnpm: path.join(path.dirname(pnpmPackage), 'bin/pnpm.cjs') }
}

async function runPnpm(pnpm, cwd, store, cache, args, signal) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(npm_config_|pnpm_|node_options$|node_path$)/i.test(name)))
  // No user rc, executable hooks, version manager or lifecycle scripts in the
  // retention workspace. Offline installs must fail rather than fetch a gap.
  env.CI = 'true'
  env.npm_config_fetch_retries = '0'
  env.npm_config_userconfig = path.join(cache, 'empty.npmrc')
  env.npm_config_globalconfig = path.join(cache, 'empty-global.npmrc')
  await writeFile(env.npm_config_userconfig, '')
  await writeFile(env.npm_config_globalconfig, '')
  try { await exec(process.execPath, [pnpm, ...args, '--store-dir', store,
    `--config.cache-dir=${cache}`, '--config.managePackageManagerVersions=false',
    '--config.enableGlobalVirtualStore=false', '--config.ignorePnpmfile=true'], { cwd, env, windowsHide: true, timeout: 120000,
    maxBuffer: 2 * 1024 * 1024, signal }) }
  catch (error) {
    const code = args[0] === 'store' ? 'STORE_PRUNE_FAILED' : args.includes('--package-import-method=copy')
      ? 'STORE_OFFLINE_VERIFY_FAILED' : 'STORE_OFFLINE_PREPARE_FAILED'
    throw Object.assign(new Error(code, { cause: new Error(String(error.stderr || error.stdout || error.message).slice(-8192)) }), { code })
  }
}

async function inspectStoreTree(environment, retained, signal) {
  const store = environment.store
  const projects = new Set([...environment.profiles, ...environment.installations.map(item => path.dirname(item.modules))].map(canonical))
  // pnpm itself uses stat, so reject any links before allowing it to traverse.
  let count = 0
  const deadline = Date.now() + 15000
  const visit = async (filename, depth = 0) => {
    signal?.throwIfAborted()
    if (++count > 200000 || Date.now() >= deadline) fail('STORE_SCAN_LIMIT')
    if (depth > 5) fail('STORE_LAYOUT_UNSUPPORTED')
    const info = await lstat(filename)
    if (info.isSymbolicLink()) {
      if (canonical(path.dirname(filename)) === canonical(path.join(store, 'v11/projects'))) {
        const target = path.resolve(path.dirname(filename), await readlink(filename))
        try { await lstat(target) } catch (error) { if (error.code === 'ENOENT') return; throw error }
        if (!projects.has(canonical(target)) && !retained.some(item => canonical(path.dirname(target)) === canonical(item.scratch)))
          fail('STORE_SHARED_REGISTRY')
        return
      }
      fail('STORE_LINKED_PATH')
    }
    if (canonical(filename) === canonical(path.join(store, 'v11/links'))) fail('STORE_GLOBAL_VIRTUAL_UNSUPPORTED')
    if (!info.isDirectory()) return
    for (const entry of await readdir(filename)) await visit(path.join(filename, entry), depth + 1)
  }
  try {
    const entries = await readdir(store)
    if (entries.some(name => name !== 'v11' && name !== 'metadata')) fail('STORE_LAYOUT_UNSUPPORTED')
    await visit(store)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}

async function prepareReferences(environment, scratch, api, signal) {
  const locks = new Map(), manifests = []
  for (const reference of environment.references) {
    const source = await checkedRead(reference)
    if (reference.kind === 'manifest') { manifests.push(JSON.parse(source)); continue }
    if (reference.kind === 'modules-state') {
      const metadata = api.parse(source)
      if (canonical(metadata?.storeDir || '.') !== canonical(path.join(environment.store, 'v11')))
        fail('STORE_MODULES_MOVED')
      const actual = path.join(path.dirname(reference.path), '.pnpm')
      const original = path.join(path.dirname(path.dirname(reference.path)), 'node_modules/.pnpm')
      if (![actual, original].some(filename => canonical(filename) === canonical(metadata?.virtualStoreDir || '.')))
        fail('STORE_VIRTUAL_LAYOUT_UNSUPPORTED')
      continue
    }
    const lock = api.parse(source)
    if (String(lock?.lockfileVersion) !== '9.0' || Object.keys(lock.importers || {}).join() !== '.'
      || lock.patchedDependencies || lock.catalogs) fail('STORE_LOCK_UNSUPPORTED')
    const manifest = { name: 'portable-retained-reference', private: true }
    for (const field of dependencyFields) {
      manifest[field] = Object.fromEntries(Object.entries(lock.importers['.'][field] || {}).map(([name, item]) => {
        if (typeof item?.specifier !== 'string') fail('STORE_LOCK_UNSUPPORTED')
        return [name, item.specifier]
      }))
    }
    if (lock.overrides) manifest.pnpm = { overrides: lock.overrides }
    const installed = environment.installations.find(item => item.lock === reference.path)
    const origin = installed ? path.dirname(installed.modules) : path.dirname(reference.path)
    const archives = []
    const registryManifest = structuredClone(manifest)
    for (const field of dependencyFields) for (const [name, value] of Object.entries(manifest[field])) {
      if (!value.startsWith('file:')) continue
      const archive = await readRetainedArchive(lock, name, value, origin)
      archives.push(archive)
      // Default seeding promotes package.json to an exact registry version but
      // retains the offline tarball graph. Accept only this verified identity;
      // materialization below still replays the original immutable lock.
      registryManifest[field][name] = archive.version
    }
    locks.set(digest(stable(lock)), { source, lock, manifest, origin, archives, registryManifest })
  }
  // A saved manifest without a retained matching lock must not be forgotten.
  const keys = new Set([...locks.values()].flatMap(item => [dependencyKey(item.manifest), dependencyKey(item.registryManifest)]))
  for (const manifest of manifests) {
    if (dependencyFields.some(field => Object.keys(manifest[field] || {}).length)
      && !keys.has(dependencyKey(manifest))
      && ![...locks.values()].some(item => dependencyFields.every(field => {
        const actual = manifest[field] || {}, expected = item.manifest[field]
        return Object.keys(actual).length === Object.keys(expected).length
          && Object.entries(expected).every(([name, value]) => actual[name] === value || actual[name] === item.registryManifest[field][name])
      }))) fail('STORE_UNRESOLVED_MANIFEST')
  }
  let index = 0
  for (const { source, lock, manifest, archives } of locks.values()) {
    signal?.throwIfAborted()
    const target = path.join(scratch, `reference-${index++}`)
    await mkdir(target)
    // Only verified Portable archive references enter the isolated workspace.
    for (const value of dependencyFields.flatMap(field => Object.values(manifest[field]))) {
      if (/^(?:link:|workspace:|portal:|\.\.?[\\/]|[A-Za-z]:[\\/]|\/)/.test(value)) fail('STORE_EXTERNAL_REFERENCE')
    }
    for (const archive of archives) {
      await mkdir(path.join(target, '.dsh-portable-archives'), { recursive: true })
      await copyFile(archive.source, path.join(target, archive.relative))
    }
    await writeFile(path.join(target, 'package.json'), JSON.stringify(manifest))
    await writeFile(path.join(target, 'pnpm-lock.yaml'), source)
    await writeFile(path.join(target, 'pnpm-workspace.yaml'), JSON.stringify({
      ...lock.settings, ...(lock.overrides ? { overrides: lock.overrides } : {}),
    }))
    // This only replays an already recorded graph into temporary pins. pnpm 11
    // otherwise performs online policy checks even with --offline. Integrity
    // and frozen-lock validation remain enabled; no normal install policy changes.
    await runPnpm(api.pnpm, target, environment.store, path.join(scratch, 'metadata'),
      ['install', '--offline', '--frozen-lockfile', '--trust-lockfile', '--ignore-scripts', '--package-import-method=hardlink'], signal)
  }
  return index
}

async function assertNoPendingTransactions(environments) {
  for (const environment of environments) {
    const state = path.dirname(environment.store)
    for (const name of ['update.json', 'pending-extension.json', 'data-import.json', 'import-transaction.json']) {
      try { await lstat(path.join(state, 'runtime', name)); fail('STORE_PENDING_TRANSACTION') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
}

async function removeScratch(scratch, store) {
  const resolved = await realpath(scratch)
  if (canonical(resolved) !== canonical(scratch) || !path.basename(scratch).startsWith('.store-maintenance-')) fail('STORE_UNSAFE_SCRATCH')
  await rm(scratch, { recursive: true, force: true })
  const registry = path.join(store, 'v11/projects')
  for (const entry of await readdir(registry, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
    if (!entry.isSymbolicLink()) continue
    const filename = path.join(registry, entry.name)
    const target = path.resolve(registry, await readlink(filename))
    if (canonical(path.dirname(target)) === canonical(scratch)) await unlink(filename)
  }
}

async function previousScratch(environment) {
  const old = []
  for (const entry of await readdir(path.dirname(environment.store), { withFileTypes: true })) {
    if (!entry.name.startsWith('.store-maintenance-')) continue
    const scratch = path.join(path.dirname(environment.store), entry.name)
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('STORE_UNSAFE_SCRATCH')
    let marker
    try {
      const filename = path.join(scratch, 'owner.json')
      const info = await lstat(filename)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) fail('STORE_UNSAFE_SCRATCH')
      marker = JSON.parse(await readFile(filename, 'utf8'))
    } catch { fail('STORE_UNSAFE_SCRATCH') }
    if (marker.schemaVersion !== 1 || !Number.isSafeInteger(marker.pid) || marker.pid <= 0) fail('STORE_UNSAFE_SCRATCH')
    if (marker.retained !== true) {
      try { process.kill(marker.pid, 0); fail('STORE_MAINTENANCE_BUSY') }
      catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    // Retain interrupted pins until the new operation has independently rebuilt
    // every reference. A failed retry must not destroy its only recovery copy.
    old.push({ scratch, store: environment.store })
  }
  return old
}

// Called by the explicit settings/CLI action only. All package graph mutations
// must participate in the product lock; official UI writers also share profile locks.
export async function cleanPluginStores({ root, stateRoot = root, runtimeRoot = root, baseStateRoot = stateRoot }, { signal } = {}) {
  const layout = layoutForRoot(root, process.platform, baseStateRoot, runtimeRoot)
  const release = await acquireProductMutationLock(layout)
  const temporary = []
  const previous = []
  let pruneStarted = false
  const result = { schemaVersion: 1, complete: false, environments: 0, references: 0 }
  try {
    const api = await loadRuntime(runtimeRoot)
    const initial = await inspectStoreReferences(baseStateRoot, { budgetMs: 15000, signal })
    if (!initial.complete) fail('STORE_REFERENCES_INCOMPLETE')
    const profiles = initial.environments.flatMap(item => item.profiles).sort()
    const locked = async index => {
      if (index < profiles.length) return api.withFileLock(path.join(profiles[index], 'package.json'), () => locked(index + 1), { waitMs: 0 })
      const inventory = await inspectStoreReferences(baseStateRoot, { budgetMs: 15000, signal })
      if (stable(inventory) !== stable(initial)) fail('STORE_REFERENCE_CHANGED')
      await assertNoPendingTransactions(inventory.environments)
      const prepared = []
      for (const environment of inventory.environments) {
        signal?.throwIfAborted()
        try { await lstat(environment.store) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        const retained = await previousScratch(environment)
        await inspectStoreTree(environment, retained, signal)
        previous.push(...retained)
        const data = path.dirname(environment.store)
        const space = await statfs(data)
        if (space.bavail * space.bsize < 64 * 1024 * 1024) fail('STORE_LOW_DISK_SPACE')
        const scratch = await mkdtemp(path.join(data, '.store-maintenance-'))
        temporary.push({ scratch, store: environment.store })
        await writeFile(path.join(scratch, 'owner.json'), JSON.stringify({ schemaVersion: 1, pid: process.pid }))
        await mkdir(path.join(scratch, 'metadata'))
        result.references += await prepareReferences(environment, scratch, api, signal)
        prepared.push({ environment, scratch })
      }
      // No store is pruned until every environment and rollback reference has
      // materialized successfully. A partial scan/failed install leaves all intact.
      const beforePrune = await inspectStoreReferences(baseStateRoot, { budgetMs: 15000, signal })
      if (stable(beforePrune) !== stable(inventory)) fail('STORE_REFERENCE_CHANGED')
      for (const { environment, scratch } of prepared) {
        signal?.throwIfAborted()
        // Preparation registers its own temporary projects. Recheck consumers
        // immediately before pruning as well; a new unknown registration aborts.
        // The product/profile locks serialize Portable writers, not an unrelated
        // raw pnpm invocation deliberately pointed at this private store.
        await inspectStoreTree(environment, [...previous, ...temporary], signal)
        pruneStarted = true
        await mkdir(path.join(scratch, 'prune-metadata'))
        await runPnpm(api.pnpm, scratch, environment.store, path.join(scratch, 'prune-metadata'), ['store', 'prune'], signal)
        for (const entry of await readdir(scratch)) {
          if (!/^reference-\d+$/.test(entry)) continue
          const reference = path.join(scratch, entry), verify = path.join(scratch, entry.replace('reference-', 'verify-'))
          await mkdir(verify)
          for (const filename of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
            await copyFile(path.join(reference, filename), path.join(verify, filename))
          try {
            await cp(path.join(reference, '.dsh-portable-archives'), path.join(verify, '.dsh-portable-archives'), { recursive: true, dereference: false })
          } catch (error) { if (error.code !== 'ENOENT') throw error }
          await runPnpm(api.pnpm, verify, environment.store, path.join(scratch, 'metadata'),
            ['install', '--offline', '--frozen-lockfile', '--trust-lockfile', '--ignore-scripts', '--package-import-method=copy'], signal)
        }
        result.environments++
      }
      result.complete = true
      for (const item of previous) await removeScratch(item.scratch, item.store)
      return result
    }
    return await locked(0)
  } catch (error) {
    await recordPortableDiagnostic(path.join(baseStateRoot, 'data/logs'), { operation: 'plugin-cache-clean', error })
    throw error
  } finally {
    try {
      if (!pruneStarted || result.complete) for (const item of temporary) await removeScratch(item.scratch, item.store)
      else for (const item of temporary) await writeFile(path.join(item.scratch, 'owner.json'),
        JSON.stringify({ schemaVersion: 1, pid: process.pid, retained: true }))
    } finally { await release() }
  }
}
