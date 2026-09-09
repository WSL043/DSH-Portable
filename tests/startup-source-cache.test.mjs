import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { createRuntimeCapsule } from '../scripts/create-runtime-capsule.mjs'
import { startSourceCache } from '../launcher/startup-source-cache.mjs'

test('startup cache preserves ESM, CommonJS and JSON, leaves profile files alone and releases hooks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-source-cache-'))
  try {
    const app = path.join(root, 'build')
    await mkdir(path.join(app, 'node_modules', 'fixture'), { recursive: true })
    const sources = { 'package.json': '{"type":"module"}', 'main.mjs': 'export default 41', 'legacy.cjs': 'module.exports = 7', 'data.json': '{"answer":42}' }
    for (const [name, source] of Object.entries(sources)) await writeFile(path.join(app, 'node_modules', 'fixture', name), source)
    const manifest = await createRuntimeCapsule(app, path.join(root, 'runtime/DSH-App.dshpack'), path.join(root, 'runtime-capsule.json'), { level: 1 })
    const runtime = path.join(root, manifest.sha256)
    const target = path.join(runtime, 'app/node_modules/fixture')
    await mkdir(target, { recursive: true })
    for (const [name, source] of Object.entries(sources)) await writeFile(path.join(target, name), name === 'package.json' ? source : name === 'data.json' ? '{"answer":0}' : 'throw Error("disk source read")')
    const mutable = path.join(root, 'profile.mjs')
    await writeFile(mutable, 'export default 99')
    const code = `import assert from 'node:assert/strict';
      import {startSourceCache} from ${JSON.stringify(new URL('../launcher/startup-source-cache.mjs', import.meta.url).href)};
      const cache=startSourceCache(${JSON.stringify(root)},${JSON.stringify(runtime)},{});
      assert.equal(cache.result.status,'ready');
      assert.equal((await import(${JSON.stringify(pathToFileURL(path.join(target, 'main.mjs')).href)})).default,41);
      assert.equal((await import(${JSON.stringify(pathToFileURL(path.join(target, 'legacy.cjs')).href)})).default,7);
      assert.equal((await import(${JSON.stringify(pathToFileURL(path.join(target, 'data.json')).href)},{with:{type:'json'}})).default.answer,42);
      assert.equal((await import(${JSON.stringify(pathToFileURL(mutable).href)})).default,99);
      assert.equal(cache.finish().hits,3);
      await assert.rejects(import(${JSON.stringify(pathToFileURL(path.join(target, 'main.mjs')).href + '?after')}),/disk source read/);`
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true })
    await writeFile(path.join(root, 'runtime/DSH-App.dshpack'), 'damaged')
    const corrupt = startSourceCache(root, runtime, {})
    assert.equal(corrupt.result.status, 'fallback')
    assert.equal(corrupt.result.reason, 'capsule-integrity')
    corrupt.finish()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing capsule falls back and explicit disable does not read one', () => {
  const fallback = startSourceCache(path.join(os.tmpdir(), 'missing-dsh-capsule'), 'runtime', {})
  assert.equal(fallback.result.status, 'fallback')
  fallback.finish()
  assert.equal(startSourceCache('', '', { DSH_PORTABLE_STARTUP_SOURCE_CACHE: '0' }).result.status, 'skipped')
})
