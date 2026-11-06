import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { OFFICIAL_MARKET_BUNDLE, ensureOfficialMarket } from '../launcher/official-market.mjs'

async function bed(t, { shipped = true, bundles = ['dsh-image-viewer'], patch, fresh = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'official-market-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  const nodeModules = path.join(root, 'app', 'node_modules')
  if (!fresh || patch !== undefined) await mkdir(profile, { recursive: true })
  await mkdir(path.join(nodeModules, '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
  if (shipped) {
    await mkdir(path.join(nodeModules, ...OFFICIAL_MARKET_BUNDLE.split('/')), { recursive: true })
    await writeFile(path.join(nodeModules, ...OFFICIAL_MARKET_BUNDLE.split('/'), 'package.json'), '{}')
  }
  if (!fresh) await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'web', dsh: { profile: { bundles } } }))
  if (patch !== undefined) await writeFile(path.join(profile, 'cordis.patch.yml'), patch)
  const layout = { platform: process.platform, dshHome, dshBin: path.join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js') }
  const manifest = async () => JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
  const patchText = () => readFile(path.join(profile, 'cordis.patch.yml'), 'utf8').catch(() => null)
  return { layout, profile, manifest, patchText }
}

test('official initialization and user plugin/index choices stay untouched', async t => {
  for (const patch of [undefined, '[]\n', '- id: plugin-market\n  config:\n    indexes:\n      - https://example.com/mine.json\n']) {
    const { layout, manifest, patchText } = await bed(t, { patch, bundles: ['user-plugin', OFFICIAL_MARKET_BUNDLE] })
    const before = await manifest()
    assert.deepEqual(await ensureOfficialMarket(layout), { status: 'unchanged', actions: [] })
    assert.deepEqual(await manifest(), before)
    assert.equal(await patchText(), patch ?? null)
  }
})

test('a fresh shipped market initializes the selected official web template under its writer lock once', async t => {
  const { layout, profile, manifest, patchText } = await bed(t, { fresh: true })
  const selected = ['selected-official-web-template']
  let locked = false, initialized = 0
  const api = { PROFILE_TEMPLATES: { web: { bundles: selected } }, DEFAULT_PROFILE_BUNDLES: ['official-fallback'],
    async withFileLock(filename, callback, options) {
      assert.equal(filename, path.join(profile, 'package.json'))
      assert.equal(options.waitMs, 0)
      locked = true
      try { return await callback() } finally { locked = false }
    },
    async initProfile(directory, bundles) {
      assert.equal(locked, true)
      assert.equal(directory, profile)
      assert.equal(bundles, selected, 'use the selected runtime template without reconstructing a bundle list')
      initialized++
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'web', dependencies: {}, dsh: { profile: { bundles } } }))
    },
  }
  const first = await ensureOfficialMarket(layout, { loadProfileInitialization: async () => api,
    async writeFile(...args) { assert.equal(locked, true, 'the first offer stays under the official profile lock'); return writeFile(...args) } })
  assert.deepEqual(first, { status: 'configured', actions: ['enabled-bundle'] })
  assert.equal(initialized, 1)
  assert.deepEqual((await manifest()).dsh.profile.bundles, [...selected, OFFICIAL_MARKET_BUNDLE])
  assert.equal(await patchText(), null)
  const edited = await manifest()
  edited.dsh.profile.bundles = [...selected]
  await writeFile(path.join(profile, 'package.json'), JSON.stringify(edited))
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]\n')
  assert.deepEqual(await ensureOfficialMarket(layout, { loadProfileInitialization: () => { throw Error('existing profiles do not initialize again') } }), { status: 'unchanged', actions: [] })
  assert.deepEqual((await manifest()).dsh.profile.bundles, selected)
  assert.equal(await patchText(), '[]\n', 'a later user removal stays removed')
})

test('existing market survives a rollback to a core without it and is restored on return', async t => {
  const owned = '- id: plugin-market\n  config:\n    indexes:\n      - https://example.com/mine.json\n'
  const { layout, manifest, patchText } = await bed(t, { bundles: ['user-plugin', OFFICIAL_MARKET_BUNDLE], patch: owned })
  const old = { ...layout, dshBin: path.join(path.dirname(layout.dshBin), '..', '..', '..', '..', 'other', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') }
  assert.deepEqual((await ensureOfficialMarket(old)).actions, ['suspended-bundle'])
  assert.deepEqual((await manifest()).dsh.profile.bundles, ['user-plugin'])
  assert.deepEqual((await ensureOfficialMarket(layout)).actions, ['enabled-bundle'])
  assert.deepEqual((await manifest()).dsh.profile.bundles, ['user-plugin', OFFICIAL_MARKET_BUNDLE])
  assert.equal(await patchText(), owned)
  assert.deepEqual(await ensureOfficialMarket(layout), { status: 'unchanged', actions: [] })
})

test('old one-time offer state does not add a removed bundle or index again', async t => {
  const { layout, profile, manifest, patchText } = await bed(t, { patch: '[]\n' })
  await writeFile(path.join(profile, '.dsh-portable-official-market.json'), JSON.stringify({ bundleOffered: true, indexOffered: false }))
  assert.deepEqual(await ensureOfficialMarket(layout), { status: 'unchanged', actions: [] })
  assert.deepEqual((await manifest()).dsh.profile.bundles, ['dsh-image-viewer'])
  assert.equal(await patchText(), '[]\n')
})

test('the environment escape hatch leaves the profile untouched', async () => {
  const result = await ensureOfficialMarket({ platform: 'win32' }, { env: { DSH_PORTABLE_OFFICIAL_MARKET: '0' }, existsSync: () => { throw Error('must not read') } })
  assert.equal(result.reason, 'disabled-by-environment')
})
