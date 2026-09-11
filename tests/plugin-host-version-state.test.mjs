import assert from 'node:assert/strict'
import test from 'node:test'
import { HostVersionState } from '../app/vendor/dsh-portable-plugin-market/src/host-version-state.ts'

test('external host updates remain pending through disk rollback, but reset on process restart', () => {
  const state = new HostVersionState()
  assert.equal(state.observe('provider', '2.0.0', true), false)
  assert.equal(state.observe('provider', '2.1.0-beta.2', true), true)
  assert.equal(state.observe('provider', '2.0.0', true), true)
  assert.equal(new HostVersionState().observe('provider', '2.1.0-beta.2', true), false)
})
test('client-only updates and first observations do not claim a stale host module', () => {
  const state = new HostVersionState()
  assert.equal(state.observe('theme', '1.0.0', false), false)
  assert.equal(state.observe('theme', '2.0.0', false), false)
  assert.equal(state.observe('provider', null, true), false)
  assert.equal(state.observe('provider', '1.0.0', true), false)
  assert.equal(state.observe('provider', '1.0.0', true), false)
})
