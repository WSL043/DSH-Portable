import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const client = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')
const begin = client.indexOf('    const completeHostCapabilities')
const end = client.indexOf('    function chooseDataExportPath', begin)
assert.ok(begin >= 0 && end > begin)
function transport(window) {
  const context = { window }
  vm.runInNewContext(client.slice(begin, end) + '\nthis.host=nativeHostTransport();this.post=postToNativeHost;', context)
  return context
}
const bridge = extra => ({ postMessage() {}, addEventListener() {}, removeEventListener() {}, ...extra })

test('versioned native capabilities are opt-in, strictly boolean and limited to known operations', () => {
  const messages = []
  const { host, post } = transport({ __DSH_PORTABLE_NATIVE__: bridge({
    protocolVersion: 1,
    capabilities: { preferences: true, restartHost: 'true', clearWebCache: true, futureAction: true },
    postMessage: value => messages.push(value),
  }) })
  assert.equal(host.capabilities.preferences, true)
  assert.equal(host.capabilities.restartHost, false)
  assert.equal(host.capabilities.importData, false)
  assert.equal(host.capabilities.futureAction, undefined)
  assert.equal(post({ type: 'cache' }, 'clearWebCache'), true)
  assert.equal(post({ type: 'restart' }, 'restartHost'), false)
  assert.equal(messages.length, 1)
})

test('unknown native protocol does not silently fall back to another transport', () => {
  const { host, post } = transport({ __DSH_PORTABLE_NATIVE__: bridge({ protocolVersion: 2 }), chrome: { webview: bridge() } })
  assert.equal(host, null)
  assert.equal(post({}, 'restartHost'), false)
  assert.equal(transport({ __DSH_PORTABLE_NATIVE__: { protocolVersion: 1 }, chrome: { webview: bridge() } }).host, null)
})

test('legacy hosts retain existing capabilities and cache support remains opt-in', () => {
  assert.equal(transport({ __DSH_PORTABLE_NATIVE__: bridge() }).host.capabilities.restartHost, true)
  assert.equal(transport({ chrome: { webview: bridge() } }).host.capabilities.clearWebCache, false)
  assert.equal(transport({ chrome: { webview: bridge() }, __DSH_PORTABLE_WEB_CACHE__: true }).host.capabilities.clearWebCache, true)
  assert.equal(transport({}).host, null)
})
