import assert from 'node:assert/strict'
import test from 'node:test'
import { qualificationVersion } from '../scripts/prepare-preview-qualification.mjs'
import { classifyProductVersion } from '../scripts/version-policy.mjs'

test('stable checkouts qualify the next candidate instead of the stable core', () => {
  assert.equal(qualificationVersion('0.6.9'), '0.6.10-alpha.1')
  assert.equal(classifyProductVersion(qualificationVersion('0.6.9')).channel, 'candidate')
})
test('candidate materialization is idempotent and validates version bounds', () => {
  assert.equal(qualificationVersion('0.6.10-alpha.1'), '0.6.10-alpha.1')
  assert.throws(() => qualificationVersion('0.6.65534'))
})
