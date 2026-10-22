import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const bootstrapSource = path.join(projectRoot, 'launcher', 'windows', 'DSH-Bootstrap.cs')

function cscPath() {
  const windows = process.env.WINDIR || 'C:\\Windows'
  return path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
}

async function compileBootstrap(output, source = bootstrapSource) {
  await execFileAsync(cscPath(), [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    '/reference:System.Net.Http.dll', '/reference:System.Runtime.Serialization.dll',
    '/reference:System.IO.Compression.dll',
    `/out:${output}`,
    source,
  ])
}

async function makePayload(root, version) {
  const packageRoot = path.join(root, 'payload', 'DSH-Portable')
  await mkdir(path.join(packageRoot, 'runtime', 'node'), { recursive: true })
  await mkdir(path.join(packageRoot, 'app'), { recursive: true })
  await mkdir(path.join(packageRoot, 'licenses'), { recursive: true })
  await mkdir(path.join(packageRoot, 'data'), { recursive: true })
  await mkdir(path.join(packageRoot, 'workspace'), { recursive: true })
  await writeFile(path.join(packageRoot, 'DeepSeek-Herness.exe'), 'new launcher\n')
  await writeFile(path.join(packageRoot, 'runtime', 'node', 'node.exe'), 'new node\n')
  await writeFile(path.join(packageRoot, 'app', 'package.json'), '{"name":"new-app"}\n')
  await writeFile(path.join(packageRoot, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({ portableVersion: version })}\n`)
  const archive = path.join(root, 'payload.zip')
  await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', path.join(root, 'payload'), 'DSH-Portable'])
  const bytes = await readFile(archive)
  return { archive, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function createOldInstall(destination) {
  await mkdir(path.join(destination, 'runtime', 'node'), { recursive: true })
  await mkdir(path.join(destination, 'app'), { recursive: true })
  await mkdir(path.join(destination, 'licenses'), { recursive: true })
  await mkdir(path.join(destination, 'workspace'), { recursive: true })
  await writeFile(path.join(destination, 'DeepSeek-Herness.exe'), 'old launcher\n')
  await writeFile(path.join(destination, 'runtime', 'node', 'node.exe'), 'old node\n')
  await writeFile(path.join(destination, 'app', 'package.json'), '{"name":"old-app"}\n')
  await writeFile(path.join(destination, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({ portableVersion: '0.2.4' })}\n`)

  const profileSettings = path.join(destination, 'data', 'dsh-home', 'profiles', 'web', 'settings.json')
  const userPlugin = path.join(destination, 'data', 'dsh-home', 'profiles', 'web', 'node_modules', 'example-user-plugin', 'package.json')
  const staleFallback = path.join(destination, 'data', 'dsh-home', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-plan', 'stale.txt')
  await mkdir(path.dirname(profileSettings), { recursive: true })
  await mkdir(path.dirname(userPlugin), { recursive: true })
  await mkdir(path.dirname(staleFallback), { recursive: true })
  await writeFile(profileSettings, '{"keep":true}\n')
  await writeFile(userPlugin, '{"name":"example-user-plugin"}\n')
  await writeFile(staleFallback, 'stale generated fallback\n')
  await writeFile(path.join(destination, 'workspace', 'project.txt'), 'keep workspace\n')
}

async function exists(filename) {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

test('signed local full updates preserve data, reject damaged inputs and never contact their remote URLs', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'offline-full-'))
  const destination = path.join(root, 'installed')
  const executable = path.join(root, 'updater.exe')
  const resultFile = path.join(root, 'result.json')
  const manifestFile = path.join(root, 'manifest.json')
  let connections = 0
  const server = createServer((request, response) => response.writeHead(503).end())
  server.on('connection', () => { connections++ })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let payload = await makePayload(root, '0.2.5')
    const healthLog = path.join(root, 'offline-health.log')
    const healthSource = path.join(root, 'health-launcher.cs')
    await writeFile(healthSource, `
using System;
using System.IO;
internal static class HealthLauncher {
  [STAThread] private static void Main() {
    if (Environment.GetEnvironmentVariable("DSH_PORTABLE_SKIP_UPDATE_CHECK") != "1"
      || Environment.GetEnvironmentVariable("DSH_PORTABLE_SKIP_CORE_RECONCILE") != "1") Environment.Exit(17);
    File.AppendAllText(Environment.GetEnvironmentVariable("OFFLINE_TEST_HEALTH_LOG"),
      Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_PREFLIGHT") == "1" ? "preflight\\n" : "updated\\n");
    File.WriteAllText(Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_HEALTH_FILE"),
      Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_HEALTH_TOKEN"));
  }
}`)
    await compileBootstrap(path.join(root, 'payload', 'DSH-Portable', 'DeepSeek-Herness.exe'), healthSource)
    await execFileAsync('tar.exe', ['-a', '-c', '-f', payload.archive, '-C', path.join(root, 'payload'), 'DSH-Portable'])
    const payloadBytes = await readFile(payload.archive)
    payload = { ...payload, bytes: payloadBytes, sha256: createHash('sha256').update(payloadBytes).digest('hex') }
    await createOldInstall(destination)
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const jwk = keys.publicKey.export({ format: 'jwk' })
    // Only this disposable test binary trusts the ephemeral key; production has no key override.
    const source = (await readFile(bootstrapSource, 'utf8'))
      .replace(/PublicKeyX = "[a-f0-9]+"/, `PublicKeyX = "${Buffer.from(jwk.x, 'base64url').toString('hex')}"`)
      .replace(/PublicKeyY = "[a-f0-9]+"/, `PublicKeyY = "${Buffer.from(jwk.y, 'base64url').toString('hex')}"`)
      .replace(/DefaultManifestUrl = "[^"]+"/, `DefaultManifestUrl = "https://127.0.0.1:${server.address().port}/unused"`)
    const testSource = path.join(root, 'test-updater.cs')
    await writeFile(testSource, source)
    await compileBootstrap(executable, testSource)
    const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, version: '0.2.5', payloads: { windowsX64: {
      filename: 'payload.zip', url: `https://127.0.0.1:${server.address().port}/unused.zip`,
      bytes: payload.bytes.length, sha256: payload.sha256,
    } } }))
    const signature = sign('sha256', manifest, { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
    const run = async (success) => {
      const result = await execFileAsync(executable, ['--manifest-file', manifestFile, '--destination', destination,
        '--upgrade-existing', '--result', resultFile], { timeout: 30000, windowsHide: true,
        env: { ...process.env, OFFLINE_TEST_HEALTH_LOG: healthLog,
          DSH_PORTABLE_SKIP_UPDATE_CHECK: '0', DSH_PORTABLE_SKIP_CORE_RECONCILE: '0' },
      }).catch(error => error)
      if (success) assert.equal(result.code, undefined, result.stderr)
      else assert.equal(result.code, 1)
      assert.equal(JSON.parse(await readFile(resultFile, 'utf8')).status, success ? 'updated' : 'failed')
    }
    await writeFile(manifestFile, manifest)
    await writeFile(`${manifestFile}.sig`, signature)
    await run(true)
    assert.equal(await readFile(healthLog, 'utf8'), 'preflight\nupdated\n', 'both real child launches inherit offline-only startup flags')
    assert.equal(await readFile(path.join(destination, 'data/dsh-home/profiles/web/settings.json'), 'utf8'), '{"keep":true}\n')
    assert.equal(await readFile(path.join(destination, 'workspace/project.txt'), 'utf8'), 'keep workspace\n')
    const installed = await readFile(path.join(destination, 'licenses/COMPONENTS.json'), 'utf8')
    await writeFile(manifestFile, Buffer.concat([manifest, Buffer.from(' ')]))
    await run(false)
    await writeFile(manifestFile, manifest)
    const corrupted = Buffer.from(payload.bytes)
    corrupted[0] ^= 1
    await writeFile(payload.archive, corrupted)
    await run(false)
    await rm(payload.archive)
    await run(false)
    assert.equal(await readFile(path.join(destination, 'licenses/COMPONENTS.json'), 'utf8'), installed)
    assert.equal(connections, 0, 'offline mode must not contact either metadata or payload URLs')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('bootstrap automatically upgrades an older complete install and stays usable offline', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-auto-upgrade-'))
  const destination = path.join(root, 'existing', 'DSH-Portable')
  const executable = path.join(root, 'bootstrap.exe')
  const resultFile = path.join(root, 'result.json')
  const payload = await makePayload(root, '0.2.5')
  let manifestRequests = 0
  let payloadRequests = 0
  let server

  try {
    await compileBootstrap(executable)
    await createOldInstall(destination)

    server = createServer((request, response) => {
      const origin = `http://127.0.0.1:${server.address().port}`
      if (request.url === '/portable-manifest.json') {
        manifestRequests += 1
        const body = Buffer.from(JSON.stringify({
          schemaVersion: 1,
          version: '0.2.5',
          payloads: {
            windowsX64: {
              filename: 'payload.zip',
              url: `${origin}/payload.zip`,
              sha256: payload.sha256,
              bytes: payload.bytes.length,
            },
          },
        }))
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length }).end(body)
        return
      }
      if (request.url === '/payload.zip') {
        payloadRequests += 1
        response.writeHead(200, { 'content-type': 'application/zip', 'content-length': payload.bytes.length }).end(payload.bytes)
        return
      }
      response.writeHead(404).end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`

    await execFileAsync(executable, [
      '--manifest', `${origin}/portable-manifest.json`,
      '--destination', destination,
      '--allow-http',
      '--no-launch',
      '--result', resultFile,
    ], { timeout: 120000, windowsHide: true })

    const updated = JSON.parse(await readFile(resultFile, 'utf8'))
    assert.equal(updated.status, 'updated')
    assert.equal(updated.version, '0.2.5')
    assert.equal(manifestRequests, 1)
    assert.equal(payloadRequests, 1)
    assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"new-app"}\n')
    assert.equal(await readFile(path.join(destination, 'data', 'dsh-home', 'profiles', 'web', 'settings.json'), 'utf8'), '{"keep":true}\n')
    assert.equal(await readFile(path.join(destination, 'data', 'dsh-home', 'profiles', 'web', 'node_modules', 'example-user-plugin', 'package.json'), 'utf8'), '{"name":"example-user-plugin"}\n')
    assert.equal(await readFile(path.join(destination, 'workspace', 'project.txt'), 'utf8'), 'keep workspace\n')
    assert.equal(await exists(path.join(destination, 'data', 'dsh-home', 'profiles', 'node_modules')), false)

    await new Promise((resolve) => server.close(resolve))
    server = null
    await execFileAsync(executable, [
      '--manifest', 'http://127.0.0.1:1/unreachable.json',
      '--destination', destination,
      '--allow-http',
      '--no-launch',
      '--result', resultFile,
    ], { timeout: 30000, windowsHide: true })
    const offline = JSON.parse(await readFile(resultFile, 'utf8'))
    assert.equal(offline.status, 'ready')
    assert.equal(offline.version, '0.2.5')
    assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"new-app"}\n')
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
