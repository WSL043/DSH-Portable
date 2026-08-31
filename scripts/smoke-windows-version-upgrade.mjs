import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { readFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const oldArchive = path.resolve(process.argv[2] || '')
const artifacts = path.resolve(process.argv[3] || path.join(projectRoot, 'artifacts'))
const allowChannelMigration = process.argv.includes('--allow-channel-migration')
const runningHostUpgrade = process.argv.includes('--running-host')
const simulateWebViewBusy = process.argv.includes('--simulate-webview-busy')
const newArchive = path.join(artifacts, 'DSH-Portable-windows-x64-offline.zip')
const componentArchive = path.join(artifacts, 'DSH-Portable-update-windows-x64.zip')
const fullManifestPath = path.join(artifacts, 'portable-manifest.json')
const componentManifestPath = path.join(artifacts, 'portable-update-windows-x64.json')

assert.equal(process.platform, 'win32', 'the release upgrade smoke requires Windows')
assert.ok(oldArchive, 'pass the prior Windows offline ZIP as the first argument')

const [newArchiveBytes, componentArchiveBytes, fullManifestSource, componentManifestSource] = await Promise.all([
  readFile(newArchive),
  readFile(componentArchive),
  readFile(fullManifestPath, 'utf8').then(JSON.parse),
  readFile(componentManifestPath, 'utf8').then(JSON.parse),
])
const payload = fullManifestSource?.payloads?.windowsX64
assert.ok(['stable', 'candidate'].includes(fullManifestSource.releaseChannel), 'the complete-package manifest must target a product release channel')
assert.equal(componentManifestSource.releaseChannel, fullManifestSource.releaseChannel, 'the component and complete-package manifests must target the same channel')
assert.equal(newArchiveBytes.length, payload?.bytes, 'new full archive size does not match its manifest')
assert.equal(createHash('sha256').update(newArchiveBytes).digest('hex'), payload?.sha256, 'new full archive digest does not match its manifest')

const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-release-upgrade-'))
const extracted = path.join(root, 'DSH-Portable')
const destination = path.join(root, 'DSH Portable 旧版迁移 ü')
const resultPath = path.join(root, 'upgrade-result.json')
let fullManifestBody = null
let componentManifestBody = null
let oldHost = null

async function waitFor(predicate, message, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(message)
}

async function launcherLog() {
  return readFile(path.join(destination, 'data', 'logs', 'launcher.log'), 'utf8').catch(() => '')
}

async function stopFinishedProduct() {
  const executable = path.join(destination, 'DeepSeek-Herness.exe')
  if (!await stat(executable).then(() => true, () => false)) return
  await execFileAsync(executable, ['stop', '--no-browser', '--json'], {
    cwd: destination,
    timeout: 90_000,
    windowsHide: true,
  }).catch(() => null)
}
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
  if (request.url === '/component.zip') {
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': componentArchiveBytes.length })
    response.end(componentArchiveBytes)
    return
  }
  response.writeHead(404).end()
})

try {
  await execFileAsync('tar.exe', ['-x', '-f', oldArchive, '-C', root], { timeout: 5 * 60 * 1000, windowsHide: true })
  await rename(extracted, destination)
  const oldComponents = JSON.parse(await readFile(path.join(destination, 'licenses', 'COMPONENTS.json'), 'utf8'))
  assert.notEqual(oldComponents.portableVersion, fullManifestSource.version, 'the prior package must differ from the target release')
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
    component: { ...componentManifestSource.component, urls: [`${origin}/component.zip`] },
  }))

  let decision = { status: 'full-package-required', delivery: 'full-package' }
  if (!allowChannelMigration) {
    const oldNode = path.join(destination, 'runtime', 'node', 'node.exe')
    const oldCli = path.join(destination, 'launcher', 'portable-cli.mjs')
    const oldEntry = await stat(path.join(destination, 'runtime-capsule.json')).then(
      () => [path.join(destination, 'launcher', 'runtime-entry.mjs'), 'portable-cli.mjs'],
      () => [oldCli],
    )
    const { stdout: decisionText } = await execFileAsync(oldNode, [
      ...oldEntry,
      'check-update',
      '--update-manifest', `${origin}/portable-update-windows-x64.json`,
      '--allow-http',
      '--force',
      '--json',
    ], { timeout: 60 * 1000, windowsHide: true })
    decision = JSON.parse(decisionText)
    assert.ok(['available', 'full-package-required'].includes(decision.status), `unexpected update decision: ${decision.status}`)
    assert.equal(decision.delivery, decision.status === 'available' ? 'component' : 'full-package')
  } else {
    assert.notEqual(
      oldComponents.releaseChannel,
      fullManifestSource.releaseChannel,
      '--allow-channel-migration is only for exercising the updater across a local release-channel boundary',
    )
  }

  let launcherLogOffset = 0
  if (decision.delivery === 'full-package') {
    if (runningHostUpgrade) {
      const oldExecutable = path.join(destination, 'DeepSeek-Herness.exe')
      oldHost = spawn(oldExecutable, [], {
        cwd: destination,
        env: {
          ...process.env,
          DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
          DSH_PORTABLE_TEST_HIDDEN: '1',
        },
        windowsHide: true,
        stdio: 'ignore',
      })
      await waitFor(
        async () => (await launcherLog()).includes('environment-ready:'),
        'the old native desktop host did not initialize WebView2 before the update',
      )
      launcherLogOffset = (await launcherLog()).length
    }
    try {
      const updaterArguments = [
        '--upgrade-existing',
        '--manifest', `${origin}/portable-manifest.json`,
        '--destination', destination,
        '--allow-http',
        '--result', resultPath,
      ]
      if (!runningHostUpgrade) updaterArguments.push('--no-launch')
      await execFileAsync(path.join(destination, 'launcher', 'DSH-FullUpdater.exe'), updaterArguments, {
        timeout: 10 * 60 * 1000,
        windowsHide: true,
        env: runningHostUpgrade ? {
          ...process.env,
          DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
          DSH_PORTABLE_TEST_HIDDEN: '1',
        } : process.env,
      })
    } catch (error) {
      const diagnostic = await readFile(resultPath, 'utf8').catch(() => 'no updater result was written')
      throw new Error(`the prior full updater failed: ${diagnostic}`, { cause: error })
    }
    const result = JSON.parse(await readFile(resultPath, 'utf8'))
    assert.equal(result.status, 'updated')
    assert.equal(result.version, fullManifestSource.version)
  } else {
    const oldNode = path.join(destination, 'runtime', 'node', 'node.exe')
    const oldCli = path.join(destination, 'launcher', 'portable-cli.mjs')
    const oldEntry = await stat(path.join(destination, 'runtime-capsule.json')).then(
      () => [path.join(destination, 'launcher', 'runtime-entry.mjs'), 'portable-cli.mjs'],
      () => [oldCli],
    )
    const { stdout } = await execFileAsync(oldNode, [
      ...oldEntry,
      'update',
      '--update-manifest', `${origin}/portable-update-windows-x64.json`,
      '--allow-http',
      '--force',
      '--no-browser',
      '--json',
      '--progress-json',
    ], { timeout: 5 * 60 * 1000, windowsHide: true })
    const records = stdout.trim().split(/\r?\n/).map(JSON.parse)
    assert.equal(records.at(-1)?.status, 'updated', 'the prior shell did not finish the compatible component update')
    assert.ok(records.some((entry) => entry.phase === 'validating'), 'the prior shell did not validate the updated runtime')
  }

  const newComponents = JSON.parse(await readFile(path.join(destination, 'licenses', 'COMPONENTS.json'), 'utf8'))
  assert.equal(newComponents.portableVersion, fullManifestSource.version)
  assert.equal(newComponents.shellSchema, componentManifestSource.requiredShellSchema)
  assert.equal(newComponents.dshVersion, componentManifestSource.component.dshVersion)
  assert.equal(newComponents.runtimeLayout, 'capsule-v1')
  assert.ok((await stat(path.join(destination, 'runtime-capsule.json'))).isFile())
  assert.ok((await stat(path.join(destination, 'runtime', 'DSH-App.dshpack'))).isFile())
  await assert.rejects(stat(path.join(destination, 'app', 'node_modules')), { code: 'ENOENT' })
  for (const [filename, value] of markers) assert.equal(await readFile(filename, 'utf8'), value)
  assert.ok((await stat(path.join(destination, 'DeepSeek-Herness.exe'))).isFile())

  if (runningHostUpgrade && decision.delivery === 'full-package') {
    await waitFor(async () => {
      const currentLog = await launcherLog()
      return currentLog.slice(launcherLogOffset).includes('dsh-first-paint-ready')
    }, 'the updated native desktop host did not become ready after the running-host handoff')
    const updateLog = (await launcherLog()).slice(launcherLogOffset)
    assert.doesNotMatch(updateLog, /0x800700AA|requested resource is in use|要求されたリソースは使用中/i)
    await stopFinishedProduct()

    if (simulateWebViewBusy) {
      launcherLogOffset = (await launcherLog()).length
      oldHost = spawn(path.join(destination, 'DeepSeek-Herness.exe'), [], {
        cwd: destination,
        env: {
          ...process.env,
          DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
          DSH_PORTABLE_TEST_HIDDEN: '1',
          DSH_PORTABLE_TEST_WEBVIEW2_BUSY_ONCE: '1',
        },
        windowsHide: true,
        stdio: 'ignore',
      })
      await waitFor(async () => {
        const currentLog = await launcherLog()
        return currentLog.slice(launcherLogOffset).includes('dsh-first-paint-ready')
      }, 'the updated product did not recover from the injected WebView2 resource-in-use race')
      const recoveryLog = (await launcherLog()).slice(launcherLogOffset)
      assert.match(recoveryLog, /environment-busy-retry:/)
      assert.doesNotMatch(recoveryLog, /0x800700AA|requested resource is in use|要求されたリソースは使用中/i)
      await stopFinishedProduct()
    }
  }

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
  await stopFinishedProduct()
  if (oldHost && oldHost.exitCode === null) oldHost.kill()
  if (server.listening) await new Promise((resolve) => server.close(resolve))
  if (!process.env.CI) await rm(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 })
}
