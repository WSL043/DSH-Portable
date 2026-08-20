import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [rootArgument, fixtureArgument] = process.argv.slice(2)
if (!rootArgument || !fixtureArgument) {
  throw new Error('usage: node smoke-portable-extensions.mjs <finished-product-root> <independent-plugin-fixture>')
}

const root = path.resolve(rootArgument)
const fixture = path.resolve(fixtureArgument)
const platformNode = process.platform === 'win32'
  ? path.join(root, 'runtime', 'node', 'node.exe')
  : path.join(root, 'runtime', 'node', 'bin', 'node')
const launcherModule = await import(pathToFileURL(path.join(root, 'launcher', 'extension-operations.mjs')))
const coreModule = await import(pathToFileURL(path.join(root, 'launcher', 'portable-core.mjs')))
const bridgeModule = await import(pathToFileURL(path.join(
  root, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'lib', 'extensions.js',
)))
const layout = coreModule.layoutForRoot(root, process.platform)
const components = JSON.parse(await readFile(path.join(root, 'licenses', 'COMPONENTS.json'), 'utf8'))
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-extension-product-'))

function run(argv) {
  const result = spawnSync(platformNode, [path.join(root, 'launcher', 'dsh-cli.mjs'), ...argv], {
    cwd: layout.workspace,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`finished-product dsh command failed (${result.status}): ${result.stderr || result.stdout}`)
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

try {
  const bundled = await bridgeModule.loadBundledCatalog()
  assert.ok(bundled.items.some(item => item.id === 'session-delete' && item.defaultInstalled === false))

  const packageParent = path.join(temporary, 'source')
  const packageRoot = path.join(packageParent, 'package')
  const archive = path.join(temporary, 'portable-extension-smoke.tgz')
  await mkdir(packageParent, { recursive: true })
  await cp(fixture, packageRoot, { recursive: true })
  const tar = spawnSync('tar', ['-czf', archive, '-C', packageParent, 'package'], { encoding: 'utf8', windowsHide: true })
  if (tar.error) throw tar.error
  if (tar.status !== 0) throw new Error(`could not package the independent extension fixture: ${tar.stderr}`)
  const bytes = await readFile(archive)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const entry = {
    id: 'portable-smoke',
    packageName: 'dsh-portable-smoke-plugin',
    version: '1.0.0',
    channel: 'reviewed',
    defaultInstalled: false,
    name: { zh: '成品测试扩展', en: 'Finished-product smoke extension' },
    summary: { zh: '仅用于隔离成品回归。', en: 'Used only by isolated product regression.' },
    repository: 'https://github.com/WSL043/DSH-Portable',
    license: 'MIT',
    permissions: { zh: ['修改隔离测试配置'], en: ['Changes the isolated test profile'] },
    artifact: { url: 'https://github.com/WSL043/DSH-Portable/releases/download/test/fixture.tgz', bytes: bytes.length, sha256 },
    compatibility: {
      portable: components.portableVersion,
      dsh: components.dshVersion,
      dshCommit: components.dshCommit,
    },
  }
  const catalog = { schemaVersion: 1, revision: '2026-08-20.99', items: [entry] }
  bridgeModule.validateExtensionCatalog(catalog)
  const pending = action => ({
    schemaVersion: 1,
    operationId: randomUUID(),
    id: entry.id,
    action,
    packageName: entry.packageName,
    version: entry.version,
    profile: 'web',
    catalogRevision: catalog.revision,
    status: 'queued',
    attempts: 0,
    createdAt: new Date().toISOString(),
  })
  const componentIdentity = {
    portableVersion: components.portableVersion,
    dshVersion: components.dshVersion,
    dshCommit: components.dshCommit,
  }

  await mkdir(path.dirname(layout.extensionPending), { recursive: true })
  const installPending = pending('install')
  await writeFile(layout.extensionPending, JSON.stringify(installPending), 'utf8')
  const install = await launcherModule.processPendingExtensionOperation({
    layout,
    pending: installPending,
    catalog,
    components: componentIdentity,
    fetch: async () => ({ ok: true, headers: new Headers({ 'content-length': String(bytes.length) }), arrayBuffer: async () => bytes }),
  })
  assert.equal(install.status, 'awaiting_host_health')
  assert.match(run(['--profile', 'web', '--dump-config']), /dsh-portable-smoke-v1/)
  const installed = await launcherModule.finishExtensionOperation(layout, install)
  assert.equal(installed.status, 'applied')
  const receipts = JSON.parse(await readFile(layout.extensionReceipts, 'utf8'))
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].sha256, sha256)

  const removePending = pending('remove')
  await writeFile(layout.extensionPending, JSON.stringify(removePending), 'utf8')
  const removal = await launcherModule.processPendingExtensionOperation({
    layout,
    pending: removePending,
    catalog,
    components: componentIdentity,
    receipts,
  })
  assert.equal(removal.status, 'awaiting_host_health')
  const removed = await launcherModule.finishExtensionOperation(layout, removal)
  assert.equal(removed.status, 'applied')
  assert.doesNotMatch(run(['--profile', 'web', '--dump-config']), /dsh-portable-smoke-v1/)
  assert.deepEqual(JSON.parse(await readFile(layout.extensionReceipts, 'utf8')), [])

  process.stdout.write('[portable-extensions-smoke] finished product install, compose, receipt, restart gate, and remove passed\n')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
