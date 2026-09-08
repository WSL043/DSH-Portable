import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import test from 'node:test'
import vm from 'node:vm'

import { workspaceDocumentReady } from '../launcher/http-readiness.mjs'

const source = process.env.DSH_TEST_CLI_REF
  ? execFileSync('git', ['show', `${process.env.DSH_TEST_CLI_REF}:launcher/portable-cli.mjs`], { encoding: 'utf8' })
  : await readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
const main = source.slice(source.indexOf('async function main() {'), source.indexOf('\nmain().catch('))
const statusBody = source.slice(source.indexOf('async function status() {'), source.indexOf('\nasync function openExisting()'))

function fixture(command, snapshot) {
  const calls = []
  const context = {
    process: { platform: 'darwin', argv: ['node', 'cli', command], env: {} },
    root: '/portable', baseStateRoot: '/portable',
    parseCli: () => ({ command, json: true, waitForLockMs: 0 }),
    environmentStateRoot: () => '/portable', layoutForRoot: () => ({ root: '/portable' }),
    activeOptions: null, startupProgressJson: false, layout: null,
    status: async () => { calls.push('read-status'); return snapshot },
    checkUpdate: async () => { calls.push('check-update'); return snapshot },
    listUpdates: async () => { calls.push('list-updates'); return snapshot },
    deferUpdate: async () => { calls.push('defer-update'); return snapshot },
    ignoreUpdate: async () => { calls.push('ignore-update'); return snapshot },
    print: (result, json) => { calls.push({ result, json }) },
    acquireLaunchLock: async () => { calls.push('lock'); throw new Error('Another portable launcher is already starting or stopping DSH.') },
    ensurePortableDirectories: async () => { throw new Error('Status must not create or mutate directories') },
  }
  return { run: vm.runInNewContext(`(${main})`, context), calls }
}

for (const status of ['stopped', 'starting', 'running']) {
  test(`status returns the ${status} snapshot while a launcher holds the mutation lock`, async () => {
    const snapshot = { status, environment: 'default' }
    const probe = fixture('status', snapshot)
    await probe.run()
    assert.deepEqual(probe.calls, ['read-status', { result: snapshot, json: true }])
  })
}

test('status liveness leaves a one-time workspace token for the WebView', async () => {
  let tokenRequests = 0
  let bareRequests = 0
  const server = http.createServer((request, response) => {
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
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const port = server.address().port
    const workspaceUrl = `http://127.0.0.1:${port}/?token=portable`
    const status = vm.runInNewContext(`(${statusBody})`, {
      layout: { environmentId: 'default', root: '/portable' },
      readProcessState: () => ({ pid: 123, port, url: workspaceUrl }),
      ownedState: () => true,
      httpReady: workspaceDocumentReady,
    })
    const result = await status()
    assert.equal(result.status, 'running')
    assert.equal(result.url, workspaceUrl)
    assert.equal(tokenRequests, 0)
    assert.equal(bareRequests, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('start still requires the exclusive launch lock', async () => {
  const probe = fixture('start', { status: 'stopped' })
  await assert.rejects(probe.run(), /Another portable launcher/)
  assert.deepEqual(probe.calls, ['lock'])
})

for (const command of ['check-update', 'list-updates', 'defer-update', 'ignore-update']) {
  test(`${command} does not acquire the start/stop mutation lock`, async () => {
    const snapshot = { status: 'available' }
    const probe = fixture(command, snapshot)
    await probe.run()
    assert.deepEqual(probe.calls, [command, { result: snapshot, json: true }])
  })
}
