import test from 'node:test'
import assert from 'node:assert/strict'
import { awaitHotActivation } from '../app/vendor/dsh-portable-plugin-market/src/hot.ts'

test('failed activation disposes partial host effects and preserves the original failure', async () => {
  const failure = new Error('activation failed after registering a route')
  let live = true
  await assert.rejects(awaitHotActivation({
    async await() { throw failure },
    dispose() { live = false; throw new Error('disposal failed') },
  }), error => error === failure)
  assert.equal(live, false)
})

test('rejected activation does not wait forever for teardown; successful mounts stay active', async () => {
  let disposals = 0
  await assert.rejects(awaitHotActivation({ async await() { throw new Error('failed') },
    dispose() { disposals++; return new Promise(() => {}) },
  }), /failed/)
  await awaitHotActivation({ async await() {}, dispose() { disposals++ } })
  assert.equal(disposals, 1)
})
