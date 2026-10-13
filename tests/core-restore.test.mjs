import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { planCoreRestore } from '../launcher/update-core.mjs'

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

test('the product update command restores the selected core before reporting completion', async () => {
  const source = await readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
  assert.match(source, /planCoreRestore\(\{[\s\S]{0,200}previousCore/)
  assert.match(source, /updateScope: 'engine', updateManifest: coreRestore\.manifestUrl/)
})
