import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { planCoreRestore, reconcilePreferredCore, recordPreferredCore } from '../launcher/update-core.mjs'

const layout = { root: 'unused', platform: 'win32' }
const catalog = versions => async () => ({ versions })

test('an upgrade that would lower the selected core restores it once the new shell has qualified it', async () => {
  const plan = await planCoreRestore({
    layout, previousCore: '0.2.1-alpha.2', appliedCore: '0.2.0-rc.2',
    list: catalog([{ version: '0.2.1-alpha.2', status: 'available', manifestUrl: 'https://example.invalid/core.json' }]),
  })
  assert.deepEqual(plan, { status: 'ready', version: '0.2.1-alpha.2', manifestUrl: 'https://example.invalid/core.json' })
})

test('a core the new shell has not qualified yet is reported, not guessed', async () => {
  const plan = await planCoreRestore({ layout, previousCore: '0.2.1-alpha.2', appliedCore: '0.2.0-rc.2', list: catalog([{ version: '0.2.0-rc.2', status: 'current' }]) })
  assert.deepEqual(plan, { status: 'awaiting-qualification', version: '0.2.1-alpha.2' })
})

test('nothing is restored when the core did not go down, or the catalog is unreachable', async () => {
  assert.deepEqual(await planCoreRestore({ layout, previousCore: '0.2.0-rc.2', appliedCore: '0.2.0-rc.2', list: catalog([]) }), { status: 'not-needed' })
  assert.deepEqual(await planCoreRestore({ layout, previousCore: '0.2.0-rc.1', appliedCore: '0.2.0-rc.2', list: catalog([]) }), { status: 'not-needed' })
  assert.deepEqual(await planCoreRestore({ layout, previousCore: '', appliedCore: '0.2.0-rc.2', list: catalog([]) }), { status: 'not-needed' })
  const plan = await planCoreRestore({ layout, previousCore: '0.2.1-alpha.2', appliedCore: '0.2.0-rc.2', list: async () => { throw new Error('offline') } })
  assert.equal(plan.status, 'catalog-unavailable')
})

async function installation(t, { installedCore = '0.2.0-rc.2', settings } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-core-reconcile-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await mkdir(path.join(root, 'data'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ portableVersion: '0.8.12', releaseChannel: 'stable', dshVersion: installedCore }))
  const launcherSettings = path.join(root, 'data', 'launcher-settings.json')
  if (settings) await writeFile(launcherSettings, JSON.stringify(settings))
  return { layout: { root, platform: 'win32', launcherSettings }, read: async () => JSON.parse(await readFile(launcherSettings, 'utf8')) }
}
const ready = catalog([{ version: '0.2.1-alpha.2', status: 'available', manifestUrl: 'https://example.invalid/core.json' }])

test('choosing a core is remembered and keeps the other launcher settings', async t => {
  const home = await installation(t, { settings: { updateChannel: 'stable', coreRestore: { status: 'failed' } } })
  await recordPreferredCore(home.layout, '0.2.1-alpha.2')
  assert.deepEqual(await home.read(), { updateChannel: 'stable', preferredCore: '0.2.1-alpha.2' })
})

test('startup puts the chosen core back once the new Portable has qualified it', async t => {
  const home = await installation(t, { settings: { preferredCore: '0.2.1-alpha.2' } })
  const applied = []
  const outcome = await reconcilePreferredCore({ layout: home.layout, list: ready, apply: async plan => { applied.push(plan.manifestUrl); return { status: 'updated' } } })
  assert.deepEqual(outcome, { status: 'restored', version: '0.2.1-alpha.2' })
  assert.deepEqual(applied, ['https://example.invalid/core.json'])
  assert.deepEqual(await home.read(), { preferredCore: '0.2.1-alpha.2' })
})

test('a restore that did not actually update is reported as failed, never as restored', async t => {
  const home = await installation(t, { settings: { preferredCore: '0.2.1-alpha.2' } })
  const outcome = await reconcilePreferredCore({ layout: home.layout, list: ready, apply: async () => ({ status: 'current' }) })
  assert.equal(outcome.status, 'failed')
  assert.equal((await home.read()).coreRestore.status, 'failed')
  const thrown = await installation(t, { settings: { preferredCore: '0.2.1-alpha.2' } })
  assert.equal((await reconcilePreferredCore({ layout: thrown.layout, list: ready, apply: async () => { throw new Error('disk full') } })).status, 'failed')
})

test('an unqualified core waits, is remembered, and is not retried inside the backoff window', async t => {
  const home = await installation(t, { settings: { preferredCore: '0.2.1-alpha.2' } })
  let lookups = 0
  const list = async () => { lookups++; return { versions: [] } }
  const now = Date.UTC(2026, 9, 13)
  assert.equal((await reconcilePreferredCore({ layout: home.layout, list, now, apply: async () => ({}) })).status, 'awaiting-qualification')
  assert.equal((await reconcilePreferredCore({ layout: home.layout, list, now: now + 60_000, apply: async () => ({}) })).status, 'backoff')
  assert.equal(lookups, 1)
  assert.equal((await reconcilePreferredCore({ layout: home.layout, list, now: now + 20 * 60_000, apply: async () => ({}) })).status, 'awaiting-qualification')
  assert.equal(lookups, 2)
})

test('nothing happens without a choice, when in sync, and a newer bundled core is followed', async t => {
  assert.deepEqual(await reconcilePreferredCore({ layout: (await installation(t)).layout, list: ready, apply: async () => ({}) }), { status: 'none' })
  assert.deepEqual(await reconcilePreferredCore({ layout: (await installation(t, { settings: { preferredCore: '0.2.0-rc.2' } })).layout, list: ready, apply: async () => ({}) }), { status: 'in-sync' })
  const newer = await installation(t, { installedCore: '0.2.0', settings: { preferredCore: '0.2.0-rc.2' } })
  assert.deepEqual(await reconcilePreferredCore({ layout: newer.layout, list: ready, apply: async () => ({}) }), { status: 'preference-advanced', version: '0.2.0' })
  assert.equal((await newer.read()).preferredCore, '0.2.0')
})

test('the CLI reconciles the core before the host starts and remembers engine updates', async () => {
  const source = await readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
  assert.match(source, /await reconcileCoreAtStart\(\)\s+const result = await startAttempt/)
  assert.match(source, /recordPreferredCore\(layout, applied\.dshVersion\)/)
})
