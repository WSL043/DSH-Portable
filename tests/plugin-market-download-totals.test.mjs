import test from 'node:test'
import assert from 'node:assert/strict'
import { createDownloadTotals, downloadPeriods } from '../app/vendor/dsh-portable-plugin-market/src/download-totals.ts'

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
