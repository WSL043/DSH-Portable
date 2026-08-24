import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (filename) => readFile(new URL(`../${filename}`, import.meta.url), 'utf8')

test('Windows GUI is a native WebView2 host with its own stable taskbar identity', async () => {
  const [host, build, lock] = await Promise.all([
    read('launcher/windows/DSH-Portable.cs'),
    read('scripts/build-windows.ps1'),
    read('upstream.lock.json').then(JSON.parse),
  ])

  assert.match(host, /Microsoft\.Web\.WebView2\.WinForms/)
  assert.match(host, /CoreWebView2Environment\.CreateAsync/)
  assert.match(host, /SetCurrentProcessExplicitAppUserModelID\("io\.github\.wsl043\.dsh-portable"\)/)
  assert.match(host, /start["']\s*,\s*["']--no-browser["']\s*,\s*["']--json/)
  assert.match(host, /FormBorderStyle\.Sizable/)
  assert.match(host, /NotifyIcon/)
  assert.match(host, /launcher-settings\.json/)
  assert.match(host, /关闭窗口时/)
  assert.match(host, /最小化到托盘/)
  assert.match(host, /退出 DeepSeek Harness/)
  assert.match(host, /WmPortableRestore/)
  assert.match(host, /SignalExistingDesktopHost/)
  assert.match(host, /NavigationCompleted/)
  assert.match(host, /TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>/)
  assert.match(host, /private void FitWebViewToClient\(\)/)
  assert.match(host, /ClientSizeChanged\s*\+=\s*delegate\s*\{\s*FitWebViewToClient\(\);\s*\}/)
  const desktopReveal = host.slice(host.indexOf('private async Task ShowDesktopAsync'), host.indexOf('private void OnNewWindowRequested'))
  assert.ok(
    desktopReveal.lastIndexOf('FitWebViewToClient();') > desktopReveal.indexOf('RestoreDesktopWindowState();'),
    'the embedded WebView viewport must be refit after restoring the full desktop window size',
  )
  assert.match(desktopReveal, /BeginInvoke\(new Action\(FitWebViewToClient\)\)/)
  assert.ok(
    host.indexOf('NavigationCompleted') < host.indexOf('launchPanel.Visible = false'),
    'the native loading view must remain until the embedded app finishes navigating',
  )
  assert.doesNotMatch(host.slice(0, host.indexOf('ShowDesktopAsync')), /MinimumSize\s*=\s*desktopStart\s*\?\s*new Size\(900,\s*620\)/)
  assert.match(host, /CloseOwnedDesktopHost/)
  assert.match(host, /Path\.GetFullPath\(process\.MainModule\.FileName\)/)
  assert.match(host, /PostMessage\(window, WmPortableExit/)
  assert.match(host, /process\.WaitForExit\(45000\)/)
  const externalHostClose = host.slice(host.indexOf('private void CloseOwnedDesktopHost()'), host.indexOf('private delegate bool EnumWindowsCallback'))
  assert.doesNotMatch(externalHostClose, /process\.ExitCode/)
  assert.doesNotMatch(host, /--app=/)

  assert.equal(lock.webview2.package, 'Microsoft.Web.WebView2')
  assert.match(lock.webview2.version, /^\d+\.\d+\.\d+\.\d+$/)
  assert.match(lock.webview2.sha256, /^[0-9a-f]{64}$/)
  assert.match(build, /Microsoft\.Web\.WebView2\.Core\.dll/)
  assert.match(build, /Microsoft\.Web\.WebView2\.WinForms\.dll/)
  assert.match(build, /WebView2Loader\.dll/)
  assert.match(build, /WebView2-LICENSE\.txt/)
  assert.doesNotMatch(build, /Copy-Item\s+\$LauncherExe\s+\(Join-Path\s+\$Stage\s+'Stop DeepSeek-Herness\.exe'\)/)
})

test('Windows exit does not complete until the owned WebView2 runtime releases the portable folder', async () => {
  const [host, moveSmoke] = await Promise.all([
    read('launcher/windows/DSH-Portable.cs'),
    read('scripts/smoke-windows-desktop-move.ps1'),
  ])

  assert.match(host, /private CoreWebView2Environment webViewEnvironment;/)
  assert.match(host, /TaskCompletionSource<CoreWebView2BrowserProcessExitedEventArgs>/)
  assert.match(host, /private int ownedWebViewBrowserProcessId;/)
  assert.match(host, /webView\.CoreWebView2\.BrowserProcessId/)
  assert.doesNotMatch(host, /private readonly WebView2 webView;/)
  assert.match(host, /await WaitForWebViewExitAsync\(/)
  assert.match(host, /Owned WebView2 processes still hold the portable folder/)
  const webViewExit = host.slice(host.indexOf('private async Task WaitForWebViewExitAsync'), host.indexOf('private List<string> OwnedWebViewProcessDiagnostics'))
  assert.match(webViewExit, /WebView2 closingWebView\s*=\s*webView;/)
  assert.match(webViewExit, /webView\s*=\s*null;/)
  assert.match(webViewExit, /closingWebView\.CoreWebView2\.ProcessFailed\s*-=\s*OnWebViewProcessFailed/)
  assert.match(webViewExit, /Controls\.Remove\(closingWebView\)/)
  assert.match(webViewExit, /closingWebView\.Dispose\(\)/)
  assert.ok(
    webViewExit.indexOf('Controls.Remove(closingWebView)') < webViewExit.indexOf('closingWebView.Dispose()'),
    'the WinForms control must leave the visual tree before its controller is disposed',
  )
  assert.match(webViewExit, /DateTime deadline\s*=\s*DateTime\.UtcNow\.AddMilliseconds\(timeoutMs\)/)
  assert.match(webViewExit, /while \(DateTime\.UtcNow < deadline\)/)
  assert.match(webViewExit, /Task\.WhenAny\(exited, Task\.Delay\(pollDelayMs\)\)/)
  assert.match(webViewExit, /exitEventObserved/)
  assert.match(webViewExit, /remaining\s*=\s*await Task\.Run\(\(\) => OwnedWebViewProcessDiagnostics\(\)\)/)
  assert.match(webViewExit, /if \(remaining\.Count == 0\)/)
  assert.match(webViewExit, /restart Windows/i)
  assert.match(webViewExit, /TryForceReleaseOwnedWebViewProcesses\(remaining\)/)
  const forceRelease = host.slice(host.indexOf('private bool TryForceReleaseOwnedWebViewProcesses'), host.indexOf('private void WriteLauncherLog'))
  assert.match(forceRelease, /ownedWebViewBrowserProcessId/)
  assert.match(forceRelease, /Process\.GetCurrentProcess\(\)\.Id/)
  assert.match(forceRelease, /"pid="[\s\S]+" ppid="[\s\S]+" name=msedgewebview2\.exe"/i)
  assert.match(forceRelease, /ParseOwnedWebViewProcessDiagnostics/)
  assert.match(forceRelease, /SelectOwnedWebViewProcessTree/)
  assert.match(forceRelease, /OrderByDescending\([\s\S]*OwnedWebViewProcessDepth/)
  assert.match(forceRelease, /process\.Kill\(\)/)
  assert.match(forceRelease, /kill-requested pid=/)
  assert.doesNotMatch(forceRelease, /taskkill\.exe/)
  assert.doesNotMatch(forceRelease, /Process\.GetProcessesByName|Name = 'msedgewebview2\.exe'/)
  assert.match(host, /launcher\.log/)
  assert.match(host, /shutdown-webview/)
  assert.match(host, /begin hostPid=/)
  assert.match(host, /Application\.ExecutablePath/)
  assert.match(host, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/)
  assert.match(host, /CreateJobObject/)
  assert.match(host, /SetInformationJobObject/)
  assert.match(host, /AssignProcessToJobObject/)
  assert.match(host, /PortableProcessJob\.Initialize\(\)/)
  assert.ok(
    host.indexOf('PortableProcessJob.Initialize();') < host.indexOf('Application.Run(new LauncherWindow(args))'),
    'the native host must enter its job before WebView2 and DSH child processes are created',
  )
  assert.match(webViewExit, /PortableProcessJob\.ExitOwnedTree/)
  assert.match(webViewExit, /job-close-requested/)
  assert.match(host, /日志 \/ Log:/)

  const webViewDataRoot = host.slice(host.indexOf('private string ResolveWebViewDataRoot()'), host.indexOf('private static bool IsTrustedLoopbackUrl'))
  assert.match(webViewDataRoot, /Environment\.SpecialFolder\.LocalApplicationData/)
  assert.match(webViewDataRoot, /ResolvePortableInstanceId\(\)/)
  assert.match(webViewDataRoot, /ResolvePortableLocationKey\(\)/)
  assert.doesNotMatch(webViewDataRoot, /Path\.Combine\(root, "data", "webview2"\)/)
  assert.match(host, /private string ResolvePortableLocationKey\(\)/)
  assert.match(host, /private string ResolveLauncherLogDirectory\(\)/)
  assert.match(host, /Path\.Combine\(root, "data", "logs"\)/)

  const releaseFailure = host.slice(host.indexOf('await WaitForWebViewExitAsync'), host.indexOf('allowClose = true;', host.indexOf('await WaitForWebViewExitAsync')))
  assert.doesNotMatch(releaseFailure, /shutdownRunning\s*=\s*false/)

  const externalExit = host.slice(host.indexOf('if (message.Msg == WmPortableExit)'), host.indexOf('if (message.Msg == WmPortableRestore)'))
  assert.match(externalExit, /BeginDesktopShutdown\(/)
  assert.doesNotMatch(externalExit, /Close\(\)/)

  const fullPackageUpdate = host.slice(host.indexOf('private void StartFullPackageUpdate('), host.indexOf('private async Task RestoreDesktopAfterUpdateAttemptAsync'))
  assert.doesNotMatch(fullPackageUpdate, /allowClose\s*=\s*true|Close\(\)/)
  assert.match(fullPackageUpdate, /--manifest/)
  assert.match(host, /JsonString\(check\.Item2, "fullPackageManifestUrl"\)/)
  assert.doesNotMatch(fullPackageUpdate, /DefaultManifestUrl|update-channel-stable/)

  assert.doesNotMatch(moveSmoke, /Wait-ForPortableWebViewExit/)
  assert.match(moveSmoke, /lifecycle failed[\s\S]+Move-Item -LiteralPath \$Root -Destination \$MovedRoot/)
})

test('Windows workspace selection is owned by the native DSH window instead of a Node child process', async () => {
  const host = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  const bridge = await readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8')
  const smoke = await readFile(new URL('../scripts/smoke-windows-native-workspace-picker.mjs', import.meta.url), 'utf8')

  assert.match(bridge, /dsh-portable\/pick-directory/)
  assert.match(bridge, /dsh-portable\/pick-directory-result/)
  assert.match(host, /FolderBrowserDialog/)
  assert.match(host, /ShowDialog\(this\)/)
  assert.match(host, /dsh-portable\/pick-directory-result/)
  assert.match(host, /BeginInvoke/)
  assert.match(smoke, /SendMessageTimeout/)
  assert.match(smoke, /WM_CLOSE\s*=\s*0x0010/)
})

test('Windows owns browser chrome and file downloads instead of exposing Edge UI', async () => {
  const host = await read('launcher/windows/DSH-Portable.cs')

  assert.match(host, /AreDefaultContextMenusEnabled\s*=\s*false/)
  assert.match(host, /IsStatusBarEnabled\s*=\s*false/)
  assert.match(host, /DownloadStarting\s*\+=\s*OnDownloadStarting/)
  assert.match(host, /CoreWebView2DownloadStartingEventArgs/)
  assert.match(host, /eventArgs\.Handled\s*=\s*true/)
  assert.match(host, /SaveFileDialog/)
  assert.match(host, /CoreWebView2DownloadOperation/)
  assert.match(host, /BytesReceivedChanged/)
  assert.match(host, /StateChanged/)
  assert.match(host, /dsh-portable\/download/)
  assert.doesNotMatch(host, /DownloadProgressWindow/)
  assert.match(host, /DSH_PORTABLE_DOWNLOAD_DIRECTORY/)
  assert.match(host, /DSH_PORTABLE_TEST_HIDDEN/)
  assert.match(host, /DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS/)
  assert.match(host, /options\.AdditionalBrowserArguments\s*=\s*testBrowserArguments/)
})

test('Windows tray presents sessions and commands in one compact Codex-style native menu', async () => {
  const host = await read('launcher/windows/DSH-Portable.cs')

  assert.doesNotMatch(host, /class\s+TrayTaskFlyout\s*:\s*Form/)
  assert.doesNotMatch(host, /class\s+TraySessionRow\s*:\s*Control/)
  assert.match(host, /ContextMenuStrip\s*=\s*trayMenu/)
  assert.match(host, /trayIcon\.MouseUp\s*\+=\s*HandleTrayMouseUp/)
  assert.doesNotMatch(host, /ShowTrayTaskFlyout/)
  assert.match(host, /private void HandleTrayMouseUp[\s\S]+eventArgs\.Button\s*==\s*MouseButtons\.Left[\s\S]+RestoreFromTray\(\)/)
  assert.doesNotMatch(host, /trayMenu\.Show\(Cursor\.Position\)/)
  assert.match(host, /CreateSessionMenuItem/)
  assert.match(host, /trayState\.sessions[\s\S]+sessions\.Take\(3\)/)
  assert.match(host, /ShortcutKeyDisplayString[\s\S]+SessionHintForLocale/)
  assert.match(host, /MeasureTrayMenuWidth/)
  assert.doesNotMatch(host, /MinimumSize\s*=\s*new Size\(300,\s*0\)/)
  assert.doesNotMatch(host, /new Size\(298,\s*35\)/)
  assert.match(host, /StringInfo\.ParseCombiningCharacters/)
  assert.match(host, /const\s+int\s+limit\s*=\s*28/)
  assert.match(host, /Equals\("coding"[\s\S]*chinese\s*\?\s*"编码"\s*:\s*"Coding"/)
  assert.match(host, /Equals\("plan"[\s\S]*chinese\s*\?\s*"计划"\s*:\s*"Plan"/)
  assert.match(host, /Equals\("review"[\s\S]*chinese\s*\?\s*"复核"\s*:\s*"Review"/)
  assert.match(host, /String\.IsNullOrEmpty\(preset\)[\s\S]*chinese\s*\?\s*"已完成"\s*:\s*"Completed"/)
  assert.match(host, /Equals\("standard"[\s\S]*chinese\s*\?\s*"标准"\s*:\s*"Standard"/)
  assert.match(host, /ToolStripMenuItem\s+more\s*=\s*new ToolStripMenuItem\(L\("更多",\s*"More"\)\)/)
  assert.match(host, /more\.DropDownItems\.Add\(checkUpdateItem\)/)
  assert.match(host, /more\.DropDownItems\.Add\(automaticUpdateCheckItem\)/)
  assert.match(host, /more\.DropDownItems\.Add\(closeBehaviorItem\)/)
  assert.match(host, /trayMenu\.Items\.Add\(CreateOpenItem\(\)\)[\s\S]+foreach \(TrayBridgeSession session in sessions\.Take\(3\)\)/)
  assert.match(host, /more\.DropDownItems\.Add\(CreateReportProblemItem\(\)\)/)
  assert.doesNotMatch(host, /more\.DropDownItems\.Add\(CreateOpenItem\(\)\)/)
  assert.doesNotMatch(host, /more\.DropDownItems\.Add\(closeToTrayItem\)/)
  assert.doesNotMatch(host, /more\.DropDownItems\.Add\(closeToExitItem\)/)
  assert.doesNotMatch(host, /more\.DropDownItems\.Add\(updateMenu\)/)
  assert.doesNotMatch(host, /more\.DropDownItems\.Add\(closeBehaviorMenu\)/)
  assert.match(host, /新会话|New session/)
  assert.match(host, /反馈问题|Report a problem/)
  assert.match(host, /退出 DeepSeek Harness|Exit DeepSeek Harness/)
})

test('macOS GUI is a native WKWebView app rather than a Chrome app-mode launcher', async () => {
  const [host, build] = await Promise.all([
    read('launcher/macos/DeepSeek-Herness.swift'),
    read('scripts/build-macos.sh'),
  ])

  assert.match(host, /import WebKit/)
  assert.match(host, /WKWebView/)
  assert.match(host, /start", "--no-browser", "--json/)
  assert.match(host, /applicationShouldTerminateAfterLastWindowClosed/)
  assert.match(host, /stop", "--no-browser", "--json/)
  assert.doesNotMatch(host, /Google Chrome|Microsoft Edge|--app=/)
  assert.match(build, /swiftc[\s\S]+DeepSeek-Herness\.swift/)
})

test('CI release gate verifies native desktop ownership, lifecycle, and application identity', async () => {
  const [workflow, windowsSmoke, traySmoke, nativeDownloadSmoke, nativeWorkspacePickerSmoke, macSmoke] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('scripts/smoke-windows-desktop-host.ps1'),
    read('scripts/smoke-windows-native-tray.ps1'),
    read('scripts/smoke-windows-native-download.mjs'),
    read('scripts/smoke-windows-native-workspace-picker.mjs'),
    read('scripts/smoke-macos-desktop-host.sh'),
  ])

  assert.match(workflow, /windows-desktop-host:/)
  assert.match(workflow, /smoke-windows-desktop-move\.ps1/)
  assert.match(workflow, /smoke-windows-native-tray\.ps1/)
  assert.match(workflow, /runner:\s*windows-2022/)
  assert.match(workflow, /runner:\s*windows-2025/)
  assert.match(workflow, /smoke-windows-native-download\.mjs/)
  assert.match(workflow, /smoke-windows-native-workspace-picker\.mjs/)
  assert.match(workflow, /\$DownloadRoot = Join-Path \$env:RUNNER_TEMP 'dsh-native-download-host'/)
  assert.match(workflow, /smoke-windows-native-download\.mjs \(Join-Path \$DownloadRoot 'DSH-Portable'\)/)
  assert.doesNotMatch(traySmoke, /[^\x00-\x7F]/, 'Windows PowerShell 5.1 smoke scripts must remain encoding-safe without a BOM')
  assert.match(traySmoke, /CaptureDirectory/)
  assert.match(traySmoke, /Bitmap\.Save/)
  assert.match(nativeDownloadSmoke, /async function waitForDocumentBody/)
  assert.match(nativeDownloadSmoke, /document\.body\s*&&\s*document\.readyState\s*!==\s*['"]loading['"]/)
  assert.ok(
    nativeDownloadSmoke.indexOf('await waitForDocumentBody') < nativeDownloadSmoke.indexOf('await triggerDownload'),
    'the real native download smoke must wait for the embedded document before injecting a download',
  )
  assert.match(nativeDownloadSmoke, /const target = document\.body/)
  assert.match(nativeDownloadSmoke, /if \(!target \|\| document\.readyState === ['"]loading['"]\) return false/)
  assert.match(nativeDownloadSmoke, /target\.appendChild\(anchor\)/)
  assert.match(nativeWorkspacePickerSmoke, /dsh-portable\/pick-directory/)
  assert.match(nativeWorkspacePickerSmoke, /ownerPid/)
  assert.match(nativeWorkspacePickerSmoke, /SendMessageTimeout/)
  assert.match(nativeWorkspacePickerSmoke, /WM_CLOSE\s*=\s*0x0010/)
  assert.match(nativeWorkspacePickerSmoke, /mainWindow != IntPtr\.Zero && owner == mainWindow && IsWindowVisible\(hwnd\)/)
  assert.match(nativeWorkspacePickerSmoke, /-WindowHandle', String\(dialog\.hwnd\)/)
  assert.doesNotMatch(nativeWorkspacePickerSmoke, /className\.ToString\(\) == "#32770"/)
  assert.match(workflow, /macos-desktop-host:/)
  assert.match(workflow, /smoke-macos-desktop-host\.sh/)
  assert.doesNotMatch(workflow, /browser ownership and Stop|windows-browser-lifecycle:|macos-browser-lifecycle:/)

  assert.match(windowsSmoke, /io\.github\.wsl043\.dsh-portable/)
  assert.match(windowsSmoke, /MainWindowHandle/)
  assert.match(windowsSmoke, /msedge\.exe|chrome\.exe/)
  assert.match(windowsSmoke, /browser\.json/)
  assert.match(windowsSmoke, /CloseMainWindow/)
  assert.match(windowsSmoke, /minimiz(?:e|ed).+tray|托盘/is)
  assert.match(windowsSmoke, /launcher-settings\.json/)
  assert.match(windowsSmoke, /window-state\.json/)
  assert.match(windowsSmoke, /SetWindowPos/)
  assert.match(windowsSmoke, /not restored after restart/)
  assert.doesNotMatch(windowsSmoke, /Stop DeepSeek-Herness\.exe/)
  assert.match(windowsSmoke, /function Get-ProductStatus/)
  assert.match(windowsSmoke, /Another portable launcher is already starting or stopping DSH/)
  assert.match(macSmoke, /DSH-Portable\.app/)
  assert.match(macSmoke, /WKWebView|WebKit/)
  assert.match(macSmoke, /CGWindowListCopyWindowInfo/)
  assert.match(macSmoke, /kCGWindowOwnerPID/)
  assert.match(macSmoke, /case "\$\(uname -m\)" in/)
  assert.match(macSmoke, /arm64\|x86_64\)/)
  assert.match(macSmoke, /\/usr\/bin\/open -n -W "\$APP" --args --skip-update-check/)
  assert.doesNotMatch(macSmoke, /"\$START" --skip-update-check/)
  assert.match(macSmoke, /pgrep -f/)
  assert.doesNotMatch(macSmoke, /DSH_PORTABLE_SKIP_UPDATE_CHECK=1 "\$START"/)
  assert.doesNotMatch(macSmoke, /System Events/)
})

test('macOS package smokes treat the native app as a long-lived desktop process', async () => {
  const [portableSmoke, dmgSmoke] = await Promise.all([
    read('scripts/smoke-portable.mjs'),
    read('scripts/smoke-macos-dmg.sh'),
  ])

  assert.match(portableSmoke, /startNativeHost/)
  assert.match(portableSmoke, /['"]\/usr\/bin\/open['"]/)
  assert.match(portableSmoke, /['"]-n['"], ['"]-W['"], app, ['"]--args['"], ['"]--skip-update-check['"]/)
  assert.match(portableSmoke, /waitForPortableStatus/)
  assert.match(portableSmoke, /Another portable launcher is already starting or stopping DSH/)
  assert.match(portableSmoke, /requestMacAppQuit/)
  assert.match(dmgSmoke, /HOST_PID=\$!/)
  assert.match(dmgSmoke, /status --json/)
  assert.match(dmgSmoke, /tell application id "io\.github\.wsl043\.dsh-portable\.installed" to quit/)
  assert.doesNotMatch(dmgSmoke, /^"\$APP\/Contents\/MacOS\/DeepSeek-Herness"$/m)
})

test('native hosts preserve only safe on-screen window placement in product data', async () => {
  const [windowsHost, macHost] = await Promise.all([
    read('launcher/windows/DSH-Portable.cs'),
    read('launcher/macos/DeepSeek-Herness.swift'),
  ])

  assert.match(windowsHost, /window-state\.json/)
  assert.match(windowsHost, /SaveDesktopWindowState/)
  assert.match(windowsHost, /RestoreDesktopWindowState/)
  assert.match(windowsHost, /RestoreBounds/)
  assert.match(windowsHost, /Screen\.AllScreens/)
  assert.match(windowsHost, /Rectangle\.Intersect/)

  assert.match(macHost, /window-state\.json/)
  assert.match(macHost, /saveWindowFrame/)
  assert.match(macHost, /restoreWindowFrame/)
  assert.match(macHost, /NSScreen\.screens/)
  assert.match(macHost, /visibleFrame\.intersection/)
  assert.match(macHost, /options:\s*\.atomic/)
})
