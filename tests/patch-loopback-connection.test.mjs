import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { patchLoopbackConnection } from '../scripts/patch-loopback-connection.mjs'

// Older cores ship one client.js; newer ones split it into client.browser.js (the web UI) and client.node.js. The seam is in
// the browser build.
const libDirectory = new URL('../app/node_modules/@deepseek-ai/dsh-client-connection/lib/', import.meta.url)
async function readSeamSource() {
  for (const name of ['client.js', 'client.browser.js', 'client.node.js']) {
    const source = await readFile(new URL(name, libDirectory), 'utf8').catch(() => null)
    if (source !== null && source.includes('stopNetworkWatch: watchBrowserNetwork(controller)')) return source
  }
  throw new Error('no dsh-client-connection client build carries the loopback seam')
}
const original = 'stopNetworkWatch: watchBrowserNetwork(controller)'
const replacementExpression = 'handle.isLoopback ? () => {} : watchBrowserNetwork(controller)'
const replacement = `stopNetworkWatch: ${replacementExpression}`

function count(source, value) {
  return source.split(value).length - 1
}

test('loopback patch applies to the current client seam and is idempotent', async () => {
  const source = await readSeamSource()
  assert.equal(count(source, original), 1)

  const patched = patchLoopbackConnection(source)
  assert.equal(count(patched, original), 0)
  assert.equal(count(patched, replacement), 1)
  assert.match(patched, /dsh-portable-loopback-connection-v1/)
  assert.equal(patchLoopbackConnection(patched), patched)
})

test('loopback patch rejects a changed or ambiguous seam', async () => {
  const source = await readSeamSource()
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

test('the command patches a core that splits the client into browser and node files', async t => {
  const { execFile } = await import('node:child_process')
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-loopback-split-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const lib = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-connection', 'lib')
  await mkdir(lib, { recursive: true })
  for (const name of ['client.browser.js', 'client.node.js']) await writeFile(path.join(lib, name), `const x = { ${original} }\n`)
  const script = fileURLToPath(new URL('../scripts/patch-loopback-connection.mjs', import.meta.url))
  await new Promise((resolve, reject) => execFile(process.execPath, [script, root], error => error ? reject(error) : resolve()))
  for (const name of ['client.browser.js', 'client.node.js']) assert.match(await readFile(path.join(lib, name), 'utf8'), /dsh-portable-loopback-connection-v1/)
  await assert.rejects(new Promise((resolve, reject) => execFile(process.execPath, [script, path.join(root, 'missing')], error => error ? reject(error) : resolve())))
})
