import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
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

test('fresh products declare only the reviewed image viewer and existing chat manager defaults', () => {
  assert.deepEqual(Object.keys(lock.defaultPlugins).sort(), ['chatManager', 'imageViewer'])
  assert.deepEqual(DEFAULT_PLUGINS.map(plugin => plugin.name), ['dsh-image-viewer', 'dsh-chat-manager'])
  assert.equal(lock.defaultPlugins.imageViewer.version, '0.1.0-beta.9')
  assert.equal(lock.defaultPlugins.chatManager.version, '1.3.1')
})

test('a fresh product seeds both reviewed archives and promotes their update specs', async (t) => {
  const layout = await fixture(t)
  await mkdir(path.join(layout.root, 'default-plugins'), { recursive: true })
  for (const plugin of DEFAULT_PLUGINS) await writeFile(path.join(layout.root, 'default-plugins', plugin.filename), plugin.name)
  let invocation

  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync(command, args, options) {
      invocation = { command, args }
      writeFileSync(path.join(options.cwd, 'package.json'), '{"dependencies":{}}\n')
      return { status: 0 }
    },
  })

  assert.deepEqual(result, { status: 'seeded', profile: 'web', plugins: ['dsh-image-viewer', 'dsh-chat-manager'] })
  assert.equal(invocation.command, layout.nodeExe)
  assert.deepEqual(invocation.args.slice(0, 4), [layout.dshBin, 'plugin', '--profile', 'web'])
  const manifest = JSON.parse(await readFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['dsh-image-viewer'], '0.1.0-beta.9')
  assert.equal(manifest.dependencies['dsh-chat-manager'], '1.3.1')
})

test('upgrades preserve an existing profile and all user-selected plugins byte-for-byte', async (t) => {
  const layout = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  const packageJson = `${JSON.stringify({
    dependencies: {
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

test('removing a default plugin is durable because every existing profile skips seeding', async (t) => {
  const layout = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  const packageJson = '{"dependencies":{"dsh-image-viewer":"0.1.0-beta.7"}}\n'
  await writeFile(path.join(profileRoot, 'package.json'), packageJson)
  let spawned = false
  const result = await seedDefaultPlugins(layout, { spawnSync() { spawned = true; return { status: 0 } } })
  assert.deepEqual(result, { status: 'skipped', profile: 'web', reason: 'profile-exists' })
  assert.equal(spawned, false)
  assert.equal(await readFile(path.join(profileRoot, 'package.json'), 'utf8'), packageJson)
})
