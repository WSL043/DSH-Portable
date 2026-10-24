import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { verifyInstalledRuntimeDependencies } from '../scripts/stage-preview-runtime.mjs'

const appRequire = createRequire(new URL('../app/package.json', import.meta.url))
const { z } = createRequire(appRequire.resolve('@deepseek-ai/dsh-session'))('zod')

test('every installed app lock location passes the runtime dependency security floors', async () => {
  const checked = await verifyInstalledRuntimeDependencies(fileURLToPath(new URL('../app/', import.meta.url)))
  for (const name of ['zod', 'undici', 'fast-uri']) assert.ok(checked.some(entry => entry.name === name))
})

test('the DSH Zod consumer rejects oversized bounded arrays and sets before visiting elements', () => {
  for (const kind of ['array', 'set']) {
    let visits = 0
    const item = z.string().refine(() => { visits++; return true })
    const schema = (kind === 'array' ? z.array(item) : z.set(item)).max(2)
    const allowed = kind === 'array' ? ['a', 'b'] : new Set(['a', 'b'])
    assert.equal(schema.safeParse(allowed).success, true)
    assert.equal(visits, 2)
    visits = 0
    const oversized = kind === 'array' ? ['a', 'b', 'c'] : new Set(['a', 'b', 'c'])
    const result = schema.safeParse(oversized)
    assert.equal(result.success, false)
    assert.ok(result.error.issues.some(issue => issue.code === 'too_big'))
    assert.equal(visits, 0, `${kind} size guard must run before element validation`)
  }
})

async function serve(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  return `http://127.0.0.1:${server.address().port}`
}

for (const [label, consumer] of [
  ['official HTTP fetch', '@deepseek-ai/dsh-web-fetch-http'],
  ['Portable market', '@wsl043/dsh-portable-plugin-market'],
]) {
  const { Agent, fetch } = createRequire(appRequire.resolve(consumer))('undici')
  test(`${label} Undici preserves local HTTP, gzip and strict integrity checks`, async t => {
    const body = 'bounded local dependency-security fixture'
    const origin = await serve(t, (_request, response) => {
      response.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync(body))
    })
    const dispatcher = new Agent()
    t.after(() => dispatcher.close())
    const request = { dispatcher, signal: AbortSignal.timeout(5000) }
    const digest = createHash('sha256').update(body).digest('base64')
    const wrong = createHash('sha256').update('wrong').digest('base64')
    assert.equal(await (await fetch(origin, request)).text(), body)
    assert.equal(await (await fetch(origin, { ...request, integrity: `sha256-${digest}` })).text(), body)
    await assert.rejects(fetch(origin, { ...request, integrity: `sha256-${wrong}` }), /fetch failed/)
    // Case variants must still be verified, including strongest-algorithm selection.
    assert.equal(await (await fetch(origin, { ...request, integrity: `Sha256-${digest}` })).text(), body)
    await assert.rejects(fetch(origin, { ...request, integrity: `SHA256-${wrong}` }), /fetch failed/)
    const wrongStrong = createHash('sha512').update('wrong').digest('base64')
    await assert.rejects(fetch(origin, { ...request, integrity: `SHA512-${wrongStrong} sha256-${digest}` }), /fetch failed/)
  })

  test(`${label} Undici rejects an excessive encoding chain and stays usable`, async t => {
    const origin = await serve(t, (request, response) => {
      if (request.url === '/too-many') response.writeHead(200, { 'content-encoding': Array(6).fill('gzip').join(', '), 'content-length': '1000', connection: 'close' }).end('small fixture')
      else response.end('still running')
    })
    const dispatcher = new Agent()
    t.after(() => dispatcher.close())
    const options = { dispatcher, signal: AbortSignal.timeout(5000) }
    await assert.rejects(async () => {
      const response = await fetch(`${origin}/too-many`, options)
      await response.text()
    }, /fetch failed|terminated/)
    assert.equal(await (await fetch(origin, options)).text(), 'still running')
  })
}
