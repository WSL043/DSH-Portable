import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const evidenceFile = fileURLToPath(new URL('../build/native-download-evidence.json', import.meta.url))
const root = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('usage: node smoke-windows-native-download.mjs <DSH-Portable root>')
if (process.platform !== 'win32') throw new Error('the native WebView2 download smoke is Windows-only')

const executable = path.join(root, 'DeepSeek-Herness.exe')
const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const portableCli = path.join(root, 'launcher', 'portable-cli.mjs')
for (const filename of [executable, portableNode, portableCli]) {
  if (!existsSync(filename)) throw new Error(`portable file is missing: ${filename}`)
}

const evidence = { node: process.version, startedAt: new Date().toISOString(), phase: 'start', events: [] }
const documentIdentity = `({ url: location.href, readyState: document.readyState, timeOrigin: performance.timeOrigin,
  body: Boolean(document.body), appFrame: Boolean(document.querySelector('[data-shell-bottom]')),
  portableHost: Boolean(window.__DSH_PORTABLE_HOST__), nativeProtocol: window.__DSH_PORTABLE_NATIVE__?.protocolVersion,
  visibility: document.visibilityState, focused: document.hasFocus(),
  activationActive: navigator.userActivation?.isActive, activationEver: navigator.userActivation?.hasBeenActive })`
function safeUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'blob:' ? `blob:${url.origin}`
      : ['http:', 'https:'].includes(url.protocol) ? `${url.origin}${url.pathname}`
      : url.protocol === 'about:' ? `about:${url.pathname}` : url.protocol
  } catch { return undefined }
}
function safeDocument(value) { return value && { ...value, url: safeUrl(value.url) } }
const observedEvents = new Set(['Page.frameNavigated', 'Page.frameStartedLoading', 'Page.frameStoppedLoading',
  'Page.domContentEventFired', 'Page.loadEventFired', 'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared', 'Runtime.exceptionThrown',
  'Page.downloadWillBegin', 'Page.downloadProgress', 'Browser.downloadWillBegin', 'Browser.downloadProgress'])
function recordEvent(message) {
  if (!observedEvents.has(message.method)) return
  const params = message.params || {}, context = params.context || {}, frame = params.frame || {}
  evidence.events.push({ at: new Date().toISOString(), method: message.method,
    frameId: frame.id || params.frameId || context.auxData?.frameId, loaderId: frame.loaderId,
    contextId: context.id || params.executionContextId, defaultContext: context.auxData?.isDefault,
    url: safeUrl(frame.url || params.url || context.origin || params.exceptionDetails?.url),
    state: params.state, guid: params.guid, receivedBytes: params.receivedBytes, totalBytes: params.totalBytes })
  if (evidence.events.length > 100) evidence.events.shift()
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
      if (!message.id) { recordEvent(message); return }
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

async function triggerDownload(client, launcher, filename, body, expectedOrigin, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let latest = 'document changed before the download could be attached'
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error(`desktop host exited before the download was triggered: ${launcher.exitCode}`)
    try {
      const triggered = await evaluate(client, `(() => {
        const target = document.body
        if (!target || document.readyState === 'loading') return false
        if (location.origin !== ${JSON.stringify(expectedOrigin)}) return false
        const identity = ${documentIdentity}
        const blob = new Blob([${JSON.stringify(body)}], { type: 'text/plain;charset=utf-8' })
        const anchor = document.createElement('a')
        anchor.href = URL.createObjectURL(blob)
        anchor.download = ${JSON.stringify(filename)}
        target.appendChild(anchor)
        anchor.click()
        anchor.remove()
        return identity
      })()`)
      if (triggered) { evidence.trigger = { at: new Date().toISOString(), document: safeDocument(triggered) }; return }
    } catch (error) {
      latest = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out triggering the native download; latest=${latest}`)
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

  evidence.phase = 'wait-page'
  const page = await waitForPage(debugPort, launcher)
  evidence.target = { id: page.id, url: safeUrl(page.url) }
  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  evidence.phase = 'wait-document'
  await waitForDocumentBody(client, launcher)
  const filename = 'dsh-native-download-smoke.txt'
  const body = 'DSH native WebView2 download passed.'
  evidence.phase = 'trigger-download'
  await triggerDownload(client, launcher, filename, body, new URL(page.url).origin)

  const downloaded = path.join(downloadRoot, filename)
  evidence.phase = 'wait-file'
  const deadline = Date.now() + 30000
  while (!existsSync(downloaded) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  if (!existsSync(downloaded)) throw Object.assign(new Error('Native download did not create the expected file within 30000ms'), { code: 'NATIVE_DOWNLOAD_TIMEOUT' })
  evidence.phase = 'verify-content'
  assert.equal(await readFile(downloaded, 'utf8'), body)
  evidence.status = 'passed'
  process.stdout.write(`${JSON.stringify({ status: 'passed', host: 'WebView2', filename, bytes: Buffer.byteLength(body) })}\n`)
} catch (error) {
  evidence.status = 'failed'
  evidence.error = { name: error.name, code: error.code, syscall: error.syscall }
  throw error
} finally {
  // Observe before stopping the product or removing the disposable download directory.
  try {
    evidence.finishedAt = new Date().toISOString()
    evidence.launcher = { pid: launcher?.pid, exitCode: launcher?.exitCode }
    if (downloadRoot) {
      evidence.directory = { path: downloadRoot, realpath: await realpath(downloadRoot), entries: [] }
      for (const entry of (await readdir(downloadRoot, { withFileTypes: true })).slice(0, 32))
        evidence.directory.entries.push({ name: entry.name, file: entry.isFile(), bytes: (await stat(path.join(downloadRoot, entry.name))).size })
    }
    if (client) {
      const observation = client.send('Runtime.evaluate', { expression: documentIdentity, returnByValue: true, timeout: 1000 })
      const snapshot = await Promise.race([observation, new Promise((_, reject) => setTimeout(() => reject(new Error('diagnostic-timeout')), 1500))])
      evidence.finalDocument = safeDocument(snapshot.result?.value)
    }
  } catch (error) { evidence.observationError = error.code || error.name }
  try {
    await mkdir(path.dirname(evidenceFile), { recursive: true })
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
  } catch (error) { process.stderr.write(`Cannot retain native download evidence: ${error.code || error.name}\n`) }
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
