import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
if (!process.argv[2] || process.platform !== 'win32') {
  throw new Error('usage: node smoke-windows-native-restart.mjs <DSH-Portable root> (Windows only)')
}

const executable = path.join(root, 'DeepSeek-Herness.exe')
const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const runtimeEntry = path.join(root, 'launcher', 'runtime-entry.mjs')
for (const filename of [executable, portableNode, runtimeEntry]) {
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

async function waitForPage(port, excludedId = '', timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(target => target.id !== excludedId && target.type === 'page'
          && /^http:\/\/127\.0\.0\.1:\d+/.test(target.url || ''))
        if (page?.webSocketDebuggerUrl) return page
      }
    } catch { /* WebView2 is still starting or restarting. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for the restarted embedded DSH page')
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

async function waitForValue(client, expression, predicate, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await evaluate(client, expression)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${label}; latest=${JSON.stringify(latest)}`)
}

async function stopProduct() {
  await execFileAsync(portableNode, [runtimeEntry, 'portable-cli.mjs', 'stop', '--no-browser', '--json'], {
    cwd: root,
    windowsHide: true,
    timeout: 120000,
  }).catch(() => {})
  const script = `$target=$env:DSH_PORTABLE_SMOKE_EXECUTABLE; Get-CimInstance Win32_Process -Filter "Name='DeepSeek-Herness.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($target,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, DSH_PORTABLE_SMOKE_EXECUTABLE: executable },
  }).catch(() => {})
}

let launcher = null
let firstClient = null
let secondClient = null
try {
  await stopProduct()
  const debugPort = await reserveLoopbackPort()
  launcher = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
      DSH_PORTABLE_TEST_AUTOMATION: '1',
      DSH_PORTABLE_TEST_HIDDEN: '1',
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const firstPage = await waitForPage(debugPort)
  firstClient = new CdpClient(firstPage.webSocketDebuggerUrl)
  await firstClient.open()
  await firstClient.send('Runtime.enable')
  const firstBoot = await waitForValue(
    firstClient,
    `typeof window.__DSH_PORTABLE_HOST__?.restart === 'function' ? fetch('/dsh-market/status',{cache:'no-store'}).then(r=>r.json()).then(x=>x.boot) : null`,
    value => typeof value === 'string' && value.length > 0,
    'native restart bridge',
  )
  assert.equal(await evaluate(firstClient, `(() => { window.__DSH_RESTART_SMOKE__ = 'requested'; window.__DSH_PORTABLE_HOST__.restart().catch(() => {}); return true })()`), true)

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('original desktop host did not exit for restart')), 60000)
    launcher.once('exit', () => { clearTimeout(timeout); resolve() })
  })
  firstClient.close()
  firstClient = null

  const secondPage = await waitForPage(debugPort, firstPage.id)
  secondClient = new CdpClient(secondPage.webSocketDebuggerUrl)
  await secondClient.open()
  const secondBoot = await waitForValue(
    secondClient,
    `fetch('/dsh-market/status',{cache:'no-store'}).then(r=>r.json()).then(x=>x.boot).catch(()=>null)`,
    value => typeof value === 'string' && value.length > 0 && value !== firstBoot,
    'new boot id',
  )
  assert.notEqual(secondBoot, firstBoot)

  const log = await readFile(path.join(root, 'data', 'logs', 'launcher.log'), 'utf8')
  assert.match(log, /\[restart-host\] request-accepted/)
  assert.match(log, /\[restart-host\] reply-posted[^\n]+ok=true/)
  assert.match(log, /\[restart-host\] relaunch-scheduled/)
  console.log(JSON.stringify({ status: 'passed', firstBoot, secondBoot }))
} finally {
  firstClient?.close()
  secondClient?.close()
  await stopProduct()
}
