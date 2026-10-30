import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyDefaultPluginPeers } from '../scripts/verify-default-plugin-peers.mjs'
import { assertNoDefaultPluginInstalls } from '../scripts/verify-default-plugin-ui.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-no-defaults-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'default-plugins'))
  return root
}

test('empty declared defaults require no pnpm store and reject undeclared or missing archives', async t => {
  const root = await fixture(t)
  const lock = path.join(root, 'lock.json')
  await writeFile(lock, JSON.stringify({ defaultPlugins: {} }))
  const script = fileURLToPath(new URL('../scripts/prepare-default-plugin-store.mjs', import.meta.url))
  const run = () => execFileSync(process.execPath, [script, root, root, lock], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' })
  assert.match(run(), /No default plugins declared/)
  assert.deepEqual(await verifyDefaultPluginPeers(root, { defaultPlugins: [] }), [])
  await writeFile(path.join(root, 'default-plugins', 'unexpected.tgz'), 'not a reviewed archive')
  assert.throws(run, /declared default-plugin archives/)
  await assert.rejects(verifyDefaultPluginPeers(root, { defaultPlugins: [] }), /packaged default plugin archives/)
  await writeFile(lock, JSON.stringify({ defaultPlugins: { image: { filename: 'dsh-image-viewer.tgz' } } }))
  assert.throws(run, /declared default-plugin archives/)
})

test('native no-default acceptance verifies installed files and profile dependencies', async t => {
  const root = await fixture(t)
  assert.deepEqual(await assertNoDefaultPluginInstalls(root), [])
  const profile = path.join(root, 'data/dsh-home/profiles/web')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-chat-manager': '1.5.19' } }))
  await assert.rejects(assertNoDefaultPluginInstalls(root), /must not be a profile dependency/)
  await writeFile(path.join(profile, 'package.json'), '{}')
  const installed = path.join(profile, 'node_modules/dsh-image-viewer')
  await mkdir(installed, { recursive: true })
  await writeFile(path.join(installed, 'package.json'), '{}')
  await assert.rejects(assertNoDefaultPluginInstalls(root), /must not be automatically installed/)
})
