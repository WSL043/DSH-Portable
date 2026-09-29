import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const market = path.join(root, 'app/vendor/dsh-portable-plugin-market')
const read = (name) => readFile(path.join(market, name), 'utf8')

test('both market pages open sorted by catalog 30-day downloads with a labelled option', async () => {
  const official = await read('src/client/official.tsx')
  assert.match(official, /useState\('downloads-desc'\)/)
  assert.match(official, /<option value="downloads-desc">[^<]*30[^<]*<\/option>/)
  const section = await read('src/client/MarketSection.tsx')
  assert.match(section, /useState<SortField>\('downloads'\)/)
  assert.match(section, /\{ key: 'downloads', label: 'sortDownloads' \}/)
  const bundle = await read('client/client.js')
  assert.match(bundle, /useState\)?\(\s*["'`]downloads["'`]\s*\)/, 'the shipped client bundle must match the source default')
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
