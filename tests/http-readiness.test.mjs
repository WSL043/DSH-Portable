import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { once } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

import { officialWorkspaceUrl, workspaceDocumentReady } from '../launcher/http-readiness.mjs'

async function withServer(handler, run) {
  const server = http.createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run(server.address().port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('workspace readiness waits for the complete HTML document body', async () => {
  await withServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.write('<!doctype html><title>DSH')
    setTimeout(() => response.end('</title>'), 90)
  }, async (port) => {
    const started = Date.now()
    assert.equal(await workspaceDocumentReady(port, 1000), true)
    assert.ok(Date.now() - started >= 70, 'readiness must not resolve on headers alone')
  })
})

test('workspace readiness rejects error pages, empty bodies, and oversized bodies', async () => {
  for (const fixture of [
    { status: 404, type: 'text/html', body: '<h1>not found</h1>' },
    { status: 200, type: 'text/html', body: '' },
    { status: 200, type: 'text/plain', body: 'ok' },
  ]) {
    await withServer((request, response) => {
      response.writeHead(fixture.status, { 'content-type': fixture.type })
      response.end(fixture.body)
    }, async (port) => assert.equal(await workspaceDocumentReady(port, 1000), false))
  }

  await withServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(Buffer.alloc(2 * 1024 * 1024 + 1, 65))
  }, async (port) => assert.equal(await workspaceDocumentReady(port, 1000), false))
})

test('alpha workspace access tokens are parsed only from the expected loopback server', async () => {
  const output = [
    'noise',
    'dsh web: https://127.0.0.1:3080/?token=wrong-protocol',
    'dsh web: http://example.com:3080/?token=wrong-host',
    'dsh web: http://127.0.0.1:3081/?token=wrong-port',
    'dsh web: http://127.0.0.1:3080/?token=local-token',
  ].join('\n')
  assert.equal(officialWorkspaceUrl(output, 3080), 'http://127.0.0.1:3080/?token=local-token')
  assert.equal(officialWorkspaceUrl(output, 3099), null)
})

test('workspace readiness can use a validated token URL', async () => {
  await withServer((request, response) => {
    if (request.url === '/?token=portable') {
      response.writeHead(303, {
        location: '/',
        'set-cookie': 'dsh-auth=verified; Path=/; HttpOnly; SameSite=Strict',
      }).end()
      return
    }
    if (request.url !== '/' || request.headers.cookie !== 'dsh-auth=verified') {
      response.writeHead(401, { 'content-type': 'text/plain' }).end('unauthorized')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>DSH</title>')
  }, async (port) => {
    assert.equal(await workspaceDocumentReady(port, 1000), false)
    assert.equal(await workspaceDocumentReady(`http://127.0.0.1:${port}/?token=portable`, 1000), true)
    assert.equal(await workspaceDocumentReady(`http://example.com:${port}/?token=portable`, 1000), false)
  })
})

test('host readiness leaves a one-time workspace token for the WebView', async () => {
  let tokenRequests = 0
  let bareRequests = 0
  await withServer((request, response) => {
    if (request.url === '/?token=portable') {
      tokenRequests += 1
      response.writeHead(tokenRequests === 1 ? 303 : 401, tokenRequests === 1 ? {
        location: '/',
        'set-cookie': 'dsh-auth=verified; Path=/; HttpOnly; SameSite=Strict',
      } : { 'content-type': 'text/plain' }).end(tokenRequests === 1 ? undefined : 'token already consumed')
      return
    }
    bareRequests += 1
    response.writeHead(401, { 'content-type': 'text/plain' }).end('authentication required')
  }, async (port) => {
    const workspaceUrl = `http://127.0.0.1:${port}/?token=portable`
    assert.equal(await workspaceDocumentReady(workspaceUrl, 1000, { preserveAccessToken: true }), true)
    assert.equal(tokenRequests, 0)
    assert.equal(bareRequests, 1)
  })
})

test('status probes survive an idle connection closing during synchronous process inspection', async t => {
  const closed = new Int32Array(new SharedArrayBuffer(4))
  const server = new Worker(`
    const http = require('node:http')
    const { parentPort, workerData } = require('node:worker_threads')
    const closed = new Int32Array(workerData)
    const server = http.createServer((request, response) => {
      response.once('finish', () => setTimeout(() => {
        const notify = () => { Atomics.store(closed, 0, 1); Atomics.notify(closed, 0) }
        if (request.socket.destroyed) notify()
        else { request.socket.once('close', notify); request.socket.destroy() }
      }, 30))
      response.writeHead(401).end('authentication required')
    })
    server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port))
  `, { eval: true, workerData: closed.buffer })
  t.after(() => server.terminate())
  const [port] = await once(server, 'message')
  assert.equal(await workspaceDocumentReady(port, 1200, { preserveAccessToken: true }), true)
  await setImmediate()
  // The independent server closes its idle socket while this event loop is busy,
  // just as a synchronous ownership query can defer delivery of the socket FIN.
  assert.notEqual(Atomics.wait(closed, 0, 0, 5000), 'timed-out')
  assert.equal(await workspaceDocumentReady(port, 1200, { preserveAccessToken: true }), true)
})
