import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { mountPortableRoutes } from '../desktop-bridge/lib/index.js'

function request(method, body = null) {
  const source = body === null ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield* source },
  }
}

function response() {
  return {
    status: 0,
    headers: {},
    chunks: [],
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(value = '') { this.chunks.push(String(value)) },
    json() { return JSON.parse(this.chunks.join('')) },
  }
}

test('Portable settings routes default to privacy-safe updates and preserve unrelated settings', async (t) => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-settings-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const routes = new Map()
  const dispose = mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }, {
    root: stateRoot,
    stateRoot,
    runCli: () => ({ status: 'ok' }),
  })
  t.after(dispose)

  const getBefore = response()
  await routes.get('/dsh-portable/settings').handler(request('GET'), getBefore)
  assert.equal(getBefore.status, 200)
  assert.deepEqual(getBefore.json().settings, {
    schemaVersion: 1,
    updateCheckEnabled: false,
    taskNotificationsEnabled: true,
    closeBehavior: 'tray',
  })
  assert.equal(getBefore.json().lastRepair, null)

  const update = response()
  await routes.get('/dsh-portable/settings').handler(request('POST', { updateCheckEnabled: true }), update)
  assert.equal(update.status, 200)
  const saved = JSON.parse(await readFile(path.join(stateRoot, 'data', 'launcher-settings.json'), 'utf8'))
  assert.equal(saved.updateCheckEnabled, true)
  assert.equal(saved.taskNotificationsEnabled, true)
  assert.equal(saved.closeBehavior, 'tray')
})

test('Portable maintenance routes are same-origin, bounded, and delegate only official CLI commands', async (t) => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-maintenance-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const calls = []
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, {
    root: stateRoot,
    stateRoot,
    runCli(args) { calls.push(args); return args[0] === 'doctor' ? { ok: true, checks: [] } : { output: 'support.json', bytes: 100 } },
  })

  const doctor = response()
  await routes.get('/dsh-portable/doctor').handler(request('POST'), doctor)
  assert.equal(doctor.status, 200)
  assert.deepEqual(calls[0], ['doctor', '--json'])

  const repair = response()
  await routes.get('/dsh-portable/repair').handler(request('POST'), repair)
  assert.equal(repair.status, 202)
  assert.equal(repair.json().scheduled, true)

  const report = response()
  await routes.get('/dsh-portable/support-report').handler(request('POST'), report)
  assert.equal(report.status, 200)
  assert.equal(calls.at(-1)[0], 'support-report')

  const untrusted = response()
  const bad = request('POST')
  bad.headers.origin = 'https://example.com'
  await routes.get('/dsh-portable/doctor').handler(bad, untrusted)
  assert.equal(untrusted.status, 403)
})

test('Portable preferences belong to the official General settings surface', async () => {
  const client = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /settings\.general\.item/)
  assert.doesNotMatch(client, /settings\.section/)
  assert.doesNotMatch(client, /id:\s*['"]portable['"][\s\S]+label:/)
  assert.match(client, /borderBottom:\s*['"]1px solid var\(--dsw-alias-border-l2\)['"]/);
  assert.match(client, /padding:\s*['"]16px 0['"]/);
  assert.match(client, /item:\s*\{[^}]*padding:\s*['"]16px 0['"]/s)
  assert.match(client, /text:\s*\{[^}]*gap:\s*4/s)
  assert.doesNotMatch(client, /row:\s*\{[^}]*minHeight:\s*44/s)
  assert.doesNotMatch(client, /borderRadius:\s*10|background:\s*['"]var\(--dsw-alias-bg-layer-1/)
  assert.match(client, /updateCheckEnabled/)
  assert.match(client, /taskNotificationsEnabled/)
  assert.match(client, /closeBehavior/)
  assert.match(client, /\/dsh-portable\/doctor/)
  assert.match(client, /\/dsh-portable\/repair/)
  assert.match(client, /\/dsh-portable\/support-report/)
})
