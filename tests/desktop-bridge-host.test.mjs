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
    schemaVersion: 2,
    updateCheckEnabled: false,
    productUpdateCheckEnabled: false,
    engineUpdateCheckEnabled: false,
    taskNotificationsEnabled: true,
    closeBehavior: 'tray',
  })
  assert.deepEqual(getBefore.json().versions, { portable: '', engine: '' })
  assert.equal(getBefore.json().lastRepair, null)

  const update = response()
  await routes.get('/dsh-portable/settings').handler(request('POST', {
    productUpdateCheckEnabled: true,
    engineUpdateCheckEnabled: true,
  }), update)
  assert.equal(update.status, 200)
  const saved = JSON.parse(await readFile(path.join(stateRoot, 'data', 'launcher-settings.json'), 'utf8'))
  assert.equal(saved.updateCheckEnabled, true)
  assert.equal(saved.productUpdateCheckEnabled, true)
  assert.equal(saved.engineUpdateCheckEnabled, true)
  assert.equal(saved.taskNotificationsEnabled, true)
  assert.equal(saved.closeBehavior, 'tray')
})

test('Portable settings expose product and official DSH checks as separate bounded actions', async (t) => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-update-settings-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const calls = []
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, {
    root: stateRoot,
    stateRoot,
    async runCli(args) { calls.push(args); return { status: 'current', updateKind: args[2] } },
  })

  const product = response()
  await routes.get('/dsh-portable/check-update').handler(request('POST', { scope: 'product' }), product)
  assert.equal(product.status, 200)
  assert.deepEqual(product.json(), { status: 'current', updateKind: 'product' })
  assert.deepEqual(calls[0], ['check-update', '--scope', 'product', '--json', '--force'])

  const engine = response()
  await routes.get('/dsh-portable/check-update').handler(request('POST', { scope: 'engine' }), engine)
  assert.equal(engine.status, 200)
  assert.deepEqual(calls[1], ['check-update', '--scope', 'engine', '--json', '--force'])

  const invalid = response()
  await routes.get('/dsh-portable/check-update').handler(request('POST', { scope: 'all' }), invalid)
  assert.equal(invalid.status, 400)
  assert.equal(calls.length, 2)
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

test('Portable data export offers a small migration package and password-protected private package', async (t) => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-data-export-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const calls = []
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, {
    root: stateRoot,
    stateRoot,
    async runCli(args) {
      calls.push(args)
      const passwordIndex = args.indexOf('--password-file')
      if (passwordIndex >= 0) assert.equal(await readFile(args[passwordIndex + 1], 'utf8'), 'private-password')
      return { output: args[args.indexOf('--output') + 1], encrypted: passwordIndex >= 0 }
    },
  })

  const standard = response()
  await routes.get('/dsh-portable/data-export').handler(request('POST', { kind: 'standard' }), standard)
  assert.equal(standard.status, 200)
  assert.deepEqual(calls[0].slice(0, 4), ['backup-data', '--json', '--categories', 'settings,sessions,plugins,credentials'])
  assert.ok(calls[0].includes('--allow-unencrypted-credentials'))

  const privateExport = response()
  await routes.get('/dsh-portable/data-export').handler(request('POST', { kind: 'private', password: 'private-password' }), privateExport)
  assert.equal(privateExport.status, 200)
  assert.equal(calls[1][calls[1].indexOf('--categories') + 1], calls[0][calls[0].indexOf('--categories') + 1])
  const passwordFile = calls[1][calls[1].indexOf('--password-file') + 1]
  await assert.rejects(readFile(passwordFile, 'utf8'), /ENOENT/)

  const missingPassword = response()
  await routes.get('/dsh-portable/data-export').handler(request('POST', { kind: 'private', password: '' }), missingPassword)
  assert.equal(missingPassword.status, 400)
})

test('Portable preferences belong to the official General settings surface', async () => {
  const client = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /settings\.general\.item/)
  assert.doesNotMatch(client, /settings\.section/)
  assert.doesNotMatch(client, /id:\s*['"]portable['"][\s\S]+label:/)
  assert.match(client, /borderBottom:\s*['"]1px solid var\(--dsw-alias-border-l2\)['"]/);
  assert.match(client, /padding:\s*['"]16px 0['"]/);
  assert.match(client, /item:\s*\{[^}]*padding:\s*['"]12px 0['"][^}]*flexWrap:\s*['"]wrap['"]/s)
  assert.match(client, /text:\s*\{[^}]*gap:\s*4/s)
  assert.match(client, /primitives\.Menu/)
  assert.match(client, /primitives\.IconChevronDownOutline14/)
  assert.match(client, /aria-haspopup['"]?:\s*['"]menu['"]/)
  assert.doesNotMatch(client, /h\(['"]select['"]/)
  const smoke = await readFile(new URL('../scripts/smoke-windows-tray-bridge.mjs', import.meta.url), 'utf8')
  assert.match(smoke, /settingsRoundTrip/)
  assert.doesNotMatch(client, /row:\s*\{[^}]*minHeight:\s*44/s)
  assert.doesNotMatch(client, /borderRadius:\s*10|background:\s*['"]var\(--dsw-alias-bg-layer-1/)
  assert.match(client, /productUpdateCheckEnabled/)
  assert.match(client, /engineUpdateCheckEnabled/)
  assert.match(client, /DeepSeek Harness/)
  assert.match(client, /\/dsh-portable\/check-update/)
  assert.match(client, /taskNotificationsEnabled/)
  assert.match(client, /closeBehavior/)
  assert.match(client, /\/dsh-portable\/doctor/)
  assert.match(client, /\/dsh-portable\/repair/)
  assert.match(client, /\/dsh-portable\/support-report/)
  assert.match(client, /\/dsh-portable\/data-export/)
})

test('Portable settings keep action feedback beside its source and group related controls', async () => {
  const client = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /const \[messages, setMessages\] = useState\(\{\}\)/)
  assert.match(client, /aria-live['"]?:\s*['"]polite['"]/)
  assert.match(client, /inlineStatus\(`update-\$\{scope\}`\)/)
  assert.match(client, /inlineStatus\(['"]maintenance['"]\)/)
  assert.match(client, /inlineStatus\(['"]data['"]\)/)
  assert.match(client, /sectionHeading/)
  assert.match(client, /t\(['"]desktop['"]\)/)
  assert.doesNotMatch(client, /message\s*&&\s*h\(['"]div['"],\s*\{\s*style:\s*styles\.status/)
})
