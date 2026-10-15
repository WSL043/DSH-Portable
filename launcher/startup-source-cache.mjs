import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompress, zstdDecompressSync } from 'node:zlib'

const PACK_MAGIC = 'DSHSMALL'
const PACK_PREFIX = 'startup-modules-'

// The hash-addressed runtime is immutable. Serve the modules a start actually loads from memory instead of the disk:
// weak disks and antivirus scanners make hundreds of small reads slow.
//
// Two sources, cheapest first:
//  1. A learned pack in the user's cache directory: just the ~900 modules a real start loaded (about 2 MB packed).
//     Preparing it takes a few milliseconds.
//  2. The shipped capsule, used when no pack exists yet (first start after an install or core update): it is hashed
//     and fully inflated (about half a second), and the modules that were loaded are written out as the pack for the
//     next start.
// Both only ever serve bytes that came out of the integrity-checked capsule; mutable profile plugins and user files
// are never cached, and a module missing from the pack simply loads from disk.
export function startSourceCache(portableRoot, runtimeRoot, env = process.env, options = {}) {
  const started = performance.now()
  const sources = new Map()
  const result = { status: 'skipped', files: 0, bytes: 0, hits: 0, servedBytes: 0, prepareMs: 0 }
  let hook
  let learn = null
  const finish = () => {
    hook?.deregister(); hook = undefined
    if (learn) { try { learn() } catch { /* the pack is an optimisation only */ } learn = null }
    sources.clear()
    return { ...result }
  }
  if (env.DSH_PORTABLE_STARTUP_SOURCE_CACHE === '0' || !runtimeRoot) return { result, finish }
  try {
    const manifest = JSON.parse(readFileSync(path.join(portableRoot, 'runtime-capsule.json'), 'utf8'))
    if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || path.basename(runtimeRoot) !== manifest.sha256) return { result, finish }
    // Node resolves module URLs through directory aliases (notably /var on macOS). Resolve the root once, rather than
    // doing filesystem IO per module.
    const canonicalRoot = realpathSync(runtimeRoot)
    const cacheDir = options.cacheDir ? path.resolve(options.cacheDir) : null
    const packFile = cacheDir ? path.join(cacheDir, `${PACK_PREFIX}${manifest.sha256}.pack`) : null
    let payload
    let fromPack = false
    const loaded = new Set()
    const sourceRanges = []

    const pack = packFile ? readPack(packFile, manifest.sha256) : null
    if (pack) {
      payload = pack.payload
      fromPack = true
      for (const entry of pack.entries) {
        sources.set(path.resolve(canonicalRoot, ...entry.path.split('/')), { offset: entry.offset, end: entry.end })
        result.files++
        result.bytes += entry.end - entry.offset
      }
    } else {
      const compressed = readFileSync(path.join(portableRoot, 'runtime', 'DSH-App.dshpack'))
      if (compressed.length !== manifest.bytes || createHash('sha256').update(compressed).digest('hex') !== manifest.sha256)
        throw new Error('capsule-integrity')
      payload = zstdDecompressSync(compressed)
      if (payload.subarray(0, 8).toString('ascii') !== 'DSHPACK1') throw new Error('capsule-format')
      const headerLength = payload.readUInt32LE(8)
      const header = JSON.parse(payload.subarray(12, 12 + headerLength).toString('utf8'))
      let offset = 12 + headerLength
      for (const entry of header.files) {
        const end = offset + entry.size
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || end > payload.length) throw new Error('capsule-entry')
        if (entry.path.startsWith('app/node_modules/') && /\.(?:mjs|cjs|js|json)$/.test(entry.path)
          && !entry.path.split('/').some(part => part === '..' || part === '.')) {
          const filename = path.resolve(canonicalRoot, ...entry.path.split('/'))
          // Index byte ranges, then decode only modules actually requested. Eager decoding also loads unused
          // package-manager/tooling sources into V8.
          sources.set(filename, { offset, end })
          sourceRanges.push({ path: entry.path, filename, offset, end })
          result.files++
          result.bytes += entry.size
        }
        offset = end
      }
    }
    hook = registerHooks({ load(url, context, nextLoad) {
      const attributes = context.importAttributes || {}
      const standardAttributes = context.format === 'json'
        ? attributes.type === 'json' && Object.keys(attributes).length === 1
        : Object.keys(attributes).length === 0
      if (standardAttributes && url.startsWith('file:') && ['module', 'commonjs', 'json'].includes(context.format)) {
        const filename = fileURLToPath(url)
        const range = sources.get(filename)
        if (range !== undefined) {
          result.hits++
          result.servedBytes += range.end - range.offset
          if (!fromPack) loaded.add(filename)
          return { format: context.format, source: payload.toString('utf8', range.offset, range.end), shortCircuit: true }
        }
      }
      return nextLoad(url, context)
    } })
    if (!fromPack && packFile) {
      // Copy out only what this start loaded, so the 350 MB payload can be released before the (asynchronous) write.
      learn = () => {
        if (loaded.size < 50) return
        const chosen = sourceRanges.filter(item => loaded.has(item.filename))
        const copies = chosen.map(item => Buffer.from(payload.subarray(item.offset, item.end)))
        writePack(packFile, cacheDir, manifest.sha256, chosen.map(item => item.path), copies)
      }
    }
    result.status = 'ready'
    result.source = fromPack ? 'pack' : 'capsule'
  } catch (error) {
    finish()
    result.status = 'fallback'
    result.reason = error.code || error.message
  }
  result.prepareMs = Math.round(performance.now() - started)
  return { result, finish }
}

function readPack(packFile, capsuleSha) {
  try {
    const manifest = JSON.parse(readFileSync(`${packFile}.json`, 'utf8'))
    if (manifest.schema !== 1 || manifest.capsuleSha256 !== capsuleSha || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return null
    const compressed = readFileSync(packFile)
    if (compressed.length !== manifest.bytes || createHash('sha256').update(compressed).digest('hex') !== manifest.sha256) return null
    const payload = zstdDecompressSync(compressed)
    if (payload.subarray(0, 8).toString('ascii') !== PACK_MAGIC) return null
    const headerLength = payload.readUInt32LE(8)
    const header = JSON.parse(payload.subarray(12, 12 + headerLength).toString('utf8'))
    let offset = 12 + headerLength
    const entries = []
    for (const entry of header.files) {
      const end = offset + entry.size
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || end > payload.length
        || typeof entry.path !== 'string' || !entry.path.startsWith('app/node_modules/')
        || entry.path.split('/').some(part => part === '..' || part === '.' || part === '')) return null
      entries.push({ path: entry.path, offset, end })
      offset = end
    }
    return { payload, entries }
  } catch { return null }
}

function writePack(packFile, cacheDir, capsuleSha, paths, buffers) {
  const header = Buffer.from(JSON.stringify({ files: paths.map((p, index) => ({ path: p, size: buffers[index].length })) }))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(header.length)
  const raw = Buffer.concat([Buffer.from(PACK_MAGIC), length, header, ...buffers])
  // Compress off the start-up path; failures are ignored because the capsule route still works.
  zstdCompress(raw, (error, compressed) => {
    if (error) return
    try {
      mkdirSync(cacheDir, { recursive: true })
      const temporary = `${packFile}.${process.pid}.tmp`
      const manifest = { schema: 1, capsuleSha256: capsuleSha, sha256: createHash('sha256').update(compressed).digest('hex'), bytes: compressed.length, files: paths.length }
      writeFileSync(temporary, compressed)
      renameSync(temporary, packFile)
      writeFileSync(`${packFile}.json`, JSON.stringify(manifest))
      // Packs of runtimes that are no longer installed are dead weight.
      for (const name of readdirSync(cacheDir)) {
        if (name.startsWith(PACK_PREFIX) && !name.startsWith(`${PACK_PREFIX}${capsuleSha}.`)) rmSync(path.join(cacheDir, name), { force: true })
      }
    } catch { /* optimisation only */ }
  })
}
