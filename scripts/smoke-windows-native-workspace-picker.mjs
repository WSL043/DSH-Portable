import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
param([int]$ProcessId, [switch]$Close)
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public sealed class DshDialogInfo {
  public long hwnd { get; set; }
  public long owner { get; set; }
  public int ownerPid { get; set; }
  public string className { get; set; }
  public bool visible { get; set; }
}
public static class DshWindowProbe {
  private const uint WM_CLOSE = 0x0010;
  private const uint SMTO_BLOCK = 0x0001;
  private const uint SMTO_ABORTIFHUNG = 0x0002;
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maximum);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  public static bool Cancel(IntPtr hwnd) {
    UIntPtr result;
    return SendMessageTimeout(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero, SMTO_BLOCK | SMTO_ABORTIFHUNG, 5000, out result) != IntPtr.Zero;
  }
  public static DshDialogInfo[] Find(int processId) {
    List<DshDialogInfo> result = new List<DshDialogInfo>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr ignored) {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      StringBuilder className = new StringBuilder(256);
      GetClassName(hwnd, className, className.Capacity);
      IntPtr owner = GetWindow(hwnd, 4);
      uint ownerPid;
      GetWindowThreadProcessId(owner, out ownerPid);
      // FolderBrowserDialog can use different native window classes across
      // supported Windows/WebView2 images. Ownership and visibility are the
      // stable product contract; the implementation class is not.
      if (pid == processId && owner != IntPtr.Zero && ownerPid == processId && IsWindowVisible(hwnd)) {
        result.Add(new DshDialogInfo { hwnd = hwnd.ToInt64(), owner = owner.ToInt64(), ownerPid = (int)ownerPid, className = className.ToString(), visible = IsWindowVisible(hwnd) });
      }
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
$dialogs = @([DshWindowProbe]::Find($ProcessId))
if ($Close) {
  if ($dialogs.Count -ne 1) { throw "Expected one owned workspace dialog, found $($dialogs.Count)." }
  if (-not [DshWindowProbe]::Cancel([IntPtr]$dialogs[0].hwnd)) { throw "The workspace dialog did not process WM_CLOSE." }
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
      DSH_PORTABLE_TEST_HIDDEN: '1',
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: 'ignore',
    windowsHide: true,
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

  const deadline = Date.now() + 15000
  let dialogs = []
  while (Date.now() < deadline) {
    const output = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePath, String(launcher.pid)], { windowsHide: true })
    const parsed = JSON.parse(output.stdout || '[]')
    dialogs = Array.isArray(parsed) ? parsed : [parsed]
    if (dialogs.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(dialogs.length >= 1, 'the native workspace dialog did not appear')
  const dialog = dialogs.find(item => item.visible === true) || dialogs[0]
  assert.ok(Number(dialog.owner) > 0, 'the workspace dialog has no native owner')
  assert.equal(Number(dialog.ownerPid), launcher.pid, 'the workspace dialog is not owned by DeepSeek-Herness.exe')

  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePath, String(launcher.pid), '-Close'], { windowsHide: true })
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
