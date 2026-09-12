import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const root = path.resolve(process.argv[2] || '')
const output = path.resolve(process.argv[3] || '')
if (!process.argv[2] || !process.argv[3]) throw new Error('usage: node benchmark-runtime-preparation.mjs <portable-root> <output-directory> [--worker]')
// Benchmark the shipped module, not an unrelated checkout implementation.
const { ensureRuntimeCapsule, runtimeCacheStatus } = await import(pathToFileURL(path.join(root, 'launcher/runtime-capsule.mjs')))
if (process.argv[4] === '--worker') {
  const cache = await mkdtemp(path.join(os.tmpdir(), 'dsh-preparation-benchmark-'))
  try {
    const env = { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: cache }
    const phases = []
    const started = performance.now()
    const prepared = await ensureRuntimeCapsule(root, { env, onProgress: (phase, fields) => phases.push({ phase, elapsedMs: performance.now() - started, ...fields }) })
    const elapsedMs = performance.now() - started
    assert.equal(prepared.reused, false)
    const status = await runtimeCacheStatus(root, { env })
    console.log(JSON.stringify({ pool: Number(process.env.UV_THREADPOOL_SIZE), elapsedMs, files: status.files, bytes: status.bytes, phases }))
  } finally {
    assert.equal(path.dirname(cache), os.tmpdir())
    assert.ok(path.basename(cache).startsWith('dsh-preparation-benchmark-'))
    await rm(cache, { recursive: true, force: true })
  }
} else {
  await mkdir(output, { recursive: true })
  const manifest = JSON.parse(await readFile(path.join(root, 'runtime-capsule.json'), 'utf8'))
  const records = []
  for (let round = 0; round < 3; round++) {
    for (const pool of round % 2 ? [16, 4] : [4, 16]) {
      const result = await promisify(execFile)(process.execPath, [path.resolve(process.argv[1]), root, output, '--worker'], {
        env: { ...process.env, UV_THREADPOOL_SIZE: String(pool) }, windowsHide: true, timeout: 180000,
      })
      records.push({ round, ...JSON.parse(result.stdout) })
      await writeFile(path.join(output, 'samples.json'), JSON.stringify({ capsuleSha256: manifest.sha256, node: process.version, records }, null, 2))
    }
  }
  assert.ok(records.every(record => record.files === records[0].files && record.bytes === records[0].bytes))
  const medians = Object.fromEntries([4, 16].map(pool => [pool, records.filter(record => record.pool === pool).map(record => record.elapsedMs).sort((a, b) => a - b)[1]]))
  const summary = { capsuleSha256: manifest.sha256, medians, improvementPercent: (1 - medians[16] / medians[4]) * 100,
    limitation: 'Fresh runtime cache per sample; OS/Defender caches are not reset. Measures preparation, not total startup. Does not change product defaults.' }
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
}
