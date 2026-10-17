import assert from 'node:assert/strict'
import test from 'node:test'

import { readBodyWhileProgressing } from '../app/vendor/dsh-portable-plugin-market/src/registry.ts'

const bytes = text => new TextEncoder().encode(text)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function streamOf(steps) {
  let index = 0
  return new Response(new ReadableStream({
    async pull(controller) {
      const step = steps[index++]
      if (step === undefined) { controller.close(); return }
      if (step.wait) await wait(step.wait)
      if (step.hang) { await new Promise(() => {}) }
      controller.enqueue(bytes(step.text))
    },
  }))
}

test('a catalog body that keeps trickling past the stall window still completes (dsh-market #766)', async () => {
  // Total time (~240 ms) is several times the 80 ms stall window, but no gap is longer than 60 ms.
  const response = streamOf([{ text: '{"a":' }, { text: '1,', wait: 60 }, { text: '"b":', wait: 60 }, { text: '2}', wait: 60 }, { text: '', wait: 60 }])
  const body = await readBodyWhileProgressing(response, 80)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(body)), { a: 1, b: 2 })
})

test('a body that goes silent is cut off with a message that says how much had arrived', async () => {
  const response = streamOf([{ text: '{"a":' }, { hang: true }])
  await assert.rejects(readBodyWhileProgressing(response, 60), error => {
    assert.equal(error.name, 'TimeoutError')
    assert.match(error.message, /no new data for/u)
    assert.match(error.message, /received 5 bytes/u)
    return true
  })
})

test('an empty body is reported as such instead of a JSON parse error', async () => {
  await assert.rejects(readBodyWhileProgressing(new Response(null, { status: 200 }), 60), /carried no body/u)
})
