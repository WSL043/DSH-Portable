import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import {
  applyStagedAppUpdate,
  checkForUpdate,
  comparePortableVersions,
  deferUpdate,
  downloadVerifiedComponent,
  evaluateUpdate,
  extractUpdateArchive,
  ignoreUpdate,
  installAvailableAppUpdate,
  platformUpdateKey,
  rollbackPendingAppUpdate,
  validateArchiveEntries,
} from '../launcher/update-core.mjs'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')

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

test('portable preview versions compare monotonically without lexical mistakes', () => {
  assert.equal(comparePortableVersions('0.1.0-rc.6-portable.5', '0.1.0-rc.6-portable.5'), 0)
  assert.equal(comparePortableVersions('0.1.0-rc.6-portable.5', '0.1.0-rc.6-portable.10'), -1)
  assert.equal(comparePortableVersions('0.1.0-rc.6-portable.10', '0.1.0-rc.7-portable.1'), -1)
  assert.equal(comparePortableVersions('0.1.0-rc.9-portable.8', '0.1.0-rc.10-portable.1'), -1)
  assert.equal(comparePortableVersions('0.1.0', '0.1.0-rc.99-portable.99'), 1)
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
  assert.equal(evaluateUpdate(updateManifest(), installed, 'windows-x64').status, 'available')
  assert.equal(evaluateUpdate(updateManifest({ portableVersion: installed.portableVersion }), installed, 'windows-x64').status, 'current')
  assert.equal(evaluateUpdate(updateManifest({ minimumUpdaterSchema: 2 }), installed, 'windows-x64').status, 'full-package-required')
  assert.equal(evaluateUpdate(updateManifest({ requiredShellSchema: 2 }), installed, 'windows-x64').status, 'full-package-required')
  assert.equal(evaluateUpdate(updateManifest({
    component: { ...updateManifest().component, requiredNodeVersion: '25.0.0' },
  }), installed, 'windows-x64').status, 'full-package-required')
  assert.equal(evaluateUpdate(updateManifest(), installed, 'macos-arm64').status, 'wrong-platform')
  assert.equal(evaluateUpdate(updateManifest(), { ...installed, updaterSchema: undefined }, 'windows-x64').status, 'full-package-required')
  const missingCompatibility = updateManifest()
  delete missingCompatibility.minimumUpdaterSchema
  assert.throws(() => evaluateUpdate(missingCompatibility, installed, 'windows-x64'), /compatibility/i)
})

test('platform update keys are explicit and unsupported targets fail closed', () => {
  assert.equal(platformUpdateKey('win32', 'x64'), 'windows-x64')
  assert.equal(platformUpdateKey('darwin', 'arm64'), 'macos-arm64')
  assert.equal(platformUpdateKey('darwin', 'x64'), 'macos-x64')
  assert.equal(platformUpdateKey('linux', 'arm64'), 'linux-arm64')
  assert.equal(platformUpdateKey('linux', 'x64'), 'linux-x64')
  assert.throws(() => platformUpdateKey('linux', 'ia32'), /unsupported/i)
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
  const chunks = [Buffer.from('sl'), Buffer.from('ow'), Buffer.from('!')]
  const bytes = Buffer.concat(chunks)
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
        }, 15)
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
      timeoutMs: 25,
    })
    assert.equal(result.bytes, bytes.length)
    assert.deepEqual(await readFile(output), bytes)
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
    'licenses/pnpm-LICENSE.txt',
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
    const result = await installAvailableAppUpdate({
      layout: fixture.layout,
      update,
      allowHttp: true,
      healthCheck: async () => true,
      extract: (filename, destination) => extractUpdateArchive(filename, destination, { windowsExtractor: extractor }),
    })
    assert.equal(result.status, 'updated')
    assert.equal(await readFile(path.join(fixture.layout.appDir, fixture.dshRelative), 'utf8'), 'new app')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    await rm(fixture.root, { recursive: true, force: true })
  }
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
    platform: 'windows-x64', nodeVersion: '24.19.0', updaterSchema: 1, shellSchema: 1,
  })}\n`)
  await writeFile(path.join(stagedRoot, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
    portableVersion: '0.1.0-rc.7-portable.1', dshVersion: '0.1.0-rc.7', dshCommit: 'b'.repeat(40),
    platform: 'windows-x64', nodeVersion: '24.19.0', updaterSchema: 1, shellSchema: 1,
  })}\n`)
  await writeFile(path.join(root, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'old license\n')
  await writeFile(path.join(stagedRoot, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'new license\n')
  await writeFile(path.join(root, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'old notices\n')
  await writeFile(path.join(stagedRoot, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'new notices\n')
  await writeFile(path.join(root, 'licenses', 'pnpm-LICENSE.txt'), 'old pnpm license\n')
  await writeFile(path.join(stagedRoot, 'licenses', 'pnpm-LICENSE.txt'), 'new pnpm license\n')
  await writeFile(path.join(stagedRoot, 'component.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'dsh-app',
    portableVersion: '0.1.0-rc.7-portable.1',
    dshVersion: '0.1.0-rc.7',
    dshCommit: 'b'.repeat(40),
  })}\n`)
  await writeFile(path.join(layout.dataDir, 'private-session.txt'), 'keep me')
  return { dshRelative, layout, root, stagedRoot }
}

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
    assert.equal(await readFile(path.join(fixture.root, 'licenses', 'pnpm-LICENSE.txt'), 'utf8'), 'new pnpm license\n')
    assert.equal(await readFile(path.join(fixture.layout.dataDir, 'private-session.txt'), 'utf8'), 'keep me')
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
