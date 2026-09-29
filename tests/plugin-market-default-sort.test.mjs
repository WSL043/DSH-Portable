import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const market = path.join(root, 'app/vendor/dsh-portable-plugin-market')
const read = (name) => readFile(path.join(market, name), 'utf8')

test('both market pages default to shared cumulative totals and label every sort metric', async () => {
  const official = await read('src/client/official.tsx')
  assert.match(official, /useState\('total-desc'\)/)
  assert.match(official, /<option value="total-desc">\{t\(totalSortLabel\)\}<\/option>/)
  assert.match(official, /<option value="downloads-desc">\{t\('sortDownloads'\)\}<\/option>/)
  const section = await read('src/client/MarketSection.tsx')
  assert.match(section, /useState<SortField>\('total'\)/)
  assert.match(section, /\{ key: 'total', label: 'sortTotal' \}/)
  assert.match(section, /\{ key: 'downloads', label: 'sortDownloads' \}/)
  const bundle = await read('client/client.js')
  assert.match(bundle, /useState\)?\(\s*["'`]total["'`]\s*\)/, 'the shipped client bundle must match the source default')
  const locale = await read('src/client/locales.ts')
  assert.equal((locale.match(/sortDownloads:/g) ?? []).length, 2, 'each locale defines the existing sortDownloads key exactly once')
})

test('downloads-desc ranks counted plugins first and leaves uncounted entries last', async () => {
  const { visiblePlugins } = await import('../app/vendor/dsh-portable-plugin-market/src/client/market-data.ts')
  const entry = (name, downloads, stars = 0) => ({
    name, owner: 'o', url: `https://example.test/${name}`, category: 'ui', description: { en: name }, downloads, stars, install: name, added: '2026-01-01',
  })
  const ranked = visiblePlugins([entry('none', null, 999), entry('low', 5), entry('high', 500), entry('missing', undefined, 999)], {
    category: 'all', query: '', lang: 'en', sort: 'downloads-desc',
  })
  assert.deepEqual(ranked.map(plugin => plugin.name).slice(0, 2), ['high', 'low'])
  assert.deepEqual(new Set(ranked.slice(2).map(plugin => plugin.name)), new Set(['none', 'missing']))
})

test('total-desc uses the shared npm-keyed table and ranks entries without a value last', async () => {
  const { visiblePlugins, effectiveMarketSort } = await import('../app/vendor/dsh-portable-plugin-market/src/client/market-data.ts')
  const entry = (name, npm, downloads = 0, stars = 0) => ({
    name, npm, owner: 'o', url: `https://example.test/${name}`, category: 'ui', description: { en: name }, downloads, stars, install: name, added: '2026-01-01',
  })
  const ranked = visiblePlugins([
    entry('none', 'none', 400, 999), entry('low', '@scope/low', 2), entry('high', 'high', 1), entry('missing', 'missing', 500, 0),
  ], {
    category: 'all', query: '', lang: 'en', sort: 'total-desc',
    totals: { high: 900, '@scope/low': 300 },
  })
  assert.deepEqual(ranked.map(plugin => plugin.name), ['high', 'low', 'none', 'missing'])
  assert.equal(effectiveMarketSort('total-desc', 'loading'), 'downloads-desc')
  assert.equal(effectiveMarketSort('total-desc', 'failed'), 'downloads-desc')
  assert.equal(effectiveMarketSort('total-desc', 'ready'), 'total-desc')
  assert.deepEqual(visiblePlugins([
    entry('high', 'high'), entry('low', 'low'), entry('missing', 'missing'),
  ], {
    category: 'all', query: '', lang: 'en', sort: 'total-asc', totals: { high: 80, low: 3 },
  }).map(plugin => plugin.name), ['low', 'high', 'missing'])

  const card = await read('src/client/DownloadCount.tsx')
  assert.match(card, /totals\?\.totals\[name\]/)
  assert.match(card, /Downloads, not unique users/)
  const section = await read('src/client/MarketSection.tsx')
  assert.match(section, /totals=\{downloadTotals\} totalsSettled=/)
  const official = await read('src/client/official.tsx')
  assert.match(official, /totals=\{downloadTotals\} totalsSettled=/)
  const routes = await read('src/routes.ts')
  assert.match(routes, /path: '\/dsh-market\/download-totals'/)
  assert.match(routes, /getDownloadTotalsTable\(registry\.plugins, registryCacheFile\)/)
})
