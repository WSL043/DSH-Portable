import test from 'node:test'
import assert from 'node:assert/strict'
import { formatRecoveryResult } from '../launcher/recovery-presentation.mjs'

test('recovery distinguishes no-op, repaired, running, incomplete and failed results', () => {
  const healthy = { ok: true, checks: [{ id: 'runtime.node', status: 'ok' }], actions: [] }
  assert.match(formatRecoveryResult(healthy, 'repair'), /no generated components need repair/)
  assert.match(formatRecoveryResult({ ...healthy, actions: ['resolver'] }, 'repair'), /Generated components repaired/)
  assert.match(formatRecoveryResult(healthy, 'doctor'), /checks passed/)
  assert.match(formatRecoveryResult({ ...healthy, ok: false, deferred: true }, 'repair'), /Repair not performed/)
  assert.match(formatRecoveryResult({ ...healthy, ok: false, needsFullPackage: true }, 'repair'), /full product package/)
  const failed = { ok: false, checks: [{ id: 'generated.resolver', status: 'error', detail: 'unavailable' }] }
  assert.match(formatRecoveryResult(failed, 'repair'), /generated.resolver: error — unavailable/)
  assert.match(formatRecoveryResult(failed, 'repair'), /Export a support report/)
  assert.equal(formatRecoveryResult(healthy, 'start'), null)
  assert.equal(formatRecoveryResult({ ok: true }, 'doctor'), null)
})
