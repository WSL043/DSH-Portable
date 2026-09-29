import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  createDownloadTotals, createDownloadTotalsTable, downloadPeriods, downloadTotalsPeriods,
  planDownloadTotals, DOWNLOAD_TOTALS_MAX_REQUESTS,
} from '../app/vendor/dsh-portable-plugin-market/src/download-totals.ts'

const root = path.resolve(import.meta.dirname, '..')

test('download periods include leap days and never overlap at year boundaries', () => {
  assert.deepEqual(downloadPeriods('2023-12-31', '2025-01-01'), [
    ['2023-12-31', '2023-12-31'], ['2024-01-01', '2024-12-31'], ['2025-01-01', '2025-01-01'],
  ])
})

test('totals sum every period, coalesce callers and expire daily', async () => {
  let calls = 0, clock = 0
  const get = createDownloadTotals(async url => {
    calls++
    const data = url.includes('registry.npmjs.org') ? { name: '@test/example', time: { created: '2024-06-01T00:00:00Z' } }
      : url.includes('last-day') ? { package: '@test/example', end: '2026-09-25' }
        : { package: '@test/example', start: url.split('/point/')[1].split(':')[0], end: url.split(':').at(-1).split('/')[0], downloads: 100 }
    return new Response(JSON.stringify(data))
  }, () => clock)
  const first = get('@test/example')
  assert.equal(get('@test/example'), first)
  assert.deepEqual(await first, { downloads: 300, start: '2024-06-01', end: '2026-09-25', complete: true })
  await get('@test/example'); assert.equal(calls, 5)
  clock = 86400001
  await get('@test/example'); assert.equal(calls, 10)
})

test('partial or mismatched npm responses never become a claimed total', async () => {
  const get = createDownloadTotals(async url => new Response(JSON.stringify(
    url.includes('registry.npmjs.org') ? { name: 'example', time: { created: '2010-01-01' } }
      : url.includes('last-day') ? { package: 'example', end: '2015-01-12' }
        : { package: 'example', start: '2015-01-11', end: '2015-01-12', downloads: 10 }
  )))
  await assert.rejects(get('example'), /Incomplete npm statistics/)
  await assert.rejects(get('../example'), /Invalid npm package/)
})

test('visible-card requests have bounded concurrency and release failed slots', async () => {
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

test('table periods and request planning stay within npm bulk limits and the refresh cap', () => {
  assert.deepEqual(downloadTotalsPeriods('2025-01-01', '2026-01-05'), [
    ['2025-01-01', '2025-12-31'], ['2026-01-01', '2026-01-05'],
  ])
  const names = [
    ...Array.from({ length: 1663 }, (_, i) => `plain-${i}`),
    ...Array.from({ length: 583 }, (_, i) => `@scope-${i}/plugin`),
  ]
  const plan = planDownloadTotals(names, '2025-01-01', '2026-09-28')
  assert.equal(plan.periods.length, 2)
  assert.equal(plan.bulkBatches, 17)
  assert.equal(plan.scopePackages, 583)
  assert.equal(plan.requestCount, 1200)
  assert.ok(plan.requestCount <= DOWNLOAD_TOTALS_MAX_REQUESTS)
  assert.ok(plan.periods.every(([start, end]) => Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) < 365 * 86400000))

  const capped = planDownloadTotals(['plain-a', 'plain-b', 'plain-c', '@scope-a/pkg', '@scope-b/pkg'], '2025-01-01', '2026-01-05', 4)
  assert.equal(capped.requestCount, 4)
  assert.equal(capped.bulkBatches, 1)
  assert.equal(capped.scopePackages, 1)
  assert.deepEqual(capped.omittedPackages, ['@scope-b/pkg'])
})

test('table batches plain packages, limits scoped concurrency, and isolates a failed batch', async () => {
  const plugins = [
    ...Array.from({ length: 205 }, (_, i) => ({ npm: `plain-${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ npm: `@scope-${i}/plugin` })),
  ]
  let active = 0, peak = 0, activeScope = 0, peakScope = 0
  const urls = []
  let stats
  const get = createDownloadTotalsTable(async url => {
    const isScope = url.split('/downloads/point/')[1].split('/').at(-1).startsWith('%40')
    urls.push(url)
    active++; peak = Math.max(peak, active)
    if (isScope) { activeScope++; peakScope = Math.max(peakScope, activeScope) }
    try {
      await new Promise(resolve => setTimeout(resolve, 2))
      const [range, encodedNames] = new URL(url).pathname.split('/downloads/point/')[1].split('/')
      const [start, end] = range.split(':')
      const names = encodedNames.split(',').map(decodeURIComponent)
      if (names.some(name => name === 'plain-100')) return new Response('batch failed', { status: 503 })
      const values = Object.fromEntries(names.map(name => [name, { package: name, start, end, downloads: 7 }]))
      return new Response(JSON.stringify(isScope ? values[names[0]] : values))
    } finally {
      active--
      if (isScope) activeScope--
    }
  }, { onRefresh: value => { stats = value } })

  const table = await get(plugins)
  assert.equal(table.complete, false)
  assert.equal(Object.keys(table.totals).length, 111, '105 plain and all six scoped packages survive')
  assert.equal(table.totals['plain-0'], 14, 'each package total sums both date ranges')
  assert.equal(table.totals['@scope-5/plugin'], 14)
  assert.equal(table.totals['plain-100'], undefined, 'failed batch values are absent, never zero')
  assert.equal(urls.length, 18, 'three plain batches and six scope packages across two ranges')
  assert.equal(stats.bulkBatches, 3)
  assert.equal(stats.scopePackages, 6)
  assert.equal(stats.scheduledRequests, 18)
  assert.equal(stats.requests, 18)
  assert.equal(stats.failedRequests, 2, 'both periods in the failed batch remain isolated')
  assert.equal(peak, 4)
  assert.ok(peakScope <= 4)
  assert.ok(stats.elapsedMs >= 0)
})

test('table requests coalesce, persist daily, merge same-day additions, and refresh next day', async () => {
  const evidence = path.join(root, 'build/orch-080/T17')
  await mkdir(evidence, { recursive: true })
  const directory = await mkdtemp(path.join(evidence, 'totals-cache-'))
  assert.equal(path.relative(evidence, directory).startsWith('..'), false, 'test cache stays inside T17 evidence')
  const registryCache = path.join(directory, 'registry-cache-v1.json')
  let clock = Date.parse('2026-09-29T12:00:00.000Z')
  let calls = 0
  const get = createDownloadTotalsTable(async url => {
    calls++
    const [range, encodedNames] = new URL(url).pathname.split('/downloads/point/')[1].split('/')
    const [start, end] = range.split(':')
    const names = encodedNames.split(',').map(decodeURIComponent)
    const values = Object.fromEntries(names.map(name => [name, { package: name, start, end, downloads: 3 }]))
    return new Response(JSON.stringify(names[0].startsWith('@') ? values[names[0]] : values))
  }, { now: () => clock })
  try {
    const initial = [{ npm: 'plain-a' }, { npm: '@scope-a/plugin' }]
    const [first, coalesced] = await Promise.all([get(initial, registryCache), get(initial, registryCache)])
    assert.deepEqual(coalesced, first)
    assert.equal(calls, 4)
    assert.equal(first.complete, true)
    assert.deepEqual(first.totals, { 'plain-a': 6, '@scope-a/plugin': 6 })
    const persisted = JSON.parse(await readFile(path.join(directory, 'download-totals-v1.json'), 'utf8'))
    assert.equal(persisted.schemaVersion, 1)
    assert.equal(persisted.complete, true)

    const offline = createDownloadTotalsTable(async () => { throw new Error('cache should prevent network') }, { now: () => clock })
    assert.deepEqual(await offline(initial, registryCache), first)
    assert.equal(calls, 4)

    const expanded = await get([...initial, { npm: 'plain-b' }], registryCache)
    assert.equal(calls, 6, 'same-day catalog additions only fetch names not already cached')
    assert.equal(expanded.complete, true)
    assert.deepEqual(expanded.totals, { 'plain-a': 6, '@scope-a/plugin': 6, 'plain-b': 6 })

    clock += 86400000
    const nextDay = await get([...initial, { npm: 'plain-b' }], registryCache)
    assert.equal(calls, 10, 'a new UTC day recalculates every package')
    assert.equal(nextDay.complete, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
