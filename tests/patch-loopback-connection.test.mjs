import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { patchLoopbackConnection } from '../scripts/patch-loopback-connection.mjs'

const sourceFile = new URL('../app/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js', import.meta.url)
const original = 'stopNetworkWatch: watchBrowserNetwork(controller)'
const replacementExpression = 'handle.isLoopback ? () => {} : watchBrowserNetwork(controller)'
const replacement = `stopNetworkWatch: ${replacementExpression}`

function count(source, value) {
  return source.split(value).length - 1
}

test('loopback patch applies to the current client seam and is idempotent', async () => {
  const source = await readFile(sourceFile, 'utf8')
  assert.equal(count(source, original), 1)

  const patched = patchLoopbackConnection(source)
  assert.equal(count(patched, original), 0)
  assert.equal(count(patched, replacement), 1)
  assert.match(patched, /dsh-portable-loopback-connection-v1/)
  assert.equal(patchLoopbackConnection(patched), patched)
})

test('loopback patch rejects a changed or ambiguous seam', async () => {
  const source = await readFile(sourceFile, 'utf8')
  assert.throws(
    () => patchLoopbackConnection(source.replace(original, 'stopNetworkWatch: changed')),
    /expected 1 match, found 0/,
  )
  assert.throws(
    () => patchLoopbackConnection(`${source}\n${original}`),
    /expected 1 match, found 2/,
  )
})

function runStopNetworkWatch(expression, isLoopback) {
  return vm.runInNewContext(`
    const calls = []
    const controller = {}
    const handle = { isLoopback: ${String(isLoopback)} }
    const watchBrowserNetwork = () => {
      calls.push('watch')
      return () => calls.push('cleanup')
    }
    const current = { stopNetworkWatch: (${expression}) }
    current.stopNetworkWatch();
    JSON.stringify({ calls, stopType: typeof current.stopNetworkWatch })
  `)
}

test('the replacement skips network watching only for loopback and keeps cleanup otherwise', () => {
  assert.deepEqual(JSON.parse(runStopNetworkWatch('watchBrowserNetwork(controller)', true)), {
    calls: ['watch', 'cleanup'],
    stopType: 'function',
  })
  assert.deepEqual(JSON.parse(runStopNetworkWatch(replacementExpression, true)), {
    calls: [],
    stopType: 'function',
  })
  assert.deepEqual(JSON.parse(runStopNetworkWatch(replacementExpression, false)), {
    calls: ['watch', 'cleanup'],
    stopType: 'function',
  })
})
