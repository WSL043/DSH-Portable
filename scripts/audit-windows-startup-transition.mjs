import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
const output = path.resolve(process.argv[3] || path.join(root, 'data', 'logs', 'startup-transition-audit'))
const startupTimeoutSeconds = Number(process.argv[4] || 30)
if (!root) throw new Error('usage: node audit-windows-startup-transition.mjs <DSH-Portable root> [output] [startup-timeout-seconds]')
if (process.platform !== 'win32') throw new Error('the startup transition audit is Windows-only')
if (!Number.isFinite(startupTimeoutSeconds) || startupTimeoutSeconds < 1 || startupTimeoutSeconds > 120) {
  throw new Error('startup-timeout-seconds must be between 1 and 120')
}

const executable = path.join(root, 'DeepSeek-Herness.exe')
const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const portableCli = path.join(root, 'launcher', 'portable-cli.mjs')
const launcherLog = path.join(root, 'data', 'logs', 'launcher.log')
for (const filename of [executable, portableNode, portableCli]) {
  if (!existsSync(filename)) throw new Error(`portable file is missing: ${filename}`)
}

async function reservePort() {
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

async function waitForTarget(port, launcher, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error(`desktop host exited before DevTools became ready: ${launcher.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(target => target.type === 'page')
        if (page?.webSocketDebuggerUrl) return page
      }
    } catch { /* WebView2 is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('timed out waiting for the embedded WebView2 target')
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

async function logTail(offset) {
  if (!existsSync(launcherLog)) return ''
  const value = await readFile(launcherLog, 'utf8')
  return value.slice(offset)
}

async function capture(client, filename) {
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(output, filename), Buffer.from(screenshot.data, 'base64'))
}

let launcher = null
let client = null
const logOffset = existsSync(launcherLog) ? (await readFile(launcherLog)).length : 0
try {
  await execFileAsync(portableNode, [portableCli, 'stop', '--no-browser', '--json'], {
    cwd: root,
    windowsHide: true,
    timeout: 60000,
  }).catch(() => {})
  await mkdir(output, { recursive: true })
  const debugPort = await reservePort()
  launcher = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
      DSH_PORTABLE_TEST_HIDDEN: '1',
      DSH_PORTABLE_TEST_AUTOMATION: '1',
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const page = await waitForTarget(debugPort, launcher)
  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  const samples = []
  let capturedBoot = false
  let capturedReveal = false
  let capturedWorkspace = false
  let workspaceStableSamples = 0
  const deadline = Date.now() + startupTimeoutSeconds * 1000
  while (Date.now() < deadline) {
    const state = await evaluate(client, `(() => {
      const visible = node => {
        if (!(node instanceof Element)) return false
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
      }
      const boot = document.querySelector('[data-dsh-boot]')
      const visibleControls = [...document.querySelectorAll('button,input,textarea,[contenteditable=true],[role=button]')].filter(visible).length
      const candidates = [...document.querySelectorAll('body *')].filter(visible).slice(0, 24).map(node => ({
        tag: node.tagName,
        id: node.id,
        cls: typeof node.className === 'string' ? node.className.slice(0, 100) : '',
        text: String(node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
        rect: (() => { const value = node.getBoundingClientRect(); return [Math.round(value.x), Math.round(value.y), Math.round(value.width), Math.round(value.height)] })(),
      }))
      return {
        at: performance.now(),
        url: String(location.origin || '') + String(location.pathname || ''),
        ready: document.readyState,
        bootVisible: visible(boot),
        bodyText: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
        bodyChildren: document.body?.children.length || 0,
        visibleControls,
        viewport: [innerWidth, innerHeight],
        gate: window.__dshPortableStartupGate ? {
          since: window.__dshPortableStartupGate.since,
          lastMutation: window.__dshPortableStartupGate.lastMutation,
          stablePolls: window.__dshPortableStartupGate.stablePolls,
          lastSignature: window.__dshPortableStartupGate.lastSignature,
        } : null,
        candidates,
      }
    })()`)
    state.log = await logTail(logOffset)
    samples.push(state)
    if (state.bootVisible && !capturedBoot) {
      capturedBoot = true
      await capture(client, '01-native-dsh-loader.png')
    }
    if (state.log.includes('dsh-first-paint-ready') && !state.bootVisible && state.bodyText.length > 0 && !capturedReveal) {
      capturedReveal = true
      await capture(client, '02-reveal-frame.png')
    }
    if (capturedReveal && !state.bootVisible && state.bodyText.length > 0) {
      workspaceStableSamples += 1
      if (!capturedWorkspace) {
        capturedWorkspace = true
        await capture(client, '03-workspace-ready.png')
      }
    } else {
      workspaceStableSamples = 0
    }
    if (workspaceStableSamples >= 8) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const bootSample = samples.find(sample => sample.bootVisible)
  const bootLogSample = samples.find(sample => sample.log.includes('dsh-boot-surface-visible'))
  const revealSample = samples.find(sample => sample.log.includes('dsh-first-paint-ready')
    && !sample.bootVisible
    && sample.bodyText.length > 0)
  const workspaceSample = samples.find(sample => revealSample
    && sample.at > revealSample.at
    && !sample.bootVisible
    && sample.bodyText.length > 0)
  await writeFile(path.join(output, 'samples.json'), JSON.stringify(samples, null, 2))
  assert.ok(bootSample || bootLogSample, 'the official DSH loading state was never observed')
  assert.ok(bootLogSample, 'the native window never revealed the official DSH loading surface')
  assert.ok(bootLogSample.log.indexOf('dsh-boot-surface-visible') < bootLogSample.log.indexOf('dsh-first-paint-ready')
    || !bootLogSample.log.includes('dsh-first-paint-ready'), 'the workspace was revealed before the DSH loading surface')
  assert.ok(revealSample, 'the native loading surface never handed off to the settled workspace')
  assert.match(revealSample.log, /surface-ready-message/)
  assert.match(revealSample.log, /surface-handoff:native-bridge/)
  assert.equal(revealSample.bootVisible, false, 'the native surface revealed the intermediate DSH loader')
  assert.ok(revealSample.bodyText.length > 0, 'the native surface revealed an empty workspace')
  assert.ok(revealSample.visibleControls >= 2, 'the native surface revealed before primary controls were ready')
  assert.ok(workspaceSample, 'the settled DSH workspace did not remain stable after native handoff')
  console.log(JSON.stringify({
    output,
    samples: samples.length,
    capturedBoot,
    capturedReveal,
    capturedWorkspace,
    revealAt: Math.round(revealSample.at),
    workspaceAt: Math.round(workspaceSample.at),
    settledAfterRevealMs: Math.round(workspaceSample.at - revealSample.at),
  }))
} finally {
  client?.close()
  await execFileAsync(portableNode, [portableCli, 'stop', '--no-browser', '--json'], {
    cwd: root,
    windowsHide: true,
    timeout: 60000,
  }).catch(() => {})
  if (launcher && launcher.exitCode === null) {
    await execFileAsync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
  }
}
