import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const [rootArgument, extensionId = 'session-delete'] = process.argv.slice(2)
if (!rootArgument || extensionId !== 'session-delete') {
  throw new Error('usage: node smoke-portable-catalog-extension.mjs <finished-product-root> session-delete')
}

const root = path.resolve(rootArgument)
const cli = path.join(root, 'launcher', 'portable-cli.mjs')
const environment = {
  ...process.env,
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
}
let running = false

function lastJsonLine(output) {
  for (const line of String(output ?? '').trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line) } catch { /* keep looking */ }
  }
  throw new Error(`Portable CLI did not return JSON: ${output}`)
}

async function runCli(...args) {
  const { stdout, stderr } = await runFile(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: environment,
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
  const result = lastJsonLine(stdout)
  if (stderr?.trim()) process.stderr.write(stderr)
  return result
}

async function start() {
  const result = await runCli('start', '--no-browser')
  assert.ok(['started', 'already-running'].includes(result.status), `unexpected start status: ${result.status}`)
  running = true
  return result
}

async function stop() {
  const result = await runCli('stop')
  assert.ok(['stopped', 'not-running'].includes(result.status), `unexpected stop status: ${result.status}`)
  running = false
}

async function request(baseUrl, pathname, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json', origin: baseUrl }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

async function queue(baseUrl, action, experimentalAcknowledged) {
  const preview = await request(baseUrl, '/api/dsh-portable/extensions/preview', {
    method: 'POST',
    body: { id: extensionId, action },
  })
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload))
  assert.equal(preview.payload.id, extensionId)
  const confirmation = await request(baseUrl, '/api/dsh-portable/extensions/confirm', {
    method: 'POST',
    body: { previewToken: preview.payload.previewToken, experimentalAcknowledged },
  })
  assert.equal(confirmation.response.status, 200, JSON.stringify(confirmation.payload))
  assert.equal(confirmation.payload.status, 'queued')
}

async function state(baseUrl) {
  const result = await request(baseUrl, '/api/dsh-portable/extensions')
  assert.equal(result.response.status, 200, JSON.stringify(result.payload))
  return result.payload
}

try {
  let host = await start()
  await queue(host.url, 'install', true)
  await stop()

  host = await start()
  let current = await state(host.url)
  assert.equal(current.items.find(item => item.id === extensionId)?.installed, true)
  assert.equal(current.result?.status, 'applied')
  assert.equal(current.result?.code, 'installed')

  const missingSession = await request(host.url, '/plugins/dsh-session-delete/delete', {
    method: 'POST',
    headers: { 'x-dsh-session-delete-confirmation': 'delete-session' },
    body: { sessionId: '00000000-0000-0000-0000-000000000000' },
  })
  assert.equal(missingSession.response.status, 409)
  assert.equal(missingSession.payload?.error?.code, 'session-not-found')

  await queue(host.url, 'remove', false)
  await stop()
  host = await start()

  current = await state(host.url)
  assert.equal(current.items.find(item => item.id === extensionId)?.installed, false)
  assert.equal(current.result?.status, 'applied')
  assert.equal(current.result?.code, 'removed')

  const profilePackage = JSON.parse(await readFile(path.join(root, 'data', 'dsh-home', 'profiles', 'web', 'package.json'), 'utf8'))
  assert.equal(profilePackage.dependencies?.['@deepseek-ai/dsh-client-ui-workspace'], undefined)

  const removedRoute = await request(host.url, '/plugins/dsh-session-delete/delete', {
    method: 'POST',
    headers: { 'x-dsh-session-delete-confirmation': 'delete-session' },
    body: { sessionId: '00000000-0000-0000-0000-000000000000' },
  })
  assert.notEqual(removedRoute.payload?.error?.code, 'session-not-found')

  process.stdout.write('[portable-catalog-extension-smoke] pinned session-delete install, restart, safe route, and remove passed\n')
} finally {
  if (running) await stop().catch(() => {})
}
