import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'

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

test('a catalog body that keeps trickling past the stall window still completes (dsh-market #766)', async t => {
  // Control only the watchdog clock: shared CI load must not turn a 60 ms gap
  // into an accidental stall. The synthetic body still spans 240 ms > 80 ms.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let controller
  const response = new Response(new ReadableStream({ start(value) { controller = value } }))
  const reading = readBodyWhileProgressing(response, 80)
  for (const chunk of ['{"a":', '1,', '"b":', '2}']) {
    t.mock.timers.tick(60)
    controller.enqueue(bytes(chunk))
    // Let the reader consume this real stream chunk and reset its watchdog.
    await setImmediate()
  }
  controller.close()
  const body = await reading
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
