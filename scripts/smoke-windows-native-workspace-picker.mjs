import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('usage: node smoke-windows-native-workspace-picker.mjs <DSH-Portable root>')
if (process.platform !== 'win32') throw new Error('the native workspace-picker smoke is Windows-only')

const executable = path.join(root, 'DeepSeek-Herness.exe')
const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const portableCli = path.join(root, 'launcher', 'portable-cli.mjs')
for (const filename of [executable, portableNode, portableCli]) {
  if (!existsSync(filename)) throw new Error(`portable file is missing: ${filename}`)
}

async function reserveLoopbackPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (!port) throw new Error('could not reserve a WebView2 DevTools port')
  return port
}

async function waitForPage(port, launcher, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error(`desktop host exited before WebView2 became ready: ${launcher.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(target.url || ''))
        if (page?.webSocketDebuggerUrl) return page
      }
    } catch { /* WebView2 is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for the embedded DSH page')
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`))
      else pending.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() { this.socket.close() }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  return response.result?.value
}

async function waitForValue(client, expression, predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await evaluate(client, expression)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${label}; latest=${JSON.stringify(latest)}`)
}

async function portable(args) {
  return execFileAsync(portableNode, [portableCli, ...args], {
    cwd: root,
    env: { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' },
    timeout: 90000,
    windowsHide: true,
  })
}

const probeSource = String.raw`
param([int]$ProcessId, [long]$WindowHandle = 0, [switch]$Close)
Add-Type @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public sealed class DshDialogInfo {
  public long hwnd { get; set; }
  public long owner { get; set; }
  public int ownerPid { get; set; }
  public string className { get; set; }
  public bool visible { get; set; }
}
public static class DshWindowProbe {
  private const uint WM_CLOSE = 0x0010;
  private const uint WM_COMMAND = 0x0111;
  private const uint BM_CLICK = 0x00F5;
  private const int IDCANCEL = 2;
  private const uint SMTO_BLOCK = 0x0001;
  private const uint SMTO_ABORTIFHUNG = 0x0002;
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr hwnd, int identifier);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maximum);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr parameter);
  private static bool WaitUntilClosed(IntPtr hwnd, int timeoutMs = 1500) {
    int deadline = Environment.TickCount + timeoutMs;
    while (IsWindow(hwnd) && Environment.TickCount < deadline) Thread.Sleep(25);
    return !IsWindow(hwnd);
  }
  public static bool CancelUntilClosed(IntPtr hwnd, int timeoutMs = 12000) {
    long deadline = Environment.TickCount64 + timeoutMs;
    // Server 2025 can expose the common-item dialog before its native controls
    // process input. Keep the user-equivalent cancel path bounded, but retry it
    // until the same captured dialog really closes instead of accepting a
    // message acknowledgement as completion.
    while (IsWindow(hwnd) && Environment.TickCount64 < deadline) {
      UIntPtr result;
      IntPtr cancel = GetDlgItem(hwnd, IDCANCEL);
      if (cancel != IntPtr.Zero) {
        SendMessageTimeout(cancel, BM_CLICK, IntPtr.Zero, IntPtr.Zero, SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out result);
        if (WaitUntilClosed(hwnd, 500)) return true;
      }
      SendMessageTimeout(hwnd, WM_COMMAND, new IntPtr(IDCANCEL), cancel, SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out result);
      if (WaitUntilClosed(hwnd, 500)) return true;
      SendMessageTimeout(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero, SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out result);
      if (WaitUntilClosed(hwnd, 500)) return true;
      Thread.Sleep(100);
    }
    return !IsWindow(hwnd);
  }
  public static DshDialogInfo[] Find(int processId) {
    List<DshDialogInfo> result = new List<DshDialogInfo>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr ignored) {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      IntPtr owner = GetWindow(hwnd, 4);
      uint ownerPid;
      GetWindowThreadProcessId(owner, out ownerPid);
      StringBuilder className = new StringBuilder(256);
      GetClassName(hwnd, className, className.Capacity);
      // FolderBrowserDialog can use different native window classes across
      // supported Windows images. A modal popup is the visible same-process
      // window whose direct owner is another window in the DSH process. This is
      // stable while the real host window remains visible to the desktop.
      if (pid == processId && owner != IntPtr.Zero && owner != hwnd && ownerPid == processId && IsWindowVisible(hwnd)) {
        result.Add(new DshDialogInfo { hwnd = hwnd.ToInt64(), owner = owner.ToInt64(), ownerPid = (int)ownerPid, className = className.ToString(), visible = true });
      }
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
$dialogs = @([DshWindowProbe]::Find($ProcessId))
if ($Close) {
  $target = @($dialogs | Where-Object { $_.hwnd -eq $WindowHandle })
  if ($target.Count -ne 1) { throw "The captured workspace dialog is no longer the active popup owned by the DSH window." }
  if (-not [DshWindowProbe]::CancelUntilClosed([IntPtr]$target[0].hwnd)) { throw "The workspace dialog did not process its native cancel command." }
}
ConvertTo-Json -Compress -InputObject @($dialogs)
`

let launcher = null
let client = null
let probeRoot = ''
try {
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  probeRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-picker-'))
  const probePath = path.join(probeRoot, 'window-probe.ps1')
  await writeFile(probePath, probeSource, 'utf8')
  const debugPort = await reserveLoopbackPort()
  launcher = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
      DSH_PORTABLE_TEST_AUTOMATION: '1',
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: 'ignore',
  })

  const page = await waitForPage(debugPort, launcher)
  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await waitForValue(client, "Boolean(document.body && document.readyState !== 'loading')", Boolean, 'DSH document readiness')
  await evaluate(client, `(() => {
    window.__dshWorkspacePickerResult = null
    window.chrome.webview.addEventListener('message', event => {
      if (event.data?.type === 'dsh-portable/pick-directory-result' && event.data?.requestId === 'workspace-smoke') {
        window.__dshWorkspacePickerResult = event.data
      }
    })
    window.chrome.webview.postMessage({ type: 'dsh-portable/pick-directory', schemaVersion: 1, requestId: 'workspace-smoke' })
    return true
  })()`)

  // Windows Server 2025 can take longer to create the system folder picker on
  // the first invocation even after the embedded page is ready. This remains
  // bounded and still verifies the real owned native dialog rather than a mock.
  const deadline = Date.now() + 45000
  let dialogs = []
  while (Date.now() < deadline) {
    const output = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePath, String(launcher.pid)], { windowsHide: true })
    const parsed = JSON.parse(output.stdout || '[]')
    dialogs = parsed == null ? [] : (Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed])
    if (dialogs.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (dialogs.length === 0) {
    const launcherLogPath = path.join(root, 'data', 'logs', 'launcher.log')
    const launcherLog = existsSync(launcherLogPath) ? await readFile(launcherLogPath, 'utf8') : '(launcher.log is missing)'
    assert.fail(`the native workspace dialog did not appear; launcher.log tail:\n${launcherLog.slice(-8000)}`)
  }
  const dialog = dialogs.find(item => item.visible === true) || dialogs[0]
  assert.ok(Number(dialog.owner) > 0, 'the workspace dialog has no native owner')
  assert.equal(Number(dialog.ownerPid), launcher.pid, 'the workspace dialog is not owned by DeepSeek-Herness.exe')

  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePath, String(launcher.pid), '-WindowHandle', String(dialog.hwnd), '-Close'], { windowsHide: true })
  const result = await waitForValue(client, 'window.__dshWorkspacePickerResult', value => value?.cancelled === true, 'workspace-picker cancellation')
  assert.equal(result.requestId, 'workspace-smoke')
  process.stdout.write(`${JSON.stringify({ status: 'passed', ownerPid: dialog.ownerPid, dialogClass: dialog.className, visible: dialog.visible, cancelled: true })}\n`)
} finally {
  client?.close()
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  if (launcher?.pid) {
    try { await execFileAsync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true }) } catch { /* already stopped */ }
  }
  if (probeRoot) await rm(probeRoot, { recursive: true, force: true })
}
