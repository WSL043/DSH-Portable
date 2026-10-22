import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { acquireLaunchLock, layoutForRoot } from '../launcher/portable-core.mjs'
import {
  applyStagedAppUpdate,
  applyStagedCapsuleUpdate,
  checkForUpdate,
  copyVerifiedLocalComponent,
  comparePortableVersions,
  cleanStaleUpdateOperationDirectories,
  defaultEngineUpdateIndexUrl,
  defaultEngineUpdateManifestUrl,
  defaultUpdateManifestUrl,
  deferUpdate,
  downloadVerifiedComponent,
  evaluateUpdate,
  extractUpdateArchive,
  freshUpdateMetadataUrl,
  ignoreUpdate,
  installAvailableAppUpdate,
  listEngineVersions,
  listInstalledVersions,
  listProductVersions,
  platformUpdateKey,
  readInstalledUpdateState,
  readLocalUpdate,
  rollbackPendingAppUpdate,
  validateArchiveEntries,
} from '../launcher/update-core.mjs'
import { verifyUpdateSignature } from '../launcher/update-signature.mjs'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')

// Independent fixture keys never reach the CLI or the production key list.
const offlineKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const offlineVerification = { verifySignature: (bytes, signature) => verifyUpdateSignature(bytes, signature,
  [offlineKeys.publicKey.export({ type: 'spki', format: 'pem' })]) }
const localFailure = expected => error => error.code === 'UPDATE_LOCAL_PACKAGE_INVALID'
  && (expected instanceof RegExp ? expected.test(error.cause?.message) : error.cause?.code === expected)
async function writeOfflineManifest(filename, manifest) {
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  await writeFile(filename, bytes)
  await writeFile(`${filename}.sig`, sign('sha256', bytes, { key: offlineKeys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64'))
}

test('offline updates require the original signature and local attachment without contacting a feed', async t => {
  const fixture = await makeUpdateFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const input = path.join(fixture.root, 'offline.json')
  const archive = path.join(fixture.root, 'component.zip')
  const payload = Buffer.from('fixture ZIP bytes')
  const manifest = updateManifest({ platform: platformUpdateKey() })
  manifest.component = { ...manifest.component, bytes: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'), urls: ['https://example.invalid/component.zip'] }
  const read = () => readLocalUpdate({ layout: fixture.layout, input, scope: 'product' }, offlineVerification)
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = () => { requests++; throw new Error('Offline update attempted a network request.') }
  t.after(() => { globalThis.fetch = originalFetch })
  await writeOfflineManifest(input, manifest)
  await writeFile(archive, payload)
  assert.equal((await read()).status, 'available')
  await assert.rejects(readLocalUpdate({ layout: fixture.layout, input }), localFailure(/signature/i), 'a package signed by an unknown key is rejected by production defaults')
  await mkdir(path.join(fixture.root, 'launcher'), { recursive: true })
  for (const name of (await readdir(path.join(projectRoot, 'launcher'))).filter(name => name.endsWith('.mjs'))) {
    await copyFile(path.join(projectRoot, 'launcher', name), path.join(fixture.root, 'launcher', name))
  }
  await assert.rejects(execFileAsync(process.execPath, [path.join(fixture.root, 'launcher', 'portable-cli.mjs'),
    'check-update', '--input', input, '--json', '--allow-http'], { windowsHide: true, timeout: 10000 }),
  error => {
    const response = JSON.parse(error.stderr.trim())
    return response.code === 'UPDATE_LOCAL_PACKAGE_INVALID' && !response.message.includes(fixture.root)
      && /offline update is invalid or incomplete/i.test(response.message)
  })
  assert.match(await readFile(path.join(fixture.layout.logsDir, 'portable-errors.jsonl'), 'utf8'), /manifest signature is invalid/)
  await writeFile(input, `${JSON.stringify(manifest)}  \n`)
  await assert.rejects(read(), localFailure(/signature/i), 'equivalent JSON with different bytes fails authentication')
  await writeOfflineManifest(input, manifest)
  await rename(`${input}.sig`, `${input}.saved`)
  await assert.rejects(read(), localFailure('ENOENT'))
  await rename(`${input}.saved`, `${input}.sig`)
  await rename(archive, `${archive}.saved`)
  await assert.rejects(read(), localFailure('ENOENT'), 'missing attachments do not fall back to component.urls')
  await rename(`${archive}.saved`, archive)
  await writeFile(archive, Buffer.alloc(payload.length, 1))
  await assert.rejects(read(), localFailure(/digest/i))
  await writeFile(archive, payload)
  await assert.rejects(readLocalUpdate({ layout: fixture.layout, input, scope: 'engine' }, offlineVerification), localFailure(/kind mismatch/i))
  for (const [patch, status] of [
    [{ platform: 'wrong-platform' }, 'wrong-platform'],
    [{ requiredShellFingerprint: 'f'.repeat(64) }, 'full-package-required'],
    [{ targetRuntimeLayout: 'capsule-v1' }, 'full-package-required'],
    [{ component: { ...manifest.component, requiredNodeVersion: '99.0.0' } }, 'full-package-required'],
    [{ updateKind: 'engine', requiredShellContract: 999 }, 'core-incompatible'],
  ]) {
    await writeOfflineManifest(input, { ...manifest, ...patch })
    assert.equal((await readLocalUpdate({ layout: fixture.layout, input, scope: patch.updateKind || 'product' }, offlineVerification)).status, status)
  }
  await writeOfflineManifest(input, { ...manifest, component: { ...manifest.component, urls: ['https://example.invalid/%2e%2e%2foutside.zip'] } })
  await assert.rejects(read(), localFailure(/archive name/i))
  assert.equal(requests, 0)
  assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
  assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
  await assert.rejects(readFile(fixture.layout.updateJournal), { code: 'ENOENT' })
})

test('offline complete manifests preflight the signed Windows ZIP and delegate only to the existing full updater', async t => {
  const fixture = await makeUpdateFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const input = path.join(fixture.root, 'portable-manifest.json')
  const payload = Buffer.from('complete ZIP fixture')
  const full = { schemaVersion: 1, version: '0.9.4', releaseChannel: 'stable', payloads: { windowsX64: {
    filename: 'complete.zip', url: 'https://example.invalid/complete.zip', bytes: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'),
  } } }
  await writeOfflineManifest(input, full)
  await writeFile(path.join(fixture.root, 'complete.zip'), payload)
  await assert.rejects(readLocalUpdate({ layout: fixture.layout, input, scope: 'engine' }, offlineVerification), localFailure(/product scope/i))
  assert.equal((await readLocalUpdate({ layout: { ...fixture.layout, platform: 'linux' }, input }, offlineVerification)).status, 'wrong-platform')
  if (process.arch !== 'x64') return
  const read = () => readLocalUpdate({ layout: { ...fixture.layout, platform: 'win32' }, input }, offlineVerification)
  const result = await read()
  assert.equal(result.status, 'full-package-required')
  assert.equal(result.existingFullUpdater, true)
  assert.equal(result.latest, '0.9.4')
  assert.equal(result.fullPackageManifestFile, await realpath(input))
  for (const [patch, message] of [[{ filename: '../complete.zip' }, /archive name/i], [{ bytes: payload.length - 1 }, /size/i],
    [{ sha256: 'a'.repeat(64) }, /digest/i]]) {
    await writeOfflineManifest(input, { ...full, payloads: { windowsX64: { ...full.payloads.windowsX64, ...patch } } })
    await assert.rejects(read(), localFailure(message))
  }
  assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
  await assert.rejects(readFile(fixture.layout.updateJournal), { code: 'ENOENT' })
})

test('offline ZIPs use the existing product/core transactions, preflight and health rollback', { skip: process.platform !== 'win32' }, async t => {
  const toolsRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-offline-update-tools-'))
  t.after(() => rm(toolsRoot, { recursive: true, force: true }))
  const extractor = path.join(toolsRoot, 'DSH-UpdateExtractor.exe')
  await compileUpdateExtractor(extractor)
  for (const [scope, capsule, healthy] of [['product', false, true], ['engine', true, true], ['engine', true, false], ['product', false, null]]) {
    const fixture = await (capsule ? makeCapsuleUpdateFixture() : makeUpdateFixture())
    try {
      const archive = path.join(fixture.root, 'component.zip')
      const input = path.join(fixture.root, 'offline.json')
      await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', fixture.stagedRoot, '.'])
      const bytes = await readFile(archive)
      const components = JSON.parse(await readFile(path.join(fixture.stagedRoot, 'licenses', 'COMPONENTS.json')))
      components.releaseChannel = 'stable'
      await writeFile(path.join(fixture.stagedRoot, 'licenses', 'COMPONENTS.json'), JSON.stringify(components))
      const metadataFile = path.join(fixture.stagedRoot, 'component.json')
      await writeFile(metadataFile, JSON.stringify({ ...JSON.parse(await readFile(metadataFile)), releaseChannel: 'stable' }))
      await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', fixture.stagedRoot, '.'])
      const originalBytes = await readFile(archive)
      const installedBefore = await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8')
      const manifest = updateManifest({ portableVersion: components.portableVersion, updateKind: scope, releaseChannel: 'stable',
        platform: platformUpdateKey(), requiredShellSchema: components.shellSchema,
        ...(capsule ? { requiredShellContract: 1, targetRuntimeLayout: 'capsule-v1' } : {}),
        component: { kind: capsule ? 'dsh-runtime-capsule' : 'dsh-app', dshVersion: components.dshVersion, dshCommit: components.dshCommit,
          requiredNodeVersion: components.nodeVersion, bytes: originalBytes.length, sha256: createHash('sha256').update(originalBytes).digest('hex'),
          urls: ['https://example.invalid/component.zip'] } })
      if (capsule) {
        const installed = JSON.parse(installedBefore)
        await writeFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ ...installed, shellContract: 1 }))
        await writeFile(path.join(fixture.stagedRoot, 'licenses', 'COMPONENTS.json'), JSON.stringify({ ...components, shellContract: 1 }))
        await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', fixture.stagedRoot, '.'])
        const updatedBytes = await readFile(archive)
        manifest.component.bytes = updatedBytes.length
        manifest.component.sha256 = createHash('sha256').update(updatedBytes).digest('hex')
      }
      await writeOfflineManifest(input, manifest)
      const update = await readLocalUpdate({ layout: fixture.layout, input, scope }, offlineVerification)
      assert.equal(update.status, 'available')
      if (healthy === null) await writeFile(archive, Buffer.alloc(manifest.component.bytes, 1))
      const phases = []
      const apply = () => installAvailableAppUpdate({ layout: fixture.layout, update,
        download: parameters => copyVerifiedLocalComponent({ ...parameters, source: update.localArchive }),
        extract: (file, destination) => extractUpdateArchive(file, destination, { windowsExtractor: extractor }),
        preflight: async () => { phases.push('preflight'); return { warnings: [] } },
        healthCheck: async () => { phases.push('health'); return healthy }, onProgress: event => phases.push(event.phase) })
      if (healthy === null) {
        await assert.rejects(apply(), /digest/i, 'changing a ZIP after preview still fails before extraction or replacement')
        assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
        assert.equal(phases.includes('preflight'), false)
        await assert.rejects(readFile(fixture.layout.updateJournal), { code: 'ENOENT' })
        continue
      }
      if (healthy) assert.equal((await apply()).status, 'updated')
      else await assert.rejects(apply(), /rolled back/i)
      assert.ok(phases.indexOf('preflight') < phases.indexOf('installing'))
      assert.ok(phases.indexOf('health') > phases.indexOf('installing'))
      if (capsule) {
        assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), healthy ? fixture.newCapsule : fixture.oldCapsule)
        assert.equal((await readInstalledUpdateState(fixture.layout)).portableVersion, '0.5.0-rc.1', 'core updates retain installed shell identity')
      }
      assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
      await assert.rejects(readFile(fixture.layout.updateJournal), { code: 'ENOENT' })
    } finally { await rm(fixture.root, { recursive: true, force: true }) }
  }
})

test('mutable GitHub update metadata bypasses stale CDN entries without altering other downloads', () => {
  const url = defaultEngineUpdateIndexUrl('candidate', 'win32', 'x64', '0.6.9')
  assert.equal(freshUpdateMetadataUrl(url, 123).searchParams.get('_portable_check'), '123')
  assert.notEqual(freshUpdateMetadataUrl(url, 123).href, freshUpdateMetadataUrl(url, 124).href)
  for (const untouched of [
    'https://example.com/index.json?signature=keep',
    'https://github.com/WSL043/DSH-Portable/releases/download/v0.6.9/portable-manifest.json',
    'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-candidate/core.zip',
  ]) assert.equal(freshUpdateMetadataUrl(untouched, 123).href, untouched)
})

async function compileUpdateExtractor(output) {
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  await execFileAsync(csc, [
    '/nologo', '/target:exe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
    `/out:${output}`,
    path.join(projectRoot, 'launcher', 'windows', 'DSH-UpdateExtractor.cs'),
  ])
}

function updateManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    portableVersion: '0.1.0-rc.7-portable.1',
    releaseChannel: 'candidate',
    platform: 'windows-x64',
    minimumUpdaterSchema: 1,
    requiredShellSchema: 1,
    component: {
      kind: 'dsh-app',
      dshVersion: '0.1.0-rc.7',
      dshCommit: 'b'.repeat(40),
      requiredNodeVersion: '24.19.0',
      bytes: 4,
      sha256: createHash('sha256').update('next').digest('hex'),
      urls: ['https://example.invalid/dsh-app.zip'],
    },
    ...overrides,
  }
}

function engineUpdateManifest(overrides = {}) {
  return updateManifest({
    updateKind: 'engine',
    portableVersion: '0.4.10',
    releaseChannel: 'stable',
    component: {
      ...updateManifest().component,
      dshVersion: '0.1.1-rc.3',
      dshCommit: 'c'.repeat(40),
    },
    ...overrides,
  })
}

test('explicit engine catalogs check compatibility even when the DSH version matches', () => {
  const manifest = engineUpdateManifest()
  const installed = { portableVersion: manifest.portableVersion, dshVersion: manifest.component.dshVersion,
    releaseChannel: 'stable', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0' }
  const options = { allowEngineVersionChange: true }
  assert.equal(evaluateUpdate(manifest, installed, 'windows-x64', options).status, 'current')
  assert.equal(evaluateUpdate({ ...manifest, portableVersion: '0.4.11' }, installed, 'windows-x64', options).status, 'core-incompatible')
  assert.equal(evaluateUpdate({ ...manifest, portableVersion: '0.4.9' }, installed, 'windows-x64', options).status, 'core-awaiting-qualification',
    'a newer installed Portable is not told to update to an older required version')
  assert.equal(evaluateUpdate({ ...manifest, requiredShellFingerprint: 'a'.repeat(64) }, installed, 'windows-x64', options).status, 'full-package-required')
  assert.equal(evaluateUpdate({ ...manifest, component: { ...manifest.component, requiredNodeVersion: '25.0.0' } }, installed, 'windows-x64', options).status, 'full-package-required')
  assert.equal(evaluateUpdate({ ...manifest, portableVersion: '0.4.11' }, installed, 'windows-x64').status, 'current',
    'automatic checks do not advertise a same-version engine update')
})

test('portable preview versions compare monotonically without lexical mistakes', () => {
  assert.equal(comparePortableVersions('0.1.0-rc.6-portable.5', '0.1.0-rc.6-portable.5'), 0)
  assert.equal(comparePortableVersions('0.1.0-rc.6-portable.5', '0.1.0-rc.6-portable.10'), -1)
  assert.equal(comparePortableVersions('0.1.0-rc.6-portable.10', '0.1.0-rc.7-portable.1'), -1)
  assert.equal(comparePortableVersions('0.1.0-rc.9-portable.8', '0.1.0-rc.10-portable.1'), -1)
  assert.equal(comparePortableVersions('0.1.0', '0.1.0-rc.99-portable.99'), 1)
  assert.equal(comparePortableVersions('0.2.0-rc.11', '0.2.0'), -1)
  assert.throws(() => comparePortableVersions('latest', '0.1.0'), /valid semantic version/i)
})

test('update evaluation distinguishes current, component update, full package, and wrong platform', () => {
  const installed = {
    portableVersion: '0.1.0-rc.6-portable.5',
    dshVersion: '0.1.0-rc.6',
    updaterSchema: 1,
    shellSchema: 1,
    nodeVersion: '24.19.0',
  }
  const componentUpdate = evaluateUpdate(updateManifest(), installed, 'windows-x64')
  assert.equal(componentUpdate.status, 'available')
  assert.deepEqual(componentUpdate.product, {
    name: 'DSH-Portable',
    current: installed.portableVersion,
    latest: updateManifest().portableVersion,
  })
  assert.deepEqual(componentUpdate.engine, {
    name: 'DeepSeek Harness',
    current: installed.dshVersion,
    latest: updateManifest().component.dshVersion,
    changed: true,
  })
  assert.equal(componentUpdate.delivery, 'component')
  assert.equal(evaluateUpdate(updateManifest({ portableVersion: installed.portableVersion }), installed, 'windows-x64').status, 'current')
  const fullUpdate = evaluateUpdate(updateManifest({ minimumUpdaterSchema: 2 }), installed, 'windows-x64')
  assert.equal(fullUpdate.status, 'full-package-required')
  assert.equal(fullUpdate.delivery, 'full-package')
  assert.equal(fullUpdate.product.name, 'DSH-Portable')
  assert.equal(fullUpdate.engine.name, 'DeepSeek Harness')
  assert.equal(evaluateUpdate(updateManifest({ requiredShellSchema: 2 }), installed, 'windows-x64').status, 'full-package-required')
  assert.equal(evaluateUpdate(updateManifest({ requiredShellFingerprint: 'a'.repeat(64) }), installed, 'windows-x64').status, 'full-package-required')
  assert.equal(evaluateUpdate(updateManifest({ requiredShellFingerprint: 'a'.repeat(64) }), { ...installed, shellFingerprint: 'a'.repeat(64) }, 'windows-x64').status, 'available')
  assert.throws(() => evaluateUpdate(updateManifest({ requiredShellFingerprint: 'invalid' }), installed, 'windows-x64'), /fingerprint/i)
  assert.equal(evaluateUpdate(updateManifest({
    component: { ...updateManifest().component, requiredNodeVersion: '25.0.0' },
  }), installed, 'windows-x64').status, 'full-package-required')
  assert.equal(evaluateUpdate(updateManifest(), installed, 'macos-arm64').status, 'wrong-platform')
  assert.equal(evaluateUpdate(updateManifest(), { ...installed, updaterSchema: undefined }, 'windows-x64').status, 'full-package-required')
  const missingCompatibility = updateManifest()
  delete missingCompatibility.minimumUpdaterSchema
  assert.throws(() => evaluateUpdate(missingCompatibility, installed, 'windows-x64'), /compatibility/i)
})

test('installed update state preserves the shell fingerprint used by compatibility checks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-installed-update-state-'))
  try {
    const layout = layoutForRoot(root)
    const shellFingerprint = 'a'.repeat(64)
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.6.0-rc.3',
      releaseChannel: 'candidate',
      dshVersion: '0.1.2-alpha.2',
      updaterSchema: 1,
      shellSchema: 24,
      shellFingerprint,
      nodeVersion: '24.19.0',
      runtimeLayout: 'capsule-v1',
    })}\n`)
    assert.equal((await readInstalledUpdateState(layout)).shellFingerprint, shellFingerprint)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an independently published official DSH component updates without changing the Portable version', () => {
  const installed = {
    portableVersion: '0.4.10',
    releaseChannel: 'stable',
    dshVersion: '0.1.1-rc.2',
    updaterSchema: 1,
    shellSchema: 1,
    nodeVersion: '24.19.0',
  }
  const result = evaluateUpdate(engineUpdateManifest(), installed, 'windows-x64')
  assert.equal(result.status, 'available')
  assert.equal(result.updateKind, 'engine')
  assert.equal(result.delivery, 'component')
  assert.equal(result.productCurrent, '0.4.10')
  assert.equal(result.productLatest, '0.4.10')
  assert.equal(result.engineCurrent, '0.1.1-rc.2')
  assert.equal(result.engineLatest, '0.1.1-rc.3')
  assert.equal(result.updateIdentity, `engine:0.1.1-rc.3:${'c'.repeat(40)}`)
})

test('the engine channel is monotonic and never crosses an unverified Portable compatibility baseline', () => {
  const installed = {
    portableVersion: '0.4.10',
    releaseChannel: 'stable',
    dshVersion: '0.1.1-rc.3',
    updaterSchema: 1,
    shellSchema: 1,
    nodeVersion: '24.19.0',
  }
  assert.equal(evaluateUpdate(engineUpdateManifest(), installed, 'windows-x64').status, 'current')
  assert.equal(evaluateUpdate(engineUpdateManifest({
    component: { ...engineUpdateManifest().component, dshVersion: '0.1.1-rc.2' },
  }), installed, 'windows-x64').status, 'current')
  assert.equal(evaluateUpdate(engineUpdateManifest({
    portableVersion: '0.4.9',
    component: { ...engineUpdateManifest().component, dshVersion: installed.dshVersion },
  }), installed, 'windows-x64').status, 'current')
  const incompatible = evaluateUpdate(engineUpdateManifest({
    portableVersion: '0.4.11',
    component: { ...engineUpdateManifest().component, dshVersion: '0.1.1-rc.4' },
  }), installed, 'windows-x64')
  assert.equal(incompatible.status, 'core-incompatible')
  assert.equal(incompatible.delivery, 'none')
})

test('platform update keys are explicit and unsupported targets fail closed', () => {
  assert.equal(platformUpdateKey('win32', 'x64'), 'windows-x64')
  assert.equal(platformUpdateKey('darwin', 'arm64'), 'macos-arm64')
  assert.equal(platformUpdateKey('darwin', 'x64'), 'macos-x64')
  assert.equal(platformUpdateKey('linux', 'arm64'), 'linux-arm64')
  assert.equal(platformUpdateKey('linux', 'x64'), 'linux-x64')
  assert.throws(() => platformUpdateKey('linux', 'ia32'), /unsupported/i)
})

test('new clients route legacy candidate aliases to the stable machine feed', () => {
  assert.equal(
    defaultUpdateManifestUrl('stable', 'win32', 'x64'),
    'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-update-windows-x64.json',
  )
  assert.equal(
    defaultUpdateManifestUrl('candidate', 'darwin', 'arm64'),
    'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-update-macos-arm64.json',
  )
  assert.throws(() => defaultUpdateManifestUrl('preview', 'linux', 'x64'), /release channel/i)
  assert.equal(
    defaultEngineUpdateManifestUrl('stable', 'win32', 'x64'),
    'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-stable/dsh-core-update-windows-x64.json',
  )
  assert.equal(
    defaultEngineUpdateIndexUrl('stable', 'win32', 'x64'),
    'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-stable/dsh-core-index-windows-x64.json',
  )
})

test('engine version catalog exposes only verified compatible manifests and preserves explicit targets', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-engine-versions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
    portableVersion: '0.4.10', releaseChannel: 'stable', dshVersion: '0.1.1-rc.2',
    updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
  })}\n`)
  const compatible = engineUpdateManifest({ platform: platformUpdateKey(process.platform, process.arch) })
  const compatibleOlder = engineUpdateManifest({
    platform: platformUpdateKey(process.platform, process.arch),
    component: { ...engineUpdateManifest().component, dshVersion: '0.1.1-rc.1' },
  })
  const wrongShell = engineUpdateManifest({
    platform: platformUpdateKey(process.platform, process.arch), requiredShellSchema: 2,
    component: { ...engineUpdateManifest().component, dshVersion: '0.1.1-rc.4' },
  })
  const result = await listEngineVersions({
    layout,
    indexUrl: 'https://updates.invalid/index.json',
    fetchImpl: async () => new Response(JSON.stringify({
      schemaVersion: 1,
      versions: [
        { version: '0.1.1-rc.3', manifestUrl: 'https://updates.invalid/0.1.1-rc.3.json', manifest: compatible },
        { version: '0.1.1-rc.4', manifestUrl: 'https://updates.invalid/0.1.1-rc.4.json', manifest: wrongShell },
        { version: '0.1.1-rc.2', manifestUrl: 'https://updates.invalid/0.1.1-rc.2.json',
          manifest: { ...wrongShell, component: { ...wrongShell.component, dshVersion: '0.1.1-rc.2' } } },
      ],
    }), { status: 200 }),
  })
  assert.equal(result.current, '0.1.1-rc.2')
  assert.deepEqual(result.versions.map(item => item.version), ['0.1.1-rc.3'])
  assert.equal(result.versions[0].manifestUrl, 'https://updates.invalid/0.1.1-rc.3.json')
  assert.deepEqual(result.unavailable, [{ version: '0.1.1-rc.4', status: 'full-package-required',
    reason: 'full-package-required', requiredPortableVersion: '0.4.10' }, { version: '0.1.1-rc.2', status: 'full-package-required',
    reason: 'full-package-required', requiredPortableVersion: '0.4.10' }])
  assert.equal(result.unavailable[0].manifestUrl, undefined, 'incompatible entries expose no install target')

  const selectedOlder = await checkForUpdate({
    layout,
    scope: 'engine',
    manifestUrl: 'https://updates.invalid/0.1.1-rc.1.json',
    force: true,
    fetchImpl: async () => new Response(JSON.stringify(compatibleOlder), { status: 200 }),
  })
  assert.equal(selectedOlder.status, 'available')
  assert.equal(selectedOlder.engineLatest, '0.1.1-rc.1')
})

test('product and official DSH checks use isolated feeds and caches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-split-'))
  const layout = layoutForRoot(root)
  const requested = []
  try {
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.4.10', releaseChannel: 'stable', dshVersion: '0.1.1-rc.2',
      updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
    })}\n`)
    const fetchImpl = async (url) => {
      requested.push(String(url))
      const manifest = String(url).includes('core-stable')
        ? engineUpdateManifest({ platform: platformUpdateKey(process.platform, process.arch) })
        : updateManifest({ portableVersion: '0.4.10', releaseChannel: 'stable', platform: platformUpdateKey(process.platform, process.arch) })
      return new Response(JSON.stringify(manifest), { status: 200 })
    }
    const product = await checkForUpdate({ layout, scope: 'product', force: true, fetchImpl })
    const engine = await checkForUpdate({ layout, scope: 'engine', force: true, fetchImpl })
    assert.equal(product.status, 'current')
    assert.equal(engine.status, 'available')
    assert.equal(engine.updateKind, 'engine')
    assert.match(requested[0], /update-channel-stable/)
    assert.match(requested[1], /update-channel-core-stable/)
    assert.notEqual(layout.productUpdateCheckCache, layout.engineUpdateCheckCache)
    assert.equal(JSON.parse(await readFile(layout.engineUpdateCheckCache, 'utf8')).manifest.updateKind, 'engine')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('each update feed fails closed when it serves the other update kind', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-kind-mismatch-'))
  const layout = layoutForRoot(root)
  try {
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.4.10', releaseChannel: 'stable', dshVersion: '0.1.1-rc.2',
      updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
    })}\n`)
    const result = await checkForUpdate({
      layout,
      scope: 'engine',
      force: true,
      manifestUrl: 'https://updates.invalid/engine.json',
      fetchImpl: async () => new Response(JSON.stringify(updateManifest({
        portableVersion: '0.4.11',
        platform: platformUpdateKey(process.platform, process.arch),
      })), { status: 200 }),
    })
    assert.equal(result.status, 'unavailable')
    assert.match(result.message, /update kind/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('automatic checks use the stable feed for legacy candidate metadata', async () => {
  const cases = [
    { releaseChannel: 'stable', installedVersion: '0.3.0', latestVersion: '0.4.0' },
    { releaseChannel: 'candidate', installedVersion: '0.4.0-rc.1', latestVersion: '0.4.0-rc.2' },
  ]
  for (const value of cases) {
    const root = await mkdtemp(path.join(os.tmpdir(), `dsh-update-${value.releaseChannel}-`))
    const layout = layoutForRoot(root)
    const requested = []
    try {
      await mkdir(path.join(root, 'licenses'), { recursive: true })
      await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
        portableVersion: value.installedVersion,
        releaseChannel: value.releaseChannel,
        dshVersion: '0.1.0-rc.8',
        updaterSchema: 1,
        shellSchema: 1,
        nodeVersion: '24.19.0',
      })}\n`)
      const manifest = updateManifest({
        portableVersion: value.latestVersion,
        releaseChannel: value.releaseChannel,
        platform: platformUpdateKey(process.platform, process.arch),
      })
      await checkForUpdate({
        layout,
        force: true,
        fetchImpl: async (url) => {
          requested.push(String(url))
          return new Response(JSON.stringify(manifest), { status: 200 })
        },
      })
      assert.equal(requested.length, 1)
      assert.match(requested[0], /\/update-channel-stable\//)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('single-line clients accept legacy candidate metadata without a channel-mismatch state', () => {
  const base = { dshVersion: '0.1.0-rc.8', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0' }
  const legacyCandidate = updateManifest({ portableVersion: '0.4.0-rc.2', releaseChannel: 'candidate' })
  const stableClient = { ...base, portableVersion: '0.3.0', releaseChannel: 'stable' }
  const result = evaluateUpdate(legacyCandidate, stableClient, 'windows-x64')
  assert.equal(result.status, 'available')
  assert.equal(result.releaseChannel, 'stable')
  const final = updateManifest({ portableVersion: '0.4.0', releaseChannel: 'stable' })
  assert.equal(evaluateUpdate(final, { ...base, portableVersion: '0.4.0-rc.2', releaseChannel: 'candidate' }, 'windows-x64').status, 'available')
})

test('full-package decisions carry immutable release and package-manifest targets', () => {
  const installed = {
    portableVersion: '0.4.0-rc.1',
    releaseChannel: 'candidate',
    platform: 'windows-x64',
    nodeVersion: '24.19.0',
    updaterSchema: 1,
    shellSchema: 1,
    dshVersion: '0.1.0-rc.7',
  }
  const result = evaluateUpdate(updateManifest({
    portableVersion: '0.4.0-rc.2',
    releaseChannel: 'candidate',
    requiredShellSchema: 2,
  }), installed, 'windows-x64')

  assert.equal(result.status, 'full-package-required')
  assert.equal(result.releaseUrl, 'https://github.com/WSL043/DSH-Portable/releases/tag/v0.4.0-rc.2')
  assert.equal(result.fullPackageManifestUrl, 'https://github.com/WSL043/DSH-Portable/releases/download/v0.4.0-rc.2/portable-manifest.json')
})

test('runtime layout changes require a verified complete-package update', () => {
  const installed = {
    portableVersion: '0.4.15',
    releaseChannel: 'stable',
    dshVersion: '0.1.1-rc.2',
    updaterSchema: 1,
    shellSchema: 21,
    nodeVersion: '24.19.0',
    runtimeLayout: 'expanded-v1',
  }
  const manifest = updateManifest({
    portableVersion: '0.5.0',
    releaseChannel: 'stable',
    targetRuntimeLayout: 'capsule-v1',
    component: {
      ...updateManifest().component,
      runtimeLayout: 'expanded-v1',
    },
  })
  const result = evaluateUpdate(manifest, installed, 'windows-x64')
  assert.equal(result.status, 'full-package-required')
  assert.equal(result.delivery, 'full-package')
})

test('a slow feed leaves the launch lock free and serializes a pending defer choice', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-feed-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({
    portableVersion: '0.3.0', releaseChannel: 'candidate', dshVersion: '0.1.0-rc.7',
    updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
  }))
  const manifest = updateManifest({ portableVersion: '0.4.0-rc.1', platform: platformUpdateKey(process.platform, process.arch) })
  let entered, finish
  const requested = new Promise(resolve => { entered = resolve })
  const network = new Promise(resolve => { finish = resolve })
  const checking = checkForUpdate({ layout, fetchImpl: async () => {
    entered()
    await network
    return new Response(JSON.stringify(manifest))
  } })
  await requested
  let deferring
  try {
    const release = await acquireLaunchLock(layout)
    await release()
    deferring = deferUpdate(layout)
  } finally { finish() }
  assert.equal((await checking).status, 'available')
  assert.equal((await deferring).status, 'deferred')
  assert.equal((await checkForUpdate({ layout, fetchImpl: () => assert.fail('use the saved feed') })).status, 'deferred')
})

test('update checks read installed metadata and cache a successful result', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-check-'))
  const layout = layoutForRoot(root)
  const manifest = updateManifest({ platform: platformUpdateKey(process.platform, process.arch) })
  let requests = 0
  const server = http.createServer((_request, response) => {
    requests += 1
    const body = Buffer.from(JSON.stringify(manifest))
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length }).end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.1.0-rc.6-portable.5',
      dshVersion: '0.1.0-rc.6',
      updaterSchema: 1,
      shellSchema: 1,
      nodeVersion: '24.19.0',
    })}\n`)
    const url = `http://127.0.0.1:${server.address().port}/update.json`
    const first = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, force: true })
    const cached = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true })
    assert.equal(first.status, 'available')
    assert.equal(cached.status, 'available')
    assert.equal(cached.cached, true)
    assert.equal(requests, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('choosing later suppresses automatic prompts but never hides a forced check', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-defer-'))
  const layout = layoutForRoot(root)
  const manifest = updateManifest({ platform: platformUpdateKey(process.platform, process.arch) })
  let requests = 0
  const server = http.createServer((_request, response) => {
    requests += 1
    const body = Buffer.from(JSON.stringify(manifest))
    response.writeHead(200, { 'content-length': body.length }).end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.1.0-rc.6-portable.5', dshVersion: '0.1.0-rc.6', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
    })}\n`)
    const url = `http://127.0.0.1:${server.address().port}/update.json`
    await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, force: true, now: 1000 })
    await deferUpdate(layout, { now: 1100, durationMs: 24 * 60 * 60 * 1000 })
    const deferred = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, now: 1200 })
    const forced = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, force: true, now: 1300 })
    assert.equal(deferred.status, 'deferred')
    assert.equal(forced.status, 'available')
    assert.equal(requests, 2)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('skipping one version suppresses only that automatic prompt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-ignore-'))
  const layout = layoutForRoot(root)
  const manifest = updateManifest({ platform: platformUpdateKey(process.platform, process.arch) })
  let activeManifest = manifest
  const server = http.createServer((_request, response) => {
    const body = Buffer.from(JSON.stringify(activeManifest))
    response.writeHead(200, { 'content-length': body.length }).end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.1.0-rc.6-portable.5', dshVersion: '0.1.0-rc.6', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
    })}\n`)
    const url = `http://127.0.0.1:${server.address().port}/update.json`
    await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, force: true, now: 1000 })
    await ignoreUpdate(layout, manifest.portableVersion)
    const ignored = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, now: 1100 })
    const forced = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, force: true, now: 1200 })
    assert.equal(ignored.status, 'ignored')
    assert.equal(ignored.latest, manifest.portableVersion)
    assert.equal(forced.status, 'available')

    activeManifest = { ...manifest, portableVersion: '0.1.0-rc.7-portable.2' }
    const next = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, force: true, now: 1300 })
    assert.equal(next.status, 'available')
    const nextAutomatic = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, now: 1400 })
    assert.equal(nextAutomatic.status, 'available')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('a temporary update outage is cached briefly instead of delaying every launch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-outage-'))
  const layout = layoutForRoot(root)
  let requests = 0
  const server = http.createServer((_request, response) => {
    requests += 1
    response.writeHead(503).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.1.0-rc.6-portable.5', dshVersion: '0.1.0-rc.6', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
    })}\n`)
    const url = `http://127.0.0.1:${server.address().port}/update.json`
    const first = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, now: 1000 })
    const cached = await checkForUpdate({ layout, manifestUrl: url, allowHttp: true, now: 2000 })
    assert.equal(first.status, 'unavailable')
    assert.equal(cached.status, 'unavailable')
    assert.equal(cached.cached, true)
    assert.equal(requests, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing candidate core feed is reported explicitly instead of claiming product-coupled updates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-unpublished-'))
  const layout = layoutForRoot(root)
  let requests = 0
  const fetchImpl = async () => {
    requests += 1
    return new Response('', { status: 404 })
  }
  try {
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
      portableVersion: '0.6.0-rc.1', releaseChannel: 'candidate', dshVersion: '0.1.1-rc.2', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0',
    })}\n`)
    const first = await checkForUpdate({ layout, scope: 'engine', fetchImpl, now: 1000 })
    const cached = await checkForUpdate({ layout, scope: 'engine', fetchImpl, now: 2000 })
    assert.equal(first.status, 'channel-unpublished')
    assert.equal(first.message, 'HTTP 404')
    assert.equal(cached.status, 'channel-unpublished')
    assert.equal(cached.cached, true)
    assert.equal(requests, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('verified component download falls back by route but never accepts corrupt bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-download-'))
  const output = path.join(root, 'component.zip')
  const bytes = Buffer.from('next')
  const server = http.createServer((request, response) => {
    if (request.url === '/ok') response.writeHead(200, { 'content-length': bytes.length }).end(bytes)
    else response.writeHead(503).end('unavailable')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const result = await downloadVerifiedComponent({
      urls: [`${origin}/fail`, `${origin}/ok`],
      destination: output,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      allowHttp: true,
    })
    assert.equal(result.url, `${origin}/ok`)
    assert.equal(await readFile(output, 'utf8'), 'next')

    await assert.rejects(downloadVerifiedComponent({
      urls: [`${origin}/ok`],
      destination: path.join(root, 'corrupt.zip'),
      bytes: bytes.length,
      sha256: '0'.repeat(64),
      allowHttp: true,
    }), /digest/i)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('component download stops as soon as a response exceeds the declared size', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-oversize-'))
  const output = path.join(root, 'component.zip')
  let pulls = 0
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1024))
        if (pulls === 50) controller.close()
      },
    }),
  })
  try {
    await assert.rejects(downloadVerifiedComponent({
      urls: ['https://example.invalid/component.zip'],
      destination: output,
      bytes: 4,
      sha256: '0'.repeat(64),
      fetchImpl,
    }), /size/i)
    assert.ok(pulls < 50, `oversized response was read to completion (${pulls} chunks)`)
    await assert.rejects(readFile(output), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('component download timeout measures inactivity instead of total transfer time', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-slow-progress-'))
  const output = path.join(root, 'component.zip')
  const chunks = [Buffer.from('s'), Buffer.from('l'), Buffer.from('o'), Buffer.from('w')]
  const bytes = Buffer.concat(chunks)
  const progress = []
  const fetchImpl = async (_url, { signal }) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        let index = 0
        const timer = setInterval(() => {
          if (index < chunks.length) controller.enqueue(chunks[index++])
          if (index === chunks.length) {
            clearInterval(timer)
            controller.close()
          }
        }, 80)
        signal.addEventListener('abort', () => {
          clearInterval(timer)
          controller.error(new Error('aborted'))
        }, { once: true })
      },
    }),
  })
  try {
    const result = await downloadVerifiedComponent({
      urls: ['https://example.invalid/component.zip'],
      destination: output,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      fetchImpl,
      timeoutMs: 220,
      onProgress: (event) => progress.push(event),
    })
    assert.equal(result.bytes, bytes.length)
    assert.deepEqual(await readFile(output), bytes)
    assert.equal(progress[0].phase, 'downloading')
    assert.equal(progress[0].receivedBytes, 0)
    assert.equal(progress.at(-1).percent, 100)
    assert.equal(progress.at(-1).receivedBytes, bytes.length)
    assert.ok(progress.every((event) => event.totalBytes === bytes.length))
    assert.deepEqual(progress.map((event) => event.receivedBytes), [...progress.map((event) => event.receivedBytes)].sort((a, b) => a - b))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('component archives are restricted to replaceable application files', () => {
  assert.doesNotThrow(() => validateArchiveEntries([
    'component.json',
    'app/package.json',
    'app/node_modules/@deepseek-ai/dsh/lib/bin.js',
    'licenses/COMPONENTS.json',
    'licenses/DeepSeek-Harness-LICENSE.txt',
    'licenses/dsh-market-LICENSE.txt',
    'licenses/pnpm-LICENSE.txt',
    'runtime-capsule.json',
    'runtime/DSH-App.dshpack',
  ]))
  for (const entry of ['../data/private.txt', '/absolute', 'C:/Windows/System32/file', 'data/session.json', 'launcher/portable-cli.mjs']) {
    assert.throws(() => validateArchiveEntries([entry]), /unsafe|not allowed/i, entry)
  }
})

test('Linux extracts a verified update without relying on macOS ditto', async () => {
  const calls = []
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-linux-update-extract-'))
  try {
    await extractUpdateArchive('/tmp/component.zip', root, {
      platform: 'linux',
      exec: async (command, args) => {
        calls.push({ command, args })
        if (command === 'unzip' && args[0] === '-Z1') return { stdout: 'component.json\napp/package.json\n' }
        return { stdout: '' }
      },
    })
    assert.deepEqual(calls, [
      { command: 'unzip', args: ['-Z1', '/tmp/component.zip'] },
      { command: 'unzip', args: ['-q', '/tmp/component.zip', '-d', root] },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('download, extract, and transactional apply form one verified update path', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await makeUpdateFixture()
  const source = path.join(fixture.root, 'component-source')
  const archive = path.join(fixture.root, 'component.zip')
  const extractor = path.join(fixture.root, 'DSH-UpdateExtractor.exe')
  let server
  try {
    await compileUpdateExtractor(extractor)
    await mkdir(source, { recursive: true })
    await execFileAsync('robocopy.exe', [fixture.stagedRoot, source, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']).catch((error) => {
      if (Number(error.code) > 7) throw error
    })
    await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', source, '.'])
    const archiveBytes = await readFile(archive)
    server = http.createServer((_request, response) => response.writeHead(200, {
      'content-length': archiveBytes.length,
      'content-type': 'application/zip',
    }).end(archiveBytes))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const update = {
      status: 'available',
      latest: '0.1.0-rc.7-portable.1',
      releaseChannel: 'candidate',
      platform: 'windows-x64',
      minimumUpdaterSchema: 1,
      requiredShellSchema: 1,
      component: {
        kind: 'dsh-app',
        dshVersion: '0.1.0-rc.7',
        dshCommit: 'b'.repeat(40),
        requiredNodeVersion: '24.19.0',
        bytes: archiveBytes.length,
        sha256: createHash('sha256').update(archiveBytes).digest('hex'),
        urls: [`http://127.0.0.1:${server.address().port}/component.zip`],
      },
    }
    const sequence = []
    const cleanupWarnings = []
    const result = await installAvailableAppUpdate({
      layout: fixture.layout,
      update,
      allowHttp: true,
      beforeApply: async () => {
        assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
        await assert.rejects(readFile(fixture.layout.updateJournal, 'utf8'), { code: 'ENOENT' })
        sequence.push('before-apply')
      },
      preflight: async () => sequence.push('preflight'),
      healthCheck: async () => true,
      extract: (filename, destination) => extractUpdateArchive(filename, destination, { windowsExtractor: extractor }),
      onProgress: (event) => sequence.push(event.phase),
      cleanOperationDirectories: async (layout) => {
        assert.equal(layout.updateDir, fixture.layout.updateDir)
        sequence.push('cleanup')
        throw Object.assign(new Error('simulated cleanup failure'), { code: 'EACCES' })
      },
      onCleanupError: (error) => { cleanupWarnings.push(error.code); sequence.push('cleanup-warning') },
    })
    assert.equal(result.status, 'updated')
    assert.ok(sequence.indexOf('verifying') < sequence.indexOf('before-apply'))
    assert.ok(sequence.indexOf('before-apply') < sequence.indexOf('preflight'))
    assert.ok(sequence.indexOf('preflight') < sequence.indexOf('installing'))
    assert.ok(sequence.indexOf('cleanup') < sequence.indexOf('preparing'))
    assert.ok(sequence.indexOf('cleanup-warning') < sequence.indexOf('preparing'))
    assert.deepEqual(cleanupWarnings, ['EACCES'])
    assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'new app')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('stale update cleanup removes only expired UUID operation directories and never follows links', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-stale-update-operations-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(layout.updateDir, { recursive: true })

  const staleId = '11111111-1111-4111-8111-111111111111'
  const freshId = '22222222-2222-4222-8222-222222222222'
  const linkId = '33333333-3333-4333-8333-333333333333'
  const stalePath = path.join(layout.updateDir, staleId)
  const freshPath = path.join(layout.updateDir, freshId)
  const externalPath = path.join(root, 'outside-update-root')
  const linkPath = path.join(layout.updateDir, linkId)
  const unmatchedPath = path.join(layout.updateDir, 'abandoned-operation')
  await Promise.all([
    mkdir(stalePath), mkdir(freshPath), mkdir(externalPath), mkdir(unmatchedPath),
  ])
  await writeFile(path.join(stalePath, 'component.zip'), 'stale')
  await writeFile(path.join(externalPath, 'keep.txt'), 'outside')
  await symlink(externalPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir')

  const now = Date.now()
  const expired = new Date(now - 48 * 60 * 60 * 1000)
  const recent = new Date(now - 60 * 60 * 1000)
  await Promise.all([
    utimes(stalePath, expired, expired),
    utimes(unmatchedPath, expired, expired),
    utimes(freshPath, recent, recent),
  ])

  const result = await cleanStaleUpdateOperationDirectories(layout, { now })
  assert.deepEqual(result, { removed: [staleId], deferred: false })
  await assert.rejects(lstat(stalePath), { code: 'ENOENT' })
  assert.equal((await lstat(freshPath)).isDirectory(), true)
  assert.equal((await lstat(unmatchedPath)).isDirectory(), true)
  assert.equal((await lstat(linkPath)).isSymbolicLink(), true)
  assert.equal(await readFile(path.join(externalPath, 'keep.txt'), 'utf8'), 'outside')

  const journalId = '44444444-4444-4444-8444-444444444444'
  const journalPath = path.join(layout.updateDir, journalId)
  await mkdir(journalPath)
  await utimes(journalPath, expired, expired)
  await mkdir(path.dirname(layout.updateJournal), { recursive: true })
  await writeFile(layout.updateJournal, JSON.stringify({ operationId: journalId, phase: 'testing' }))
  assert.deepEqual(await cleanStaleUpdateOperationDirectories(layout, { now }), { removed: [], deferred: false })
  assert.equal((await lstat(journalPath)).isDirectory(), true, 'a pending rollback journal owns its operation directory')
})

async function makeUpdateFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-transaction-'))
  const layout = layoutForRoot(root)
  const stagedRoot = path.join(root, '.dsh-portable-update', 'fixture', 'staged')
  const dshRelative = path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  await mkdir(path.join(layout.appDir, path.dirname(dshRelative)), { recursive: true })
  await mkdir(path.join(stagedRoot, 'app', path.dirname(dshRelative)), { recursive: true })
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await mkdir(path.join(stagedRoot, 'licenses'), { recursive: true })
  await mkdir(layout.dataDir, { recursive: true })
  await writeFile(path.join(layout.appDir, dshRelative), 'old app')
  await writeFile(path.join(stagedRoot, 'app', dshRelative), 'new app')
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
    portableVersion: '0.1.0-rc.6-portable.5', dshVersion: '0.1.0-rc.6', dshCommit: 'a'.repeat(40),
    releaseChannel: 'candidate', platform: 'windows-x64', nodeVersion: '24.19.0', updaterSchema: 1, shellSchema: 1,
  })}\n`)
  await writeFile(path.join(stagedRoot, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
    portableVersion: '0.1.0-rc.7-portable.1', dshVersion: '0.1.0-rc.7', dshCommit: 'b'.repeat(40),
    releaseChannel: 'candidate', platform: 'windows-x64', nodeVersion: '24.19.0', updaterSchema: 1, shellSchema: 1,
  })}\n`)
  await writeFile(path.join(root, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'old license\n')
  await writeFile(path.join(stagedRoot, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'new license\n')
  await writeFile(path.join(root, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'old notices\n')
  await writeFile(path.join(stagedRoot, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'new notices\n')
  await writeFile(path.join(root, 'licenses', 'dsh-market-LICENSE.txt'), 'old market license\n')
  await writeFile(path.join(stagedRoot, 'licenses', 'dsh-market-LICENSE.txt'), 'new market license\n')
  await writeFile(path.join(root, 'licenses', 'pnpm-LICENSE.txt'), 'old pnpm license\n')
  await writeFile(path.join(stagedRoot, 'licenses', 'pnpm-LICENSE.txt'), 'new pnpm license\n')
  await writeFile(path.join(stagedRoot, 'component.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'dsh-app',
    portableVersion: '0.1.0-rc.7-portable.1',
    releaseChannel: 'candidate',
    dshVersion: '0.1.0-rc.7',
    dshCommit: 'b'.repeat(40),
  })}\n`)
  await writeFile(path.join(layout.dataDir, 'private-session.txt'), 'keep me')
  return { dshRelative, layout, root, stagedRoot }
}

async function makeCapsuleUpdateFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-capsule-update-'))
  const runtimeRoot = path.join(root, 'machine-cache', 'old-runtime')
  const layout = layoutForRoot(root, process.platform, root, runtimeRoot)
  const stagedRoot = path.join(root, '.dsh-portable-update', 'capsule-fixture', 'staged')
  const oldCapsule = Buffer.from('old capsule')
  const newCapsule = Buffer.from('new capsule')
  await mkdir(path.join(root, 'runtime'), { recursive: true })
  await mkdir(path.join(stagedRoot, 'runtime'), { recursive: true })
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await mkdir(path.join(stagedRoot, 'licenses'), { recursive: true })
  await mkdir(layout.dataDir, { recursive: true })
  const capsuleManifest = (bytes) => ({
    schemaVersion: 1,
    filename: 'runtime/DSH-App.dshpack',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    required: ['package.json'],
  })
  await writeFile(path.join(root, 'runtime', 'DSH-App.dshpack'), oldCapsule)
  await writeFile(path.join(root, 'runtime-capsule.json'), `${JSON.stringify(capsuleManifest(oldCapsule))}\n`)
  await writeFile(path.join(stagedRoot, 'runtime', 'DSH-App.dshpack'), newCapsule)
  await writeFile(path.join(stagedRoot, 'runtime-capsule.json'), `${JSON.stringify(capsuleManifest(newCapsule))}\n`)
  const components = (version, dshVersion, commit) => ({
    portableVersion: version,
    dshVersion,
    dshCommit: commit,
    releaseChannel: 'candidate',
    platform: 'windows-x64',
    nodeVersion: '24.19.0',
    updaterSchema: 1,
    shellSchema: 21,
    runtimeLayout: 'capsule-v1',
  })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), `${JSON.stringify(components('0.5.0-rc.1', '0.1.1-rc.2', 'a'.repeat(40)))}\n`)
  await writeFile(path.join(stagedRoot, 'licenses', 'COMPONENTS.json'), `${JSON.stringify(components('0.5.0-rc.2', '0.1.1-rc.3', 'b'.repeat(40)))}\n`)
  for (const name of ['DeepSeek-Harness-LICENSE.txt', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md', 'dsh-market-LICENSE.txt', 'pnpm-LICENSE.txt']) {
    await writeFile(path.join(root, 'licenses', name), `old ${name}\n`)
    await writeFile(path.join(stagedRoot, 'licenses', name), `new ${name}\n`)
  }
  await writeFile(path.join(stagedRoot, 'component.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'dsh-runtime-capsule',
    portableVersion: '0.5.0-rc.2',
    releaseChannel: 'candidate',
    dshVersion: '0.1.1-rc.3',
    dshCommit: 'b'.repeat(40),
  })}\n`)
  await writeFile(path.join(layout.dataDir, 'private-session.txt'), 'keep me')
  return { layout, root, stagedRoot, oldCapsule, newCapsule }
}

test('compact runtime update swaps only the capsule and preserves portable data', async () => {
  const fixture = await makeCapsuleUpdateFixture()
  try {
    const result = await applyStagedCapsuleUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => true,
    })
    assert.equal(result.status, 'updated')
    assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), fixture.newCapsule)
    assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8')).runtimeLayout, 'capsule-v1')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('failed compact runtime health check restores the prior capsule and metadata', async () => {
  const fixture = await makeCapsuleUpdateFixture()
  try {
    const progress = []
    await assert.rejects(applyStagedCapsuleUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => false,
      onProgress: (event) => progress.push(event.phase),
    }), /rolled back/i)
    assert.deepEqual(progress, ['installing', 'validating', 'rolling-back', 'rollback-complete'])
    assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), fixture.oldCapsule)
    assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8')).portableVersion, '0.5.0-rc.1')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('app update commits only replaceable files and preserves portable user data', async () => {
  const fixture = await makeUpdateFixture()
  try {
    const result = await applyStagedAppUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => true,
    })
    assert.equal(result.status, 'updated')
    assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'new app')
    assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8')).portableVersion, '0.1.0-rc.7-portable.1')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'utf8'), 'new license\n')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'utf8'), 'new notices\n')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'dsh-market-LICENSE.txt'), 'utf8'), 'new market license\n')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'pnpm-LICENSE.txt'), 'utf8'), 'new pnpm license\n')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
    await assert.rejects(readFile(fixture.layout.updateJournal, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('app compatibility preflight fails before any installed file or journal is changed', async () => {
  const fixture = await makeUpdateFixture()
  try {
    const progress = []
    await assert.rejects(applyStagedAppUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => true,
      preflight: async ({ metadata, stagedRoot }) => {
        assert.equal(metadata.dshVersion, '0.1.0-rc.7')
        assert.equal(stagedRoot, fixture.stagedRoot)
        assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
        await assert.rejects(readFile(fixture.layout.updateJournal, 'utf8'), { code: 'ENOENT' })
        throw new Error('existing profile does not compose')
      },
      onProgress: (event) => progress.push(event.phase),
    }), /existing profile does not compose/i)
    assert.deepEqual(progress, ['preflighting'])
    assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
    assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8')).portableVersion, '0.1.0-rc.6-portable.5')
    await assert.rejects(readFile(fixture.layout.updateJournal, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('compact runtime compatibility preflight fails before its capsule is replaced', async () => {
  const fixture = await makeCapsuleUpdateFixture()
  try {
    const progress = []
    await assert.rejects(applyStagedCapsuleUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => true,
      preflight: async ({ metadata }) => {
        assert.equal(metadata.kind, 'dsh-runtime-capsule')
        assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), fixture.oldCapsule)
        throw new Error('existing profile does not compose')
      },
      onProgress: (event) => progress.push(event.phase),
    }), /existing profile does not compose/i)
    assert.deepEqual(progress, ['preflighting'])
    assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), fixture.oldCapsule)
    await assert.rejects(readFile(fixture.layout.updateJournal, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('failed health check restores the prior app and metadata without touching data', async () => {
  const fixture = await makeUpdateFixture()
  try {
    await assert.rejects(applyStagedAppUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => false,
    }), /rolled back/i)
    assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
    assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8')).portableVersion, '0.1.0-rc.6-portable.5')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'utf8'), 'old license\n')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'utf8'), 'old notices\n')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'dsh-market-LICENSE.txt'), 'utf8'), 'old market license\n')
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'pnpm-LICENSE.txt'), 'utf8'), 'old pnpm license\n')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('staged component metadata must agree before any installed file is replaced', async () => {
  const fixture = await makeUpdateFixture()
  try {
    const componentsFile = path.join(fixture.stagedRoot, 'licenses', 'COMPONENTS.json')
    const components = JSON.parse(await readFile(componentsFile, 'utf8'))
    components.dshVersion = '0.1.0-rc.999'
    await writeFile(componentsFile, `${JSON.stringify(components)}\n`)
    await assert.rejects(applyStagedAppUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => true,
    }), /metadata/i)
    assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
    await assert.rejects(readFile(fixture.layout.updateJournal, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('an interrupted swap can be rolled back from its durable journal', async () => {
  const fixture = await makeUpdateFixture()
  try {
    await assert.rejects(applyStagedAppUpdate({
      layout: fixture.layout,
      stagedRoot: fixture.stagedRoot,
      healthCheck: async () => {
        const journal = JSON.parse(await readFile(fixture.layout.updateJournal, 'utf8'))
        journal.phase = 'testing'
        await writeFile(fixture.layout.updateJournal, `${JSON.stringify(journal)}\n`)
        throw Object.assign(new Error('simulated power loss'), { leavePending: true })
      },
    }), /simulated power loss/)
    let stoppedBeforeRestore = false
    const restored = await rollbackPendingAppUpdate(fixture.layout, {
      beforeRestore: async () => {
        assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'new app')
        stoppedBeforeRestore = true
      },
    })
    assert.equal(restored.status, 'rolled-back')
    assert.equal(stoppedBeforeRestore, true)
    assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'old app')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})


test('Portable catalog filters channels and keeps exact approved version URLs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-product-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  const installed = { portableVersion: '0.6.6', releaseChannel: 'stable', dshVersion: '0.1.3-alpha.2', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0' }
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify(installed))
  const platform = platformUpdateKey(process.platform, process.arch)
  const entry = version => ({ version,
    manifestUrl: `https://github.com/WSL043/DSH-Portable/releases/download/update-channel-candidate/portable-update-${platform}-${version}.json`,
    manifest: updateManifest({ portableVersion: version, releaseChannel: version.includes('-') ? 'candidate' : 'stable', platform }),
  })
  const catalog = { schemaVersion: 1, releaseChannel: 'stable', versions: [entry('0.6.5-rc.1'), entry('0.6.5')] }
  const options = { layout, fetchImpl: async () => new Response(JSON.stringify(catalog)) }
  const result = await listProductVersions(options)
  assert.deepEqual(result.versions.map(item => item.version), ['0.6.5'])
  assert.equal(result.versions[0].manifestUrl, entry('0.6.5').manifestUrl)
  assert.equal(evaluateUpdate(entry('0.6.5').manifest, installed, platform).status, 'current', 'automatic checks never downgrade')
  assert.equal(evaluateUpdate(entry('0.6.5').manifest, installed, platform, { allowProductVersionChange: true }).status, 'available', 'explicit approved selection can change versions')
  catalog.versions[0].manifestUrl = 'https://example.invalid/portable-update.json'
  await assert.rejects(listProductVersions(options), /Untrusted Portable/)
})

test('selected Portable version must match the downloaded manifest', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-product-selection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ portableVersion: '0.6.4', dshVersion: '0.1.2-rc.1', updaterSchema: 1, shellSchema: 1, nodeVersion: '24.19.0' }))
  const result = await checkForUpdate({ layout: layoutForRoot(root), manifestUrl: 'https://example.invalid/selected.json', releaseChannel: 'candidate', force: true,
    expectedProductVersion: '0.6.5-rc.1', allowProductVersionChange: true,
    fetchImpl: async () => new Response(JSON.stringify(updateManifest({ portableVersion: '0.6.6', releaseChannel: 'stable' }))) })
  assert.equal(result.status, 'unavailable')
  assert.match(result.message, /Selected Portable version/)
})

test('shared catalog reader normalizes legacy preferences and explicit aliases to stable', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-catalog-service-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const baseStateRoot = path.join(root, 'state')
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await mkdir(path.join(baseStateRoot, 'data'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ portableVersion: '0.6.8', dshVersion: '0.1.5-rc.2' }))
  const urls = []
  const options = { root, baseStateRoot, scope: 'engine', fetchImpl: async url => { urls.push(String(url)); return new Response('', { status: 404 }) } }
  assert.equal((await listInstalledVersions(options)).releaseChannel, 'stable')
  await writeFile(path.join(baseStateRoot, 'data', 'launcher-settings.json'), JSON.stringify({ updateChannel: 'candidate' }))
  assert.equal((await listInstalledVersions(options)).releaseChannel, 'stable')
  assert.equal((await listInstalledVersions({ ...options, releaseChannel: 'candidate' })).releaseChannel, 'stable')
  assert.match(urls[1], /update-channel-core-stable/)
  assert.match(urls[2], /update-channel-core-stable/)
  await writeFile(path.join(baseStateRoot, 'data', 'launcher-settings.json'), '{incomplete')
  assert.equal((await listInstalledVersions(options)).releaseChannel, 'stable')
  await assert.rejects(listInstalledVersions({ ...options, scope: 'arbitrary' }), /Unsupported update scope/)
})

test('candidate CLI aliases and prerelease shells still use stable core catalogs', () => {
  const legacyAlias = defaultEngineUpdateIndexUrl('candidate', 'win32', 'x64', '0.6.5-rc.2')
  const stableRoute = 'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-stable-0.6.5-rc.2/dsh-core-index-windows-x64.json'
  assert.equal(legacyAlias, stableRoute)
  assert.equal(defaultEngineUpdateManifestUrl('candidate', 'win32', 'x64', '0.6.5-rc.2'), 'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-stable-0.6.5-rc.2/dsh-core-update-windows-x64.json')
  assert.equal(defaultEngineUpdateIndexUrl('candidate', 'win32', 'x64', '0.6.4'), defaultEngineUpdateIndexUrl('stable', 'win32', 'x64', '0.6.4'))
  assert.throws(() => defaultEngineUpdateIndexUrl('candidate', 'win32', 'x64', '../other'))
})

test('oversized engine catalogs are still rejected', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-core-catalog-window-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ portableVersion: '0.8.3', releaseChannel: 'candidate', dshVersion: '0.2.0-rc.2' }))
  const fetchImpl = async () => new Response(JSON.stringify({ schemaVersion: 1, versions: Array.from({ length: 21 }, () => ({})) }))
  await assert.rejects(listEngineVersions({ layout, fetchImpl }), /Unsupported engine version catalog/)
})

test('an unpublished default core catalog is distinct from a broken explicit URL', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-pending-core-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ portableVersion: '0.6.5-rc.2', releaseChannel: 'candidate', dshVersion: '0.1.3-alpha.2' }))
  const fetchImpl = async () => new Response('', { status: 404 })
  const result = await listEngineVersions({ layout, fetchImpl })
  assert.equal(result.status, 'channel-unpublished')
  assert.deepEqual(result.versions, [])
  await assert.rejects(listEngineVersions({ layout, fetchImpl, indexUrl: 'https://example.com/broken.json' }), /HTTP 404/)
  assert.deepEqual((await listProductVersions({ layout, fetchImpl })).versions, [])
  await assert.rejects(listProductVersions({ layout, fetchImpl, indexUrl: 'https://example.com/broken.json' }), /HTTP 404/)
})

test('catalog size limit stops a chunked response before the server finishes sending', { timeout: 3000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bounded-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  await mkdir(path.join(root, 'licenses'), { recursive: true })
  await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), JSON.stringify({ portableVersion: '0.6.7', dshVersion: '0.1.5-rc.2', releaseChannel: 'stable' }))
  for (const headers of [{}, { 'content-length': '1' }]) {
    let cancelled = false
    let signal
    const fetchImpl = async (_url, options) => {
      signal = options.signal
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(256 * 1024))
          controller.enqueue(new Uint8Array(1))
          // Deliberately never close: the client must stop reading on overflow.
        },
        cancel() { cancelled = true },
      }), { headers })
    }
    await assert.rejects(listEngineVersions({ layout, fetchImpl }), /Update manifest is too large/)
    assert.equal(cancelled, true)
    assert.equal(signal.aborted, true)
  }
  const json = JSON.stringify({ schemaVersion: 1, versions: [] })
  assert.deepEqual((await listEngineVersions({ layout, fetchImpl: async () => new Response(json.padEnd(256 * 1024, ' ')) })).versions, [])
})

for (const phase of ['prepared', 'manifest-backed-up', 'runtime-backed-up', 'testing', 'manifest-restored']) {
  test(`capsule recovery preserves originals across interrupted steps: ${phase}`, async t => {
    const fixture = await makeCapsuleUpdateFixture()
    t.after(() => rm(fixture.root, { recursive: true, force: true }))
    const { layout, root, oldCapsule, newCapsule } = fixture
    const backup = path.join(layout.updateDir, 'interrupted', 'backup')
    await mkdir(backup, { recursive: true })
    const manifest = path.join(root, 'runtime-capsule.json')
    const capsule = path.join(root, 'runtime', 'DSH-App.dshpack')
    const originalManifest = await readFile(manifest)
    const originalComponents = await readFile(path.join(root, 'licenses', 'COMPONENTS.json'))
    if (phase !== 'prepared') await rename(manifest, path.join(backup, 'runtime-capsule.json'))
    if (!['prepared', 'manifest-backed-up'].includes(phase)) await rename(capsule, path.join(backup, 'DSH-App.dshpack'))
    if (['testing', 'manifest-restored'].includes(phase)) {
      await copyFile(path.join(fixture.stagedRoot, 'runtime-capsule.json'), manifest)
      await writeFile(capsule, newCapsule)
    }
    if (phase === 'manifest-restored') {
      await rm(manifest)
      await rename(path.join(backup, 'runtime-capsule.json'), manifest)
    }
    await mkdir(path.dirname(layout.updateJournal), { recursive: true })
    await writeFile(layout.updateJournal, JSON.stringify({ schemaVersion: 1, operationId: 'interrupted', kind: 'dsh-runtime-capsule', phase: 'prepared', hadLicenses: ['COMPONENTS.json','DeepSeek-Harness-LICENSE.txt','DeepSeek-Harness-THIRD_PARTY_NOTICES.md','dsh-market-LICENSE.txt','pnpm-LICENSE.txt'] }))
    assert.equal((await rollbackPendingAppUpdate(layout)).status, 'rolled-back')
    assert.deepEqual(await readFile(capsule), oldCapsule)
    assert.deepEqual(await readFile(manifest), originalManifest)
    assert.deepEqual(await readFile(path.join(root,'licenses','COMPONENTS.json')), originalComponents)
    assert.equal(await readFile(path.join(layout.dataDir,'private-session.txt'),'utf8'), 'keep me')
    assert.equal((await rollbackPendingAppUpdate(layout)).status, 'none')
  })
}

test('recovery rejects parent operation IDs without touching data or deleting the journal', async t => {
  const fixture = await makeCapsuleUpdateFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  for (const operationId of ['.', '..']) {
    const journal = JSON.stringify({schemaVersion:1, operationId, phase:'committed'})
    await mkdir(path.dirname(fixture.layout.updateJournal), { recursive: true })
    await writeFile(fixture.layout.updateJournal, journal)
    await assert.rejects(rollbackPendingAppUpdate(fixture.layout), /journal is invalid/)
    assert.equal(await readFile(fixture.layout.updateJournal,'utf8'), journal)
    assert.equal(await readFile(path.join(fixture.layout.dataDir,'private-session.txt'),'utf8'), 'keep me')
  }
})

const contractInstalled = { portableVersion: '0.9.2', dshVersion: '0.2.0', releaseChannel: 'stable', updaterSchema: 1, shellSchema: 25,
  shellFingerprint: 'a'.repeat(64), shellContract: 3, nodeVersion: '24.19.0', runtimeLayout: 'capsule-v1' }
const contractManifest = (overrides = {}) => engineUpdateManifest({
  portableVersion: '0.9.7', requiredShellSchema: 25, requiredShellFingerprint: 'b'.repeat(64), requiredShellContract: 3,
  targetRuntimeLayout: 'capsule-v1',
  component: { ...engineUpdateManifest().component, kind: 'dsh-runtime-capsule', dshVersion: '0.2.4', runtimeLayout: 'capsule-v1' },
  ...overrides,
})

test('a core built for the same shell contract is accepted by an older Portable with another fingerprint', () => {
  const result = evaluateUpdate(contractManifest(), contractInstalled, 'windows-x64', { allowEngineVersionChange: true })
  assert.equal(result.status, 'available')
  assert.equal(result.requiredShellContract, 3)
  // The same package without a contract is still bound to one exact shell.
  const legacy = contractManifest()
  delete legacy.requiredShellContract
  assert.equal(evaluateUpdate(legacy, contractInstalled, 'windows-x64', { allowEngineVersionChange: true }).status, 'core-incompatible')
})

test('a core for a newer contract needs a Portable update, an older one is not offered', () => {
  const options = { allowEngineVersionChange: true }
  assert.equal(evaluateUpdate(contractManifest({ requiredShellContract: 4 }), contractInstalled, 'windows-x64', options).status, 'core-incompatible')
  assert.equal(evaluateUpdate(contractManifest({ requiredShellContract: 2 }), contractInstalled, 'windows-x64', options).status, 'core-awaiting-qualification')
  assert.throws(() => evaluateUpdate(contractManifest({ requiredShellContract: 0 }), contractInstalled, 'windows-x64', options), /shell contract/iu)
  assert.throws(() => evaluateUpdate(contractManifest({ requiredShellContract: '3' }), contractInstalled, 'windows-x64', options), /shell contract/iu)
})

test('the contract does not replace the Node, layout and update-machinery requirements', () => {
  const options = { allowEngineVersionChange: true }
  assert.equal(evaluateUpdate(contractManifest({ requiredShellSchema: 26 }), contractInstalled, 'windows-x64', options).status, 'full-package-required')
  assert.equal(evaluateUpdate(contractManifest({ component: { ...contractManifest().component, requiredNodeVersion: '25.0.0' } }), contractInstalled, 'windows-x64', options).status, 'full-package-required')
  assert.equal(evaluateUpdate(contractManifest(), { ...contractInstalled, runtimeLayout: 'expanded-v1' }, 'windows-x64', options).status, 'full-package-required')
})

test('the installed state carries the shell contract, and 0 for a shell that predates it', async () => {
  const fixture = await makeCapsuleUpdateFixture()
  try {
    assert.equal((await readInstalledUpdateState(fixture.layout)).shellContract, 0)
    const file = path.join(fixture.root, 'licenses', 'COMPONENTS.json')
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), shellContract: 3 }))
    assert.equal((await readInstalledUpdateState(fixture.layout)).shellContract, 3)
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

async function contractUpdateFixture({ stagedContract = 3 } = {}) {
  const fixture = await makeCapsuleUpdateFixture()
  const patch = async (file, change) => writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), ...change }))
  await patch(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), { shellContract: 3, shellFingerprint: 'a'.repeat(64), releaseChannel: 'stable', pnpmVersion: '10.0.0', defaultPlugins: [{ package: 'dsh-image-viewer', version: '0.1.13' }] })
  await patch(path.join(fixture.stagedRoot, 'licenses', 'COMPONENTS.json'), { shellContract: stagedContract, shellFingerprint: 'b'.repeat(64), releaseChannel: 'stable', pnpmVersion: '10.1.0', defaultPlugins: [{ package: 'dsh-image-viewer', version: '0.1.15' }] })
  await patch(path.join(fixture.stagedRoot, 'component.json'), { releaseChannel: 'stable' })
  const update = {
    status: 'available', latest: '0.5.0-rc.2', releaseChannel: 'stable', platform: 'windows-x64', minimumUpdaterSchema: 1,
    requiredShellSchema: 21, requiredShellContract: 3, requiredShellFingerprint: 'b'.repeat(64),
    component: { kind: 'dsh-runtime-capsule', dshVersion: '0.1.1-rc.3', dshCommit: 'b'.repeat(40), requiredNodeVersion: '24.19.0', bytes: 4, sha256: 'c'.repeat(64), urls: ['https://example.invalid/x'] },
  }
  const install = (extra = {}) => installAvailableAppUpdate({
    layout: fixture.layout, update, healthCheck: async () => true, cleanOperationDirectories: async () => {},
    download: async () => {}, extract: async (_archive, destination) => cp(fixture.stagedRoot, destination, { recursive: true }),
    ...extra,
  })
  return { fixture, update, install }
}

test('a core qualified on another Portable version replaces the runtime but keeps the installed shell identity', async () => {
  const { fixture, install } = await contractUpdateFixture()
  try {
    const result = await install()
    assert.equal(result.status, 'updated')
    assert.equal(result.portableVersion, '0.5.0-rc.1', 'the shell version is the installed one, not the one the core was qualified on')
    const components = JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8'))
    assert.equal(components.dshVersion, '0.1.1-rc.3')
    assert.equal(components.portableVersion, '0.5.0-rc.1')
    assert.equal(components.shellFingerprint, 'a'.repeat(64))
    assert.equal(components.shellContract, 3)
    assert.equal(components.pnpmVersion, '10.1.0', 'runtime facts come from the new capsule')
    assert.deepEqual(components.defaultPlugins, [{ package: 'dsh-image-viewer', version: '0.1.13' }],
      'the default plugin archives sit beside the installed launcher, so its list stays')
    assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), fixture.newCapsule)
    assert.equal((await readInstalledUpdateState(fixture.layout)).portableVersion, '0.5.0-rc.1')
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

test('a rolled-back core update leaves the shell identity untouched too', async () => {
  const { fixture, install } = await contractUpdateFixture()
  try {
    await assert.rejects(install({ healthCheck: async () => false }), /rolled back/u)
    const components = JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8'))
    assert.equal(components.dshVersion, '0.1.1-rc.2')
    assert.equal(components.portableVersion, '0.5.0-rc.1')
    assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), fixture.oldCapsule)
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})

test('a package whose own contract disagrees with its manifest is refused before anything is replaced', async () => {
  const { fixture, install } = await contractUpdateFixture({ stagedContract: 2 })
  try {
    await assert.rejects(install(), /shell contract/iu)
    assert.deepEqual(await readFile(path.join(fixture.root, 'runtime', 'DSH-App.dshpack')), fixture.oldCapsule)
    assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'licenses', 'COMPONENTS.json'), 'utf8')).dshVersion, '0.1.1-rc.2')
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
})
