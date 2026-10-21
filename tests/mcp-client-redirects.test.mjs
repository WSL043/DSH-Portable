import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const appRequire = createRequire(new URL('../app/package.json', import.meta.url))
// Resolve from the actual DSH consumer, including any nested dependency copy.
const consumer = appRequire.resolve('@deepseek-ai/dsh-mcp-client')
const { StreamableHTTPClientTransport, refreshAuthorization } = createRequire(consumer)('@modelcontextprotocol/client')
const message = { jsonrpc: '2.0', method: 'notifications/initialized', params: { marker: 'fixture-private-body' } }

async function serve(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  return `http://127.0.0.1:${server.address().port}`
}

async function requestData(request) {
  let body = ''
  for await (const chunk of request) body += chunk
  return { headers: request.headers, method: request.method, body }
}

for (const status of [307, 308]) {
  test(`MCP HTTP ${status} cannot forward custom headers, session ID, or body to another origin`, async t => {
    const leaked = []
    const foreign = await serve(t, async (request, response) => {
      leaked.push(await requestData(request))
      response.writeHead(202).end()
    })
    const received = []
    const origin = await serve(t, async (request, response) => {
      received.push(await requestData(request))
      response.writeHead(status, { location: `${foreign}/capture` }).end()
    })
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { 'x-api-key': 'fixture-api-key' } }, sessionId: 'fixture-session',
    })
    await transport.start()
    t.after(() => transport.close())
    await assert.rejects(transport.send(message), /redirect.*not followed/i)
    assert.equal(received[0].headers['x-api-key'], 'fixture-api-key')
    assert.equal(received[0].headers['mcp-session-id'], 'fixture-session')
    assert.deepEqual(JSON.parse(received[0].body), message)
    assert.deepEqual(leaked, [], 'the other origin must receive no request')
  })

  test(`OAuth refresh ${status} cannot forward refresh token or client secret to another origin`, async t => {
    const leaked = []
    const foreign = await serve(t, async (request, response) => {
      leaked.push(await requestData(request))
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'fixture-access', token_type: 'Bearer' }))
    })
    const received = []
    const origin = await serve(t, async (request, response) => {
      received.push(await requestData(request))
      response.writeHead(status, { location: `${foreign}/capture` }).end()
    })
    await assert.rejects(refreshAuthorization(origin, {
      metadata: { issuer: origin, token_endpoint: `${origin}/token`, token_endpoint_auth_methods_supported: ['client_secret_post'] },
      clientInformation: { client_id: 'fixture-client', client_secret: 'fixture-secret' }, refreshToken: 'fixture-refresh',
    }))
    const form = new URLSearchParams(received[0].body)
    assert.equal(form.get('refresh_token'), 'fixture-refresh')
    assert.equal(form.get('client_secret'), 'fixture-secret')
    assert.deepEqual(leaked, [], 'the other origin must receive no token request')
  })
}

test('MCP HTTP still follows a same-origin redirect without changing the POST', async t => {
  const accepted = []
  const origin = await serve(t, async (request, response) => {
    const data = await requestData(request)
    if (request.url === '/mcp') response.writeHead(307, { location: '/accepted' }).end()
    else {
      accepted.push(data)
      response.writeHead(202).end()
    }
  })
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { 'x-api-key': 'fixture-api-key' } }, sessionId: 'fixture-session',
  })
  await transport.start()
  t.after(() => transport.close())
  await transport.send(message)
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].method, 'POST')
  assert.equal(accepted[0].headers['x-api-key'], 'fixture-api-key')
  assert.equal(accepted[0].headers['mcp-session-id'], 'fixture-session')
  assert.deepEqual(JSON.parse(accepted[0].body), message)
})

test('the official DSH MCP consumer imports with the patched client', async () => {
  await import(pathToFileURL(consumer).href)
})
