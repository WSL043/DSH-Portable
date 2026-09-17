import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedTimeout } from '../app/vendor/dsh-portable-plugin-market/src/timeout.ts'

test('invalid timer overrides use the default instead of immediate or infinite waits', () => {
  for (const value of [undefined, '', 'wrong', 0, -1, Infinity, NaN]) {
    assert.equal(boundedTimeout(value, 10000, 60000), 10000)
  }
})
test('valid test overrides remain available while oversized durations are bounded', () => {
  assert.equal(boundedTimeout('20', 10000, 60000), 20)
  assert.equal(boundedTimeout(25.9, 10000, 60000), 25)
  assert.equal(boundedTimeout(2 ** 32, 10000, 60000), 60000)
})
