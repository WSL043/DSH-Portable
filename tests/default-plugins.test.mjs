import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { DEFAULT_PLUGINS, seedDefaultPlugins } from '../launcher/default-plugins.mjs'

const lock = JSON.parse(await readFile(new URL('../upstream.lock.json', import.meta.url), 'utf8'))

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return layoutForRoot(root, process.platform)
}

test('fresh products declare no default community plugins', () => {
  assert.deepEqual(lock.defaultPlugins, {})
  assert.deepEqual(DEFAULT_PLUGINS, [])
})

test('a fresh product does not create a profile or invoke DSH plugin installation', async (t) => {
  const layout = await fixture(t)
  let spawned = false

  const result = await seedDefaultPlugins(layout, {
    spawnSync() { spawned = true; return { status: 0 } },
  })

  assert.deepEqual(result, { status: 'skipped', profile: 'web', reason: 'no-compatible-defaults' })
  assert.equal(spawned, false)
  await assert.rejects(readFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json')), /ENOENT/)
})

test('upgrades preserve an existing profile and all user-selected plugins byte-for-byte', async (t) => {
  const layout = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  const packageJson = `${JSON.stringify({
    dependencies: {
      'dsh-chat-manager': '1.2.2',
      'dsh-image-viewer': '0.1.0-beta.7',
      'user-selected-plugin': '3.1.4',
    },
  }, null, 2)}\n`
  await mkdir(profileRoot, { recursive: true })
  await writeFile(path.join(profileRoot, 'package.json'), packageJson)
  let spawned = false

  const result = await seedDefaultPlugins(layout, {
    spawnSync() { spawned = true; return { status: 0 } },
  })

  assert.deepEqual(result, { status: 'skipped', profile: 'web', reason: 'profile-exists' })
  assert.equal(spawned, false)
  assert.equal(await readFile(path.join(profileRoot, 'package.json'), 'utf8'), packageJson)
})
