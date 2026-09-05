import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as profile from '../app/vendor/dsh-portable-plugin-market/src/profile.ts'

test('native addon detection includes direct dependencies and rejects escaping package names', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-native-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const plugin = path.join(root, 'node_modules', 'example')
  await mkdir(plugin, { recursive: true })
  await writeFile(path.join(plugin, 'package.json'), JSON.stringify({ dependencies: { 'native-dep': '1.0.0' } }))
  assert.equal(profile.holdsNativeAddon('web', 'example', root), false)
  await mkdir(path.join(root, 'node_modules', 'native-dep', 'prebuilds'), { recursive: true })
  assert.equal(profile.holdsNativeAddon('web', 'example', root), true)
  assert.equal(profile.holdsNativeAddon('web', 'native-dep', root), true)
  assert.equal(profile.holdsNativeAddon('web', '../escape', root), false)
  assert.equal(profile.holdsNativeAddon('web', 'missing', root), false)
})
