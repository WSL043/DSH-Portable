import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const market = path.join(root, 'app/vendor/dsh-portable-plugin-market')
const read = (name) => readFile(path.join(market, name), 'utf8')

test('both market pages default to shared rolling totals and label the 364-day window', async () => {
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
  assert.match(bundle, /last 364 days/)
  const locale = await read('src/client/locales.ts')
  assert.equal((locale.match(/sortDownloads:/g) ?? []).length, 2, 'each locale defines sortDownloads once')
  assert.match(locale, /sortTotal: 'npm 近 364 天累计下载'/)
  assert.match(locale, /sortTotal: 'npm total downloads \(last 364 days\)'/)
})

test('downloads-desc ranks entries with a catalog count first and leaves unknown entries last', async () => {
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

test('total sorting keeps counted plugins first, then orders missing totals by 30-day downloads and Star', async () => {
  const { visiblePlugins, effectiveMarketSort } = await import('../app/vendor/dsh-portable-plugin-market/src/client/market-data.ts')
  const entry = (name, npm, downloads, stars = 0) => ({
    name, npm, owner: 'o', url: `https://example.test/${name}`, category: 'ui', description: { en: name }, downloads, stars, install: name, added: '2026-01-01',
  })
  const plugins = [
    entry('unknown-500-stars-1', 'unknown-500-stars-1', 500, 1),
    entry('total-small', 'total-small', 10, 5),
    entry('no-catalog-count', 'no-catalog-count', null, 1000),
    entry('total-large', 'total-large', 1, 0),
    entry('unknown-500-stars-20', 'unknown-500-stars-20', 500, 20),
    entry('unknown-80', 'unknown-80', 80, 50),
  ]
  const totals = { 'total-small': 30, 'total-large': 900 }
  const ranked = visiblePlugins(plugins, {
    category: 'all', query: '', lang: 'en', sort: 'total-desc', totals,
  })
  assert.deepEqual(ranked.map(plugin => plugin.name), [
    'total-large', 'total-small', 'unknown-500-stars-20', 'unknown-500-stars-1', 'unknown-80', 'no-catalog-count',
  ])
  assert.equal(effectiveMarketSort('total-desc', 'loading'), 'downloads-desc')
  assert.equal(effectiveMarketSort('total-desc', 'failed'), 'downloads-desc')
  assert.equal(effectiveMarketSort('total-desc', 'ready'), 'total-desc')

  const ascending = visiblePlugins(plugins, {
    category: 'all', query: '', lang: 'en', sort: 'total-asc', totals,
  })
  assert.deepEqual(ascending.map(plugin => plugin.name), [
    'total-small', 'total-large', 'unknown-80', 'unknown-500-stars-20', 'unknown-500-stars-1', 'no-catalog-count',
  ])
  assert.ok(ranked.indexOf(ranked.find(plugin => plugin.name === 'total-small')) < ranked.indexOf(ranked.find(plugin => plugin.name === 'unknown-500-stars-20')),
    'a real zero or small cumulative value must still rank ahead of any uncounted entry')

  const card = await read('src/client/DownloadCount.tsx')
  assert.match(card, /totals\?\.totals\[name\]/)
  assert.match(card, /近 364 天累计/)
  assert.match(card, /Downloads, not unique users/)
  assert.doesNotMatch(card, /自创建以来|since creation/i)
  const section = await read('src/client/MarketSection.tsx')
  assert.match(section, /totals=\{downloadTotals\} totalsSettled=/)
  const official = await read('src/client/official.tsx')
  assert.match(official, /totals=\{downloadTotals\} totalsSettled=/)
  const routes = await read('src/routes.ts')
  assert.match(routes, /path: '\/dsh-market\/download-totals'/)
  assert.match(routes, /getDownloadTotalsTable\(registry\.plugins, registryCacheFile\)/)
})
