import assert from 'node:assert/strict'
import test from 'node:test'

import { renameWithRetry } from '../scripts/smoke-helpers.mjs'

test('Windows movable-folder smoke retries only transient rename locks', async () => {
  let calls = 0
  const waits = []
  await renameWithRetry('before', 'after', {
    platform: 'win32',
    attempts: 5,
    renameFn: async () => {
      calls += 1
      if (calls < 3) throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' })
    },
    waitFn: async (milliseconds) => { waits.push(milliseconds) },
  })
  assert.equal(calls, 3)
  assert.deepEqual(waits, [100, 200])
})

test('movable-folder smoke does not hide permanent or non-Windows rename failures', async () => {
  await assert.rejects(
    renameWithRetry('before', 'after', {
      platform: 'win32',
      renameFn: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }) },
      waitFn: async () => assert.fail('must not retry a permanent error'),
    }),
    { code: 'ENOENT' },
  )
  await assert.rejects(
    renameWithRetry('before', 'after', {
      platform: 'darwin',
      renameFn: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) },
      waitFn: async () => assert.fail('must not apply a Windows workaround on macOS'),
    }),
    { code: 'EBUSY' },
  )
})
