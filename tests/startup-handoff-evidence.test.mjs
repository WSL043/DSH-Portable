import assert from 'node:assert/strict'
import test from 'node:test'
import { assessStartupHandoff } from '../scripts/startup-handoff-evidence.mjs'

const deadline = 100000
const trace = timestamp => [{ pid: 42, phase: 'interactive-ready', timestamp: new Date(timestamp).toISOString() }]
const samples = Array.from({ length: 8 }, (_, i) => ({ observedAt: deadline + i * 20,
  at: i * 20, bootVisible: false, bodyText: 'Workspace', visibleControls: 3, log: '' }))

test('on-time native handoff can settle after the deadline without relying on delayed text logs', () => {
  assert.equal(assessStartupHandoff({ samples, trace: trace(deadline - 1), pid: 42, deadline }).reason, 'ready')
  assert.equal(assessStartupHandoff({ samples, trace: trace(deadline + 1), pid: 42, deadline }).reason, 'native-startup-budget-exceeded')
})

test('handoff evidence requires the audited PID and eight consecutive usable samples', () => {
  assert.equal(assessStartupHandoff({ samples, trace: trace(deadline), pid: 43, deadline }).reason, 'native-handoff-missing')
  for (const change of [{ bootVisible: true }, { bodyText: '' }, { visibleControls: 0 }]) {
    const interrupted = samples.map((sample, index) => index === 4 ? { ...sample, ...change } : sample)
    assert.equal(assessStartupHandoff({ samples: interrupted, trace: trace(deadline), pid: 42, deadline }).reason, 'workspace-not-stable-after-handoff')
  }
})
