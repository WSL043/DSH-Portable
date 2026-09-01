import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '..')
const launcherSource = path.join(projectRoot, 'launcher', 'windows', 'DSH-Portable.cs')

test('Windows desktop host waits for the usable DOM and reports the failing boundary', async () => {
  const source = await readFile(launcherSource, 'utf8')
  assert.match(source, /WorkspaceNavigationTimeoutMs\s*=\s*60000/)
  assert.match(source, /TaskCompletionSource<bool>\s+workspaceUsable/)
  assert.match(source, /EventHandler<CoreWebView2DOMContentLoadedEventArgs>\s+domLoaded/)
  assert.match(source, /DOMContentLoaded\s*\+=\s*domLoaded/)
  assert.match(source, /ProbeWorkspaceDomAsync\(url\)/)
  assert.match(source, /WaitForWorkspaceHandoffAsync\(url, workspaceSurfaceReady\.Task\)/)
  assert.match(source, /WaitForWorkspaceHandoffAsync[\s\S]+getBoundingClientRect\(\)[\s\S]+await Task\.Delay\(50\)/)
  assert.match(source, /gate\.readyPolls\+\+/)
  assert.match(source, /visibleControls>=2/)
  assert.doesNotMatch(source, /gate\.lastMutation|MutationObserver\(function\(records\)/)
  assert.match(source, /surface-handoff:/)
  assert.match(source, /dsh-portable\/surface-ready/)
  assert.match(source, /native-bridge/)
  assert.match(source, /stable-workspace/)
  assert.match(source, /ExecuteScriptAsync/)
  assert.match(source, /workspaceUsable\.TrySetResult\(true\)/)
  assert.match(source, /Task\.WhenAny\(workspaceUsable\.Task,\s*navigation\.Task,\s*webViewProcessFailure\.Task,\s*timeout\)/)
  assert.match(source, /webView\.Visible\s*=\s*true/)
  assert.match(source, /launchPanel\.BringToFront\(\)/)
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
  assert.match(source, /first-paint-timeout:/)
  assert.match(source, /visibleControls:visibleControls/)
})

test('Windows finished-product smoke proves usable DOM wins over a stalled subresource', async () => {
  const [source, smoke, workflow] = await Promise.all([
    readFile(launcherSource, 'utf8'),
    readFile(path.join(projectRoot, 'scripts', 'smoke-windows-dom-ready.ps1'), 'utf8'),
    readFile(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
  ])
  assert.match(source, /DSH_PORTABLE_TEST_STALLED_RESOURCE_URL/)
  assert.match(source, /DSH_PORTABLE_TEST_CONTINUOUS_DOM_MUTATION/)
  assert.match(source, /AddScriptToExecuteOnDocumentCreatedAsync/)
  assert.match(smoke, /DshStalledHttpServer/)
  assert.match(smoke, /never-finishes\.png/)
  assert.match(smoke, /DSH_PORTABLE_TEST_CONTINUOUS_DOM_MUTATION/)
  assert.match(smoke, /"phase":"interactive-ready"/)
  assert.match(smoke, /-not \$InteractiveReady/)
  assert.match(smoke, /DesktopWidth\s+-lt\s+900/)
  assert.match(workflow, /smoke-windows-dom-ready\.ps1/)
})

test('Windows overlaps cold WebView2 initialization with the first DSH start', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const runLauncher = source.slice(
    source.indexOf('private async Task RunLauncherAsync()'),
    source.indexOf('private async Task CheckForDesktopUpdateAsync'),
  )
  const webViewStart = runLauncher.indexOf('Task webViewInitialization = InitializeWebViewAsync()')
  const backendStart = runLauncher.indexOf('InvokePortableCli(new[] { "start", "--no-browser", "--json", "--progress-json" }')
  const webViewAwait = runLauncher.indexOf('await webViewInitialization')
  assert.ok(webViewStart >= 0 && webViewStart < backendStart)
  assert.ok(webViewAwait > backendStart)
})

test('Windows recovers a bounded WebView2 resource-in-use race after an update restart', async () => {
  const [source, bootstrap, upgradeSmoke] = await Promise.all([
    readFile(launcherSource, 'utf8'),
    readFile(path.join(projectRoot, 'launcher', 'windows', 'DSH-Bootstrap.cs'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts', 'smoke-windows-version-upgrade.mjs'), 'utf8'),
  ])

  assert.match(source, /WebViewResourceInUseHResult\s*=\s*unchecked\(\(int\)0x800700AA\)/)
  assert.match(source, /IsWebViewResourceInUse\(Exception error\)/)
  assert.match(source, /InitializeWebViewAttemptAsync/)
  assert.match(source, /ResetWebViewAfterInitializationFailure/)
  assert.match(source, /environment-busy-retry:/)
  assert.match(source, /WebViewInitializationMaxAttempts\s*=\s*[2-9]/)
  assert.match(source, /DSH_PORTABLE_TEST_WEBVIEW2_BUSY_ONCE/)
  assert.match(bootstrap, /StopRunningPortable\(\)[\s\S]+WaitForPortableWebViewRelease\(\)/)
  assert.match(bootstrap, /ResolvePortableWebViewDataRoot\(\)/)
  assert.match(bootstrap, /Get-CimInstance Win32_Process[\s\S]+DSH_PORTABLE_WEBVIEW_ROOT/)
  assert.match(upgradeSmoke, /--running-host/)
  assert.match(upgradeSmoke, /--simulate-webview-busy/)
  assert.match(upgradeSmoke, /dsh-first-paint-ready/)
  assert.match(upgradeSmoke, /environment-busy-retry:/)
})

test('Windows cold start shows the local workspace before checking for updates in the background', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const runLauncher = source.slice(
    source.indexOf('private async Task RunLauncherAsync()'),
    source.indexOf('private void ShowDesktopOperation'),
  )
  const startIndex = runLauncher.indexOf('InvokePortableCli(new[] { "start", "--no-browser", "--json", "--progress-json" }')
  const desktopIndex = runLauncher.indexOf('await ShowDesktopAsync(url)')
  const automaticCheckIndex = runLauncher.indexOf('CheckForDesktopUpdateAsync(false, "product")')
  assert.ok(startIndex >= 0, 'the native host must start the local DSH service')
  assert.ok(desktopIndex > startIndex, 'the WebView must open after the service is ready')
  assert.ok(automaticCheckIndex > desktopIndex, 'automatic update checking must begin only after the workspace is visible')
  assert.doesNotMatch(runLauncher.slice(0, desktopIndex), /CheckAndApplyUpdateAsync/)
  assert.match(source, /checkUpdateItem\.Click\s*\+=\s*async delegate \{ await CheckForDesktopUpdateAsync\(true, "product"\); \}/)
  assert.match(source, /checkEngineUpdateItem\.Click\s*\+=\s*async delegate \{ await CheckForDesktopUpdateAsync\(true, "engine"\); \}/)
})

test('Windows never treats an unavailable tray bridge state as permission to replace the running product', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const updateCheck = source.slice(
    source.indexOf('private async Task CheckForDesktopUpdateAsync(bool manual, string scope)'),
    source.indexOf('private void ShowDesktopOperation'),
  )
  const fullPackageBranch = updateCheck.slice(
    updateCheck.indexOf('if (updateStatus == "full-package-required")'),
    updateCheck.indexOf('if (updateStatus != "available")'),
  )

  assert.match(fullPackageBranch, /if \(!trayBridgeReady\)/)
  assert.ok(
    fullPackageBranch.indexOf('if (!trayBridgeReady)') < fullPackageBranch.indexOf('ShowUpdateChoiceDialog'),
    'the shell must fail closed before offering a complete-package replacement',
  )
  assert.match(fullPackageBranch, /if \(!manual\) return/)
  assert.match(fullPackageBranch, /正在读取任务状态|reading the current task state/i)
})

test('Windows update checking and update interaction use separate states', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const rebuild = source.slice(
    source.indexOf('private void RebuildTrayMenu()'),
    source.indexOf('private void RebuildRecentSessionItems'),
  )
  const updateCheck = source.slice(
    source.indexOf('private async Task CheckForDesktopUpdateAsync(bool manual, string scope)'),
    source.indexOf('private void ShowDesktopOperation'),
  )

  assert.match(source, /private bool updateCheckRunning;/)
  assert.match(source, /private bool updateInteractionRunning;/)
  assert.match(rebuild, /checkUpdateItem\.Text = updateCheckRunning\s*\? L\("正在检查…"/)
  assert.match(rebuild, /checkUpdateItem\.Enabled = !updateCheckRunning && !updateInteractionRunning/)
  assert.match(rebuild, /checkEngineUpdateItem\.Text = updateCheckRunning\s*\? L\("正在检查…"/)
  assert.match(rebuild, /checkEngineUpdateItem\.Enabled = !updateCheckRunning && !updateInteractionRunning/)
  assert.match(updateCheck, /FinishUpdateCheckPhase\(\);/)
  assert.ok(
    updateCheck.indexOf('FinishUpdateCheckPhase();') < updateCheck.indexOf('ShowUpdateChoiceDialog'),
    'the checking label must be cleared before waiting for the user update choice',
  )
})

test('Windows complete-package update choice never resizes the live workspace', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const updateCheck = source.slice(
    source.indexOf('private async Task CheckForDesktopUpdateAsync(bool manual, string scope)'),
    source.indexOf('private void ShowDesktopOperation'),
  )
  const choice = source.slice(
    source.indexOf('private int ShowUpdateChoiceDialog('),
    source.indexOf('private void ResetOperationUi'),
  )

  assert.match(updateCheck, /int choice = ShowUpdateChoiceDialog\(/)
  assert.match(choice, /dialog\.ShowDialog\(this\)/)
  assert.doesNotMatch(choice, /^\s*ClientSize\s*=/m)
  assert.doesNotMatch(choice, /webView\.(?:Bounds|Size|Width|Height)\s*=/)
})
