import test from 'node:test'
import assert from 'node:assert/strict'
import { createLegacyDisableReplay } from '../app/vendor/dsh-portable-plugin-market/src/disable-replay.ts'
const modern = { listPlugins() {}, setPluginEnabled() {} }
function fixture(manager) {
  let service = manager, listener, removed = 0
  const writes = [], errors = []
  const host = { get() { return service }, on(_event, fn) { listener = fn; return () => { removed++; listener = undefined } } }
  const disabled = new Set(['example'])
  const controller = createLegacyDisableReplay(host, disabled, async name => { writes.push(name) }, e => errors.push(e))
  return { controller, writes, errors, disabled, setService(value) { service = value },
    emit() { listener?.({ entry: { options: { name: 'example' } } }) }, get removed() { return removed } }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
test('official ownership wins over stale market state on boot and runtime entry changes', async () => {
  const f = fixture(modern)
  await f.controller.replayAll(); f.emit(); await settle()
  assert.deepEqual(f.writes, [])
  f.controller.dispose(); assert.equal(f.removed, 1)
})
test('legacy replay remains available and repeated entry events coalesce', async () => {
  const f = fixture(undefined)
  f.emit(); f.emit(); await settle()
  assert.deepEqual(f.writes, ['example'])
  f.disabled.clear(); f.emit(); await settle()
  assert.deepEqual(f.writes, ['example'])
  f.controller.dispose()
})
test('late official service or route disposal cancels queued legacy writes', async () => {
  for (const action of ['modern', 'dispose']) {
    const f = fixture(undefined)
    f.emit()
    if (action === 'modern') f.setService(modern)
    else f.controller.dispose()
    await settle(); await f.controller.replayAll()
    assert.deepEqual(f.writes, [])
    f.controller.dispose()
  }
})
test('replay errors are contained and unknown ownership is not permission to mutate', async () => {
  let failures = 0
  const c = createLegacyDisableReplay({}, new Set(['example']), async () => { throw Error('failed') }, () => { failures++ })
  await c.replayAll(); assert.equal(failures, 1); c.dispose()
  const blocked = createLegacyDisableReplay({ get() { throw Error('disposing') } }, new Set(['example']), async () => { assert.fail('must not write') }, () => {})
  await blocked.replayAll(); blocked.dispose()
})

// Exercise the actual route mount/unmount wiring, not just the helper.
test('market route lifecycle respects official enablement despite persisted legacy disabled state', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { default: path } = await import('node:path')
  const { default: os } = await import('node:os')
  const { mountMarketRoutes } = await import('../app/vendor/dsh-portable-plugin-market/src/routes.ts')
  const { writeMarketState } = await import('../app/vendor/dsh-portable-plugin-market/src/hot.ts')
  const root = await mkdtemp(path.join(os.tmpdir(), 'market-state-owner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
  writeMarketState(root, { disabled: new Set(['example']), groups: {}, groupOrder: [] })
  let listener, removed = 0, writes = 0
  const host = {
    get: () => modern,
    loader: { entries: () => [{ options: { name: 'example' }, fiber: {}, update: async () => { writes++ } }] },
    plugin() { throw Error('unexpected hot mount') },
    on(_event, fn) { listener = fn; return () => { removed++; listener = undefined } },
    webServer: { register() { return () => {} } },
  }
  const dispose = mountMarketRoutes(host, { profile: 'web', profileDirectory: root })
  await settle(); listener({ entry: { options: { name: 'example' } } }); await settle()
  assert.equal(writes, 0)
  dispose(); assert.equal(removed, 1)
})
