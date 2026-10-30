import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AWESOME_INDEX_URL, OFFICIAL_MARKET_BUNDLE, ensureOfficialMarket, withAwesomeIndex } from '../launcher/official-market.mjs'

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

test('a profile on a core that ships the market gets the bundle and the Awesome index once', async t => {
  const { layout, manifest, patchText } = await bed(t, { patch: '# first run\n[]\n' })
  const first = await ensureOfficialMarket(layout)
  assert.deepEqual(first, { status: 'configured', actions: ['enabled-bundle', 'added-index'] })
  assert.deepEqual((await manifest()).dsh.profile.bundles, ['dsh-image-viewer', OFFICIAL_MARKET_BUNDLE])
  const patch = await patchText()
  assert.ok(patch.startsWith('# first run\n'), 'the official header comment survives')
  assert.ok(patch.includes(`- id: plugin-market\n  config:\n    indexes:\n      - ${AWESOME_INDEX_URL}\n`))
  assert.ok(!patch.includes('[]'), 'the empty list is replaced, not kept beside the row')
  assert.deepEqual(await ensureOfficialMarket(layout), { status: 'unchanged', actions: [] })
})

test('a user who turned the bundle off or removed the index keeps that choice', async t => {
  const { layout, profile, manifest, patchText } = await bed(t)
  await ensureOfficialMarket(layout)
  const edited = await manifest()
  edited.dsh.profile.bundles = edited.dsh.profile.bundles.filter(name => name !== OFFICIAL_MARKET_BUNDLE)
  await writeFile(path.join(profile, 'package.json'), JSON.stringify(edited))
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]\n')
  assert.equal((await ensureOfficialMarket(layout)).status, 'unchanged')
  assert.ok(!(await manifest()).dsh.profile.bundles.includes(OFFICIAL_MARKET_BUNDLE))
  assert.equal(await patchText(), '[]\n')
})

test('an index list the user already owns is never touched, and other rows are kept', async t => {
  const owned = '- id: plugin-market\n  config:\n    indexes:\n      - https://example.com/mine.json\n'
  const first = await bed(t, { patch: owned })
  assert.deepEqual((await ensureOfficialMarket(first.layout)).actions, ['enabled-bundle'])
  assert.equal(await first.patchText(), owned)

  const other = '- id: ui-settings-general\n  config:\n    language: zh\n'
  const second = await bed(t, { patch: other })
  await ensureOfficialMarket(second.layout)
  const patch = await second.patchText()
  assert.ok(patch.startsWith(other) && patch.endsWith(`      - ${AWESOME_INDEX_URL}\n`))
})

test('the patch file is created when the profile has none yet', async t => {
  const { layout, patchText } = await bed(t)
  await ensureOfficialMarket(layout)
  assert.equal(await patchText(), `- id: plugin-market\n  config:\n    indexes:\n      - ${AWESOME_INDEX_URL}\n`)
})

test('a core without the market suspends the bundle, and the next core that has it brings it back', async t => {
  const shipped = await bed(t)
  await ensureOfficialMarket(shipped.layout)
  assert.ok((await shipped.manifest()).dsh.profile.bundles.includes(OFFICIAL_MARKET_BUNDLE))

  // Same profile, now run by a core that does not ship the bundle (0.2.0-rc.2).
  const without = { ...shipped.layout, dshBin: path.join(path.dirname(shipped.layout.dshBin), '..', '..', '..', '..', 'other', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') }
  assert.deepEqual(await ensureOfficialMarket(without), { status: 'configured', actions: ['suspended-bundle'] })
  assert.ok(!(await shipped.manifest()).dsh.profile.bundles.includes(OFFICIAL_MARKET_BUNDLE), 'the profile never names a bundle its core cannot resolve')
  assert.equal((await ensureOfficialMarket(without)).status, 'unchanged')

  assert.deepEqual((await ensureOfficialMarket(shipped.layout)).actions, ['enabled-bundle'])
  assert.ok((await shipped.manifest()).dsh.profile.bundles.includes(OFFICIAL_MARKET_BUNDLE))
})

test('a core that never shipped it leaves a fresh profile alone', async t => {
  const { layout, manifest, patchText } = await bed(t, { shipped: false })
  assert.deepEqual(await ensureOfficialMarket(layout), { status: 'unchanged', actions: [] })
  assert.deepEqual((await manifest()).dsh.profile.bundles, ['dsh-image-viewer'])
  assert.equal(await patchText(), null)
})

test('a missing or unreadable profile is skipped without throwing', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'official-market-none-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(await ensureOfficialMarket({ platform: process.platform, dshHome: root, dshBin: path.join(root, 'x') }), { status: 'skipped', reason: 'no-profile' })
})

test('CRLF patch files keep their line endings', () => {
  const next = withAwesomeIndex('- id: other\r\n  config: {}\r\n')
  assert.ok(next.includes('\r\n- id: plugin-market\r\n  config:\r\n'))
  assert.ok(!/(?<!\r)\n/u.test(next))
  assert.equal(withAwesomeIndex('- id: plugin-market\n'), null)
})

test('the environment switch leaves the profile untouched', async () => {
  const result = await ensureOfficialMarket({ platform: 'win32', dshHome: 'C:/h', dshBin: 'C:/x/bin/dsh' }, { env: { DSH_PORTABLE_OFFICIAL_MARKET: '0' }, existsSync: () => { throw new Error('must not look at the profile') } })
  assert.deepEqual(result, { status: 'skipped', reason: 'disabled-by-environment' })
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
  assert.deepEqual(first, { status: 'configured', actions: ['enabled-bundle', 'added-index'] })
  assert.equal(initialized, 1)
  assert.deepEqual((await manifest()).dsh.profile.bundles, [...selected, OFFICIAL_MARKET_BUNDLE])
  assert.ok((await patchText()).includes(AWESOME_INDEX_URL))
  const edited = await manifest()
  edited.dsh.profile.bundles = [...selected]
  await writeFile(path.join(profile, 'package.json'), JSON.stringify(edited))
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]\n')
  assert.deepEqual(await ensureOfficialMarket(layout, { loadProfileInitialization: () => { throw Error('existing profiles do not initialize again') } }), { status: 'unchanged', actions: [] })
  assert.deepEqual((await manifest()).dsh.profile.bundles, selected)
  assert.equal(await patchText(), '[]\n', 'a later user removal stays removed')
})

test('a profile created before the initialization lock is acquired keeps the user bundle and index choices', async t => {
  const { layout, profile, manifest, patchText } = await bed(t, { fresh: true })
  const owned = '- id: plugin-market\n  config:\n    indexes:\n      - https://example.com/mine.json\n'
  const api = { PROFILE_TEMPLATES: {}, DEFAULT_PROFILE_BUNDLES: ['official-fallback'],
    async withFileLock(_filename, callback) {
      await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'web', dsh: { profile: { bundles: ['user-bundle'] } } }))
      await writeFile(path.join(profile, '.dsh-portable-official-market.json'), JSON.stringify({ bundleOffered: true, indexOffered: true }))
      await writeFile(path.join(profile, 'cordis.patch.yml'), owned)
      return callback()
    },
    initProfile() { throw Error('the competing writer already initialized this profile') },
  }
  assert.deepEqual(await ensureOfficialMarket(layout, { loadProfileInitialization: async () => api }), { status: 'unchanged', actions: [] })
  assert.deepEqual((await manifest()).dsh.profile.bundles, ['user-bundle'])
  assert.equal(await patchText(), owned)
})

test('a missing profile stays missing without a shipped market or when the environment disables it', async t => {
  for (const scenario of [{ shipped: false, reason: 'no-profile' }, { shipped: true, env: { DSH_PORTABLE_OFFICIAL_MARKET: '0' }, reason: 'disabled-by-environment' }]) {
    const { layout, profile } = await bed(t, { fresh: true, shipped: scenario.shipped })
    const result = await ensureOfficialMarket(layout, { env: scenario.env ?? {}, loadProfileInitialization: () => { throw Error('must not load the SDK') } })
    assert.deepEqual(result, { status: 'skipped', reason: scenario.reason })
    await assert.rejects(lstat(profile), { code: 'ENOENT' })
  }
})
