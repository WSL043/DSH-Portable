import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { DEFAULT_PLUGINS, seedDefaultPlugins } from '../launcher/default-plugins.mjs'

const lock = JSON.parse(await readFile(new URL('../upstream.lock.json', import.meta.url), 'utf8'))
const expected = Object.freeze(Object.values(lock.defaultPlugins).map(plugin => Object.freeze({
  name: plugin.package,
  version: plugin.version,
  filename: plugin.filename,
  url: plugin.url,
  sha256: plugin.sha256,
  integrity: plugin.integrity,
  license: plugin.license,
  reviewedCommit: plugin.reviewedCommit,
})))

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root, process.platform)
  await mkdir(path.join(root, 'default-plugins'), { recursive: true })
  for (const plugin of expected) {
    await writeFile(path.join(root, 'default-plugins', plugin.filename), `verified archive fixture: ${plugin.name}`)
  }
  return { root, layout }
}

test('default plugin metadata is exact and independently locked', () => {
  assert.deepEqual(DEFAULT_PLUGINS, expected)
  assert.deepEqual(
    DEFAULT_PLUGINS.map(plugin => plugin.name),
    ['dsh-chat-manager', 'dsh-image-viewer'],
    'fresh profiles must use the current canonical package identities',
  )
})

test('a product channel can explicitly ship no default plugins without creating a profile', async (t) => {
  const { root, layout } = await fixture(t)
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), '{"defaultPlugins":[]}\n')
  let spawned = false
  const result = await seedDefaultPlugins(layout, {
    spawnSync() { spawned = true; return { status: 0 } },
  })

  assert.deepEqual(result, { status: 'skipped', profile: 'web', reason: 'no-compatible-defaults' })
  assert.equal(spawned, false)
  await assert.rejects(readFile(path.join(layout.dshHome, 'profiles', 'web', 'package.json')), /ENOENT/)
})

test('fresh web profile is seeded through official plugin add with a move-safe profile-relative archive', async (t) => {
  const { layout } = await fixture(t)
  const calls = []
  const result = await seedDefaultPlugins(layout, {
    verifyArchive: async () => true,
    spawnSync(command, args, options) {
      calls.push({ command, args, options })
      writeFileSync(path.join(options.cwd, 'package.json'), JSON.stringify({
        dependencies: Object.fromEntries(expected.map(plugin => [plugin.name, `file:.dsh-portable-archives/${plugin.filename}`])),
      }))
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
    'file:.dsh-portable-archives/dsh-chat-manager.tgz',
    'file:.dsh-portable-archives/dsh-image-viewer.tgz',
  ])
  assert.equal(calls[0].options.cwd, path.join(layout.dshHome, 'profiles', 'web'))
  assert.equal(calls[0].options.env.DSH_HOME, layout.dshHome)
  assert.equal(
    await readFile(path.join(calls[0].options.cwd, '.dsh-portable-archives', expected[1].filename), 'utf8'),
    'verified archive fixture: dsh-image-viewer',
  )
  const manifest = JSON.parse(await readFile(path.join(calls[0].options.cwd, 'package.json'), 'utf8'))
  for (const plugin of expected) assert.equal(manifest.dependencies[plugin.name], plugin.version)
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
    spawnSync(command, args, options) {
      calls += 1
      writeFileSync(path.join(options.cwd, 'package.json'), JSON.stringify({
        dependencies: Object.fromEntries(expected.map(plugin => [plugin.name, `file:.dsh-portable-archives/${plugin.filename}`])),
      }))
      return { status: 0 }
    },
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
