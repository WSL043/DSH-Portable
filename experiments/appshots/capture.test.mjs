import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { captureAppshot } from './capture.mjs'

const target = { window: '123', pid: 456 }
const frame = { type: 'image', width: 1, height: 1, dataUrl: 'data:image/png;base64,aGVsbG8=' }
function helper() {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null)) }
  return child
}

test('image is delivered before text and survives a stalled UIA provider', async () => {
  const child = helper(); let preview = false
  const promise = captureAppshot('fixture', target, { spawnProcess: () => child, timeoutMs: 30, onImage: () => { preview = true } })
  child.stdout.write(JSON.stringify(frame) + '\n')
  assert.equal(preview, true)
  const result = await promise
  assert.equal(child.killed, true)
  assert.equal(result.textPartial, true)
  assert.match(result.warning, /timed out/)
  assert.equal(result.image.dataUrl, frame.dataUrl)
})

test('cancel does not keep a captured image as a successful attachment', async () => {
  const child = helper(); const controller = new AbortController()
  const promise = captureAppshot('fixture', target, { spawnProcess: () => child, signal: controller.signal })
  child.stdout.write(JSON.stringify(frame) + '\n')
  controller.abort()
  await assert.rejects(promise, /cancelled/)
  assert.equal(child.killed, true)
})

test('partial UTF-8 responses are reassembled and text failure remains explicit', async () => {
  const child = helper()
  const promise = captureAppshot('fixture', target, { spawnProcess: () => child })
  const output = Buffer.from(JSON.stringify(frame) + '\n' + JSON.stringify({ type: 'text', text: '中文上下文', partial: true }) + '\n')
  for (const byte of output) child.stdout.write(Buffer.from([byte]))
  child.emit('close', 0)
  const result = await promise
  assert.equal(result.text, '中文上下文')
  assert.equal(result.textPartial, true)
})

test('native capture failure never becomes a blank successful attachment', async () => {
  const child = helper()
  const promise = captureAppshot('fixture', target, { spawnProcess: () => child })
  child.stdout.write(JSON.stringify({ type: 'error', message: 'Window closed.' }) + '\n')
  child.emit('close', 1)
  await assert.rejects(promise, /Window closed/)
})
