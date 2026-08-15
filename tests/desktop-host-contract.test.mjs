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
  assert.match(host, /FormClosing[\s\S]+InvokePortableCli[\s\S]+stop/)
  assert.match(host, /CloseOwnedDesktopHost/)
  assert.match(host, /Path\.GetFullPath\(process\.MainModule\.FileName\)/)
  assert.match(host, /process\.CloseMainWindow\(\)/)
  assert.match(host, /process\.WaitForExit\(45000\)/)
  assert.doesNotMatch(host, /--app=/)

  assert.equal(lock.webview2.package, 'Microsoft.Web.WebView2')
  assert.match(lock.webview2.version, /^\d+\.\d+\.\d+\.\d+$/)
  assert.match(lock.webview2.sha256, /^[0-9a-f]{64}$/)
  assert.match(build, /Microsoft\.Web\.WebView2\.Core\.dll/)
  assert.match(build, /Microsoft\.Web\.WebView2\.WinForms\.dll/)
  assert.match(build, /WebView2Loader\.dll/)
  assert.match(build, /WebView2-LICENSE\.txt/)
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
  assert.match(workflow, /macos-desktop-host:/)
  assert.match(workflow, /smoke-macos-desktop-host\.sh/)
  assert.doesNotMatch(workflow, /browser ownership and Stop|windows-browser-lifecycle:|macos-browser-lifecycle:/)

  assert.match(windowsSmoke, /io\.github\.wsl043\.dsh-portable/)
  assert.match(windowsSmoke, /MainWindowHandle/)
  assert.match(windowsSmoke, /msedge\.exe|chrome\.exe/)
  assert.match(windowsSmoke, /browser\.json/)
  assert.match(windowsSmoke, /CloseMainWindow/)
  assert.match(macSmoke, /DSH-Portable\.app/)
  assert.match(macSmoke, /WKWebView|WebKit/)
  assert.match(macSmoke, /CGWindowListCopyWindowInfo/)
  assert.match(macSmoke, /kCGWindowOwnerPID/)
  assert.doesNotMatch(macSmoke, /System Events/)
})

test('macOS package smokes treat the native app as a long-lived desktop process', async () => {
  const [portableSmoke, dmgSmoke] = await Promise.all([
    read('scripts/smoke-portable.mjs'),
    read('scripts/smoke-macos-dmg.sh'),
  ])

  assert.match(portableSmoke, /startNativeHost/)
  assert.match(portableSmoke, /waitForPortableStatus/)
  assert.match(portableSmoke, /Another portable launcher is already starting or stopping DSH/)
  assert.match(portableSmoke, /requestMacAppQuit/)
  assert.match(dmgSmoke, /HOST_PID=\$!/)
  assert.match(dmgSmoke, /status --json/)
  assert.match(dmgSmoke, /tell application id "io\.github\.wsl043\.dsh-portable\.installed" to quit/)
  assert.doesNotMatch(dmgSmoke, /^"\$APP\/Contents\/MacOS\/DeepSeek-Herness"$/m)
})
