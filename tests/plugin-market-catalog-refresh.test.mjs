import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import * as market from '../app/vendor/dsh-portable-plugin-market/src/client/market-data.ts'

test('browsing many plugin details evicts old screenshot lookups and bounds requests', async () => {
  const previousFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    requests.push(url)
    return new Response('![preview](https://example.com/preview.png)')
  }
  const plugin = i => ({ name: `plugin-${i}`, url: `https://github.com/example/plugin-${i}`, category: 'tools', owner: 'example' })
  try {
    market.resetScreenshotsCache()
    for (let i = 0; i < 65; i++) await market.pluginScreenshots(plugin(i))
    await market.pluginScreenshots(plugin(64))
    assert.equal(requests.length, 65, 'recent entries remain reusable')
    await market.pluginScreenshots(plugin(0))
    assert.equal(requests.length, 66, 'old entries are no longer retained indefinitely')
  } finally {
    globalThis.fetch = previousFetch
    market.resetScreenshotsCache()
  }
})

test('a new catalog generation drops failed README lookups while an unchanged generation reuses them', async () => {
  const previousFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests++
    return requests === 1 ? new Response('', { status: 404 }) : new Response('![preview](https://raw.githubusercontent.com/example/plugin/HEAD/new.png)')
  }
  try {
    market.resetScreenshotsCache()
    market.syncScreenshotsGeneration('first')
    const plugin = { name: 'example', url: 'https://github.com/example/plugin', category: 'tools', owner: 'example' }
    assert.deepEqual(await market.pluginScreenshots(plugin), [])
    market.syncScreenshotsGeneration('first')
    assert.deepEqual(await market.pluginScreenshots(plugin), [])
    assert.equal(requests, 1)
    market.syncScreenshotsGeneration('second')
    assert.deepEqual(await market.pluginScreenshots(plugin), ['https://raw.githubusercontent.com/example/plugin/HEAD/new.png'])
    assert.equal(requests, 2)
  } finally {
    globalThis.fetch = previousFetch
    market.resetScreenshotsCache()
  }
})

test('market-managed text and its screenshot portal opt out of browser DOM translation', async () => {
  const source = await readFile(new URL('../app/vendor/dsh-portable-plugin-market/src/client/MarketSection.tsx', import.meta.url), 'utf8')
  assert.match(source, /translate="no"/)
  assert.match(source, /portalHost\.setAttribute\('translate', 'no'\)/)
  assert.match(source, /syncScreenshotsGeneration\(registry\.updated\)/)
})
