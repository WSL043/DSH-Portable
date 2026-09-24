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

test('modern inventory ignores stale market flags and rejects legacy enablement writes', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { Readable } = await import('node:stream')
  const { default: path } = await import('node:path')
  const { default: os } = await import('node:os')
  const { mountMarketRoutes } = await import('../app/vendor/dsh-portable-plugin-market/src/routes.ts')
  const { writeMarketState } = await import('../app/vendor/dsh-portable-plugin-market/src/hot.ts')
  const root = await mkdtemp(path.join(os.tmpdir(), 'market-modern-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'node_modules', 'example'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { example: '1.0.0' }, dsh: { profile: { bundles: [] } },
  }))
  await writeFile(path.join(root, 'node_modules', 'example', 'package.json'), JSON.stringify({
    name: 'example', version: '1.0.0', dsh: {},
  }))
  writeMarketState(root, { disabled: new Set(['example']), groups: {}, groupOrder: [] })
  const handlers = new Map()
  const host = {
    get: () => modern,
    loader: { entries: () => [{ options: { name: 'example', id: 'example' }, fiber: {} }] },
    plugin() { throw Error('unexpected hot mount') },
    webServer: { register(route) { handlers.set(route.path, route.handler); return () => {} } },
  }
  const dispose = mountMarketRoutes(host, { profile: 'web', profileDirectory: root })
  t.after(dispose)
  function response() {
    return { status: null, body: null, writeHead(status) { this.status = status },
      end(body) { this.body = body ? JSON.parse(body) : null } }
  }
  const inventory = response()
  await handlers.get('/dsh-market/installed')({ method: 'GET' }, inventory)
  assert.equal(inventory.status, 200)
  assert.deepEqual(inventory.body.disabled, [])
  assert.equal(inventory.body.activation.example.state, 'live')

  const headers = { origin: 'http://localhost:3080', host: 'localhost:3080' }
  const toggle = response()
  await handlers.get('/dsh-market/toggle')({ method: 'POST', headers }, toggle)
  assert.equal(toggle.status, 409)
  const groupToggle = response()
  const request = Object.assign(Readable.from([JSON.stringify({ action: 'toggle', name: 'sample' })]),
    { method: 'POST', headers })
  await handlers.get('/dsh-market/groups')(request, groupToggle)
  assert.equal(groupToggle.status, 409)
})
