import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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

async function compileBootstrap(output) {
  await execFileAsync(cscPath(), [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    '/reference:System.Net.Http.dll', '/reference:System.Runtime.Serialization.dll',
    '/reference:System.IO.Compression.dll',
    `/out:${output}`,
    bootstrapSource,
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
