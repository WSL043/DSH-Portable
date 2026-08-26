import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
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

let launcher = null
let client = null
try {
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
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
  await waitForValue(client, 'location.href', value => /^http:\/\/127\.0\.0\.1:\d+\//.test(value || ''), 'DSH application origin')
  await waitForValue(client, "Boolean(document.body && document.readyState !== 'loading')", Boolean, 'DSH document readiness')
  await evaluate(client, `(() => {
    window.__dshNativeDialogResults = {}
    window.chrome.webview.addEventListener('message', event => {
      if (event.data?.type === 'dsh-portable/pick-directory-result' && event.data?.requestId === 'workspace-smoke') {
        window.__dshNativeDialogResults.workspace = event.data
      }
      if (event.data?.type === 'dsh-portable/pick-data-export-result' && event.data?.requestId === 'data-export-smoke') {
        window.__dshNativeDialogResults.dataExport = event.data
      }
      if (event.data?.type === 'dsh-portable/pick-data-import-result' && event.data?.requestId === 'data-import-smoke') {
        window.__dshNativeDialogResults.dataImport = event.data
      }
    })
    window.chrome.webview.postMessage({ type: 'dsh-portable/pick-directory', schemaVersion: 1, requestId: 'workspace-smoke' })
    return true
  })()`)

  const result = await waitForValue(client, 'window.__dshNativeDialogResults.workspace', value => value?.cancelled === true, 'workspace-picker cancellation', 45000)
  assert.equal(result.requestId, 'workspace-smoke')
  await evaluate(client, `window.chrome.webview.postMessage({ type: 'dsh-portable/pick-data-export', schemaVersion: 1, requestId: 'data-export-smoke', kind: 'standard' })`)
  const dataExport = await waitForValue(client, 'window.__dshNativeDialogResults.dataExport', value => value?.cancelled === true, 'data-export dialog cancellation', 45000)
  assert.equal(dataExport.requestId, 'data-export-smoke')
  await evaluate(client, `window.chrome.webview.postMessage({ type: 'dsh-portable/pick-data-import', schemaVersion: 1, requestId: 'data-import-smoke' })`)
  const dataImport = await waitForValue(client, 'window.__dshNativeDialogResults.dataImport', value => value?.cancelled === true, 'data-import dialog cancellation', 45000)
  assert.equal(dataImport.requestId, 'data-import-smoke')
  const launcherLogPath = path.join(root, 'data', 'logs', 'launcher.log')
  const launcherLog = existsSync(launcherLogPath) ? await readFile(launcherLogPath, 'utf8') : '(launcher.log is missing)'
  assert.match(launcherLog, /\[workspace-picker\] dialog-detected hwnd=\d+ owner=\d+ class=\S+/)
  assert.match(launcherLog, /\[workspace-picker\] dialog-closed result=Cancel/)
  assert.match(launcherLog, /\[data-export-dialog\] dialog-detected hwnd=\d+ owner=\d+ class=\S+/)
  assert.match(launcherLog, /\[data-import-dialog\] dialog-detected hwnd=\d+ owner=\d+ class=\S+/)
  process.stdout.write(`${JSON.stringify({ status: 'passed', nativeDialog: true, workspace: 'cancelled', dataExport: 'cancelled', dataImport: 'cancelled' })}\n`)
} finally {
  client?.close()
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  if (launcher?.pid) {
    try { await execFileAsync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true }) } catch { /* already stopped */ }
  }
}
