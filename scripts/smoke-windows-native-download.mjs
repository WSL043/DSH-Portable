import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('usage: node smoke-windows-native-download.mjs <DSH-Portable root>')
if (process.platform !== 'win32') throw new Error('the native WebView2 download smoke is Windows-only')

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
  let latest = ''
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error(`desktop host exited before WebView2 became ready: ${launcher.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      latest = await response.text()
      if (response.ok) {
        const targets = JSON.parse(latest)
        const page = targets.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(target.url || ''))
        if (page?.webSocketDebuggerUrl) return page
      }
    } catch { /* WebView2 is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for the embedded DSH page; latest=${latest.slice(-1000)}`)
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
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result?.value
}

async function waitForDocumentBody(client, launcher, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let latest = 'document is not ready'
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error(`desktop host exited before the DSH document became ready: ${launcher.exitCode}`)
    try {
      if (await evaluate(client, "Boolean(document.body && document.readyState !== 'loading')")) return
    } catch (error) {
      latest = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for the embedded DSH document body; latest=${latest}`)
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
let downloadRoot = ''
try {
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  downloadRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-download-'))
  const debugPort = await reserveLoopbackPort()
  launcher = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
      DSH_PORTABLE_TEST_HIDDEN: '1',
      DSH_PORTABLE_DOWNLOAD_DIRECTORY: downloadRoot,
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const page = await waitForPage(debugPort, launcher)
  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await waitForDocumentBody(client, launcher)
  const filename = 'dsh-native-download-smoke.txt'
  const body = 'DSH native WebView2 download passed.'
  await evaluate(client, `(() => {
    const blob = new Blob([${JSON.stringify(body)}], { type: 'text/plain;charset=utf-8' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = ${JSON.stringify(filename)}
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return true
  })()`)

  const downloaded = path.join(downloadRoot, filename)
  const deadline = Date.now() + 30000
  while (!existsSync(downloaded) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await readFile(downloaded, 'utf8'), body)
  process.stdout.write(`${JSON.stringify({ status: 'passed', host: 'WebView2', filename, bytes: Buffer.byteLength(body) })}\n`)
} finally {
  client?.close()
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  if (launcher?.pid) {
    try { await execFileAsync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true }) } catch { /* already stopped */ }
  }
  if (downloadRoot) {
    const tempRoot = path.resolve(os.tmpdir()) + path.sep
    const resolved = path.resolve(downloadRoot)
    if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('dsh-native-download-')) {
      throw new Error(`refusing to remove unexpected download root: ${resolved}`)
    }
    await rm(resolved, { recursive: true, force: true })
  }
}
