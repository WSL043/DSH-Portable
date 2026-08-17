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
  assert.ok(
    host.indexOf('NavigationCompleted') < host.indexOf('launchPanel.Visible = false'),
    'the native loading view must remain until the embedded app finishes navigating',
  )
  assert.doesNotMatch(host.slice(0, host.indexOf('ShowDesktopAsync')), /MinimumSize\s*=\s*desktopStart\s*\?\s*new Size\(900,\s*620\)/)
  assert.match(host, /CloseOwnedDesktopHost/)
  assert.match(host, /Path\.GetFullPath\(process\.MainModule\.FileName\)/)
  assert.match(host, /PostMessage\(window, WmPortableExit/)
  assert.match(host, /process\.WaitForExit\(45000\)/)
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
  assert.match(host, /打开文件夹|Show in folder/)
  assert.match(host, /取消下载|Cancel download/)
  assert.match(host, /DSH_PORTABLE_DOWNLOAD_DIRECTORY/)
  assert.match(host, /DSH_PORTABLE_TEST_HIDDEN/)
})

test('Windows tray follows the Codex native bounded task-menu hierarchy', async () => {
  const host = await read('launcher/windows/DSH-Portable.cs')

  assert.doesNotMatch(host, /class\s+TrayTaskCenter\s*:\s*Form/)
  assert.match(host, /ContextMenuStrip\s*=\s*trayMenu/)
  assert.match(host, /trayIcon\.MouseClick\s*\+=/)
  assert.match(host, /sessions\.Take\(3\)/)
  assert.match(host, /sessions\.Skip\(3\)\.Take\(7\)/)
  assert.match(host, /CreateSectionHeader\("最近",\s*"Recent"\)/)
  assert.match(host, /ShortcutKeyDisplayString\s*=\s*SessionHint/)
  assert.match(host, /StringInfo\.ParseCombiningCharacters/)
  assert.match(host, /const\s+int\s+limit\s*=\s*35/)
  assert.match(host, /Equals\("coding"[\s\S]*L\("编码",\s*"Coding"\)/)
  assert.match(host, /Equals\("plan"[\s\S]*L\("计划",\s*"Plan"\)/)
  assert.match(host, /Equals\("review"[\s\S]*L\("复核",\s*"Review"\)/)
  assert.match(host, /ToolStripMenuItem\s+more\s*=\s*new ToolStripMenuItem\(L\("更多",\s*"More"\)\)/)
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
  const [workflow, windowsSmoke, macSmoke] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('scripts/smoke-windows-desktop-host.ps1'),
    read('scripts/smoke-macos-desktop-host.sh'),
  ])

  assert.match(workflow, /windows-desktop-host:/)
  assert.match(workflow, /smoke-windows-desktop-host\.ps1/)
  assert.match(workflow, /smoke-windows-native-tray\.ps1/)
  assert.match(workflow, /smoke-windows-native-download\.mjs/)
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
