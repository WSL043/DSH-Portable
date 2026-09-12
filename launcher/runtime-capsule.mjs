import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from('DSHPACK1', 'ascii')
const HEADER_BYTES = 12
const READY_FILE = '.dsh-runtime-ready.json'
const HASH_PATTERN = /^[a-f0-9]{64}$/
const INCOMPLETE_CACHE_PATTERN = /^\.([a-f0-9]{64})\.([1-9][0-9]*)\.([0-9]{13})$/
const INCOMPLETE_CACHE_GRACE_MS = 24 * 60 * 60 * 1000

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) return null
  const normalized = path.posix.normalize(value)
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || path.posix.isAbsolute(normalized)) return null
  if (/^[a-zA-Z]:/.test(normalized)) return null
  return normalized
}

function runtimeCacheParent(env = process.env) {
  if (env.DSH_PORTABLE_RUNTIME_CACHE) return path.resolve(env.DSH_PORTABLE_RUNTIME_CACHE)
  const local = env.LOCALAPPDATA || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local')
    : path.join(os.homedir(), '.cache'))
  return path.join(local, 'DSH-Portable', 'runtime-cache')
}

function runtimeGcLock(cacheParent, hash) {
  return path.join(cacheParent, `${hash}.gc.lock`)
}

function runtimeLeasePrefix(hash) {
  return `${hash}.lease.`
}

export function capsulePaths(root, env = process.env) {
  const portableRoot = path.resolve(root)
  const manifestFile = path.join(portableRoot, 'runtime-capsule.json')
  if (!existsSync(manifestFile)) {
    return { mode: 'expanded', portableRoot, runtimeRoot: portableRoot, manifestFile }
  }
  return { mode: 'capsule', portableRoot, manifestFile, cacheParent: runtimeCacheParent(env) }
}

/**
 * One compact, support-safe line for the launcher's existing lifecycle log.
 * It deliberately distinguishes the one-time materialisation cost from the
 * normal ready-marker path; otherwise a slow first run is indistinguishable
 * from every later startup in a user report.
 */
export function runtimePreparationDiagnostic(result, elapsedMs) {
  const elapsed = Math.max(0, Math.round(Number(elapsedMs) || 0))
  if (result?.mode !== 'capsule') return `expanded-layout elapsed=${elapsed}ms`
  const manifest = result.manifest ?? {}
  const hash = typeof manifest.sha256 === 'string' ? manifest.sha256.slice(0, 12) : 'unknown'
  const files = Number.isSafeInteger(manifest.fileCount) ? manifest.fileCount : 0
  if (result.reused === true) return `reused hash=${hash} files=${files} elapsed=${elapsed}ms`
  const packed = Number.isSafeInteger(manifest.bytes) ? manifest.bytes : 0
  const raw = Number.isSafeInteger(manifest.rawBytes) ? manifest.rawBytes : 0
  return `prepared hash=${hash} files=${files} packed=${packed} raw=${raw} elapsed=${elapsed}ms`
}

async function readManifest(filename) {
  const manifest = JSON.parse(await readFile(filename, 'utf8'))
  if (manifest?.schemaVersion !== 1 || manifest?.format !== 'dshpack-zstd-v1') {
    throw new Error('Unsupported DSH runtime capsule manifest.')
  }
  if (!/^[a-f0-9]{64}$/.test(String(manifest.sha256 || ''))) throw new Error('Runtime capsule manifest has no valid SHA-256.')
  if (!Array.isArray(manifest.required) || manifest.required.length === 0) throw new Error('Runtime capsule manifest has no required-file contract.')
  return manifest
}

async function readyRuntime(target, manifest) {
  let ready
  try {
    ready = JSON.parse(await readFile(path.join(target, READY_FILE), 'utf8'))
  } catch {
    return false
  }
  if (ready?.schemaVersion !== 1 || ready?.sha256 !== manifest.sha256) return false
  for (const relative of manifest.required) {
    const safe = safeRelativePath(relative)
    if (!safe || !existsSync(path.join(target, ...safe.split('/')))) return false
  }
  return true
}

async function waitForReady(target, manifest, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await readyRuntime(target, manifest)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function extractPayload(payload, target, expectedCount, progress = () => {}) {
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Runtime capsule magic is invalid.')
  const headerLength = payload.readUInt32LE(MAGIC.length)
  if (headerLength <= 0 || HEADER_BYTES + headerLength > payload.length) throw new Error('Runtime capsule header is invalid.')
  const header = JSON.parse(payload.subarray(HEADER_BYTES, HEADER_BYTES + headerLength).toString('utf8'))
  if (header?.schemaVersion !== 1 || !Array.isArray(header.files)) throw new Error('Runtime capsule file index is invalid.')
  if (Number.isSafeInteger(expectedCount) && header.files.length !== expectedCount) throw new Error('Runtime capsule file count does not match its manifest.')

  let offset = HEADER_BYTES + headerLength
  const files = []
  const directories = new Set()
  for (const entry of header.files) {
    const relative = safeRelativePath(entry?.path)
    const size = Number(entry?.size)
    if (!relative || !Number.isSafeInteger(size) || size < 0 || offset + size > payload.length) {
      throw new Error('Runtime capsule contains an unsafe or truncated entry.')
    }
    const bytes = payload.subarray(offset, offset + size)
    offset += size
    if (entry.sha256 && sha256(bytes) !== entry.sha256) throw new Error(`Runtime capsule entry failed verification: ${relative}`)
    const filename = path.join(target, ...relative.split('/'))
    directories.add(path.dirname(filename))
    files.push({ filename, bytes })
  }
  if (offset !== payload.length) throw new Error('Runtime capsule contains trailing data.')
  progress('extract-index-verified', { files: files.length, directories: directories.size })
  // The extraction root is new. Create each ancestor once, parent levels first,
  // instead of repeatedly walking the same ancestor chain with recursive mkdir.
  const levels = new Map()
  const unique = new Set()
  for (const leaf of directories) {
    for (let directory = leaf; directory !== target; directory = path.dirname(directory)) {
      if (unique.has(directory)) break
      unique.add(directory)
      const depth = path.relative(target, directory).split(path.sep).length
      if (!levels.has(depth)) levels.set(depth, [])
      levels.get(depth).push(directory)
    }
  }
  for (const [, level] of [...levels].sort(([a], [b]) => a - b)) {
    for (let index = 0; index < level.length; index += 64) {
      await Promise.all(level.slice(index, index + 64).map(directory => mkdir(directory)))
    }
  }
  progress('extract-directories-ready')
  // Keep a bounded queue busy instead of waiting for the slowest write in each
  // batch. Drain in-flight writes before propagating errors and deleting staging.
  let next = 0
  let completed = 0
  let failure
  await Promise.all(Array.from({ length: Math.min(32, files.length) }, async () => {
    while (!failure && next < files.length) {
      const { filename, bytes } = files[next++]
      try { await writeFile(filename, bytes) } catch (error) { failure ??= error; return }
      completed++
      if (completed % 1024 === 0 || completed === files.length) progress('extract-files-progress', { completed, total: files.length })
    }
  }))
  if (failure) throw failure
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    // EPERM means the process exists but this user cannot signal it. Failing
    // closed avoids deleting another live preparer's lock.
    return true
  }
}

async function waitForMissing(filename, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (existsSync(filename) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  return !existsSync(filename)
}

async function readLock(filename) {
  try {
    const text = (await readFile(filename, 'utf8')).trim()
    if (/^\d+$/.test(text)) return { pid: Number(text), legacy: true }
    const value = JSON.parse(text)
    return {
      pid: Number(value?.pid),
      token: typeof value?.token === 'string' ? value.token : '',
      schemaVersion: Number(value?.schemaVersion),
    }
  } catch {
    return null
  }
}

async function reclaimCrashedLock(filename) {
  const prior = await readLock(filename)
  if (!prior || processExists(prior.pid)) return false
  // Re-read immediately before removal. A different preparer may have replaced
  // the file between the first read and the liveness check.
  const current = await readLock(filename)
  if (!current || current.pid !== prior.pid || current.token !== prior.token) return false
  await rm(filename, { force: true })
  return true
}

async function acquireLock(filename) {
  await mkdir(path.dirname(filename), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(filename, 'wx')
      const token = randomUUID()
      await handle.writeFile(`${JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
      })}\n`, 'utf8')
      return async () => {
        await handle.close().catch(() => {})
        const owned = await readLock(filename)
        if (owned?.pid === process.pid && owned?.token === token) await rm(filename, { force: true }).catch(() => {})
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (attempt === 0 && await reclaimCrashedLock(filename)) continue
      return null
    }
  }
  return null
}

export async function acquireRuntimeLease(runtimeRoot, options = {}) {
  const target = path.resolve(runtimeRoot)
  const hash = path.basename(target)
  const cacheParent = path.dirname(target)
  if (!HASH_PATTERN.test(hash)) return async () => {}

  await mkdir(cacheParent, { recursive: true })
  const gcLock = runtimeGcLock(cacheParent, hash)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!await waitForMissing(gcLock, options.waitMs)) throw new Error('The DSH runtime cache is currently being maintained.')
    const token = randomUUID()
    const leaseFile = path.join(cacheParent, `${runtimeLeasePrefix(hash)}${process.pid}.${token}.json`)
    const handle = await open(leaseFile, 'wx')
    await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, pid: process.pid, token, startedAt: new Date().toISOString() })}\n`, 'utf8')
    await handle.close()
    if (existsSync(gcLock)) {
      await rm(leaseFile, { force: true }).catch(() => {})
      continue
    }
    const release = async () => {
      const owned = await readLock(leaseFile)
      if (owned?.pid === process.pid && owned?.token === token) await rm(leaseFile, { force: true }).catch(() => {})
    }
    release.filename = leaseFile
    return release
  }
  throw new Error('The DSH runtime cache changed while it was being opened.')
}

async function activeRuntimeLeases(cacheParent, hash, { reclaimStale = false } = {}) {
  let names = []
  try { names = await readdir(cacheParent) } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const active = []
  for (const name of names.filter((value) => value.startsWith(runtimeLeasePrefix(hash)) && value.endsWith('.json'))) {
    const filename = path.join(cacheParent, name)
    const lease = await readLock(filename)
    // A killed writer may leave empty JSON; our own UUID filename still records
    // its PID. Unknown filenames remain protected rather than guessed away.
    const namedOwner = /^([1-9][0-9]*)\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.exec(name.slice(runtimeLeasePrefix(hash).length))
    const pid = lease?.pid ?? (namedOwner ? Number(namedOwner[1]) : null)
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      // An unreadable lease is not evidence that its owner has exited.
      if (existsSync(filename)) active.push({ filename, pid: null, uncertain: true })
    } else if (processExists(pid)) active.push({ filename, pid })
    else if (reclaimStale) await rm(filename, { force: true }).catch(() => {})
  }
  return active
}

async function directoryFootprint(root) {
  let bytes = 0
  let files = 0
  const entries = await readdir(root, { withFileTypes: true })
  const regularFiles = entries.filter(entry => entry.isFile() && !entry.isSymbolicLink())
  for (let index = 0; index < regularFiles.length; index += 32) {
    const sizes = await Promise.all(regularFiles.slice(index, index + 32).map(async entry =>
      (await stat(path.join(root, entry.name))).size))
    bytes += sizes.reduce((total, size) => total + size, 0)
    files += sizes.length
  }
  // Traverse directories serially so concurrency stays bounded at every depth.
  for (const entry of entries) {
    const filename = path.join(root, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const nested = await directoryFootprint(filename)
      bytes += nested.bytes
      files += nested.files
    }
  }
  return { bytes, files }
}

export async function commitRuntimeDirectory(temporary, target, options = {}) {
  const renameImpl = options.renameImpl ?? rename
  const sleepImpl = options.sleepImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const platform = options.platform ?? process.platform
  const retryDelays = [100, 250, 500, 1000]
  const retryableCodes = new Set(['EPERM', 'EBUSY', 'EACCES'])

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await renameImpl(temporary, target)
    } catch (error) {
      if (platform !== 'win32' || !retryableCodes.has(error?.code) || attempt >= retryDelays.length) throw error
      options.onRetry?.({ attempt: attempt + 1, delayMs: retryDelays[attempt], code: error.code })
      await sleepImpl(retryDelays[attempt])
    }
  }
}

export async function runtimeCacheStatus(root, options = {}) {
  const paths = capsulePaths(root, options.env)
  if (paths.mode === 'expanded') return { mode: 'expanded', caches: [], bytes: 0, files: 0, complete: true, errors: [] }
  const manifest = await readManifest(paths.manifestFile)
  let names = []
  try { names = await readdir(paths.cacheParent, { withFileTypes: true }) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const caches = []
  const errors = []
  for (const entry of names) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const incomplete = INCOMPLETE_CACHE_PATTERN.exec(entry.name)
    if (!incomplete && !HASH_PATTERN.test(entry.name)) continue
    const hash = incomplete ? incomplete[1] : entry.name
    const target = path.join(paths.cacheParent, entry.name)
    try {
      const footprint = await directoryFootprint(target)
      const leases = await activeRuntimeLeases(paths.cacheParent, hash)
      caches.push({ hash, current: !incomplete && hash === manifest.sha256,
        active: incomplete ? processExists(Number(incomplete[2])) : leases.length > 0,
        ...(incomplete ? { incomplete: true, directory: entry.name } : {}),
        ...(leases.some(lease => lease.uncertain) ? { uncertainLease: true } : {}), ...footprint })
    } catch (error) {
      if (error?.code === 'ENOENT' && !existsSync(target)) continue
      errors.push({ directory: entry.name, code: error?.code || 'unknown' })
    }
  }
  return {
    mode: 'capsule',
    cacheParent: paths.cacheParent,
    currentHash: manifest.sha256,
    caches,
    bytes: caches.reduce((sum, item) => sum + item.bytes, 0),
    files: caches.reduce((sum, item) => sum + item.files, 0),
    complete: errors.length === 0,
    errors,
  }
}

export async function cleanUnusedRuntimeCaches(root, options = {}) {
  const paths = capsulePaths(root, options.env)
  if (paths.mode !== 'capsule') return { mode: 'expanded', caches: [], removed: [], retained: [] }
  const manifest = await readManifest(paths.manifestFile)
  let names = []
  try { names = await readdir(paths.cacheParent, { withFileTypes: true }) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const removed = []
  const retained = []
  for (const entry of names) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const incomplete = INCOMPLETE_CACHE_PATTERN.exec(entry.name)
    if (!incomplete && !HASH_PATTERN.test(entry.name)) continue
    const hash = incomplete ? incomplete[1] : entry.name
    const identity = incomplete ? { hash, directory: entry.name, incomplete: true } : { hash }
    if (incomplete && (Date.now() - Number(incomplete[3]) < INCOMPLETE_CACHE_GRACE_MS
        || !Number.isSafeInteger(Number(incomplete[2])) || processExists(Number(incomplete[2])))) {
      retained.push({ ...identity, reason: 'incomplete-recent-or-active' })
      continue
    }
    if (!incomplete && hash === manifest.sha256) {
      retained.push({ ...identity, reason: 'current' })
      continue
    }
    const gcLock = runtimeGcLock(paths.cacheParent, hash)
    let release
    let releasePreparation
    try {
      release = await acquireLock(gcLock)
      if (!release) {
        retained.push({ ...identity, reason: 'busy' })
        continue
      }
      // A preparer can have passed the GC check before we acquired its lock.
      // Serialize against its commit, not only against consumers' leases.
      releasePreparation = await acquireLock(path.join(paths.cacheParent, `${hash}.lock`))
      if (!releasePreparation) {
        retained.push({ ...identity, reason: 'preparing' })
        continue
      }
      if ((!incomplete && (await activeRuntimeLeases(paths.cacheParent, hash, { reclaimStale: true })).length > 0)
          || (incomplete && processExists(Number(incomplete[2])))) {
        retained.push({ ...identity, reason: 'active' })
        continue
      }
      const target = path.join(paths.cacheParent, entry.name)
      if (path.dirname(target) !== path.resolve(paths.cacheParent)
          || (!HASH_PATTERN.test(path.basename(target)) && !INCOMPLETE_CACHE_PATTERN.test(path.basename(target)))) {
        throw new Error('Refusing to clean an unsafe runtime cache path.')
      }
      const footprint = await directoryFootprint(target)
      await rm(target, { recursive: true, force: true })
      removed.push({ ...identity, ...footprint })
    } catch (error) {
      if (error?.code === 'ENOENT' && !existsSync(path.join(paths.cacheParent, entry.name))) continue
      retained.push({ ...identity, reason: 'cleanup-failed', code: error?.code || 'unknown' })
    } finally {
      try { await releasePreparation?.() } finally { await release?.() }
    }
  }
  return { mode: 'capsule', cacheParent: paths.cacheParent, currentHash: manifest.sha256, removed, retained }
}

export async function ensureRuntimeCapsule(root, options = {}) {
  const progress = (phase, fields = {}) => { try { options.onProgress?.(phase, fields) } catch { /* diagnostics cannot break preparation */ } }
  progress('cache-inspect')
  const paths = capsulePaths(root, options.env)
  if (paths.mode === 'expanded') return { mode: 'expanded', runtimeRoot: paths.runtimeRoot, reused: true }

  const manifest = await readManifest(paths.manifestFile)
  if (manifest.platform && manifest.platform !== process.platform) throw new Error('Runtime capsule does not match this operating system.')
  if (manifest.arch && manifest.arch !== process.arch) throw new Error('Runtime capsule does not match this CPU architecture.')
  const capsuleFile = path.join(paths.portableRoot, manifest.filename)
  const target = path.join(paths.cacheParent, manifest.sha256)
  if (await readyRuntime(target, manifest)) return { mode: 'capsule', runtimeRoot: target, reused: true, manifest }

  if (!await waitForMissing(runtimeGcLock(paths.cacheParent, manifest.sha256), options.waitMs)) {
    throw new Error('The DSH runtime cache is currently being maintained.')
  }

  progress('cache-lock-acquire')
  const lockFile = path.join(paths.cacheParent, `${manifest.sha256}.lock`)
  const release = await acquireLock(lockFile)
  if (!release) {
    if (await waitForReady(target, manifest, options.waitMs)) return { mode: 'capsule', runtimeRoot: target, reused: true, manifest }
    throw new Error('Another DSH-Portable instance is still preparing this runtime capsule.')
  }

  const temporary = path.join(paths.cacheParent, `.${manifest.sha256}.${process.pid}.${Date.now()}`)
  try {
    if (await readyRuntime(target, manifest)) return { mode: 'capsule', runtimeRoot: target, reused: true, manifest }
    progress('capsule-read')
    const compressed = await readFile(capsuleFile)
    if (compressed.length !== manifest.bytes || sha256(compressed) !== manifest.sha256) {
      throw new Error('Runtime capsule failed SHA-256 verification.')
    }
    await rm(temporary, { recursive: true, force: true })
    await mkdir(temporary, { recursive: true })
    progress('capsule-verified')
    const payload = zstdDecompressSync(compressed)
    progress('capsule-decompressed')
    await extractPayload(payload, temporary, manifest.fileCount, progress)
    for (const relative of manifest.required) {
      const safe = safeRelativePath(relative)
      if (!safe || !existsSync(path.join(temporary, ...safe.split('/')))) throw new Error(`Runtime capsule is incomplete: ${relative}`)
    }
    await writeFile(path.join(temporary, READY_FILE), `${JSON.stringify({ schemaVersion: 1, sha256: manifest.sha256 })}\n`, 'utf8')
    if (existsSync(target)) await rm(target, { recursive: true, force: true })
    progress('cache-commit')
    await commitRuntimeDirectory(temporary, target, options)
    progress('cache-committed')
    return { mode: 'capsule', runtimeRoot: target, reused: false, manifest }
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    await release()
  }
}
