import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
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
    const alias = path.join(root, 'root-alias')
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const code = `import assert from 'node:assert/strict';
      import {startSourceCache} from ${JSON.stringify(new URL('../launcher/startup-source-cache.mjs', import.meta.url).href)};
      const cache=startSourceCache(${JSON.stringify(root)},${JSON.stringify(path.join(alias, manifest.sha256))},{});
      assert.equal(cache.result.status,'ready');
      assert.equal((await import(${JSON.stringify(pathToFileURL(path.join(target, 'main.mjs')).href)})).default,41);
      assert.equal((await import(${JSON.stringify(pathToFileURL(path.join(target, 'legacy.cjs')).href)})).default,7);
      assert.equal((await import(${JSON.stringify(pathToFileURL(path.join(target, 'data.json')).href)},{with:{type:'json'}})).default.answer,42);
      assert.equal((await import(${JSON.stringify(pathToFileURL(mutable).href)})).default,99);
      await assert.rejects(import(${JSON.stringify(pathToFileURL(path.join(target, 'data.json')).href + '?no-attribute')}),{code:'ERR_IMPORT_ATTRIBUTE_MISSING'});
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

test('modules loaded by one start are packed for the next, which skips the capsule and rejects a tampered pack', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-source-pack-'))
  try {
    const app = path.join(root, 'build')
    const modules = path.join(app, 'node_modules', 'fixture')
    await mkdir(modules, { recursive: true })
    await writeFile(path.join(modules, 'package.json'), '{"type":"module"}')
    // 60 small modules: the pack is only worth writing for a real start, which loads hundreds.
    for (let index = 0; index < 60; index++) await writeFile(path.join(modules, `m${index}.mjs`), `export default ${index}`)
    const manifest = await createRuntimeCapsule(app, path.join(root, 'runtime/DSH-App.dshpack'), path.join(root, 'runtime-capsule.json'), { level: 1 })
    const runtime = path.join(root, manifest.sha256)
    const target = path.join(runtime, 'app/node_modules/fixture')
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'package.json'), '{"type":"module"}')
    // The disk copies differ so every served value proves where the bytes came from.
    for (let index = 0; index < 60; index++) await writeFile(path.join(target, `m${index}.mjs`), `export default -${index}`)
    const cacheDir = path.join(root, 'data', 'cache')
    const driver = (extra = '') => `import assert from 'node:assert/strict';
      import {startSourceCache} from ${JSON.stringify(new URL('../launcher/startup-source-cache.mjs', import.meta.url).href)};
      const cache=startSourceCache(${JSON.stringify(root)},${JSON.stringify(runtime)},{},{cacheDir:${JSON.stringify(cacheDir)}});
      console.log(JSON.stringify(cache.result));
      for (let i=0;i<60;i++) assert.equal((await import(${JSON.stringify(pathToFileURL(target).href + '/m')}+i+'.mjs')).default, i);
      ${extra}
      console.log(JSON.stringify(cache.finish()));
      await new Promise(resolve => setTimeout(resolve, 500));`
    const run = code => execFileSync(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line))
    const first = run(driver())
    assert.equal(first[0].source, 'capsule')
    assert.equal(first[1].hits, 60)
    const { readdirSync, readFileSync, writeFileSync } = await import('node:fs')
    const names = readdirSync(cacheDir)
    assert.equal(names.filter(name => name.endsWith('.pack')).length, 1, 'the first start wrote a pack')
    // Remove the capsule: the second start can only succeed from the pack.
    await rm(path.join(root, 'runtime/DSH-App.dshpack'))
    const second = run(driver())
    assert.equal(second[0].status, 'ready')
    assert.equal(second[0].source, 'pack')
    assert.equal(second[1].hits, 60)
    // A modified pack fails its hash check, and with no capsule the cache then steps aside entirely.
    const packFile = path.join(cacheDir, names.find(name => name.endsWith('.pack')))
    const bytes = readFileSync(packFile)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(packFile, bytes)
    const third = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import {startSourceCache} from ${JSON.stringify(new URL('../launcher/startup-source-cache.mjs', import.meta.url).href)};
      const cache=startSourceCache(${JSON.stringify(root)},${JSON.stringify(runtime)},{},{cacheDir:${JSON.stringify(cacheDir)}});
      console.log(JSON.stringify(cache.result)); cache.finish()`], { windowsHide: true, encoding: 'utf8' })
    assert.equal(JSON.parse(third).status, 'fallback')
  } finally { await rm(root, { recursive: true, force: true }) }
})
