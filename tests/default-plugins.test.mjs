import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { DEFAULT_PLUGINS, seedDefaultPlugins } from '../launcher/default-plugins.mjs'

const expected = Object.freeze({
  name: 'dsh-native-session-delete',
  version: '1.0.0',
  filename: 'dsh-native-session-delete.tgz',
  url: 'https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.0/dsh-native-session-delete.tgz',
  sha256: 'e51bbe07ca27f87b742438d15afc16319074a338688f8e28480bff084d74462e',
  integrity: 'sha512-PMcKj2vxJQbmWiXTnuuYRcAKWVqmGY1dRnbzYQDNgBhrgK2HmODWloFHFiS9t4EuWpSp7q5SsPfSjzlhdigYzg==',
  license: 'MIT',
  reviewedCommit: '5842dc611884da08c8a95e306a9e41ac0bcb7c7e',
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root, process.platform)
  await mkdir(path.join(root, 'default-plugins'), { recursive: true })
  await writeFile(path.join(root, 'default-plugins', expected.filename), 'verified archive fixture')
  return { root, layout }
}

test('default session-delete plugin metadata is exact and independently locked', () => {
  assert.deepEqual(DEFAULT_PLUGINS, [expected])
})

test('fresh web profile is seeded through official plugin add with a move-safe profile-relative archive', async (t) => {
  const { layout } = await fixture(t)
  const calls = []
  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync(command, args, options) {
      calls.push({ command, args, options })
      return { status: 0 }
    },
  })

  assert.equal(result.status, 'seeded')
  assert.equal(result.profile, 'web')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, layout.nodeExe)
  assert.deepEqual(calls[0].args, [
    layout.dshBin,
    'plugin', '--profile', 'web', 'add',
    'file:.dsh-portable-archives/dsh-native-session-delete.tgz',
  ])
  assert.equal(calls[0].options.cwd, path.join(layout.dshHome, 'profiles', 'web'))
  assert.equal(calls[0].options.env.DSH_HOME, layout.dshHome)
  assert.equal(
    await readFile(path.join(calls[0].options.cwd, '.dsh-portable-archives', expected.filename), 'utf8'),
    'verified archive fixture',
  )
})

test('an existing profile is never inspected, changed, or re-seeded after removal', async (t) => {
  const { layout } = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  await writeFile(path.join(profileRoot, 'user-state.json'), '{"keep":true}\n')
  let spawned = false

  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync() { spawned = true; return { status: 0 } },
  })

  assert.deepEqual(result, { status: 'skipped', profile: 'web', reason: 'profile-exists' })
  assert.equal(spawned, false)
  assert.equal(await readFile(path.join(profileRoot, 'user-state.json'), 'utf8'), '{"keep":true}\n')
})

test('an interrupted Portable-owned seed is recovered without treating it as user profile state', async (t) => {
  const { layout } = await fixture(t)
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  await mkdir(profileRoot, { recursive: true })
  await writeFile(path.join(profileRoot, '.dsh-portable-default-seed.json'), '{"schemaVersion":1}\n')
  await writeFile(path.join(profileRoot, 'partial.txt'), 'incomplete')
  let calls = 0

  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync() { calls += 1; return { status: 0 } },
  })

  assert.equal(result.status, 'seeded')
  assert.equal(calls, 1)
  await assert.rejects(readFile(path.join(profileRoot, 'partial.txt')), /ENOENT/)
  await assert.rejects(readFile(path.join(profileRoot, '.dsh-portable-default-seed.json')), /ENOENT/)
})

test('failed fresh-profile seed rolls back only that newly created profile and returns a warning', async (t) => {
  const { layout } = await fixture(t)
  const otherProfile = path.join(layout.dshHome, 'profiles', 'research')
  await mkdir(otherProfile, { recursive: true })
  await writeFile(path.join(otherProfile, 'keep.txt'), 'keep')

  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync: () => ({ status: 7, stderr: 'fixture failure' }),
  })

  assert.equal(result.status, 'warning')
  assert.equal(result.code, 'default_plugin_seed_failed')
  assert.equal(result.profileRolledBack, true)
  await assert.rejects(readFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json')), /ENOENT/)
  assert.equal(await readFile(path.join(otherProfile, 'keep.txt'), 'utf8'), 'keep')
})
