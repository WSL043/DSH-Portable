import assert from 'node:assert/strict'
import { lstat, mkdtemp, mkdir, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyPluginStorage,
  pluginStorageManifestPath,
  pluginStorageRoot,
  resolvePluginStorageEntry,
} from '../launcher/plugin-storage.mjs'

async function fixture() {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-storage-')))
  const root = path.join(base, 'portable')
  const dataDir = path.join(root, 'data')
  const dshHome = path.join(dataDir, 'dsh-home')
  await mkdir(dshHome, { recursive: true })
  const layout = { root, dataDir, dshHome }
  return { base, root, dataDir, dshHome, layout }
}

async function writeManifest(layout, links) {
  await writeFile(pluginStorageManifestPath(layout.dataDir), JSON.stringify({ version: 1, links }, null, 2))
}

async function linkStat(filename) {
  try { return await stat(filename) } catch { return null }
}

test('safe apply creates a link for an absent source and is idempotent', async () => {
  const { base, layout } = await fixture()
  const source = path.join(base, 'profile', '.dsh', 'memory')
  try {
    await writeManifest(layout, [{ id: 'memory', link: source, target: '%DSH_DATA%/dsh-home/storages/plugin-data/memory' }])
    const first = await applyPluginStorage({ layout, mode: 'safe' })
    assert.equal(first.failed, 0)
    assert.equal(first.entries[0].action, 'link')
    assert.ok((await linkStat(source)).isDirectory())
    await writeFile(path.join(layout.dataDir, 'dsh-home', 'storages', 'plugin-data', 'memory', 'probe.txt'), 'portable')
    assert.equal(await readFile(path.join(source, 'probe.txt'), 'utf8'), 'portable')

    const second = await applyPluginStorage({ layout, mode: 'safe' })
    assert.equal(second.failed, 0)
    assert.equal(second.entries[0].action, 'ok')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('safe apply preserves real directories; explicit migration links them and keeps the backup', async () => {
  const { base, layout } = await fixture()
  const source = path.join(base, 'profile', 'pet-electron')
  try {
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, 'Preferences.json'), '{}')
    await writeManifest(layout, [{ id: 'pet-electron', link: source, target: '%DSH_DATA%/dsh-home/storages/plugin-data/pet-electron' }])

    const safe = await applyPluginStorage({ layout, mode: 'safe' })
    assert.equal(safe.entries[0].action, 'skip-live')
    assert.equal(await readFile(path.join(source, 'Preferences.json'), 'utf8'), '{}')

    const finalized = await applyPluginStorage({ layout, mode: 'migrate' })
    assert.equal(finalized.failed, 0, finalized.entries[0].error)
    assert.equal(finalized.entries[0].action, 'migrate')
    assert.equal(await readFile(path.join(source, 'Preferences.json'), 'utf8'), '{}')
    assert.equal(await readFile(path.join(layout.dataDir, 'dsh-home', 'storages', 'plugin-data', 'pet-electron', 'Preferences.json'), 'utf8'), '{}')
    assert.ok((await lstat(source)).isSymbolicLink())
    assert.match(finalized.entries[0].backup, /\.pre-portable-/)
    assert.equal(await readFile(path.join(finalized.entries[0].backup, 'Preferences.json'), 'utf8'), '{}')

    const again = await applyPluginStorage({ layout, mode: 'migrate' })
    assert.equal(again.entries[0].action, 'ok')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('targets must stay under dsh-home/storages/plugin-data', async () => {
  const { base, layout } = await fixture()
  try {
    await writeManifest(layout, [{ id: 'escape', link: path.join(base, 'profile', 'x'), target: '%DSH_DATA%/dsh-home/../escape' }])
    await assert.rejects(
      () => applyPluginStorage({ layout, mode: 'safe' }),
      /target must stay under/,
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('existing targets and foreign links are left unchanged, including empty source directories', async () => {
  const { base, layout } = await fixture()
  try {
    for (const populated of [false, true]) {
      const id = populated ? 'populated' : 'empty'
      const source = path.join(base, 'profile', id)
      const target = path.join(pluginStorageRoot(layout.dataDir), id)
      await mkdir(source, { recursive: true })
      await mkdir(target, { recursive: true })
      if (populated) {
        await writeFile(path.join(source, 'state.txt'), 'host')
        await writeFile(path.join(target, 'state.txt'), 'portable')
      }
      await writeManifest(layout, [{ id, link: source, target }])
      assert.equal((await applyPluginStorage({ layout })).entries[0].action, 'skip-live')
      const result = await applyPluginStorage({ layout, mode: 'migrate' })
      assert.equal(result.failed, 1)
      assert.equal((await lstat(source)).isSymbolicLink(), false)
      if (populated) {
        assert.equal(await readFile(path.join(source, 'state.txt'), 'utf8'), 'host')
        assert.equal(await readFile(path.join(target, 'state.txt'), 'utf8'), 'portable')
      }
    }
    const source = path.join(base, 'profile', 'foreign')
    const foreign = path.join(base, 'another-portable')
    await mkdir(foreign)
    await writeFile(path.join(foreign, 'state.txt'), 'foreign')
    await symlink(foreign, source, process.platform === 'win32' ? 'junction' : 'dir')
    const original = await readlink(source)
    await writeManifest(layout, [{ id: 'foreign', link: source, target: path.join(pluginStorageRoot(layout.dataDir), 'foreign') }])
    for (const mode of ['safe', 'migrate']) {
      assert.equal((await applyPluginStorage({ layout, mode })).failed, 1)
      assert.equal(await readlink(source), original)
      assert.equal(await readFile(path.join(foreign, 'state.txt'), 'utf8'), 'foreign')
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('junction ancestors and links inside a migration source cannot redirect storage', async () => {
  const { base, layout } = await fixture()
  const kind = process.platform === 'win32' ? 'junction' : 'dir'
  try {
    const outside = path.join(base, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'state.txt'), 'outside')
    const alias = path.join(base, 'profile-alias')
    await symlink(outside, alias, kind)
    await writeManifest(layout, [{ id: 'source-parent', link: path.join(alias, 'new'), target: path.join(pluginStorageRoot(layout.dataDir), 'source-parent') }])
    assert.equal((await applyPluginStorage({ layout })).failed, 1)
    await assert.rejects(lstat(path.join(outside, 'new')), { code: 'ENOENT' })

    const targetAlias = path.join(pluginStorageRoot(layout.dataDir), 'alias')
    await mkdir(path.dirname(targetAlias), { recursive: true })
    await symlink(outside, targetAlias, kind)
    const source = path.join(base, 'profile', 'state')
    await writeManifest(layout, [{ id: 'target-parent', link: source, target: path.join(targetAlias, 'new') }])
    assert.equal((await applyPluginStorage({ layout })).failed, 1)
    await assert.rejects(lstat(source), { code: 'ENOENT' })
    await assert.rejects(lstat(path.join(outside, 'new')), { code: 'ENOENT' })

    await mkdir(source)
    await symlink(outside, path.join(source, 'external'), kind)
    await writeManifest(layout, [{ id: 'inner-link', link: source, target: path.join(pluginStorageRoot(layout.dataDir), 'inner-link') }])
    const result = await applyPluginStorage({ layout, mode: 'migrate' })
    assert.equal(result.failed, 1)
    assert.match(result.entries[0].error, /Unsupported plugin storage entry/)
    assert.equal((await lstat(source)).isSymbolicLink(), false)
    assert.equal(await readFile(path.join(source, 'external', 'state.txt'), 'utf8'), 'outside')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('relative paths, portable ancestors and overlapping entries fail before applying any links', async () => {
  const { base, layout } = await fixture()
  try {
    const target = path.join(pluginStorageRoot(layout.dataDir), 'state')
    for (const link of ['relative/state', base, path.join(layout.root, 'state')]) {
      assert.throws(() => resolvePluginStorageEntry({ id: 'invalid', link, target }, layout), /absolute|outside/)
    }
    assert.throws(() => resolvePluginStorageEntry({ id: 'invalid', link: path.join(base, 'profile'), target: 'relative/target' }, layout), /absolute/)
    for (const overlapTarget of [false, true]) {
      const source = path.join(base, 'profile', 'first')
      await writeManifest(layout, [
        { id: 'first', link: source, target },
        { id: 'second', link: overlapTarget ? path.join(base, 'profile', 'second') : path.join(source, 'nested'), target: overlapTarget ? path.join(target, 'nested') : `${target}-second` },
      ])
      await assert.rejects(() => applyPluginStorage({ layout, mode: 'migrate' }), /Overlapping/)
      await assert.rejects(lstat(source), { code: 'ENOENT' })
      await assert.rejects(lstat(target), { code: 'ENOENT' })
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a source lock blocks both modes and is never stolen or removed', async () => {
  const { base, layout } = await fixture()
  try {
    const source = path.join(base, 'profile', 'locked')
    const target = path.join(pluginStorageRoot(layout.dataDir), 'locked')
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, 'state.txt'), 'host')
    const lock = `${source}.dsh-portable-lock`
    await writeFile(lock, 'another portable copy')
    await writeManifest(layout, [{ id: 'locked', link: source, target }])
    for (const mode of ['safe', 'migrate']) {
      assert.equal((await applyPluginStorage({ layout, mode })).failed, 1)
      assert.equal(await readFile(lock, 'utf8'), 'another portable copy')
      assert.equal(await readFile(path.join(source, 'state.txt'), 'utf8'), 'host')
      await assert.rejects(lstat(target), { code: 'ENOENT' })
    }
    await rm(lock)
    const migrated = await applyPluginStorage({ layout, mode: 'migrate' })
    assert.equal(migrated.failed, 0, migrated.entries[0].error)
    await assert.rejects(lstat(lock), { code: 'ENOENT' })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('env tokens expand for link and target', async () => {
  const { base, layout } = await fixture()
  try {
    const entry = resolvePluginStorageEntry(
      { id: 'tmp', link: '%PLUGIN_TEST_HOME%/memory', target: '%DSH_DATA%/dsh-home/storages/plugin-data/tmp' },
      layout,
      { env: { ...process.env, PLUGIN_TEST_HOME: path.join(base, 'profile') } },
    )
    assert.equal(entry.link, path.join(base, 'profile', 'memory'))
    assert.equal(entry.target, path.join(layout.dataDir, 'dsh-home', 'storages', 'plugin-data', 'tmp'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

