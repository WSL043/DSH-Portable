import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeStartupPerformance } from '../scripts/report-startup-performance.mjs'

function report(runs) {
  return { startupHistory: { runs: runs.map(summary => ({ summary })) } }
}

test('startup performance groups prepared, reused, and unknown capsule runs', () => {
  const result = summarizeStartupPerformance(report([
    { capsuleReused: false, importDurationMs: 10 },
    { capsuleReused: true, importDurationMs: 20 },
    { capsuleReused: 'not-recorded', importDurationMs: 30 },
    { capsuleReused: 'unexpected', importDurationMs: 40 },
  ]))
  assert.deepEqual(Object.keys(result.groups), ['prepared-new-runtime', 'reused-runtime', 'unknown'])
  assert.equal(result.groups['prepared-new-runtime'].runs, 1)
  assert.equal(result.groups['reused-runtime'].runs, 1)
  assert.equal(result.groups.unknown.runs, 2)
  assert.equal(result.groups.unknown.stats.importDurationMs.count, 2)
})

test('failed and incomplete runs remain counted while unrecorded values stay out of stats', () => {
  const result = summarizeStartupPerformance(report([
    { capsuleReused: false, failureObserved: true, readinessObserved: false, importDurationMs: 'not-recorded', capsuleDurationMs: 12 },
    null,
    { capsuleReused: false, failureObserved: false, readinessObserved: true, importDurationMs: 8, capsuleDurationMs: -1, interactiveElapsedMs: Infinity },
  ]))
  const group = result.groups['prepared-new-runtime']
  assert.equal(group.runs, 2)
  assert.equal(group.failed, 1)
  assert.equal(group.readiness, 1)
  assert.deepEqual(group.notRecorded, { importDurationMs: 1, capsuleDurationMs: 1, interactiveElapsedMs: 2, maxHeartbeatAgeMs: 2 })
  assert.deepEqual(group.stats.importDurationMs, { count: 1, median: 8, p95: 8, max: 8 })
  assert.deepEqual(group.stats.capsuleDurationMs, { count: 1, median: 12, p95: 12, max: 12 })
  assert.equal(result.groups.unknown.runs, 1)
})

test('startup performance uses nearest-rank p95 for small samples and median averages', () => {
  const result = summarizeStartupPerformance(report([
    { capsuleReused: true, importDurationMs: 4, interactiveElapsedMs: 100 },
    { capsuleReused: true, importDurationMs: 12, interactiveElapsedMs: 300 },
    { capsuleReused: true, importDurationMs: 20, interactiveElapsedMs: 500 },
  ]))
  assert.deepEqual(result.groups['reused-runtime'].stats.importDurationMs, { count: 3, median: 12, p95: 20, max: 20 })
  assert.deepEqual(result.groups['reused-runtime'].stats.interactiveElapsedMs, { count: 3, median: 300, p95: 500, max: 500 })
  assert.match(result.scope, /sample-based/)
  assert.match(result.scope, /not a benchmark/)
  assert.match(result.scope, /OS-cold-start/)
})
