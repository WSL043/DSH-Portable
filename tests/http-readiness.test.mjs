import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { workspaceDocumentReady } from '../launcher/http-readiness.mjs'

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
