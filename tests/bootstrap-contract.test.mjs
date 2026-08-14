import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const source = path.join(projectRoot, 'launcher', 'windows', 'DSH-Bootstrap.cs')

function cscPath() {
  const windows = process.env.WINDIR || 'C:\\Windows'
  return path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
}

async function compileBootstrap(output) {
  await execFileAsync(cscPath(), [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    '/reference:System.Net.Http.dll', '/reference:System.Runtime.Serialization.dll',
    `/out:${output}`,
    source,
  ])
}

async function makeFixture(root) {
  const packageRoot = path.join(root, 'payload', 'DSH-Portable')
  await mkdir(path.join(packageRoot, 'runtime', 'node'), { recursive: true })
  await mkdir(path.join(packageRoot, 'app'), { recursive: true })
  await mkdir(path.join(packageRoot, 'data'), { recursive: true })
  await mkdir(path.join(packageRoot, 'workspace'), { recursive: true })
  await writeFile(path.join(packageRoot, 'DeepSeek-Herness.exe'), 'fixture launcher')
  await writeFile(path.join(packageRoot, 'runtime', 'node', 'node.exe'), 'fixture node')
  await writeFile(path.join(packageRoot, 'app', 'package.json'), '{"name":"fixture"}\n')
  await writeFile(path.join(packageRoot, 'data', 'README.txt'), 'portable data')
  const archive = path.join(root, 'payload.zip')
  await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', path.join(root, 'payload'), 'DSH-Portable'])
  const bytes = await readFile(archive)
  return {
    archive,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function withFixtureServer(fixture, callback) {
  let archiveRequests = 0
  let manifest = null
  const server = createServer((request, response) => {
    if (request.url === '/payload.zip') {
      archiveRequests += 1
      response.writeHead(200, { 'content-type': 'application/zip', 'content-length': fixture.bytes.length })
      response.end(fixture.bytes)
      return
    }
    if (request.url === '/portable-manifest.json') {
      const body = Buffer.from(JSON.stringify(manifest), 'utf8')
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length })
      response.end(body)
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  manifest = {
    schemaVersion: 1,
    version: 'test-portable',
    payloads: {
      windowsX64: {
        filename: 'payload.zip',
        url: `${origin}/payload.zip`,
        sha256: fixture.sha256,
        bytes: fixture.bytes.length,
      },
    },
  }
  try {
    return await callback({
      archiveRequests: () => archiveRequests,
      manifest,
      manifestUrl: `${origin}/portable-manifest.json`,
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('the recommended Windows bootstrap stays genuinely small', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-size-'))
  try {
    const executable = path.join(root, 'DSH-Portable-windows-x64.exe')
    await compileBootstrap(executable)
    assert.ok((await stat(executable)).size < 1024 * 1024, 'bootstrap must remain below 1 MiB')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bootstrap installs atomically, verifies the payload, and reuses it offline', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-flow-'))
  try {
    const executable = path.join(root, 'bootstrap.exe')
    const resultFile = path.join(root, 'result.json')
    const destination = path.join(root, 'chosen-parent', 'DSH-Portable')
    const fixture = await makeFixture(root)
    await compileBootstrap(executable)

    await withFixtureServer(fixture, async ({ archiveRequests, manifestUrl }) => {
      await execFileAsync(executable, [
        '--manifest', manifestUrl,
        '--destination', destination,
        '--allow-http',
        '--no-launch',
        '--result', resultFile,
      ])
      assert.equal(archiveRequests(), 1)
      const result = JSON.parse(await readFile(resultFile, 'utf8'))
      assert.equal(result.status, 'installed')
      assert.equal(result.version, 'test-portable')
      assert.equal(await readFile(path.join(destination, 'data', 'README.txt'), 'utf8'), 'portable data')
      assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"fixture"}\n')

      await rm(fixture.archive, { force: true })
      await execFileAsync(executable, [
        '--manifest', 'http://127.0.0.1:1/unreachable.json',
        '--destination', destination,
        '--allow-http',
        '--no-launch',
        '--result', resultFile,
      ])
      const reused = JSON.parse(await readFile(resultFile, 'utf8'))
      assert.equal(reused.status, 'ready')
      assert.equal(archiveRequests(), 1, 'an installed portable folder must not need the network')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bootstrap never commits a payload whose digest is wrong', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-digest-'))
  try {
    const executable = path.join(root, 'bootstrap.exe')
    const resultFile = path.join(root, 'result.json')
    const destination = path.join(root, 'DSH-Portable')
    const fixture = await makeFixture(root)
    await compileBootstrap(executable)

    await withFixtureServer(fixture, async ({ manifest, manifestUrl }) => {
      manifest.payloads.windowsX64.sha256 = '0'.repeat(64)
      await assert.rejects(execFileAsync(executable, [
        '--manifest', manifestUrl,
        '--destination', destination,
        '--allow-http',
        '--no-launch',
        '--result', resultFile,
      ]))
      const failed = JSON.parse(await readFile(resultFile, 'utf8'))
      assert.equal(failed.status, 'failed')
      await assert.rejects(stat(destination))
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
