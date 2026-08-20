import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createFileExtensionState,
  createExtensionMarket,
  loadBundledCatalog,
  registerExtensionRoutes,
} from '../desktop-bridge/lib/extensions.js'
import {
  finishExtensionOperation,
  preparePendingExtensionOperation,
  processPendingExtensionOperation,
  rollbackExtensionOperationAfterBootFailure,
} from '../launcher/extension-operations.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

const currentComponents = {
  portableVersion: '0.3.0-rc.2',
  dshVersion: '0.1.0-rc.8',
  dshCommit: '141eb6fef83422698aef7a981029e843e8161534',
}

test('bundled catalog is small, immutable, and explicit about experimental capabilities', async () => {
  const catalog = await loadBundledCatalog()
  assert.equal(catalog.schemaVersion, 1)
  assert.match(catalog.revision, /^\d{4}-\d{2}-\d{2}\.[1-9]\d*$/)
  assert.ok(catalog.items.length >= 1 && catalog.items.length <= 5)
  assert.equal(new Set(catalog.items.map(item => item.id)).size, catalog.items.length)
  for (const item of catalog.items) {
    assert.match(item.packageName, /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/)
    assert.match(item.version, /^\d+\.\d+\.\d+$/)
    assert.match(item.artifact.url, /^https:\/\/github\.com\//)
    assert.match(item.artifact.sha256, /^[a-f0-9]{64}$/)
    assert.ok(['reviewed', 'experimental'].includes(item.channel))
    assert.ok(item.permissions.zh.length > 0)
    assert.ok(item.permissions.en.length > 0)
    assert.equal(item.compatibility.portable, '0.3.0-rc.2')
    assert.equal(item.compatibility.dsh, '0.1.0-rc.8')
    assert.equal(item.compatibility.dshCommit, currentComponents.dshCommit)
  }
  const deletion = catalog.items.find(item => item.id === 'session-delete')
  assert.equal(deletion?.channel, 'experimental')
  assert.equal(deletion?.defaultInstalled, false)
  assert.match([...(deletion?.permissions.zh ?? []), ...(deletion?.permissions.en ?? [])].join(' '), /permanent|永久/i)
})

test('preview and confirm never accept package facts from the client', async () => {
  const writes = []
  let now = Date.parse('2026-08-20T01:00:00Z')
  const market = createExtensionMarket({
    catalog: await loadBundledCatalog(),
    components: currentComponents,
    readState: async () => ({ pending: null, receipts: [] }),
    writePending: async value => { writes.push(value) },
    now: () => now,
    token: () => 'preview-token-0000000000000001',
  })

  const preview = await market.preview({ id: 'session-delete', action: 'install' })
  assert.equal(preview.packageName, 'dsh-session-delete')
  assert.equal(preview.version, '0.1.5')
  assert.equal(preview.requiresRestart, true)
  assert.match(preview.expiresAt, /^2026-08-20T/)

  await assert.rejects(
    () => market.confirm({ previewToken: preview.previewToken, artifactUrl: 'https://evil.invalid/plugin.tgz' }),
    /invalid request/i,
  )
  await assert.rejects(() => market.confirm({ previewToken: preview.previewToken, experimentalAcknowledged: false }), /experimental|acknowledge/i)
  const acceptedPreview = await market.preview({ id: 'session-delete', action: 'install' })
  const queued = await market.confirm({ previewToken: acceptedPreview.previewToken, experimentalAcknowledged: true })
  assert.equal(queued.status, 'queued')
  assert.equal(writes.length, 1)
  assert.deepEqual(Object.keys(writes[0]).sort(), [
    'action', 'attempts', 'catalogRevision', 'createdAt', 'id', 'operationId',
    'packageName', 'profile', 'schemaVersion', 'status', 'version',
  ])
  assert.equal(JSON.stringify(writes[0]).includes('github.com'), false)
  await assert.rejects(() => market.confirm({ previewToken: acceptedPreview.previewToken, experimentalAcknowledged: true }), /expired|used/i)

  now += 6 * 60 * 1000
  const expired = await market.preview({ id: 'session-delete', action: 'install' })
  now += 6 * 60 * 1000
  await assert.rejects(() => market.confirm({ previewToken: expired.previewToken, experimentalAcknowledged: true }), /expired/i)
})

test('removing an experimental extension does not require re-acknowledging install capabilities', async () => {
  const catalog = await loadBundledCatalog()
  const item = catalog.items.find(value => value.id === 'session-delete')
  const writes = []
  const market = createExtensionMarket({
    catalog,
    components: currentComponents,
    readState: async () => ({
      pending: null,
      receipts: [{ id: item.id, packageName: item.packageName, version: item.version }],
    }),
    writePending: async value => { writes.push(value) },
  })
  const preview = await market.preview({ id: item.id, action: 'remove' })
  const result = await market.confirm({ previewToken: preview.previewToken, experimentalAcknowledged: false })
  assert.equal(result.status, 'queued')
  assert.equal(writes[0].action, 'remove')
})

test('next launch verifies the artifact, preflights config, and records a portable receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-ok-'))
  const layout = layoutForRoot(root, process.platform)
  const catalog = await loadBundledCatalog()
  const entry = catalog.items.find(item => item.id === 'session-delete')
  const bytes = Buffer.from('verified extension artifact')
  const expected = createHash('sha256').update(bytes).digest('hex')
  const pending = {
    schemaVersion: 1,
    operationId: 'operation-0000000000000001',
    id: entry.id,
    action: 'install',
    packageName: entry.packageName,
    version: entry.version,
    profile: 'web',
    catalogRevision: catalog.revision,
    status: 'queued',
    attempts: 0,
    createdAt: '2026-08-20T01:00:00.000Z',
  }
  const calls = []
  const writes = []
  const result = await processPendingExtensionOperation({
    layout,
    pending,
    catalog: {
      ...catalog,
      items: catalog.items.map(item => item.id === entry.id
        ? { ...item, artifact: { ...item.artifact, bytes: bytes.length, sha256: expected } }
        : item),
    },
    components: currentComponents,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }),
    runPlugin: async argv => { calls.push(argv); return 0 },
    snapshotProfile: async () => ({ id: 'snapshot-1' }),
    restoreProfile: async () => { throw new Error('should not restore a successful operation') },
    writeResult: async value => { writes.push(value) },
  })

  assert.equal(result.status, 'awaiting_host_health')
  assert.deepEqual(calls.map(argv => argv.slice(0, 4)), [
    ['plugin', '--profile', 'web', 'add'],
    ['--profile', 'web', '--dump-config'],
  ])
  assert.match(calls[0][4], /^@deepseek-ai\/dsh-client-ui-workspace@.+\.tgz$/)
  assert.equal(calls[0][4].includes(root), true)
  assert.equal(writes.at(-1).status, 'awaiting_host_health')
  assert.equal(writes.at(-1).receipt.packageName, entry.packageName)
  assert.equal(writes.at(-1).receipt.sha256, expected)
  assert.equal(JSON.stringify(writes.at(-1)).includes(root), false)
})

test('digest or preflight failure cannot leave a changed profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-rollback-'))
  const layout = layoutForRoot(root, process.platform)
  const catalog = await loadBundledCatalog()
  const entry = catalog.items[0]
  const pending = {
    schemaVersion: 1,
    operationId: 'operation-0000000000000002',
    id: entry.id,
    action: 'install',
    packageName: entry.packageName,
    version: entry.version,
    profile: 'web',
    catalogRevision: catalog.revision,
    status: 'queued',
    attempts: 0,
    createdAt: '2026-08-20T01:00:00.000Z',
  }
  let pluginCalls = 0
  let restores = 0
  const digestFailure = await processPendingExtensionOperation({
    layout,
    pending,
    catalog: {
      ...catalog,
      items: catalog.items.map(item => item.id === entry.id
        ? { ...item, artifact: { ...item.artifact, bytes: Buffer.byteLength('wrong') } }
        : item),
    },
    components: currentComponents,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('wrong') }),
    runPlugin: async () => { pluginCalls += 1; return 0 },
    snapshotProfile: async () => ({ id: 'snapshot' }),
    restoreProfile: async () => { restores += 1 },
    writeResult: async () => {},
  })
  assert.equal(digestFailure.status, 'failed')
  assert.equal(digestFailure.code, 'digest_mismatch')
  assert.equal(pluginCalls, 0)
  assert.equal(restores, 0)

  const bytes = Buffer.from('preflight artifact')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const compatibleCatalog = {
    ...catalog,
    items: catalog.items.map(item => item.id === entry.id
      ? { ...item, artifact: { ...item.artifact, bytes: bytes.length, sha256 } }
      : item),
  }
  pluginCalls = 0
  let dumpCalls = 0
  const preflightFailure = await processPendingExtensionOperation({
    layout,
    pending,
    catalog: compatibleCatalog,
    components: currentComponents,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }),
    runPlugin: async argv => {
      pluginCalls += 1
      if (!argv.includes('--dump-config')) return 0
      dumpCalls += 1
      return dumpCalls === 1 ? 7 : 0
    },
    snapshotProfile: async () => ({ id: 'snapshot' }),
    restoreProfile: async () => { restores += 1 },
    writeResult: async () => {},
  })
  assert.equal(preflightFailure.status, 'rolled_back')
  assert.equal(preflightFailure.code, 'preflight_failed')
  assert.equal(pluginCalls, 4)
  assert.equal(restores, 1)
})

test('portable extension state follows stateRoot instead of the executable directory', async () => {
  const layout = layoutForRoot('C:\\Portable\\DSH', 'win32', 'D:\\DSH-State')
  assert.equal(layout.extensionPending, 'D:\\DSH-State\\data\\runtime\\pending-extension.json')
  assert.equal(layout.extensionResult, 'D:\\DSH-State\\data\\runtime\\extension-result.json')
  assert.equal(layout.extensionReceipts, 'D:\\DSH-State\\data\\runtime\\extension-receipts.json')
})

test('host routes are same-origin, bounded, and never execute a plugin while DSH is running', async () => {
  const handlers = new Map()
  const writes = []
  const ctx = {
    webServer: {
      port: 3080,
      register(route) {
        handlers.set(route.path, route.handler)
        return () => handlers.delete(route.path)
      },
    },
  }
  const dispose = await registerExtensionRoutes(ctx, {
    catalog: await loadBundledCatalog(),
    components: currentComponents,
    readState: async () => ({ pending: null, receipts: [], result: null }),
    writePending: async value => { writes.push(value) },
    token: () => 'route-preview-token-000000001',
    operationId: () => 'route-operation-00000000001',
    now: () => Date.parse('2026-08-20T01:00:00Z'),
  })
  assert.deepEqual([...handlers.keys()].sort(), [
    '/api/dsh-portable/extensions',
    '/api/dsh-portable/extensions/confirm',
    '/api/dsh-portable/extensions/preview',
  ])

  const request = (method, url, body, origin = 'http://127.0.0.1:3080') => ({
    method,
    url,
    headers: { host: '127.0.0.1:3080', origin, 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
  })
  const response = () => {
    const result = { statusCode: 0, headers: {}, body: '' }
    result.setHeader = (name, value) => { result.headers[name] = value }
    result.end = value => { result.body = String(value ?? '') }
    return result
  }

  const denied = response()
  await handlers.get('/api/dsh-portable/extensions/preview')(
    request('POST', '/api/dsh-portable/extensions/preview', { id: 'session-delete', action: 'install' }, 'https://evil.invalid'),
    denied,
  )
  assert.equal(denied.statusCode, 403)
  assert.equal(writes.length, 0)

  const previewResponse = response()
  await handlers.get('/api/dsh-portable/extensions/preview')(
    request('POST', '/api/dsh-portable/extensions/preview', { id: 'session-delete', action: 'install' }),
    previewResponse,
  )
  assert.equal(previewResponse.statusCode, 200)
  const preview = JSON.parse(previewResponse.body)
  assert.equal(preview.packageName, 'dsh-session-delete')

  const confirmResponse = response()
  await handlers.get('/api/dsh-portable/extensions/confirm')(
    request('POST', '/api/dsh-portable/extensions/confirm', { previewToken: preview.previewToken, experimentalAcknowledged: true }),
    confirmResponse,
  )
  assert.equal(confirmResponse.statusCode, 200)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].status, 'queued')
  dispose()
  assert.equal(handlers.size, 0)
})

async function writeOperationFixture(layout, catalog, pending, components = currentComponents) {
  await mkdir(path.dirname(layout.extensionPending), { recursive: true })
  await mkdir(path.dirname(path.join(
    layout.appDir,
    'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'extensions', 'catalog.json',
  )), { recursive: true })
  await mkdir(path.dirname(path.join(layout.root, 'licenses', 'COMPONENTS.json')), { recursive: true })
  await writeFile(layout.extensionPending, JSON.stringify(pending), 'utf8')
  await writeFile(path.join(
    layout.appDir,
    'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'extensions', 'catalog.json',
  ), JSON.stringify(catalog), 'utf8')
  await writeFile(path.join(layout.root, 'licenses', 'COMPONENTS.json'), JSON.stringify(components), 'utf8')
}

test('an interrupted mutation blocks startup when its profile snapshot cannot be restored', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-interrupted-'))
  const layout = layoutForRoot(root, process.platform)
  const catalog = await loadBundledCatalog()
  const entry = catalog.items[0]
  const pending = {
    schemaVersion: 1,
    operationId: 'operation-interrupted-00000001',
    id: entry.id,
    action: 'install',
    packageName: entry.packageName,
    version: entry.version,
    profile: 'web',
    catalogRevision: catalog.revision,
    status: 'applying',
    attempts: 1,
    createdAt: '2026-08-20T01:00:00.000Z',
  }
  await writeOperationFixture(layout, catalog, pending)

  await assert.rejects(
    () => preparePendingExtensionOperation(layout, {
      restoreProfile: async () => { throw new Error('snapshot unreadable') },
      runPlugin: async () => 0,
    }),
    /manual recovery|required|snapshot/i,
  )
  assert.equal(JSON.parse(await readFile(layout.extensionPending, 'utf8')).status, 'applying')
  const result = JSON.parse(await readFile(layout.extensionResult, 'utf8'))
  assert.equal(result.status, 'recovery_required')
})

test('a healthy host commits the receipt and removes the pending operation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-finish-'))
  const layout = layoutForRoot(root, process.platform)
  await mkdir(path.dirname(layout.extensionPending), { recursive: true })
  await writeFile(layout.extensionPending, '{}', 'utf8')
  const transaction = {
    schemaVersion: 1,
    operationId: 'operation-finish-000000000001',
    id: 'session-delete',
    action: 'install',
    packageName: 'dsh-session-delete',
    version: '0.1.5',
    status: 'awaiting_host_health',
    code: 'applied_pending_health',
    attempts: 1,
    updatedAt: '2026-08-20T01:00:00.000Z',
    receipt: { id: 'session-delete', packageName: 'dsh-session-delete', version: '0.1.5', sha256: 'a'.repeat(64) },
  }
  const result = await finishExtensionOperation(layout, transaction)
  assert.equal(result.status, 'applied')
  assert.equal(JSON.parse(await readFile(layout.extensionReceipts, 'utf8'))[0].id, 'session-delete')
  await assert.rejects(() => readFile(layout.extensionPending), /ENOENT/)
})

test('a rollback failure after mutation preserves recovery authority and blocks startup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-rollback-authority-'))
  const layout = layoutForRoot(root, process.platform)
  const bundled = await loadBundledCatalog()
  const original = bundled.items[0]
  const bytes = Buffer.from('rollback-authority-fixture')
  const entry = { ...original, artifact: { ...original.artifact, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }
  const catalog = { ...bundled, items: [entry] }
  const pending = {
    schemaVersion: 1,
    operationId: 'operation-rollback-authority-001',
    id: entry.id,
    action: 'install',
    packageName: entry.packageName,
    version: entry.version,
    profile: 'web',
    catalogRevision: catalog.revision,
    status: 'queued',
    attempts: 0,
    createdAt: '2026-08-20T01:00:00.000Z',
  }
  await writeOperationFixture(layout, catalog, pending)

  await assert.rejects(() => preparePendingExtensionOperation(layout, {
    fetch: async () => ({ ok: true, headers: new Headers({ 'content-length': String(bytes.length) }), arrayBuffer: async () => bytes }),
    snapshotProfile: async () => ({ backupRoot: 'kept-recovery', profileRoot: 'profile', present: [] }),
    runPlugin: async argv => argv.includes('add') ? 9 : 0,
    restoreProfile: async () => { throw new Error('restore failed') },
  }), /recovery|required/i)
  assert.equal(JSON.parse(await readFile(layout.extensionPending, 'utf8')).status, 'applying')
  assert.equal(JSON.parse(await readFile(layout.extensionResult, 'utf8')).status, 'recovery_required')
})

test('host-health rollback keeps its snapshot when profile relinking fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-health-rollback-'))
  const layout = layoutForRoot(root, process.platform)
  await mkdir(path.dirname(layout.extensionPending), { recursive: true })
  await writeFile(layout.extensionPending, JSON.stringify({ status: 'applying' }), 'utf8')
  const backupRoot = path.join(layout.extensionRecovery, 'health-operation')
  await mkdir(backupRoot, { recursive: true })
  const transaction = {
    operationId: 'health-operation', id: 'portable-smoke', action: 'install', packageName: 'portable-smoke',
    version: '1.0.0', attempts: 1, status: 'awaiting_host_health', snapshot: { backupRoot, profileRoot: 'profile', present: [] },
  }
  await assert.rejects(() => rollbackExtensionOperationAfterBootFailure(layout, transaction, {
    restoreProfile: async () => {},
    runPlugin: async () => 8,
  }), /recovery|required|relink/i)
  assert.equal(JSON.parse(await readFile(layout.extensionResult, 'utf8')).status, 'recovery_required')
  assert.equal((await readFile(layout.extensionPending, 'utf8')).length > 0, true)
})

test('host-health rollback restores the Portable receipt for a removed extension', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-remove-rollback-receipt-'))
  const layout = layoutForRoot(root, process.platform)
  await mkdir(path.dirname(layout.extensionPending), { recursive: true })
  const receipt = {
    schemaVersion: 1,
    id: 'session-delete',
    packageName: 'dsh-session-delete',
    dependencyName: '@deepseek-ai/dsh-client-ui-workspace',
    version: '0.1.4',
    sha256: 'c'.repeat(64),
  }
  const transaction = {
    operationId: 'remove-rollback-receipt-00001', id: receipt.id, action: 'remove',
    packageName: receipt.packageName, version: '0.1.5', attempts: 1,
    status: 'awaiting_host_health', receipt,
    snapshot: { backupRoot: path.join(layout.extensionRecovery, 'remove-rollback-receipt-00001'), profileRoot: 'profile', present: [] },
  }
  await writeFile(layout.extensionPending, JSON.stringify({ status: 'applying' }), 'utf8')
  await writeFile(layout.extensionReceipts, '[]', 'utf8')

  await rollbackExtensionOperationAfterBootFailure(layout, transaction, {
    restoreProfile: async () => {},
    runPlugin: async () => 0,
  })

  assert.deepEqual(JSON.parse(await readFile(layout.extensionReceipts, 'utf8')), [receipt])
})

test('an interrupted host-health rollback resumes rollback instead of committing the reverted extension', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-resume-health-rollback-'))
  const layout = layoutForRoot(root, process.platform)
  const catalog = await loadBundledCatalog()
  const entry = catalog.items.find(item => item.id === 'session-delete')
  const operationId = 'resume-health-rollback-000001'
  const receipt = {
    schemaVersion: 1, id: entry.id, packageName: entry.packageName,
    dependencyName: entry.installAs, version: entry.version, sha256: 'd'.repeat(64),
  }
  const pending = {
    schemaVersion: 1, operationId, id: entry.id, action: 'remove', packageName: entry.packageName,
    version: entry.version, profile: 'web', catalogRevision: catalog.revision,
    status: 'applying', attempts: 1, createdAt: '2026-08-20T01:00:00.000Z',
  }
  await writeOperationFixture(layout, catalog, pending)
  const backupRoot = path.join(layout.extensionRecovery, operationId)
  await mkdir(backupRoot, { recursive: true })
  await writeFile(path.join(backupRoot, 'snapshot.json'), JSON.stringify({ schemaVersion: 1, present: [] }), 'utf8')
  await writeFile(layout.extensionReceipts, '[]', 'utf8')
  await writeFile(layout.extensionResult, JSON.stringify({
    ...pending, status: 'rolling_back', code: 'host_health_failed', receipt,
    updatedAt: '2026-08-20T01:01:00.000Z',
  }), 'utf8')

  let restores = 0
  const transaction = await preparePendingExtensionOperation(layout, {
    restoreProfile: async () => { restores += 1 },
    runPlugin: async () => 0,
  })
  assert.equal(transaction, null)
  assert.equal(restores, 1)
  assert.deepEqual(JSON.parse(await readFile(layout.extensionReceipts, 'utf8')), [receipt])
  assert.equal(JSON.parse(await readFile(layout.extensionResult, 'utf8')).status, 'rolled_back_after_boot_failure')
  await assert.rejects(() => readFile(layout.extensionPending), /ENOENT/)
})

test('an extension artifact download has a bounded total timeout before profile mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-download-timeout-'))
  const layout = layoutForRoot(root, process.platform)
  const catalog = await loadBundledCatalog()
  const entry = catalog.items[0]
  const pending = {
    schemaVersion: 1, operationId: 'download-timeout-000000000001', id: entry.id,
    action: 'install', packageName: entry.packageName, version: entry.version,
    profile: 'web', catalogRevision: catalog.revision, status: 'queued', attempts: 0,
    createdAt: '2026-08-20T01:00:00.000Z',
  }
  const started = Date.now()
  const result = await Promise.race([
    processPendingExtensionOperation({
      layout, pending, catalog, components: currentComponents, downloadTimeoutMs: 20,
      fetch: async () => new Promise(() => {}),
      writeResult: async () => {},
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('download was not bounded')), 250)),
  ])
  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'download_timeout')
  assert.ok(Date.now() - started < 250)
})

test('the bundled plugin command has a finite execution timeout and terminates its owned process tree', async () => {
  const source = await readFile(path.join(process.cwd(), 'launcher', 'extension-operations.mjs'), 'utf8')
  assert.match(source, /EXTENSION_PLUGIN_TIMEOUT_MS\s*=\s*\d+/)
  assert.match(source, /spawn\(layout\.nodeExe[\s\S]+setTimeout\([\s\S]+terminatePluginTree\(child\)/)
  assert.match(source, /taskkill\.exe[\s\S]+\/T[\s\S]+\/F/)
  assert.match(source, /process\.kill\(-child\.pid,\s*'SIGKILL'\)/)
  assert.doesNotMatch(source, /spawnSync\(layout\.nodeExe/)
})

test('concurrent confirmations cannot overwrite an already queued extension', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-confirm-race-'))
  const environment = { DSH_HOME: path.join(root, 'data', 'dsh-home') }
  const fileState = createFileExtensionState(environment)
  const market = createExtensionMarket({
    catalog: await loadBundledCatalog(),
    components: currentComponents,
    readState: fileState.readState,
    writePending: fileState.writePending,
  })
  const first = await market.preview({ id: 'session-delete', action: 'install' })
  const second = await market.preview({ id: 'session-delete', action: 'install' })
  const results = await Promise.allSettled([
    market.confirm({ previewToken: first.previewToken, experimentalAcknowledged: true }),
    market.confirm({ previewToken: second.previewToken, experimentalAcknowledged: true }),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
})

test('a torn pending file is quarantined before a new confirmation is queued', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-torn-confirm-'))
  const environment = { DSH_HOME: path.join(root, 'data', 'dsh-home') }
  const fileState = createFileExtensionState(environment)
  const pendingPath = path.join(root, 'data', 'runtime', 'pending-extension.json')
  await mkdir(path.dirname(pendingPath), { recursive: true })
  await writeFile(pendingPath, '{"schemaVersion":', 'utf8')

  const market = createExtensionMarket({
    catalog: await loadBundledCatalog(),
    components: currentComponents,
    readState: fileState.readState,
    writePending: fileState.writePending,
  })
  const preview = await market.preview({ id: 'session-delete', action: 'install' })
  const result = await market.confirm({ previewToken: preview.previewToken, experimentalAcknowledged: true })
  assert.equal(result.status, 'queued')
  assert.equal(JSON.parse(await readFile(pendingPath, 'utf8')).id, 'session-delete')
})

test('a stale confirmation lock is recoverable without filesystem hard links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-stale-confirm-lock-'))
  const environment = { DSH_HOME: path.join(root, 'data', 'dsh-home') }
  const fileState = createFileExtensionState(environment)
  const pendingPath = path.join(root, 'data', 'runtime', 'pending-extension.json')
  const lockPath = `${pendingPath}.lock`
  await mkdir(path.dirname(lockPath), { recursive: true })
  await writeFile(lockPath, '{"token":', 'utf8')
  await utimes(lockPath, new Date(0), new Date(0))

  const market = createExtensionMarket({
    catalog: await loadBundledCatalog(),
    components: currentComponents,
    readState: fileState.readState,
    writePending: fileState.writePending,
  })
  const preview = await market.preview({ id: 'session-delete', action: 'install' })
  const result = await market.confirm({ previewToken: preview.previewToken, experimentalAcknowledged: true })
  assert.equal(result.status, 'queued')
  assert.equal(JSON.parse(await readFile(pendingPath, 'utf8')).id, 'session-delete')

  const source = await readFile(path.join(process.cwd(), 'desktop-bridge', 'lib', 'extensions.js'), 'utf8')
  assert.doesNotMatch(source, /\blink\(/)
})

test('pending confirmation does not require hard links on portable filesystems', async () => {
  const source = await readFile(path.join(process.cwd(), 'desktop-bridge', 'lib', 'extensions.js'), 'utf8')
  assert.doesNotMatch(source, /\blink\s*\(/)
})

test('pending confirmation fails closed for a live writer and recovers a dead writer lock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-pending-lock-'))
  const environment = { DSH_HOME: path.join(root, 'data', 'dsh-home') }
  const fileState = createFileExtensionState(environment)
  const pendingPath = path.join(root, 'data', 'runtime', 'pending-extension.json')
  const lockPath = `${pendingPath}.lock`
  await mkdir(path.dirname(pendingPath), { recursive: true })
  const catalog = await loadBundledCatalog()
  const item = catalog.items.find(value => value.id === 'session-delete')
  const createMarket = () => createExtensionMarket({
    catalog, components: currentComponents, readState: fileState.readState, writePending: fileState.writePending,
  })

  await writeFile(lockPath, JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: '1970-01-01T00:00:00.000Z' }), 'utf8')
  const live = createMarket()
  const livePreview = await live.preview({ id: item.id, action: 'install' })
  await assert.rejects(
    () => live.confirm({ previewToken: livePreview.previewToken, experimentalAcknowledged: true }),
    /another extension operation/i,
  )

  await writeFile(lockPath, JSON.stringify({ schemaVersion: 1, pid: 999999999 }), 'utf8')
  const stale = createMarket()
  const stalePreview = await stale.preview({ id: item.id, action: 'install' })
  await stale.confirm({ previewToken: stalePreview.previewToken, experimentalAcknowledged: true })
  assert.equal(JSON.parse(await readFile(pendingPath, 'utf8')).id, item.id)
})

test('an applied removal left with pending state is finalized instead of rolled back', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-remove-commit-'))
  const layout = layoutForRoot(root, process.platform)
  const catalog = await loadBundledCatalog()
  const entry = catalog.items.find(item => item.id === 'session-delete')
  const operationId = 'operation-remove-commit-000001'
  const pending = {
    schemaVersion: 1, operationId, id: entry.id, action: 'remove', packageName: entry.packageName,
    version: entry.version, profile: 'web', catalogRevision: catalog.revision,
    status: 'applying', attempts: 1, createdAt: '2026-08-20T01:00:00.000Z',
  }
  await writeOperationFixture(layout, catalog, pending)
  await mkdir(path.join(layout.extensionRecovery, operationId), { recursive: true })
  await writeFile(path.join(layout.extensionRecovery, operationId, 'snapshot.json'), JSON.stringify({ schemaVersion: 1, present: [] }), 'utf8')
  await writeFile(layout.extensionResult, JSON.stringify({
    ...pending, status: 'applied', code: 'removed', updatedAt: '2026-08-20T01:01:00.000Z',
  }), 'utf8')
  await writeFile(layout.extensionReceipts, '[]', 'utf8')

  let restores = 0
  const transaction = await preparePendingExtensionOperation(layout, {
    restoreProfile: async () => { restores += 1 },
    runPlugin: async () => 0,
  })
  assert.equal(transaction, null)
  assert.equal(restores, 0)
  await assert.rejects(() => readFile(layout.extensionPending), /ENOENT/)
})

test('an owned but unready DSH process is never followed by extension mutation', async () => {
  const source = await readFile(path.join(process.cwd(), 'launcher', 'portable-cli.mjs'), 'utf8')
  assert.match(source, /if \(ownedState\(prior\)\) \{[\s\S]*await waitForHost\(prior, 15000\)[\s\S]*throw new Error\([\s\S]*\}/)
  assert.ok(source.indexOf('if (ownedState(prior))') < source.indexOf('preparePendingExtensionOperation(layout)'))
})

test('removal follows the installed receipt even after the catalog version changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-ext-old-receipt-'))
  const layout = layoutForRoot(root, process.platform)
  const catalog = await loadBundledCatalog()
  const entry = catalog.items.find(item => item.id === 'session-delete')
  const pending = {
    schemaVersion: 1, operationId: 'operation-old-receipt-0000001', id: entry.id, action: 'remove',
    packageName: entry.packageName, version: entry.version, profile: 'web', catalogRevision: catalog.revision,
    status: 'queued', attempts: 0, createdAt: '2026-08-20T01:00:00.000Z',
  }
  const calls = []
  const result = await processPendingExtensionOperation({
    layout, pending, catalog, components: currentComponents,
    receipts: [{
      id: entry.id, packageName: entry.packageName, dependencyName: entry.installAs,
      version: '0.1.4', sha256: 'b'.repeat(64),
    }],
    snapshotProfile: async () => ({ id: 'snapshot' }),
    restoreProfile: async () => {},
    runPlugin: async argv => { calls.push(argv); return 0 },
    writeResult: async () => {},
  })
  assert.equal(result.status, 'awaiting_host_health')
  assert.equal(result.receipt.dependencyName, '@deepseek-ai/dsh-client-ui-workspace')
  assert.equal(result.receipt.version, '0.1.4')
  assert.deepEqual(calls[0], ['plugin', '--profile', 'web', 'remove', '@deepseek-ai/dsh-client-ui-workspace'])
})

test('the settings tab explains terminal failures and recovery without exposing raw internal codes', async () => {
  const source = await readFile(path.join(process.cwd(), 'desktop-bridge', 'lib', 'client.js'), 'utf8')
  assert.match(source, /lastChange:/)
  assert.match(source, /recoveryRequired:/)
  assert.match(source, /changeRolledBack:/)
  assert.match(source, /resultMessage\(state\.value\.result/)
  assert.doesNotMatch(source, /React\.createElement\([^\n]+state\.value\.result\.code/)
})

test('a receipt is committed only after the Portable Extensions host route is healthy', async () => {
  const source = await readFile(path.join(process.cwd(), 'launcher', 'portable-cli.mjs'), 'utf8')
  assert.match(source, /waitForExtensionHost\(state\)/)
  assert.match(source, /extensionTransaction\s*&&\s*!await waitForExtensionHost\(state\)/)
  assert.ok(source.indexOf('waitForExtensionHost(state)') < source.indexOf('finishExtensionOperation(layout, extensionTransaction)'))
})
