import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '..')
const launcherSource = path.join(projectRoot, 'launcher', 'windows', 'DSH-Portable.cs')

test('Windows desktop host waits for the usable DOM and reports the failing boundary', async () => {
  const source = await readFile(launcherSource, 'utf8')
  assert.match(source, /WorkspaceNavigationTimeoutMs\s*=\s*60000/)
  assert.match(source, /DOMContentLoaded\s*\+=/)
  assert.match(source, /ProbeWorkspaceDocument/)
  assert.match(source, /Stopwatch probeBudget = Stopwatch\.StartNew\(\)/)
  assert.match(source, /stream\.ReadTimeout = Math\.Max\(1, remaining\)/)
  assert.match(source, /BrowserVersionString/)
  assert.match(source, /string webViewSnapshot = WebViewEnvironmentSnapshot\(\)/)
  assert.match(source, /WorkspaceFailureDiagnostics\(url, webViewSnapshot\)/)
  assert.match(source, /dsh\.stderr\.log/)
  assert.doesNotMatch(source, /Task\.Delay\(30000\)/)
  assert.doesNotMatch(source, /工作台未能在 30 秒内打开|workspace did not open within 30 seconds/)
  assert.match(source, /60 秒内打开/)
  assert.match(source, /within 60 seconds/)
})

test('Windows overlaps cold WebView2 initialization with the first DSH start', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const runLauncher = source.slice(
    source.indexOf('private async Task RunLauncherAsync()'),
    source.indexOf('private async Task CheckForDesktopUpdateAsync'),
  )
  const webViewStart = runLauncher.indexOf('Task webViewInitialization = InitializeWebViewAsync()')
  const backendStart = runLauncher.indexOf('InvokePortableCli(new[] { "start", "--no-browser", "--json" })')
  const webViewAwait = runLauncher.indexOf('await webViewInitialization')
  assert.ok(webViewStart >= 0 && webViewStart < backendStart)
  assert.ok(webViewAwait > backendStart)
})

test('Windows cold start shows the local workspace before checking for updates in the background', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const runLauncher = source.slice(
    source.indexOf('private async Task RunLauncherAsync()'),
    source.indexOf('private void ShowDesktopOperation'),
  )
  const startIndex = runLauncher.indexOf('InvokePortableCli(new[] { "start", "--no-browser", "--json" })')
  const desktopIndex = runLauncher.indexOf('await ShowDesktopAsync(url)')
  const automaticCheckIndex = runLauncher.indexOf('CheckForDesktopUpdateAsync(false)')
  assert.ok(startIndex >= 0, 'the native host must start the local DSH service')
  assert.ok(desktopIndex > startIndex, 'the WebView must open after the service is ready')
  assert.ok(automaticCheckIndex > desktopIndex, 'automatic update checking must begin only after the workspace is visible')
  assert.doesNotMatch(runLauncher.slice(0, desktopIndex), /CheckAndApplyUpdateAsync/)
  assert.match(source, /checkUpdateItem\.Click\s*\+=\s*async delegate \{ await CheckForDesktopUpdateAsync\(true\); \}/)
})

test('Windows never treats an unavailable tray bridge state as permission to replace the running product', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const updateCheck = source.slice(
    source.indexOf('private async Task CheckForDesktopUpdateAsync(bool manual)'),
    source.indexOf('private void ShowDesktopOperation'),
  )
  const fullPackageBranch = updateCheck.slice(
    updateCheck.indexOf('if (updateStatus == "full-package-required")'),
    updateCheck.indexOf('if (updateStatus != "available")'),
  )

  assert.match(fullPackageBranch, /if \(!trayBridgeReady\)/)
  assert.ok(
    fullPackageBranch.indexOf('if (!trayBridgeReady)') < fullPackageBranch.indexOf('ShowUpdateChoiceAsync'),
    'the shell must fail closed before offering a complete-package replacement',
  )
  assert.match(fullPackageBranch, /if \(!manual\) return/)
  assert.match(fullPackageBranch, /正在读取任务状态|reading the current task state/i)
})
