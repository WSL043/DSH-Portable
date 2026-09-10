import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCheckedPluginMutation } from '../launcher/plugin-command-check.mjs'

for (const recovers of [true, false]) test(`CLI import failure restores configuration; dependency recovery=${recovers}`, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-cli-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = '{"dsh":{"profile":{"bundles":[]}}}\n'
  await writeFile(path.join(root, 'package.json'), original)
  await writeFile(path.join(root, 'pnpm-lock.yaml'), 'original lock\n')
  await writeFile(path.join(root, 'session.jsonl'), 'keep\n')
  let restored = false
  const result = await runCheckedPluginMutation({
    profileRoot: root, layout: { logsDir: path.join(root, 'logs'), dshBin: path.join(root, 'lib/bin.js') },
    run: async () => {
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['bad-plugin'] } } }))
      await writeFile(path.join(root, 'pnpm-lock.yaml'), 'changed')
      return { status: 0 }
    },
    preflight: async (_root, packages) => { assert.deepEqual(packages, ['bad-plugin']); return { ok: false, detail: 'missing export' } },
    reinstall: async () => {
      assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), original)
      assert.equal(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'), 'original lock\n')
      restored = true
      return { status: recovers ? 0 : 1 }
    },
  })
  assert.equal(result.status, 1)
  assert.equal(restored, true)
  assert.match(result.stderr, recovers ? /configuration restored/ : /dependency recovery failed/)
  assert.equal(await readFile(path.join(root, 'session.jsonl'), 'utf8'), 'keep\n')
  assert.match(await readFile(path.join(root, 'logs/launcher.log'), 'utf8'), /import-check-failed/)
})

test('the shipped preflight entry rejects a real missing export', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-cli-bundle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'node_modules/bad-plugin')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(root, 'package.json'), '{}')
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'bad-plugin', type: 'module', main: 'index.js' }))
  await writeFile(path.join(dir, 'index.js'), "import {gone} from './api.js'; export default gone")
  await writeFile(path.join(dir, 'api.js'), 'export const current = 1')
  const { preflightPluginImports } = await import('../app/vendor/dsh-portable-plugin-market/lib/import-preflight.js')
  const result = await preflightPluginImports(root, ['bad-plugin'], { dshInstallDir: null })
  assert.equal(result.ok, false)
  assert.match(result.detail, /does not provide an export/)
})
