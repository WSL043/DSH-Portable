import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const source = path.join(projectRoot, 'launcher', 'windows', 'DSH-Bootstrap.cs')

test('bootstrap failure help opens the offline package that is actually published', async () => {
  const bootstrap = await readFile(source, 'utf8')
  assert.match(bootstrap, /OfflineDownloadUrl\s*=\s*"[^"]+DSH-Portable-windows-x64-offline\.zip"/)
  assert.doesNotMatch(bootstrap, /OfflineDownloadUrl\s*=\s*"[^"]+DSH-Portable-windows-x64-offline\.exe"/)
})

test('bootstrap UI follows the Windows display language with English fallback', async () => {
  const bootstrap = await readFile(source, 'utf8')
  assert.match(bootstrap, /CultureInfo\.InstalledUICulture\.TwoLetterISOLanguageName/)
  assert.match(bootstrap, /internal static string L\(string chinese, string english\)/)
  assert.match(bootstrap, /BootstrapText\.L\("准备 DSH-Portable", "Preparing DSH-Portable"\)/)
  assert.match(bootstrap, /BootstrapText\.L\("取消", "Cancel"\)/)
  assert.match(bootstrap, /BootstrapText\.L\("关闭", "Close"\)/)
  assert.match(bootstrap, /BootstrapText\.L\("网络有问题？下载离线完整包", "Network issue\? Download the full offline package"\)/)
})

test('interactive first launch lets the user choose the portable parent folder', async () => {
  const bootstrap = await readFile(source, 'utf8')
  assert.match(bootstrap, /internal bool DestinationExplicit;/)
  assert.match(bootstrap, /options\.DestinationExplicit = true;/)
  assert.match(bootstrap, /FolderBrowserDialog/)
  assert.match(bootstrap, /BootstrapText\.L\("选择 DSH-Portable 的保存位置", "Choose where to save DSH-Portable"\)/)
  assert.match(bootstrap, /Path\.Combine\(dialog\.SelectedPath, "DSH-Portable"\)/)
  assert.match(bootstrap, /if \(!options\.DestinationExplicit && !BootstrapInstaller\.IsCompletePortable\(options\.Destination\)\)/)
})

test('bootstrap relaunch preserves the updater environment for bounded handoff recovery', async () => {
  const bootstrap = await readFile(source, 'utf8')
  const launch = bootstrap.match(/private void LaunchIfRequested\(\)[\s\S]*?\n        \}/u)?.[0] ?? ''
  assert.match(launch, /FileName = Path\.Combine\(options\.Destination, "DeepSeek-Herness\.exe"\)/)
  assert.match(launch, /UseShellExecute = false/)
})

test('full-package cleanup does not depend on a user PATH entry for PowerShell', async () => {
  const bootstrap = await readFile(source, 'utf8')
  assert.match(bootstrap, /SpecialFolder\.Windows[\s\S]+WindowsPowerShell[\s\S]+powershell\.exe/)
  assert.doesNotMatch(bootstrap, /FileName = "powershell\.exe"/)
})

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
    source,
  ])
}

async function compileHealthFixture(output, mode = 'ready') {
  const sourceFile = `${output}.cs`
  await writeFile(sourceFile, `
using System;
using System.IO;
using System.Text;
internal static class FixtureLauncher {
  [STAThread] private static void Main() {
    string marker = Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_HEALTH_FILE");
    string token = Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_HEALTH_TOKEN");
    bool preflight = String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_PREFLIGHT"), "1", StringComparison.Ordinal);
    bool ready = ${JSON.stringify(mode)} == "ready" || (${JSON.stringify(mode)} == "preflight-only" && preflight);
    if (ready && !String.IsNullOrWhiteSpace(marker) && !String.IsNullOrWhiteSpace(token)) {
      Directory.CreateDirectory(Path.GetDirectoryName(marker));
      File.WriteAllText(marker, token + "\\r\\n", new UTF8Encoding(false));
    }
  }
}
`)
  await execFileAsync(cscPath(), ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', `/out:${output}`, sourceFile])
}

test('a full-package update preflights the staged desktop against preserved state before replacing program files', async () => {
  const bootstrap = await readFile(source, 'utf8')
  const updateFlow = bootstrap.match(/if \(upgradeExisting\)[\s\S]*?else\s*\{\s*if \(Directory\.Exists\(options\.Destination\)\)/u)?.[0] ?? ''
  assert.match(updateFlow, /VerifyStagedPortableCompatibility\(extracted, manifest\.Version\)/)
  assert.ok(
    updateFlow.indexOf('VerifyStagedPortableCompatibility(extracted, manifest.Version)')
      < updateFlow.indexOf('ReplacePortableTransactionally(extracted, backupRoot)'),
    'the staged product must pass compatibility preflight before program replacement begins',
  )
  assert.match(bootstrap, /DSH_PORTABLE_UPDATE_PREFLIGHT/)
  assert.match(bootstrap, /DSH_PORTABLE_STATE_ROOT/)
})

async function execBootstrap(executable, args, resultFile) {
  try {
    return await execFileAsync(executable, args)
  } catch (error) {
    const result = await readFile(resultFile, 'utf8').catch(() => '')
    if (result) error.message += `\nBootstrap result: ${result}`
    throw error
  }
}

async function makeFixture(root, { omitRuntime = false } = {}) {
  const packageRoot = path.join(root, 'payload', 'DSH-Portable')
  const longRelative = path.join(
    'app',
    'node_modules',
    `package-${'a'.repeat(72)}`,
    'dist',
    `feature-${'b'.repeat(72)}`,
    'runtime.json',
  )
  await mkdir(path.join(packageRoot, 'runtime', 'node'), { recursive: true })
  await mkdir(path.join(packageRoot, 'app'), { recursive: true })
  await mkdir(path.join(packageRoot, 'data'), { recursive: true })
  await mkdir(path.join(packageRoot, 'workspace'), { recursive: true })
  await writeFile(path.join(packageRoot, 'DeepSeek-Herness.exe'), 'fixture launcher')
  if (!omitRuntime) await writeFile(path.join(packageRoot, 'runtime', 'node', 'node.exe'), 'fixture node')
  await writeFile(path.join(packageRoot, 'app', 'package.json'), '{"name":"fixture"}\n')
  await mkdir(path.dirname(path.join(packageRoot, longRelative)), { recursive: true })
  await writeFile(path.join(packageRoot, longRelative), '{"longPath":true}\n')
  await writeFile(path.join(packageRoot, 'data', 'README.txt'), 'portable data')
  const archive = path.join(root, 'payload.zip')
  await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', path.join(root, 'payload'), 'DSH-Portable'])
  const bytes = await readFile(archive)
  return {
    archive,
    bytes,
    longRelative,
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
    const destination = path.join(root, 'chosen 父目录', 'DSH-Portable')
    const fixture = await makeFixture(root)
    await compileBootstrap(executable)

    await withFixtureServer(fixture, async ({ archiveRequests, manifestUrl }) => {
      await execBootstrap(executable, [
        '--manifest', manifestUrl,
        '--destination', destination,
        '--allow-http',
        '--no-launch',
        '--result', resultFile,
      ], resultFile)
      assert.equal(archiveRequests(), 1)
      const result = JSON.parse(await readFile(resultFile, 'utf8'))
      assert.equal(result.status, 'installed')
      assert.equal(result.version, 'test-portable')
      assert.equal(await readFile(path.join(destination, 'data', 'README.txt'), 'utf8'), 'portable data')
      assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"fixture"}\n')
      assert.equal(await readFile(path.join(destination, fixture.longRelative), 'utf8'), '{"longPath":true}\n')
      assert.deepEqual(
        (await readdir(path.dirname(destination))).filter((name) => name.startsWith('.dsh-portable-install-')),
        [],
        'successful installation must not leave its staging directory behind',
      )

      await rm(fixture.archive, { force: true })
      await execBootstrap(executable, [
        '--manifest', 'http://127.0.0.1:1/unreachable.json',
        '--destination', destination,
        '--allow-http',
        '--no-launch',
        '--result', resultFile,
      ], resultFile)
      const reused = JSON.parse(await readFile(resultFile, 'utf8'))
      assert.equal(reused.status, 'ready')
      assert.equal(archiveRequests(), 1, 'an installed portable folder must not need the network')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bootstrap upgrades an existing portable folder in place without replacing user data', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-upgrade-'))
  try {
    const executable = path.join(root, 'full-updater.exe')
    const resultFile = path.join(root, 'result.json')
    const destination = path.join(root, '移动目录', 'DSH-Portable')
    const fixture = await makeFixture(root)
    await compileBootstrap(executable)
    await mkdir(path.join(destination, 'runtime', 'node'), { recursive: true })
    await mkdir(path.join(destination, 'app'), { recursive: true })
    await mkdir(path.join(destination, 'data'), { recursive: true })
    await mkdir(path.join(destination, 'workspace'), { recursive: true })
    await mkdir(path.join(destination, 'licenses'), { recursive: true })
    await writeFile(path.join(destination, 'DeepSeek-Herness.exe'), 'old launcher')
    await writeFile(path.join(destination, 'runtime', 'node', 'node.exe'), 'old node')
    await writeFile(path.join(destination, 'app', 'package.json'), '{"name":"old"}\n')
    await writeFile(path.join(destination, 'licenses', 'COMPONENTS.json'), '{"portableVersion":"0.4.0"}\n')
    await writeFile(path.join(destination, 'data', 'session.json'), '{"keep":true}\n')
    await writeFile(path.join(destination, 'workspace', 'project.txt'), 'keep workspace\n')

    await withFixtureServer(fixture, async ({ manifestUrl }) => {
      await execBootstrap(executable, [
        '--upgrade-existing',
        '--manifest', manifestUrl,
        '--destination', destination,
        '--allow-http',
        '--no-launch',
        '--result', resultFile,
      ], resultFile)
    })

    const result = JSON.parse(await readFile(resultFile, 'utf8'))
    assert.equal(result.status, 'updated')
    assert.equal(result.version, 'test-portable')
    assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"fixture"}\n')
    assert.equal(await readFile(path.join(destination, 'data', 'session.json'), 'utf8'), '{"keep":true}\n')
    assert.equal(await readFile(path.join(destination, 'workspace', 'project.txt'), 'utf8'), 'keep workspace\n')
    assert.deepEqual(
      (await readdir(path.dirname(destination))).filter((name) => name.startsWith('.dsh-portable-')),
      [],
      'successful upgrades must remove staging and backup directories',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a full-package update restores the prior program when the updated desktop never becomes ready', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-health-rollback-'))
  try {
    const executable = path.join(root, 'full-updater.exe')
    const resultFile = path.join(root, 'result.json')
    const destination = path.join(root, 'portable', 'DSH-Portable')
    const fixture = await makeFixture(root)
    await compileBootstrap(executable)
    await compileHealthFixture(path.join(root, 'payload', 'DSH-Portable', 'DeepSeek-Herness.exe'), 'preflight-only')
    await execFileAsync('tar.exe', ['-a', '-c', '-f', fixture.archive, '-C', path.join(root, 'payload'), 'DSH-Portable'])
    fixture.bytes = await readFile(fixture.archive)
    fixture.sha256 = createHash('sha256').update(fixture.bytes).digest('hex')

    await mkdir(path.join(destination, 'runtime', 'node'), { recursive: true })
    await mkdir(path.join(destination, 'app'), { recursive: true })
    await mkdir(path.join(destination, 'data'), { recursive: true })
    await mkdir(path.join(destination, 'workspace'), { recursive: true })
    await mkdir(path.join(destination, 'licenses'), { recursive: true })
    await compileHealthFixture(path.join(destination, 'DeepSeek-Herness.exe'), 'ready')
    await writeFile(path.join(destination, 'runtime', 'node', 'node.exe'), 'old node')
    await writeFile(path.join(destination, 'app', 'package.json'), '{"name":"old"}\n')
    await writeFile(path.join(destination, 'licenses', 'COMPONENTS.json'), '{"portableVersion":"0.4.0"}\n')
    await writeFile(path.join(destination, 'data', 'session.json'), '{"keep":true}\n')

    await withFixtureServer(fixture, async ({ manifestUrl }) => {
      await assert.rejects(execBootstrap(executable, [
        '--upgrade-existing', '--manifest', manifestUrl, '--destination', destination,
        '--allow-http', '--result', resultFile,
      ], resultFile))
    })

    const result = JSON.parse(await readFile(resultFile, 'utf8'))
    assert.equal(result.status, 'failed')
    assert.match(result.message, /previous version was restored/i)
    const updateOutcome = JSON.parse(await readFile(path.join(destination, 'data', 'runtime', 'last-update-result.json'), 'utf8'))
    assert.equal(updateOutcome.status, 'rolled-back')
    assert.equal(updateOutcome.restoredVersion, '0.4.0')
    assert.equal(updateOutcome.targetVersion, 'test-portable')
    assert.match(updateOutcome.message, /previous version was restored/i)
    assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"old"}\n')
    assert.equal(await readFile(path.join(destination, 'data', 'session.json'), 'utf8'), '{"keep":true}\n')
    assert.deepEqual((await readdir(path.dirname(destination))).filter(name => name.startsWith('.dsh-portable-backup-')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed staged compatibility preflight leaves the installed program untouched', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-preflight-reject-'))
  try {
    const executable = path.join(root, 'full-updater.exe')
    const resultFile = path.join(root, 'result.json')
    const destination = path.join(root, 'portable', 'DSH-Portable')
    const fixture = await makeFixture(root)
    await compileBootstrap(executable)
    await compileHealthFixture(path.join(root, 'payload', 'DSH-Portable', 'DeepSeek-Herness.exe'), 'fail')
    await execFileAsync('tar.exe', ['-a', '-c', '-f', fixture.archive, '-C', path.join(root, 'payload'), 'DSH-Portable'])
    fixture.bytes = await readFile(fixture.archive)
    fixture.sha256 = createHash('sha256').update(fixture.bytes).digest('hex')

    await mkdir(path.join(destination, 'runtime', 'node'), { recursive: true })
    await mkdir(path.join(destination, 'app'), { recursive: true })
    await mkdir(path.join(destination, 'data'), { recursive: true })
    await mkdir(path.join(destination, 'workspace'), { recursive: true })
    await mkdir(path.join(destination, 'licenses'), { recursive: true })
    await compileHealthFixture(path.join(destination, 'DeepSeek-Herness.exe'), 'ready')
    await writeFile(path.join(destination, 'runtime', 'node', 'node.exe'), 'old node')
    await writeFile(path.join(destination, 'app', 'package.json'), '{"name":"old"}\n')
    await writeFile(path.join(destination, 'licenses', 'COMPONENTS.json'), '{"portableVersion":"0.5.2"}\n')
    await writeFile(path.join(destination, 'data', 'session.json'), '{"keep":true}\n')

    await withFixtureServer(fixture, async ({ manifestUrl }) => {
      await assert.rejects(execBootstrap(executable, [
        '--upgrade-existing', '--manifest', manifestUrl, '--destination', destination,
        '--allow-http', '--result', resultFile,
      ], resultFile))
    })

    const result = JSON.parse(await readFile(resultFile, 'utf8'))
    assert.equal(result.status, 'failed')
    assert.match(result.message, /compatibility check/i)
    const updateOutcome = JSON.parse(await readFile(path.join(destination, 'data', 'runtime', 'last-update-result.json'), 'utf8'))
    assert.equal(updateOutcome.status, 'blocked')
    assert.equal(updateOutcome.restoredVersion, '0.5.2')
    assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"old"}\n')
    assert.equal(await readFile(path.join(destination, 'data', 'session.json'), 'utf8'), '{"keep":true}\n')
    assert.deepEqual((await readdir(path.dirname(destination))).filter(name => name.startsWith('.dsh-portable-backup-')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a full-package update commits only after the updated desktop reports ready', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-health-commit-'))
  try {
    const executable = path.join(root, 'full-updater.exe')
    const resultFile = path.join(root, 'result.json')
    const destination = path.join(root, 'portable', 'DSH-Portable')
    const fixture = await makeFixture(root)
    await compileBootstrap(executable)
    await compileHealthFixture(path.join(root, 'payload', 'DSH-Portable', 'DeepSeek-Herness.exe'), 'ready')
    await execFileAsync('tar.exe', ['-a', '-c', '-f', fixture.archive, '-C', path.join(root, 'payload'), 'DSH-Portable'])
    fixture.bytes = await readFile(fixture.archive)
    fixture.sha256 = createHash('sha256').update(fixture.bytes).digest('hex')

    await mkdir(path.join(destination, 'runtime', 'node'), { recursive: true })
    await mkdir(path.join(destination, 'app'), { recursive: true })
    await mkdir(path.join(destination, 'data'), { recursive: true })
    await mkdir(path.join(destination, 'workspace'), { recursive: true })
    await compileHealthFixture(path.join(destination, 'DeepSeek-Herness.exe'), 'ready')
    await writeFile(path.join(destination, 'runtime', 'node', 'node.exe'), 'old node')
    await writeFile(path.join(destination, 'app', 'package.json'), '{"name":"old"}\n')
    await writeFile(path.join(destination, 'data', 'session.json'), '{"keep":true}\n')

    await withFixtureServer(fixture, async ({ manifestUrl }) => {
      await execBootstrap(executable, [
        '--upgrade-existing', '--manifest', manifestUrl, '--destination', destination,
        '--allow-http', '--result', resultFile,
      ], resultFile)
    })

    const result = JSON.parse(await readFile(resultFile, 'utf8'))
    assert.equal(result.status, 'updated')
    const updateOutcome = JSON.parse(await readFile(path.join(destination, 'data', 'runtime', 'last-update-result.json'), 'utf8'))
    assert.equal(updateOutcome.status, 'updated')
    assert.equal(updateOutcome.targetVersion, 'test-portable')
    assert.equal(await readFile(path.join(destination, 'app', 'package.json'), 'utf8'), '{"name":"fixture"}\n')
    assert.equal(await readFile(path.join(destination, 'data', 'session.json'), 'utf8'), '{"keep":true}\n')
    assert.deepEqual((await readdir(path.dirname(destination))).filter(name => name.startsWith('.dsh-portable-backup-')), [])
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

test('bootstrap removes a rejected long-path payload without leaving staging data', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-reject-'))
  try {
    const executable = path.join(root, 'bootstrap.exe')
    const resultFile = path.join(root, 'result.json')
    const destination = path.join(root, `parent-${'c'.repeat(150)}`, '中文 parent', 'DSH-Portable')
    const fixture = await makeFixture(root, { omitRuntime: true })
    await compileBootstrap(executable)

    await withFixtureServer(fixture, async ({ manifestUrl }) => {
      await assert.rejects(execBootstrap(executable, [
        '--manifest', manifestUrl,
        '--destination', destination,
        '--allow-http',
        '--no-launch',
        '--result', resultFile,
      ], resultFile))
      const failed = JSON.parse(await readFile(resultFile, 'utf8'))
      assert.equal(failed.status, 'failed')
      await assert.rejects(stat(destination))
      assert.deepEqual(
        (await readdir(path.dirname(destination))).filter((name) => name.startsWith('.dsh-portable-install-')),
        [],
        'rejected payloads must not leave long-path staging data behind',
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
