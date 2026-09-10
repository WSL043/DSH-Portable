import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { preflightPluginImports } from '../app/vendor/dsh-portable-plugin-market/src/import-preflight.ts'

async function fixture(t, source, manifest = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-import-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), '{}')
  const dir = path.join(root, 'node_modules', 'candidate')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'candidate', type: 'module', main: 'index.js', ...manifest }))
  await writeFile(path.join(dir, 'index.js'), source)
  return { root, dir }
}

test('checks transitive named imports before a plugin can be activated', async t => {
  const { root, dir } = await fixture(t, "export {default} from './gate.js'")
  await writeFile(path.join(dir, 'gate.js'), "import {removed} from './host.js'; export default removed")
  await writeFile(path.join(dir, 'host.js'), 'export const current = 1')
  const result = await preflightPluginImports(root, ['candidate'])
  assert.equal(result.ok, false)
  assert.match(result.detail, /does not provide an export named 'removed'/)
})

test('uses import conditions and does not run the plugin apply function', async t => {
  const { root } = await fixture(t, "export const apply = () => { throw Error('must not apply') }", { exports: { '.': { import: './index.js', require: './missing.cjs' } } })
  assert.deepEqual(await preflightPluginImports(root, ['candidate']), { ok: true, checked: ['candidate'] })
})

test('checks bundle subpaths instead of an unrelated root entry', async t => {
  const { root, dir } = await fixture(t, "throw Error('root is not a host entry')", { exports: { '.': './index.js', './host': './host.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })
  await writeFile(path.join(dir, 'host.js'), 'export const apply = () => {}')
  await writeFile(path.join(dir, 'cordis.patch.yml'), '- insert:\n    - id: test\n      name: candidate/host\n')
  assert.deepEqual(await preflightPluginImports(root, ['candidate']), { ok: true, checked: ['candidate/host'] })
})

test('a hanging import is bounded and fails the check', async t => {
  const { root } = await fixture(t, 'await new Promise(resolve => setTimeout(resolve, 60000))')
  const result = await preflightPluginImports(root, ['candidate'], { timeoutMs: 300 })
  assert.equal(result.ok, false)
  assert.match(result.detail, /timed out/)
})

test('profile modules win, with a host fallback only for missing bare packages', async t => {
  const { root, dir } = await fixture(t, "import {current} from 'host-api'; export default current")
  const host = path.join(root, 'host')
  await mkdir(path.join(host, 'node_modules/host-api'), { recursive: true })
  await writeFile(path.join(host, 'package.json'), '{}')
  await writeFile(path.join(host, 'node_modules/host-api/package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
  await writeFile(path.join(host, 'node_modules/host-api/index.js'), 'export const current = 1')
  assert.equal((await preflightPluginImports(root, ['candidate'], { dshInstallDir: host })).ok, true)
  await mkdir(path.join(dir, 'node_modules/host-api'), { recursive: true })
  await writeFile(path.join(dir, 'node_modules/host-api/package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
  await writeFile(path.join(dir, 'node_modules/host-api/index.js'), 'export const other = 1')
  const result = await preflightPluginImports(root, ['candidate'], { dshInstallDir: host })
  assert.equal(result.ok, false)
  assert.match(result.detail, /does not provide an export named 'current'/)
})

test('configuration display names are not interpreted as loader modules', async t => {
  const { root, dir } = await fixture(t, 'export const apply = () => {}', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
  await writeFile(path.join(dir, 'cordis.patch.yml'), '- insert:\n    - id: plugin\n      name: candidate\n      config:\n        presets:\n          auto:\n            name: Auto\n- id: permission-presets\n  config:\n    presets:\n      read-only:\n        name: 只读\n')
  assert.deepEqual(await preflightPluginImports(root, ['candidate']), { ok: true, checked: ['candidate'] })
})

test('a plugin calling process.exit cannot fake a successful import', async t => {
  const { root } = await fixture(t, 'process.exit(0)')
  assert.equal((await preflightPluginImports(root, ['candidate'])).ok, false)
})
