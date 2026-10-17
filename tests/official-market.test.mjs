import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AWESOME_INDEX_URL, OFFICIAL_MARKET_BUNDLE, ensureOfficialMarket, withAwesomeIndex } from '../launcher/official-market.mjs'

async function bed(t, { shipped = true, bundles = ['dsh-image-viewer'], patch } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'official-market-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  const nodeModules = path.join(root, 'app', 'node_modules')
  await mkdir(profile, { recursive: true })
  await mkdir(path.join(nodeModules, '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
  if (shipped) {
    await mkdir(path.join(nodeModules, ...OFFICIAL_MARKET_BUNDLE.split('/')), { recursive: true })
    await writeFile(path.join(nodeModules, ...OFFICIAL_MARKET_BUNDLE.split('/'), 'package.json'), '{}')
  }
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'web', dsh: { profile: { bundles } } }))
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
