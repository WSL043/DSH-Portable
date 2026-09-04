import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    notificationAvailability: async () => ({ status: 'disabled-system' }),
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
    updateChannel: 'stable',
    taskNotificationsEnabled: true,
    closeBehavior: 'tray',
  })
  assert.deepEqual(getBefore.json().versions, { portable: '', engine: '' })
  assert.deepEqual(getBefore.json().notificationAvailability, { status: 'disabled-system' })
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
  assert.equal(saved.updateChannel, 'stable')
  assert.equal(saved.taskNotificationsEnabled, true)
  assert.equal(saved.closeBehavior, 'tray')
})

test('Portable update channel is explicit, persistent, and defaults to the installed product channel', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-channel-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'licenses-placeholder'), '')
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, { root, stateRoot: root })

  const initial = response()
  await routes.get('/dsh-portable/settings').handler(request('GET'), initial)
  assert.equal(initial.json().settings.updateChannel, 'stable')

  const changed = response()
  await routes.get('/dsh-portable/settings').handler(request('POST', { updateChannel: 'candidate' }), changed)
  assert.equal(changed.status, 200)
  assert.equal(changed.json().settings.updateChannel, 'candidate')
  assert.equal(JSON.parse(await readFile(path.join(root, 'data', 'launcher-settings.json'), 'utf8')).updateChannel, 'candidate')

  const ignored = response()
  await routes.get('/dsh-portable/settings').handler(request('POST', { updateChannel: 'nightly' }), ignored)
  assert.equal(ignored.json().settings.updateChannel, 'candidate')
})

test('shared product preferences do not diverge across isolated environments', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-shared-settings-'))
  const environmentRoot = path.join(root, 'environments', 'research')
  t.after(() => rm(root, { recursive: true, force: true }))
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, {
    root, stateRoot: environmentRoot, baseStateRoot: root, environmentId: 'research',
  })
  const changed = response()
  await routes.get('/dsh-portable/settings').handler(request('POST', { updateChannel: 'candidate' }), changed)
  assert.equal(JSON.parse(await readFile(path.join(root, 'data', 'launcher-settings.json'), 'utf8')).updateChannel, 'candidate')
  await assert.rejects(readFile(path.join(environmentRoot, 'data', 'launcher-settings.json'), 'utf8'), /ENOENT/)
})

test('Portable environments are explicit, isolated, and created without changing the current environment', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-environments-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, {
    root,
    stateRoot: root,
    baseStateRoot: root,
    environmentId: 'default',
  })

  const before = response()
  await routes.get('/dsh-portable/environments').handler(request('GET'), before)
  assert.deepEqual(before.json(), { current: 'default', items: [{ id: 'default', name: '' }] })

  const created = response()
  await routes.get('/dsh-portable/environments').handler(request('POST', { name: '研究任务' }), created)
  assert.equal(created.status, 201)
  assert.equal(created.json().created.name, '研究任务')
  assert.match(created.json().created.id, /^env-[a-f0-9]{10}$/)
  assert.equal(created.json().current, 'default')
  const target = path.join(root, 'environments', created.json().created.id)
  await access(path.join(target, 'data'))
  await access(path.join(target, 'workspace'))

  const duplicate = response()
  await routes.get('/dsh-portable/environments').handler(request('POST', { name: '研究任务' }), duplicate)
  assert.equal(duplicate.status, 400)
})

test('environment controls require an explicitly capable desktop host', async () => {
  const source = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /openEnvironment: false/)
  assert.match(source, /webView2HostCapabilities[\s\S]+openEnvironment: true/)
  assert.match(source, /environmentsSupported && h\('section'/)
  assert.match(source, /dsh-portable\/open-environment/)
  assert.match(source, /pendingEnvironmentRequests/)
  assert.match(source, /dsh-portable\/open-environment-result/)
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
  assert.deepEqual(calls[0], ['check-update', '--scope', 'product', '--json', '--force', '--wait-for-lock-ms', '10000'])

  const engine = response()
  await routes.get('/dsh-portable/check-update').handler(request('POST', { scope: 'engine' }), engine)
  assert.equal(engine.status, 200)
  assert.deepEqual(calls[1], ['check-update', '--scope', 'engine', '--json', '--force', '--wait-for-lock-ms', '10000'])

  const background = response()
  await routes.get('/dsh-portable/check-update').handler(request('POST', { scope: 'engine', background: true }), background)
  assert.equal(background.status, 200)
  assert.deepEqual(calls[2], ['check-update', '--scope', 'engine', '--json', '--wait-for-lock-ms', '10000'])

  const versions = response()
  await routes.get('/dsh-portable/engine-versions').handler(request('GET'), versions)
  assert.equal(versions.status, 200)
  assert.deepEqual(calls[3], ['list-updates', '--scope', 'engine', '--json', '--wait-for-lock-ms', '10000'])

  const invalid = response()
  await routes.get('/dsh-portable/check-update').handler(request('POST', { scope: 'all' }), invalid)
  assert.equal(invalid.status, 400)
  assert.equal(calls.length, 4)
})

test('Portable settings expose recovery and only select versions returned by the verified catalog', async (t) => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-update-recovery-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  await mkdir(path.join(stateRoot, 'data', 'runtime'), { recursive: true })
  await writeFile(path.join(stateRoot, 'data', 'runtime', 'last-update-result.json'), JSON.stringify({
    schemaVersion: 1,
    status: 'rolled-back',
    restoredVersion: '0.5.2',
    targetVersion: '0.6.0-beta.1',
    recordedAt: '2026-08-28T00:00:00.0000000Z',
  }))
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, { root: stateRoot, stateRoot })
  const settings = response()
  await routes.get('/dsh-portable/settings').handler(request('GET'), settings)
  assert.equal(settings.status, 200)
  assert.deepEqual(settings.json().lastUpdate, {
    schemaVersion: 1,
    status: 'rolled-back',
    restoredVersion: '0.5.2',
    targetVersion: '0.6.0-beta.1',
    recordedAt: '2026-08-28T00:00:00.0000000Z',
  })

  const client = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /新版本无法正常启动时，会自动恢复更新前的程序/)
  assert.match(client, /上次更新未通过启动验证，已自动恢复/)
  assert.match(client, /\/dsh-portable\/engine-versions/)
  assert.match(client, /engineVersionManifestUrls/)
})

test('data import review exposes the real package contents before restart', async () => {
  const source = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /dataImportFiles:/)
  assert.match(source, /styles\.importFileList/)
  assert.match(source, /importInfo\.files\.map/)
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

  const reportOutput = path.join(stateRoot, 'chosen-support.json')
  const report = response()
  await routes.get('/dsh-portable/support-report').handler(request('POST', { output: reportOutput }), report)
  assert.equal(report.status, 200)
  assert.deepEqual(calls.at(-1), ['support-report', '--json', '--output', reportOutput])

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
  const chosenStandard = path.join(stateRoot, 'chosen', 'migration.dshdata')
  await routes.get('/dsh-portable/data-export').handler(request('POST', { kind: 'standard', output: chosenStandard }), standard)
  assert.equal(standard.status, 200)
  assert.deepEqual(calls[0].slice(0, 4), ['backup-data', '--json', '--categories', 'settings,sessions,plugins,credentials'])
  assert.ok(calls[0].includes('--allow-unencrypted-credentials'))
  assert.equal(calls[0][calls[0].indexOf('--output') + 1], chosenStandard)

  const privateExport = response()
  const chosenPrivate = path.join(stateRoot, 'chosen', 'private.dshdata')
  await routes.get('/dsh-portable/data-export').handler(request('POST', { kind: 'private', password: 'private-password', output: chosenPrivate }), privateExport)
  assert.equal(privateExport.status, 200)
  assert.equal(calls[1][calls[1].indexOf('--categories') + 1], calls[0][calls[0].indexOf('--categories') + 1])
  assert.equal(calls[1][calls[1].indexOf('--output') + 1], chosenPrivate)
  const passwordFile = calls[1][calls[1].indexOf('--password-file') + 1]
  await assert.rejects(readFile(passwordFile, 'utf8'), /ENOENT/)

  const missingPassword = response()
  await routes.get('/dsh-portable/data-export').handler(request('POST', { kind: 'private', password: '' }), missingPassword)
  assert.equal(missingPassword.status, 400)

  const relativeOutput = response()
  await routes.get('/dsh-portable/data-export').handler(request('POST', { kind: 'standard', output: 'relative.dshdata' }), relativeOutput)
  assert.equal(relativeOutput.status, 400)
})

test('Portable data import inspects plain and encrypted packages without retaining a password', async (t) => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-data-import-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const plain = path.join(stateRoot, 'plain.dshdata')
  const encrypted = path.join(stateRoot, 'private.dshdata')
  await writeFile(plain, Buffer.from('DSHDAT1Ufixture'))
  await writeFile(encrypted, Buffer.from('DSHDAT1Efixture'))
  const calls = []
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, {
    root: stateRoot,
    stateRoot,
    async runCli(args) {
      calls.push(args)
      const passwordIndex = args.indexOf('--password-file')
      if (passwordIndex >= 0) assert.equal(await readFile(args[passwordIndex + 1], 'utf8'), 'private-password')
      return { categories: ['settings', 'sessions', 'plugins', 'credentials'], files: ['data/dsh-home/settings.yaml'] }
    },
  })

  const plainResponse = response()
  await routes.get('/dsh-portable/data-inspect').handler(request('POST', { input: plain }), plainResponse)
  assert.equal(plainResponse.status, 200)
  assert.equal(plainResponse.json().encrypted, false)
  assert.deepEqual(calls[0], ['inspect-data', '--input', plain, '--json'])

  const lockedResponse = response()
  await routes.get('/dsh-portable/data-inspect').handler(request('POST', { input: encrypted }), lockedResponse)
  assert.equal(lockedResponse.status, 401)
  assert.equal(lockedResponse.json().requiresPassword, true)
  assert.equal(calls.length, 1)

  const privateResponse = response()
  await routes.get('/dsh-portable/data-inspect').handler(request('POST', { input: encrypted, password: 'private-password' }), privateResponse)
  assert.equal(privateResponse.status, 200)
  assert.equal(privateResponse.json().encrypted, true)
  const passwordFile = calls[1][calls[1].indexOf('--password-file') + 1]
  await assert.rejects(readFile(passwordFile, 'utf8'), /ENOENT/)
})

test('Portable preferences belong to the official General settings surface', async () => {
  const client = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /settings\.general\.item/)
  assert.doesNotMatch(client, /settings\.section/)
  const settingsRegistration = client.slice(client.indexOf("name: 'settings.general.item'"), client.indexOf('}, SettingsSection)'))
  assert.doesNotMatch(settingsRegistration, /label:/)
  assert.match(client, /borderBottom:\s*['"]1px solid var\(--dsw-alias-border-l2\)['"]/);
  assert.match(client, /padding:\s*['"]20px 0 8px['"]/);
  assert.match(client, /section:\s*\{[^}]*gap:\s*0[^}]*marginTop:\s*18/s)
  assert.match(client, /item:\s*\{[^}]*padding:\s*['"]14px 0['"][^}]*borderBottom:\s*['"]1px solid var\(--dsw-alias-border-l2\)['"][^}]*flexWrap:\s*['"]wrap['"]/s)
  assert.match(client, /text:\s*\{[^}]*gap:\s*4/s)
  assert.match(client, /primitives\.Menu/)
  assert.match(client, /primitives\.Modal/)
  assert.match(client, /dataPasswordConfirm/)
  assert.match(client, /dsh-portable\/pick-data-export/)
  assert.match(client, /dsh-portable\/pick-data-import/)
  assert.match(client, /\/dsh-portable\/data-inspect/)
  assert.match(client, /dataImportRestart/)
  assert.doesNotMatch(client, /const privateDisclosure/)
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
  assert.match(client, /channel-unpublished/)
  assert.match(client, /engine-follows-product/)
  assert.match(client, /预览版内核随 DSH-Portable 更新/)
  assert.match(client, /此预览版尚未发布更新通道/)
  assert.match(client, /taskNotificationsEnabled/)
  assert.match(client, /closeBehavior/)
  assert.match(client, /\/dsh-portable\/doctor/)
  assert.match(client, /\/dsh-portable\/repair/)
  assert.match(client, /\/dsh-portable\/support-report/)
  assert.match(client, /\/dsh-portable\/data-export/)
  assert.match(client, /modalInput:\s*\{[^}]*width:\s*['"]100%['"][^}]*boxSizing:\s*['"]border-box['"]/s)
  assert.match(client, /style:\s*styles\.modalInput/)
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
  assert.doesNotMatch(client, /dataPassword[^\n]+h\(['"]input['"]/)
  assert.match(client, /setDataDialog\(['"]private['"]\)/)
  assert.match(client, /scrollIntoView/)
})

test('Portable settings expose the owned workspace path to the official client bridge', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-workspace-route-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const routes = new Map()
  mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, { root, stateRoot: root })
  const reply = response()
  await routes.get('/dsh-portable/settings').handler(request('GET'), reply)
  assert.equal(reply.json().workspacePath, path.join(root, 'workspace'))
})
