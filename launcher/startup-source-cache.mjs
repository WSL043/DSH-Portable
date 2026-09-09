import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

// The hash-addressed runtime is immutable. Use its already shipped capsule as
// a sequential source read; never cache mutable profile plugins or user files.
export function startSourceCache(portableRoot, runtimeRoot, env = process.env) {
  const started = performance.now()
  const sources = new Map()
  const result = { status: 'skipped', files: 0, bytes: 0, hits: 0, servedBytes: 0, prepareMs: 0 }
  let hook
  const finish = () => { hook?.deregister(); hook = undefined; sources.clear(); return { ...result } }
  if (env.DSH_PORTABLE_STARTUP_SOURCE_CACHE === '0' || !runtimeRoot) return { result, finish }
  try {
    const manifest = JSON.parse(readFileSync(path.join(portableRoot, 'runtime-capsule.json'), 'utf8'))
    if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || path.basename(runtimeRoot) !== manifest.sha256) return { result, finish }
    const compressed = readFileSync(path.join(portableRoot, 'runtime', 'DSH-App.dshpack'))
    if (compressed.length !== manifest.bytes || createHash('sha256').update(compressed).digest('hex') !== manifest.sha256)
      throw new Error('capsule-integrity')
    const payload = zstdDecompressSync(compressed)
    if (payload.subarray(0, 8).toString('ascii') !== 'DSHPACK1') throw new Error('capsule-format')
    const headerLength = payload.readUInt32LE(8)
    const header = JSON.parse(payload.subarray(12, 12 + headerLength).toString('utf8'))
    let offset = 12 + headerLength
    for (const entry of header.files) {
      const end = offset + entry.size
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || end > payload.length) throw new Error('capsule-entry')
      if (entry.path.startsWith('app/node_modules/') && /\.(?:mjs|cjs|js|json)$/.test(entry.path)
        && !entry.path.split('/').some(part => part === '..' || part === '.')) {
        const filename = path.resolve(runtimeRoot, ...entry.path.split('/'))
        // Index byte ranges, then decode only modules actually requested. Eager
        // decoding also loads unused package-manager/tooling sources into V8.
        sources.set(filename, { offset, end })
        result.files++
        result.bytes += entry.size
      }
      offset = end
    }
    hook = registerHooks({ load(url, context, nextLoad) {
      if (url.startsWith('file:') && ['module', 'commonjs', 'json'].includes(context.format)) {
        const range = sources.get(fileURLToPath(url))
        if (range !== undefined) {
          result.hits++
          result.servedBytes += range.end - range.offset
          return { format: context.format, source: payload.toString('utf8', range.offset, range.end), shortCircuit: true }
        }
      }
      return nextLoad(url, context)
    } })
    result.status = 'ready'
  } catch (error) {
    finish()
    result.status = 'fallback'
    result.reason = error.code || error.message
  }
  result.prepareMs = Math.round(performance.now() - started)
  return { result, finish }
}
