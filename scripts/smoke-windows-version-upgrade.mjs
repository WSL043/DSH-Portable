import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const oldArchive = path.resolve(process.argv[2] || '')
const artifacts = path.resolve(process.argv[3] || path.join(projectRoot, 'artifacts'))
const newArchive = path.join(artifacts, 'DSH-Portable-windows-x64-offline.zip')
const fullManifestPath = path.join(artifacts, 'portable-manifest.json')
const componentManifestPath = path.join(artifacts, 'portable-update-windows-x64.json')

assert.equal(process.platform, 'win32', 'the release upgrade smoke requires Windows')
assert.ok(oldArchive, 'pass the prior Windows offline ZIP as the first argument')

const [newArchiveBytes, fullManifestSource, componentManifestSource] = await Promise.all([
  readFile(newArchive),
  readFile(fullManifestPath, 'utf8').then(JSON.parse),
  readFile(componentManifestPath, 'utf8').then(JSON.parse),
])
const payload = fullManifestSource?.payloads?.windowsX64
assert.equal(fullManifestSource.releaseChannel, 'candidate', 'the complete-package manifest must target the candidate channel')
assert.equal(componentManifestSource.releaseChannel, 'candidate', 'the component manifest must target the candidate channel')
assert.equal(newArchiveBytes.length, payload?.bytes, 'new full archive size does not match its manifest')
assert.equal(createHash('sha256').update(newArchiveBytes).digest('hex'), payload?.sha256, 'new full archive digest does not match its manifest')

const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-release-upgrade-'))
const extracted = path.join(root, 'DSH-Portable')
const destination = path.join(root, 'DSH Portable 旧版迁移 ü')
const resultPath = path.join(root, 'upgrade-result.json')
let fullManifestBody = null
let componentManifestBody = null
const server = createServer((request, response) => {
  if (request.url === '/portable-manifest.json') {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': fullManifestBody.length })
    response.end(fullManifestBody)
    return
  }
  if (request.url === '/portable-update-windows-x64.json') {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': componentManifestBody.length })
    response.end(componentManifestBody)
    return
  }
  if (request.url === '/payload.zip') {
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': newArchiveBytes.length })
    response.end(newArchiveBytes)
    return
  }
  response.writeHead(404).end()
})

try {
  await execFileAsync('tar.exe', ['-x', '-f', oldArchive, '-C', root], { timeout: 5 * 60 * 1000, windowsHide: true })
  await rename(extracted, destination)
  const oldComponents = JSON.parse(await readFile(path.join(destination, 'licenses', 'COMPONENTS.json'), 'utf8'))
  assert.match(oldComponents.portableVersion, /-rc\./, 'the prior package must be a release candidate')
  assert.notEqual(oldComponents.portableVersion, fullManifestSource.version, 'the prior package must be older than the candidate')
  assert.ok(
    Number(oldComponents.shellSchema) < Number(componentManifestSource.requiredShellSchema),
    'the prior package does not exercise a complete-package shell boundary',
  )

  const markers = new Map([
    [path.join(destination, 'data', 'dsh-home', 'settings.yaml'), 'locale:\n  preference: zh\n'],
    [path.join(destination, 'data', 'dsh-home', 'portable-upgrade-session.marker'), 'keep-session\n'],
    [path.join(destination, 'data', 'dsh-home', 'profiles', 'web', 'portable-upgrade-plugin.marker'), 'keep-plugin\n'],
    [path.join(destination, 'workspace', 'portable-upgrade-project.txt'), 'keep-workspace\n'],
  ])
  for (const [filename, value] of markers) {
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, value)
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  fullManifestBody = Buffer.from(JSON.stringify({
    ...fullManifestSource,
    payloads: { windowsX64: { ...payload, url: `${origin}/payload.zip` } },
  }))
  componentManifestBody = Buffer.from(JSON.stringify({
    ...componentManifestSource,
    component: { ...componentManifestSource.component, urls: [`${origin}/unused-component.zip`] },
  }))

  const oldNode = path.join(destination, 'runtime', 'node', 'node.exe')
  const oldCli = path.join(destination, 'launcher', 'portable-cli.mjs')
  const { stdout: decisionText } = await execFileAsync(oldNode, [
    oldCli,
    'check-update',
    '--update-manifest', `${origin}/portable-update-windows-x64.json`,
    '--allow-http',
    '--force',
    '--json',
  ], { timeout: 60 * 1000, windowsHide: true })
  const decision = JSON.parse(decisionText)
  assert.equal(decision.status, 'full-package-required')
  assert.equal(decision.delivery, 'full-package')

  try {
    await execFileAsync(path.join(destination, 'launcher', 'DSH-FullUpdater.exe'), [
      '--upgrade-existing',
      '--manifest', `${origin}/portable-manifest.json`,
      '--destination', destination,
      '--allow-http',
      '--no-launch',
      '--result', resultPath,
    ], { timeout: 10 * 60 * 1000, windowsHide: true })
  } catch (error) {
    const diagnostic = await readFile(resultPath, 'utf8').catch(() => 'no updater result was written')
    throw new Error(`the prior full updater failed: ${diagnostic}`, { cause: error })
  }
  const result = JSON.parse(await readFile(resultPath, 'utf8'))
  assert.equal(result.status, 'updated')
  assert.equal(result.version, fullManifestSource.version)

  const newComponents = JSON.parse(await readFile(path.join(destination, 'licenses', 'COMPONENTS.json'), 'utf8'))
  assert.equal(newComponents.portableVersion, fullManifestSource.version)
  assert.equal(newComponents.shellSchema, componentManifestSource.requiredShellSchema)
  assert.equal(newComponents.dshVersion, componentManifestSource.component.dshVersion)
  for (const [filename, value] of markers) assert.equal(await readFile(filename, 'utf8'), value)
  assert.ok((await stat(path.join(destination, 'DeepSeek-Herness.exe'))).isFile())

  await execFileAsync(process.execPath, [path.join(projectRoot, 'scripts', 'smoke-portable.mjs'), destination], {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  })
  console.log(JSON.stringify({
    status: 'passed',
    from: oldComponents.portableVersion,
    to: newComponents.portableVersion,
    dshVersion: newComponents.dshVersion,
    preserved: markers.size,
    delivery: decision.delivery,
  }))
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve))
  if (!process.env.CI) await rm(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 })
}
