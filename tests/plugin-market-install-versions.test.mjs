import assert from 'node:assert/strict'
import test from 'node:test'
import { installVersions } from '../app/vendor/dsh-portable-plugin-market/src/updates.ts'

test('the explicit Beta install choice never offers a stale tag', async () => {
  const originalFetch = globalThis.fetch
  const proxyKeys = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY']
  const proxyValues = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]))
  let stable = '1.3.0'
  let beta = '1.4.0-beta.2'
  let next = ''
  try {
    for (const key of proxyKeys) delete process.env[key]
    globalThis.fetch = async url => {
      const tag = new URL(url).pathname.split('/').at(-1)
      const version = tag === 'latest' ? stable : tag === 'beta' ? beta : next
      return version ? Response.json({ version }) : new Response('missing', { status: 404 })
    }
    assert.deepEqual(await installVersions('dsh-example'), { stable, beta })
    next = '1.4.0-beta.3'
    assert.deepEqual(await installVersions('dsh-example'), { stable, beta: next })
    next = '1.4.0-beta.1'
    assert.deepEqual(await installVersions('dsh-example'), { stable, beta })
    stable = '1.4.0'
    assert.deepEqual(await installVersions('dsh-example'), { stable, beta: null })
    beta = '1.5.0'
    assert.deepEqual(await installVersions('dsh-example'), { stable, beta: null })
    beta = ''
    assert.deepEqual(await installVersions('dsh-example'), { stable, beta: null })
  } finally {
    globalThis.fetch = originalFetch
    for (const key of proxyKeys) {
      if (proxyValues[key] === undefined) delete process.env[key]
      else process.env[key] = proxyValues[key]
    }
  }
})
