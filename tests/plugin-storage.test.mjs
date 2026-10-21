import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyPluginStorage,
  finalizePluginStorage,
  pluginStorageManifestPath,
  resolvePluginStorageEntry,
} from '../launcher/plugin-storage.mjs'

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-storage-'))
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

test('safe apply never moves a live directory; finalize migrates and links it', async () => {
  const { base, layout } = await fixture()
  const source = path.join(base, 'profile', 'pet-electron')
  try {
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, 'Preferences.json'), '{}')
    await writeManifest(layout, [{ id: 'pet-electron', link: source, target: '%DSH_DATA%/dsh-home/storages/plugin-data/pet-electron' }])

    const safe = await applyPluginStorage({ layout, mode: 'safe' })
    assert.equal(safe.entries[0].action, 'skip-live')
    assert.equal(await readFile(path.join(source, 'Preferences.json'), 'utf8'), '{}')

    const finalized = await finalizePluginStorage({ layout })
    assert.equal(finalized.failed, 0)
    assert.equal(finalized.entries[0].action, 'migrate')
    assert.equal(await readFile(path.join(source, 'Preferences.json'), 'utf8'), '{}')
    assert.equal(await readFile(path.join(layout.dataDir, 'dsh-home', 'storages', 'plugin-data', 'pet-electron', 'Preferences.json'), 'utf8'), '{}')

    const again = await finalizePluginStorage({ layout })
    assert.equal(again.entries[0].action, 'ok')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('targets must stay under data/plugin-data', async () => {
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

