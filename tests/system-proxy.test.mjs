import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { installSystemProxy, parseMacProxy, parseProxyServer, parseWindowsProxy, proxyEnvOverlay, resolveProxyEnvironment } from '../launcher/system-proxy.mjs'

const registry = (server, enabled = '0x1') => `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    ${enabled}
    ProxyServer    REG_SZ    ${server}
    ProxyOverride    REG_SZ    localhost;127.*;<local>
`

test('Windows registry output is read for a single proxy and a per-scheme list', () => {
  assert.deepEqual(parseWindowsProxy(registry('127.0.0.1:7890')), {
    enabled: true, http: 'http://127.0.0.1:7890', https: 'http://127.0.0.1:7890', bypass: ['localhost', '127.*'],
  })
  const perScheme = parseWindowsProxy(registry('http=10.0.0.1:8080;https=10.0.0.2:8443;socks=10.0.0.3:1080'))
  assert.equal(perScheme.http, 'http://10.0.0.1:8080')
  assert.equal(perScheme.https, 'http://10.0.0.2:8443')
  assert.equal(parseWindowsProxy(registry('x:1', '0x0')).enabled, false)
  assert.deepEqual(parseProxyServer(''), { http: '', https: '' })
})

test('macOS scutil output is read', () => {
  const output = '<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 7890\n  HTTPProxy : 127.0.0.1\n  HTTPSEnable : 1\n  HTTPSPort : 7891\n  HTTPSProxy : 127.0.0.1\n}'
  const parsed = parseMacProxy(output)
  assert.equal(parsed.http, 'http://127.0.0.1:7890')
  assert.equal(parsed.https, 'http://127.0.0.1:7891')
})

test('an environment proxy wins, the system proxy is the fallback, and no proxy means nothing changes', () => {
  const forbidden = () => { throw new Error('must not read the registry') }
  assert.equal(resolveProxyEnvironment({ platform: 'win32', env: { HTTPS_PROXY: 'http://user-chosen:1' }, run: forbidden }).source, 'environment')
  const system = resolveProxyEnvironment({ platform: 'win32', env: {}, run: () => registry('127.0.0.1:7890') })
  assert.equal(system.source, 'system')
  assert.equal(system.env.HTTPS_PROXY, 'http://127.0.0.1:7890')
  assert.match(system.env.NO_PROXY, /localhost,127\.0\.0\.1,::1/)
  assert.equal(resolveProxyEnvironment({ platform: 'win32', env: {}, run: () => registry('x:1', '0x0') }), null)
  assert.equal(resolveProxyEnvironment({ platform: 'win32', env: {}, run: () => { throw new Error('no reg') } }), null)
  assert.equal(resolveProxyEnvironment({ platform: 'linux', env: {} }), null)
})

test('child processes only receive the system proxy and never override one the user set', () => {
  assert.deepEqual(proxyEnvOverlay({ platform: 'win32', env: { HTTPS_PROXY: 'http://mine:1' } }), {})
  assert.equal(proxyEnvOverlay({ platform: 'win32', env: {}, run: () => registry('127.0.0.1:7890') }).HTTPS_PROXY, 'http://127.0.0.1:7890')
})

test('fetch goes through the system proxy once it is installed and process.env is left alone', { skip: typeof http.setGlobalProxyFromEnv !== 'function' }, async t => {
  // HTTPS requests reach a proxy as CONNECT; refuse the tunnel so nothing leaves the machine and the target is recorded.
  const seen = []
  const proxy = http.createServer((request, response) => response.end('unused'))
  proxy.on('connect', (request, socket) => {
    seen.push(`CONNECT ${request.url}`)
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const port = proxy.address().port
  const before = process.env.HTTPS_PROXY
  const outcome = installSystemProxy({ platform: 'win32', env: {}, run: () => registry(`127.0.0.1:${port}`) })
  t.after(() => {
    outcome.restore?.()
    proxy.closeAllConnections()
    proxy.close()
  })
  assert.equal(outcome.status, 'installed')
  assert.equal(outcome.source, 'system')
  assert.equal(process.env.HTTPS_PROXY, before)
  await assert.rejects(fetch('https://updates.invalid/portable-update.json'))
  assert.deepEqual(seen, ['CONNECT updates.invalid:443'])
})
