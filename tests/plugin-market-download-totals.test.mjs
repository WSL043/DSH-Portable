import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createDownloadTotals, createDownloadTotalsTable, downloadTotalsPeriods, downloadTotalsWindow,
  planDownloadTotals, selectDownloadTotalsPackages,
  DOWNLOAD_TOTALS_MAX_CONCURRENCY, DOWNLOAD_TOTALS_MAX_REQUESTS, DOWNLOAD_TOTALS_MAX_SCOPE_PACKAGES,
  DOWNLOAD_TOTALS_REFRESH_TIMEOUT_MS, DOWNLOAD_TOTALS_REQUEST_TIMEOUT_MS, DOWNLOAD_TOTALS_WINDOW_DAYS,
} from '../app/vendor/dsh-portable-plugin-market/src/download-totals.ts'

const root = path.resolve(import.meta.dirname, '..')

test('cumulative totals use one rolling 365-day UTC window ending today', () => {
  const now = Date.parse('2026-09-29T19:30:00.000Z')
  assert.equal(DOWNLOAD_TOTALS_WINDOW_DAYS, 364)
  assert.deepEqual(downloadTotalsWindow(now), ['2025-09-30', '2026-09-29'])
  assert.deepEqual(downloadTotalsPeriods(...downloadTotalsWindow(now)), [['2025-09-30', '2026-09-29']])
  assert.equal(DOWNLOAD_TOTALS_MAX_REQUESTS, 150)
  assert.equal(DOWNLOAD_TOTALS_MAX_SCOPE_PACKAGES, 100)
  assert.equal(DOWNLOAD_TOTALS_REQUEST_TIMEOUT_MS, 10_000)
  assert.equal(DOWNLOAD_TOTALS_REFRESH_TIMEOUT_MS, 120_000)
})

test('planner makes 17 plain batches and only the top 100 scoped packages: 117 requests', () => {
  const plugins = [
    ...Array.from({ length: 1669 }, (_, i) => ({ npm: `plain-${i}` })),
    ...Array.from({ length: 584 }, (_, i) => ({ npm: `@scope-${i}/plugin`, downloads: i, stars: i % 5 })),
    { npm: '@scope-no-count/plugin' },
  ]
  const selected = selectDownloadTotalsPackages(plugins)
  assert.equal(selected.filter(name => !name.startsWith('@')).length, 1669)
  assert.equal(selected.filter(name => name.startsWith('@')).length, 100)
  assert.ok(selected.includes('@scope-583/plugin'))
  assert.ok(!selected.includes('@scope-483/plugin'))
  assert.ok(!selected.includes('@scope-no-count/plugin'), 'scope packages without catalog downloads are not ranked or queried')

  const plan = planDownloadTotals(selected, '2025-09-30', '2026-09-29')
  assert.equal(plan.periods.length, 1)
  assert.deepEqual(plan.periods, [['2025-09-30', '2026-09-29']])
  assert.equal(plan.bulkBatches, 17)
  assert.equal(plan.scopePackages, 100)
  assert.equal(plan.requestCount, 117)
  assert.equal(plan.omittedPackages.length, 0)
  assert.ok(plan.units.filter(unit => unit.kind === 'bulk').every(unit => unit.packages.length <= 100))
  assert.ok(plan.requestCount <= DOWNLOAD_TOTALS_MAX_REQUESTS)
})

test('request planner enforces the hard 150-call cap even when asked for more', () => {
  const names = Array.from({ length: 15001 }, (_, i) => `plain-${i}`)
  const plan = planDownloadTotals(names, '2025-09-30', '2026-09-29', 1000)
  assert.equal(plan.periods.length, 1)
  assert.equal(plan.requestCount, 150)
  assert.equal(plan.bulkBatches, 150)
  assert.equal(plan.omittedPackages.length, 1)
  assert.ok(plan.requestCount <= DOWNLOAD_TOTALS_MAX_REQUESTS)
})

test('table requests are isolated by batch and scoped calls stay at concurrency four', async () => {
  const plugins = [
    ...Array.from({ length: 205 }, (_, i) => ({ npm: `plain-${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ npm: `@scope-${i}/plugin`, downloads: 100 - i })),
  ]
  const now = Date.parse('2026-09-29T12:00:00.000Z')
  let active = 0, peak = 0, activeScope = 0, peakScope = 0
  const urls = []
  let stats
  const get = createDownloadTotalsTable(async url => {
    const encodedNames = new URL(url).pathname.split('/downloads/point/')[1].split('/')[1]
    const isScope = encodedNames.startsWith('%40')
    urls.push(url)
    active++; peak = Math.max(peak, active)
    if (isScope) { activeScope++; peakScope = Math.max(peakScope, activeScope) }
    try {
      await new Promise(resolve => setTimeout(resolve, 2))
      const [range, encoded] = new URL(url).pathname.split('/downloads/point/')[1].split('/')
      const [start, end] = range.split(':')
      const names = encoded.split(',').map(decodeURIComponent)
      if (names.some(name => name === 'plain-100')) return new Response('batch failed', { status: 503 })
      const values = Object.fromEntries(names.map(name => [name, { package: name, start, end, downloads: 7 }]))
      return new Response(JSON.stringify(isScope ? values[names[0]] : values))
    } finally {
      active--
      if (isScope) activeScope--
    }
  }, { now: () => now, onRefresh: value => { stats = value } })

  const table = await get(plugins)
  assert.equal(table.complete, false)
  assert.equal(Object.keys(table.totals).length, 111, '105 plain and all six selected scoped packages survive')
  assert.equal(table.totals['plain-0'], 7)
  assert.equal(table.totals['@scope-5/plugin'], 7)
  assert.equal(table.totals['plain-100'], undefined, 'failed batch values are absent, never zero')
  assert.equal(urls.length, 9, 'three plain batches and six scope packages each use one window')
  assert.equal(stats.periods, 1)
  assert.equal(stats.bulkBatches, 3)
  assert.equal(stats.scopePackages, 6)
  assert.equal(stats.scheduledRequests, 9)
  assert.equal(stats.requests, 9)
  assert.equal(stats.failedRequests, 1, 'the failed batch does not suppress other requests')
  assert.equal(peak, 4)
  assert.ok(peakScope <= DOWNLOAD_TOTALS_MAX_CONCURRENCY)
  assert.ok(stats.elapsedMs >= 0)
})

test('refresh deadline aborts in-flight calls and prevents scheduling the rest', async () => {
  const plugins = Array.from({ length: 1000 }, (_, i) => ({ npm: `plain-${i}` }))
  let calls = 0
  let stats
  const get = createDownloadTotalsTable(async (_url, { signal }) => {
    calls++
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new Error('aborted'))
      else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  }, {
    now: () => Date.parse('2026-09-29T12:00:00.000Z'),
    refreshTimeoutMs: 15,
    requestTimeoutMs: 10_000,
    onRefresh: value => { stats = value },
  })
  const table = await get(plugins)
  assert.equal(table.complete, false)
  assert.equal(calls, 4)
  assert.equal(stats.requests, 4)
  assert.equal(stats.failedRequests, 4)
  assert.equal(stats.scheduledRequests, 10)
})

test('only selected scope packages are queried; omitted scope entries have no zero total', async () => {
  const plugins = [
    { npm: 'plain-a' },
    ...Array.from({ length: 103 }, (_, i) => ({ npm: `@scope-${i}/plugin`, downloads: i + 1 })),
  ]
  const seen = []
  const get = createDownloadTotalsTable(async url => {
    const [range, encoded] = new URL(url).pathname.split('/downloads/point/')[1].split('/')
    const [start, end] = range.split(':')
    const names = encoded.split(',').map(decodeURIComponent)
    seen.push(...names)
    const values = Object.fromEntries(names.map(name => [name, { package: name, start, end, downloads: 1 }]))
    return new Response(JSON.stringify(names.length === 1 && names[0].startsWith('@') ? values[names[0]] : values))
  }, { now: () => Date.parse('2026-09-29T12:00:00.000Z') })

  const table = await get(plugins)
  assert.equal(seen.length, 101, 'one plain bulk request and one request for each of the top 100 scopes')
  assert.ok(seen.includes('@scope-102/plugin'))
  assert.ok(!seen.includes('@scope-2/plugin'))
  assert.equal(table.totals['@scope-2/plugin'], undefined)
  assert.equal(table.complete, true, 'complete covers all queried packages in the selected catalog subset')
})

test('single-card fallback uses one request for the same rolling window and caches daily', async () => {
  let calls = 0
  let clock = Date.parse('2026-09-29T12:00:00.000Z')
  const get = createDownloadTotals(async url => {
    calls++
    const [range] = new URL(url).pathname.split('/downloads/point/')[1].split('/')
    const [start, end] = range.split(':')
    return new Response(JSON.stringify({ package: '@test/example', start, end, downloads: 100 }))
  }, () => clock)
  const first = get('@test/example')
  assert.equal(get('@test/example'), first)
  assert.deepEqual(await first, { downloads: 100, start: '2025-09-30', end: '2026-09-29', complete: true })
  await get('@test/example')
  assert.equal(calls, 1)
  clock += 86400000
  await get('@test/example')
  assert.equal(calls, 2)
})

test('mismatched single-package response is rejected', async () => {
  const get = createDownloadTotals(async () => new Response(JSON.stringify({
    package: 'example', start: '2025-09-30', end: '2026-09-29', downloads: 10,
  })), () => Date.parse('2026-09-29T12:00:00.000Z'))
  await assert.rejects(get('@test/example'), /Incomplete npm statistics/)
  await assert.rejects(get('../example'), /Invalid npm package/)
})

test('visible-card fallback requests have bounded concurrency and release failed slots', async () => {
  let active = 0, peak = 0
  const releases = []
  const get = createDownloadTotals(async () => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => releases.push(resolve))
    active--
    throw new Error('offline')
  })
  const results = Promise.allSettled(Array.from({ length: 6 }, (_, i) => get(`plugin-${i}`)))
  assert.equal(active, 4)
  for (let i = 0; i < 6; i++) {
    releases.shift()()
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal((await results).filter(r => r.status === 'rejected').length, 6)
  assert.equal(peak, 4)
  assert.equal(active, 0)
})

test('table requests coalesce, persist daily, merge additions, and refresh next day', async () => {
  const evidence = path.join(root, 'build/orch-080/T17b')
  await mkdir(evidence, { recursive: true })
  const directory = await mkdtemp(path.join(evidence, 'totals-cache-'))
  assert.equal(path.relative(evidence, directory).startsWith('..'), false, 'test cache stays inside T17b evidence')
  const registryCache = path.join(directory, 'registry-cache-v1.json')
  let clock = Date.parse('2026-09-29T12:00:00.000Z')
  let calls = 0
  const get = createDownloadTotalsTable(async url => {
    calls++
    const [range, encoded] = new URL(url).pathname.split('/downloads/point/')[1].split('/')
    const [start, end] = range.split(':')
    const names = encoded.split(',').map(decodeURIComponent)
    const values = Object.fromEntries(names.map(name => [name, { package: name, start, end, downloads: 3 }]))
    return new Response(JSON.stringify(names[0].startsWith('@') ? values[names[0]] : values))
  }, { now: () => clock })
  try {
    const initial = [{ npm: 'plain-a' }, { npm: '@scope-a/plugin', downloads: 5 }]
    const [first, coalesced] = await Promise.all([get(initial, registryCache), get(initial, registryCache)])
    assert.deepEqual(coalesced, first)
    assert.equal(calls, 2)
    assert.equal(first.complete, true)
    assert.deepEqual(first.totals, { 'plain-a': 3, '@scope-a/plugin': 3 })
    assert.deepEqual([first.start, first.end], ['2025-09-30', '2026-09-29'])
    const persisted = JSON.parse(await readFile(path.join(directory, 'download-totals-v1.json'), 'utf8'))
    assert.equal(persisted.schemaVersion, 1)
    assert.equal(persisted.complete, true)

    const offline = createDownloadTotalsTable(async () => { throw new Error('cache should prevent network') }, { now: () => clock })
    assert.deepEqual(await offline(initial, registryCache), first)
    assert.equal(calls, 2)

    const expanded = await get([...initial, { npm: 'plain-b' }], registryCache)
    assert.equal(calls, 3, 'same-day catalog additions only fetch names not already cached')
    assert.equal(expanded.complete, true)
    assert.deepEqual(expanded.totals, { 'plain-a': 3, '@scope-a/plugin': 3, 'plain-b': 3 })

    clock += 86400000
    const nextDay = await get([...initial, { npm: 'plain-b' }], registryCache)
    assert.equal(calls, 5, 'a new UTC day recalculates plain and selected scoped packages once each')
    assert.equal(nextDay.complete, true)

    const legacyCache = JSON.parse(await readFile(path.join(directory, 'download-totals-v1.json'), 'utf8'))
    legacyCache.start = '2025-01-01'
    legacyCache.end = '2026-09-29'
    await writeFile(path.join(directory, 'download-totals-v1.json'), `${JSON.stringify(legacyCache)}\n`)
    const staleWindow = createDownloadTotalsTable(async () => { throw new Error('legacy window needs refresh') }, { now: () => clock })
    const refreshed = await staleWindow([...initial, { npm: 'plain-b' }], registryCache)
    assert.equal(refreshed.start, '2025-10-01')
    assert.equal(refreshed.end, '2026-09-30')
    assert.deepEqual(refreshed.totals, {}, 'same-day totals from the previous fixed window are never reused')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
