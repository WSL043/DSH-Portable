import { launcherSourceFiles } from './helpers/launcher-source.mjs'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const sources = [
  ...launcherSourceFiles.map(filename => path.join(projectRoot, 'launcher', 'windows', filename)),
  path.join(projectRoot, 'launcher', 'windows', 'PortableProcessJob.cs'),
]
const utf8FailureFixture = path.join(projectRoot, 'tests', 'fixtures', 'launcher-error-utf8.mjs')

function cscPath() {
  const windows = process.env.WINDIR || 'C:\\Windows'
  return path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
}

async function prepareWebView2(root) {
  const lock = JSON.parse(await readFile(path.join(projectRoot, 'upstream.lock.json'), 'utf8'))
  const archive = path.join(root, `Microsoft.Web.WebView2.${lock.webview2.version}.nupkg`)
  const sdk = path.join(root, 'webview2-sdk')
  const response = await fetch(lock.webview2.url)
  assert.equal(response.ok, true, `WebView2 SDK download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'), lock.webview2.sha256)
  await writeFile(archive, bytes)
  await mkdir(sdk)
  await execFileAsync('tar.exe', ['-x', '-f', archive, '-C', sdk])
  const core = path.join(sdk, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll')
  const winforms = path.join(sdk, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll')
  const loader = path.join(sdk, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll')
  await copyFile(core, path.join(root, path.basename(core)))
  await copyFile(winforms, path.join(root, path.basename(winforms)))
  await copyFile(loader, path.join(root, path.basename(loader)))
  return { core, winforms }
}

async function downloadAndExtract(root, name, url, expectedSha256) {
  const archive = path.join(root, name)
  const extracted = path.join(root, `${name}-extracted`)
  const response = await fetch(url)
  assert.equal(response.ok, true, `${name} download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha256)
  await writeFile(archive, bytes)
  await mkdir(extracted)
  await execFileAsync('tar.exe', ['-x', '-f', archive, '-C', extracted])
  return extracted
}

async function prepareNotificationRuntime(root) {
  const lock = JSON.parse(await readFile(path.join(projectRoot, 'upstream.lock.json'), 'utf8'))
  const toolkit = await downloadAndExtract(root, 'windows-notifications.nupkg', lock.windowsNotifications.url, lock.windowsNotifications.sha256)
  const valueTuple = await downloadAndExtract(root, 'system-valuetuple.nupkg', lock.windowsNotifications.valueTupleUrl, lock.windowsNotifications.valueTupleSha256)
  const notification = path.join(toolkit, 'lib', 'net461', 'Microsoft.Toolkit.Uwp.Notifications.dll')
  const tuple = path.join(valueTuple, 'lib', 'net461', 'System.ValueTuple.dll')
  await copyFile(notification, path.join(root, path.basename(notification)))
  await copyFile(tuple, path.join(root, path.basename(tuple)))
  return { notification, tuple }
}

async function notificationCompileReferences() {
  const windows = process.env.WINDIR || 'C:\\Windows'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const referencesRoot = path.join(programFilesX86, 'Windows Kits', '10', 'References')
  const contractFiles = (await readdir(referencesRoot, { recursive: true }))
    .filter(filename => filename.endsWith('Windows.Foundation.UniversalApiContract.winmd'))
    .sort()
  assert.ok(contractFiles.length > 0, 'Windows.Foundation.UniversalApiContract.winmd is unavailable')
  return [
    path.join(programFilesX86, 'Windows Kits', '10', 'UnionMetadata', 'Facade', 'Windows.winmd'),
    path.join(referencesRoot, contractFiles.at(-1)),
    path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'System.Runtime.WindowsRuntime.dll'),
  ]
}

async function compileLauncher(output, webview2, notifications) {
  const winrt = await notificationCompileReferences()
  await execFileAsync(cscPath(), [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
    ...winrt.map(filename => `/reference:${filename}`),
    `/reference:${webview2.core}`, `/reference:${webview2.winforms}`,
    `/reference:${notifications.notification}`, `/reference:${notifications.tuple}`,
    `/out:${output}`,
    ...sources,
  ])
}

test('Windows launcher preserves UTF-8 diagnostics from the DSH subprocess', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-launcher-utf8-'))
  try {
    const executable = path.join(root, 'DeepSeek-Herness.exe')
    const diagnostic = path.join(root, 'launcher-diagnostic.txt')
    await mkdir(path.join(root, 'runtime', 'node'), { recursive: true })
    await mkdir(path.join(root, 'launcher'), { recursive: true })
    await copyFile(process.execPath, path.join(root, 'runtime', 'node', 'node.exe'))
    await copyFile(utf8FailureFixture, path.join(root, 'launcher', 'portable-cli.mjs'))
    await copyFile(new URL('../launcher/runtime-entry.mjs', import.meta.url), path.join(root, 'launcher', 'runtime-entry.mjs'))
    await copyFile(new URL('../launcher/runtime-capsule.mjs', import.meta.url), path.join(root, 'launcher', 'runtime-capsule.mjs'))
    await copyFile(new URL('../launcher/portable-core.mjs', import.meta.url), path.join(root, 'launcher', 'portable-core.mjs'))
    await copyFile(new URL('../launcher/data-paths.mjs', import.meta.url), path.join(root, 'launcher', 'data-paths.mjs'))
    await copyFile(new URL('../launcher/startup-trace.mjs', import.meta.url), path.join(root, 'launcher', 'startup-trace.mjs'))
    await copyFile(new URL('../launcher/log-history.mjs', import.meta.url), path.join(root, 'launcher', 'log-history.mjs'))
    await copyFile(new URL('../launcher/launcher-log.mjs', import.meta.url), path.join(root, 'launcher', 'launcher-log.mjs'))
    const webview2 = await prepareWebView2(root)
    const notifications = await prepareNotificationRuntime(root)
    await compileLauncher(executable, webview2, notifications)

    await assert.rejects(execFileAsync(executable, ['--json'], {
      windowsHide: true,
      env: { ...process.env, DSH_PORTABLE_LAUNCHER_DIAGNOSTIC: diagnostic },
    }), (error) => error.code === 17)

    const text = (await readFile(diagnostic, 'utf8')).replace(/^\uFEFF/, '')
    assert.equal(text, '启动失败：找不到运行模块 “测试”')

    const controls = path.join(root, 'window-controls-fixture.exe')
    await execFileAsync(cscPath(), [
      '/nologo', '/target:exe', '/platform:x64',
      '/reference:System.dll', '/reference:System.Core.dll',
      '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
      `/out:${controls}`,
      path.join(projectRoot, 'tests', 'fixtures', 'launcher-window-controls.cs'),
    ])
    const acceptance = await execFileAsync(controls, [executable, root], { windowsHide: true })
    assert.match(acceptance.stdout, /window-controls-composite-ok/)
  } finally {
    // Windows can retain the just-exited node image briefly (job teardown or
    // scanner). Retry fixture cleanup only; never rerun the tested operation.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('the native updater explains core qualification and the core restore instead of staying silent', async () => {
  const { readFile } = await import('node:fs/promises')
  const update = await readFile(new URL('../launcher/windows/LauncherWindow.Update.cs', import.meta.url), 'utf8')
  const ui = await readFile(new URL('../launcher/windows/LauncherWindow.UpdateUi.cs', import.meta.url), 'utf8')
  const cli = await readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8')
  assert.match(update, /updateStatus == "core-awaiting-qualification"/)
  assert.match(ui, /你选过的内核会在更新后自动恢复/)
  assert.match(ui, /phase == "core-restoring"/)
  assert.match(cli, /phase: 'core-restoring'/)
})

test('the loading surface says why a long step takes long, and stops once the workspace opens or fails', async () => {
  const ui = await readFile(path.join(projectRoot, 'launcher', 'windows', 'LauncherWindow.UpdateUi.cs'), 'utf8')
  const host = await readFile(path.join(projectRoot, 'launcher', 'windows', 'LauncherWindow.Host.cs'), 'utf8')
  assert.match(ui, /NoteStartupStage\(phase\);\r?\n\s+if \(phase == "runtime-preparing"\)/)
  assert.match(ui, /seconds >= 3\) SetStartupPatience\(L\("首次启动需展开一次，之后会快很多。"/)
  assert.match(ui, /else if \(seconds >= 8\)/)
  assert.match(ui, /!launchPanel\.Visible/)
  // Both a successful and a failed preparation end the hint before anything else is shown.
  assert.match(host, /NoteStartupStage\("workspace-ready"\);\r?\n\s+AppendStartupTrace\("native-host", "portable-cli-complete"/)
})

test('the startup theme smoke attaches its colour probe before any slow step', async () => {
  const smoke = await readFile(path.join(projectRoot, 'scripts', 'smoke-windows-startup-theme.mjs'), 'utf8')
  const probe = smoke.indexOf("Page.addScriptToEvaluateOnNewDocument")
  const capture = smoke.indexOf("capture-windows-native-window.ps1")
  assert.ok(probe > 0 && capture > 0, 'both steps exist')
  // A faster start makes the workspace navigate sooner; a probe registered after the multi-second window capture misses the page.
  assert.ok(probe < capture, 'the probe is registered before the native-window capture')
  assert.equal(smoke.split('Page.addScriptToEvaluateOnNewDocument').length - 1, 1)
})


test('native startup history survives a locked latest log and concurrent writers preserve complete events', { skip: process.platform !== 'win32' }, async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-trace-'))
  t.after(() => rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const host = await readFile(path.join(projectRoot, 'launcher/windows/LauncherWindow.Host.cs'), 'utf8')
  const start = host.indexOf('        private void AppendHistoryLog(')
  const end = host.indexOf('        private async Task<List<string>> InspectWebViewForShutdownAsync(', start)
  assert.ok(start > 0 && end > start, 'the real native trace methods must be compiled')
  const cs = path.join(fixture, 'TraceProbe.cs'), exe = path.join(fixture, 'TraceProbe.exe')
  await writeFile(cs, [
    'using System; using System.Collections.Generic; using System.Diagnostics; using System.Globalization;',
    'using System.IO; using System.Text; using System.Text.RegularExpressions; using System.Threading;',
    'using System.Web.Script.Serialization;',
    'class TraceProbe {',
    '  string directory, startupId; long startupStartedAt; bool startupTraceActive = true;',
    '  JavaScriptSerializer json = new JavaScriptSerializer();',
    '  string ResolveLauncherLogDirectory() { return directory; }',
    host.slice(start, end),
    '  static int Main(string[] args) {',
    '    var probe = new TraceProbe { directory = args[0], startupId = args[1], startupStartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };',
    '    Directory.CreateDirectory(probe.directory);',
    '    if (args[2] == "locked") {',
    '      using (var held = new FileStream(Path.Combine(probe.directory, "startup-latest.jsonl"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {',
    '        probe.AppendStartupTrace("native-host", "native-loading-ready", new Dictionary<string, object> { { "paintedFrames", 1 } });',
    '      }',
    '      return 0;',
    '    }',
    '    File.WriteAllText(Path.Combine(probe.directory, args[2] + ".ready"), "ready");',
    '    var barrier = Stopwatch.StartNew();',
    '    while (Directory.GetFiles(probe.directory, "*.ready").Length < 2) {',
    '      if (barrier.ElapsedMilliseconds > 5000) throw new TimeoutException("trace writer barrier");',
    '      Thread.Sleep(1);',
    '    }',
    '    for (int i = 0; i < 32; i++) probe.AppendStartupTrace("native-host", args[2] + "-" + i, null);',
    '    return 0;',
    '  }',
    '}', '',
  ].join('\n'))
  await execFileAsync(cscPath(), ['/nologo', '/target:exe', '/reference:System.dll',
    '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll', '/out:' + exe, cs],
  { windowsHide: true, timeout: 30000 })
  const id = 'a'.repeat(32)
  const locked = path.join(fixture, 'locked')
  await execFileAsync(exe, [locked, id, 'locked'], { windowsHide: true, timeout: 15000 })
  const events = text => text.trim().split(/\r?\n/).map(JSON.parse)
  const lockedEvents = events(await readFile(path.join(locked, 'history', id, 'startup.jsonl'), 'utf8'))
  assert.equal(lockedEvents.length, 1)
  assert.equal(lockedEvents[0].phase, 'native-loading-ready')
  assert.equal(lockedEvents[0].paintedFrames, 1)
  assert.equal(await readFile(path.join(locked, 'startup-latest.jsonl'), 'utf8'), '')
  const concurrent = path.join(fixture, 'concurrent')
  await Promise.all(['one', 'two'].map(worker => execFileAsync(exe, [concurrent, id, worker], { windowsHide: true, timeout: 15000 })))
  for (const relative of ['startup-latest.jsonl', path.join('history', id, 'startup.jsonl')]) {
    const written = events(await readFile(path.join(concurrent, relative), 'utf8'))
    assert.equal(written.length, 64, relative + ' must preserve every event')
    assert.ok(written.every(entry => entry.startupId === id && entry.component === 'native-host'))
    const phases = new Set(written.map(entry => entry.phase))
    assert.equal(phases.size, 64, relative + ' must not contain overwritten or duplicate events')
    for (const worker of ['one', 'two']) for (let index = 0; index < 32; index++) assert.ok(phases.has(worker + '-' + index))
  }
})
