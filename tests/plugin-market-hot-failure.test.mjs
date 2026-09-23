import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hotMount, readMarketState, writeMarketState } from '../app/vendor/dsh-portable-plugin-market/src/hot.ts'
import { mountMarketRoutes } from '../app/vendor/dsh-portable-plugin-market/src/routes.ts'

test('a plugin activation exception is not promised to be fixed by restart and leaves no hot mount file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-market-hot-failure-'))
  try {
    const plugin = path.join(root, 'node_modules', 'test-plugin')
    await mkdir(plugin, { recursive: true })
    await writeFile(path.join(plugin, 'package.json'), JSON.stringify({ dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    await writeFile(path.join(plugin, 'cordis.patch.yml'), '- insert:\n  - id: test-plugin\n    name: test-plugin\n')
    const result = await hotMount({ plugin() { throw new TypeError('ctx.settings.register is not a function') } }, root, 'test-plugin')
    assert.equal(result.ok, false)
    assert.equal(result.restartRequired, undefined)
    assert.match(result.reason, /settings\.register/)
    assert.doesNotMatch(result.reason, /restart required/)
    assert.deepEqual(await readdir(path.join(root, '.dsh-market')), [])
    assert.match(await readFile(path.join(plugin, 'cordis.patch.yml'), 'utf8'), /test-plugin/)
  } finally {
    assert.equal(path.dirname(root), tmpdir())
    await rm(root, { recursive: true, force: true })
  }
})

test('failed enable leaves the saved disabled choice unchanged and offers no restart', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-market-toggle-failure-'))
  assert.equal(path.dirname(root), tmpdir())
  t.after(() => rm(root, { recursive: true, force: true }))
  const plugin = path.join(root, 'node_modules', 'test-plugin')
  await mkdir(plugin, { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { 'test-plugin': '1.0.0' }, dsh: { profile: { bundles: [] } } }))
  await writeFile(path.join(plugin, 'package.json'), JSON.stringify({ name: 'test-plugin', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(path.join(plugin, 'cordis.patch.yml'), '- insert:\n  - id: test-plugin\n    name: test-plugin\n')
  writeMarketState(root, { disabled: new Set(['test-plugin']), groups: {}, groupOrder: [] })

  const routes = new Map()
  const host = {
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    loader: { entries: () => [] },
    plugin() { throw new TypeError('ctx.settings.register is not a function') },
    on() { return () => {} },
    logger: { warn() {} },
  }
  const commands = { runPlugin() { throw Error('unexpected package command') }, probePnpm() {}, provisionPnpm() {}, cancelActive() {} }
  const dispose = mountMarketRoutes(host, { profile: 'web', profileDirectory: root }, commands)
  t.after(dispose)
  const server = createServer((request, response) => {
    const handler = routes.get(new URL(request.url, 'http://127.0.0.1').pathname)
    if (handler) void handler(request, response)
    else response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${url}/dsh-market/toggle`, {
    method: 'POST',
    headers: { origin: url, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'test-plugin', enabled: true }),
  })
  const body = await response.json()
  assert.equal(response.status, 502)
  assert.equal(body.restart, false)
  assert.deepEqual(body.disabled, ['test-plugin'])
  assert.match(body.reason, /settings\.register/)
  assert.equal(readMarketState(root).disabled.has('test-plugin'), true)
  assert.deepEqual((await readdir(path.join(root, '.dsh-market'))).filter(name => name.startsWith('hot-')), [])
})
