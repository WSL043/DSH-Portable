import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import * as market from '../app/vendor/dsh-portable-plugin-market/src/client/market-data.ts'

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
