import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { scheduleHostMaintenance } from '../launcher/host-maintenance.mjs'

test('stopped host cancels deferred maintenance without touching caches', async () => {
  let calls = 0
  const stop = scheduleHostMaintenance({ root: '.' }, {
    delayMs: 5, intervalMs: 10,
    cleanRuntime: async () => { calls++ }, cleanLogs: async () => { calls++ }, record() {},
  })
  stop()
  await delay(30)
  assert.equal(calls, 0)
})

test('slow maintenance cannot overlap and shutdown skips subsequent work', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let calls = 0
  let logCalls = 0
  let signal
  const stop = scheduleHostMaintenance({ root: '.' }, {
    delayMs: 1, intervalMs: 5,
    cleanRuntime: async (_root, options) => { signal = options.signal; assert.equal(options.budgetMs, 1000); assert.equal(options.measure, false); calls++; await gate; return { retained: [], removed: [] } },
    cleanLogs: async () => { logCalls++; return {} }, record() {},
  })
  try {
    await delay(30)
    assert.equal(calls, 1)
    assert.equal(signal.aborted, false)
    stop()
    assert.equal(signal.aborted, true)
    release()
    await delay(10)
    assert.equal(logCalls, 0)
  } finally { stop(); release() }
})

test('runtime cleanup failure does not prevent bounded plugin log maintenance', async () => {
  const events = []
  let finish
  const done = new Promise(resolve => { finish = resolve })
  const stop = scheduleHostMaintenance({ root: '.' }, {
    delayMs: 1, intervalMs: 10000,
    cleanRuntime: async () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }) },
    cleanLogs: async () => ({ removed: 3, limited: true }),
    record(component, phase, fields) { events.push({ component, phase, fields }); if (component === 'plugin-logs') finish() },
  })
  try {
    await Promise.race([done, delay(1000).then(() => { throw new Error('maintenance did not run') })])
    assert.equal(events[0].fields.code, 'EBUSY')
    assert.equal(events[1].fields.removed, 3)
  } finally { stop() }
})

test('unmeasured background reclamation does not report zero bytes as an exact saving', async () => {
  let recorded
  let finish
  const done = new Promise(resolve => { finish = resolve })
  const stop = scheduleHostMaintenance({ root: '.' }, {
    delayMs: 1, intervalMs: 10000,
    cleanRuntime: async () => ({ retained: [], removed: [{ hash: 'old', bytes: null, files: null }] }),
    cleanLogs: async () => { finish(); return {} },
    record(_component, _phase, fields) { recorded = fields },
  })
  try {
    await Promise.race([done, delay(1000).then(() => { throw new Error('maintenance did not run') })])
    assert.equal(recorded.removed, 1)
    assert.equal(recorded.reclaimedBytes, null)
  } finally { stop() }
})

test('Portable host maintenance runs stale update-operation cleanup and records removals', async () => {
  const events = []
  let finish
  const done = new Promise(resolve => { finish = resolve })
  const stop = scheduleHostMaintenance({ root: '.' }, {
    delayMs: 1, intervalMs: 10000,
    cleanRuntime: async () => ({ retained: [], removed: [] }),
    cleanUpdateOperations: async () => ({ removed: ['11111111-1111-4111-8111-111111111111'], deferred: false }),
    cleanLogs: async () => { finish(); return {} },
    record(component, phase, fields) { events.push({ component, phase, fields }) },
  })
  try {
    await Promise.race([done, delay(1000).then(() => { throw new Error('maintenance did not run') })])
    assert.deepEqual(events.find(event => event.component === 'update-operations'), {
      component: 'update-operations', phase: 'maintenance-complete', fields: { removed: 1 },
    })
  } finally { stop() }
})
