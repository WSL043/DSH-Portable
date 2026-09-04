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
const environmentId = String(process.argv[5] || '')
const notificationProof = process.env.DSH_PORTABLE_AUDIT_NOTIFICATION_PROOF === '1'
const requireLoading = process.env.DSH_PORTABLE_AUDIT_REQUIRE_LOADING !== '0'
const openSessionTitle = String(process.env.DSH_PORTABLE_AUDIT_OPEN_SESSION || '').trim()
const existingSessionProof = process.env.DSH_PORTABLE_AUDIT_EXISTING_SESSION_PROOF === '1'
const stopArgs = ['stop', '--no-browser', '--json', ...(environmentId ? ['--environment', environmentId] : [])]
if (!root) throw new Error('usage: node audit-windows-startup-transition.mjs <DSH-Portable root> [output] [startup-timeout-seconds]')
if (process.platform !== 'win32') throw new Error('the startup transition audit is Windows-only')
if (!Number.isFinite(startupTimeoutSeconds) || startupTimeoutSeconds < 1 || startupTimeoutSeconds > 120) {
  throw new Error('startup-timeout-seconds must be between 1 and 120')
}

const executable = path.join(root, 'DeepSeek-Herness.exe')
const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const portableCli = path.join(root, 'launcher', 'portable-cli.mjs')
const launcherLog = path.join(environmentId ? path.join(root, 'environments', environmentId) : root, 'data', 'logs', 'launcher.log')
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

async function waitForValue(client, expression, predicate, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    value = await evaluate(client, expression)
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${description}: ${JSON.stringify(value)}`)
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

async function captureDesktop(filename) {
  const capturePath = path.join(output, filename)
  const command = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$width=[Math]::Min(900,$bounds.Width)',
    '$height=[Math]::Min(1100,$bounds.Height)',
    '$bitmap=New-Object System.Drawing.Bitmap $width,$height',
    '$graphics=[System.Drawing.Graphics]::FromImage($bitmap)',
    'try { $graphics.CopyFromScreen($bounds.Right-$width,$bounds.Bottom-$height,0,0,[System.Drawing.Size]::new($width,$height)); $bitmap.Save($env:DSH_CAPTURE_PATH) } finally { $graphics.Dispose(); $bitmap.Dispose() }',
  ].join('; ')
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true,
    timeout: 15000,
    env: { ...process.env, DSH_CAPTURE_PATH: capturePath },
  })
}

async function dismissBlockingOnboarding(client, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let quietPasses = 0
  while (Date.now() < deadline && quietPasses < 3) {
    const clicked = await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('button')].find(node => /^(Continue|继续|Configure later|稍后配置|Set up later)$/.test(String(node.textContent || '').trim()))
      button?.click()
      return Boolean(button)
    })()`)
    quietPasses = clicked ? 0 : quietPasses + 1
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

async function createExistingSession(client) {
  const message = `DSH Portable existing session user message ${Date.now()}`
  const prepared = await evaluate(client, `(() => {
    const input = document.querySelector('[data-composer-input="true"][contenteditable="true"]')
    if (!input) return { ready: false, reason: 'composer input unavailable' }
    input.focus()
    input.textContent = ${JSON.stringify(message)}
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(message)} }))
    return { ready: true }
  })()`)
  assert.equal(prepared?.ready, true, `could not prepare existing session user message: ${prepared?.reason || 'unknown reason'}`)
  const send = await waitForValue(client, `(() => {
    const button = document.querySelector('button[aria-label="Send message"],button[aria-label="发送消息"]')
    return { available: Boolean(button), enabled: Boolean(button && !button.disabled) }
  })()`, value => value?.enabled, 'enabled send-message action', 5000)
  assert.equal(send.available, true)
  const submitted = await evaluate(client, `(() => {
    const button = document.querySelector('button[aria-label="Send message"],button[aria-label="发送消息"]')
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(submitted, true, 'could not submit existing session user message')
  return waitForValue(client, `(() => ({
    messageVisible: (document.body?.innerText || '').includes(${JSON.stringify(message)}),
    composerHero: Boolean(document.querySelector('[data-composer-input="true"]')?.closest('[class*="hero"]')),
  }))()`, value => value?.messageVisible && !value.composerHero, 'existing session user message', 15000)
}

let launcher = null
let client = null
const logOffset = existsSync(launcherLog) ? (await readFile(launcherLog)).length : 0
try {
  await execFileAsync(portableNode, [portableCli, ...stopArgs], {
    cwd: root,
    windowsHide: true,
    timeout: 60000,
  }).catch(() => {})
  await mkdir(output, { recursive: true })
  const debugPort = await reservePort()
  launcher = spawn(executable, environmentId ? ['--environment', environmentId] : [], {
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
  if (requireLoading) {
    assert.ok(bootSample || bootLogSample, 'the official DSH loading state was never observed')
    assert.ok(bootLogSample, 'the native window never revealed the official DSH loading surface')
    assert.ok(bootLogSample.log.indexOf('dsh-boot-surface-visible') < bootLogSample.log.indexOf('dsh-first-paint-ready')
      || !bootLogSample.log.includes('dsh-first-paint-ready'), 'the workspace was revealed before the DSH loading surface')
  }
  assert.ok(revealSample, 'the native loading surface never handed off to the settled workspace')
  assert.match(revealSample.log, /surface-ready-message/)
  assert.match(revealSample.log, /surface-handoff:native-bridge/)
  assert.equal(revealSample.bootVisible, false, 'the native surface revealed the intermediate DSH loader')
  assert.ok(revealSample.bodyText.length > 0, 'the native surface revealed an empty workspace')
  assert.ok(revealSample.visibleControls >= 2, 'the native surface revealed before primary controls were ready')
  assert.ok(workspaceSample, 'the settled DSH workspace did not remain stable after native handoff')
  const dismissedWelcome = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')].find(node => /^(Continue|继续)$/.test(String(node.textContent || '').trim()))
    if (!button) return false
    button.click()
    return true
  })()`)
  if (dismissedWelcome) {
    const dismissalDeadline = Date.now() + 5000
    while (Date.now() < dismissalDeadline) {
      const visible = await evaluate(client, `![...document.querySelectorAll('button')].some(node => /^(Continue|继续)$/.test(String(node.textContent || '').trim()))`)
      if (visible) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const dismissedProvider = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')].find(node => /^(Configure later|稍后配置)$/.test(String(node.textContent || '').trim()))
    if (!button) return false
    button.click()
    return true
  })()`)
  if (dismissedWelcome || dismissedProvider) {
    await new Promise(resolve => setTimeout(resolve, 250))
    await capture(client, '04-main-workspace.png')
  }
  await dismissBlockingOnboarding(client)
  let existingSession = null
  if (existingSessionProof) existingSession = await createExistingSession(client)
  if (openSessionTitle) {
    const opened = await evaluate(client, `(() => {
      const title = ${JSON.stringify(openSessionTitle)}
      const target = [...document.querySelectorAll('*')]
        .filter(node => String(node.textContent || '').trim() === title)
        .sort((left, right) => left.childElementCount - right.childElementCount)[0]
      if (!target) return false
      ;(target.closest('button,a,[role="button"]') || target).click()
      return true
    })()`)
    assert.equal(opened, true, `session was not found in the live sidebar: ${openSessionTitle}`)
    await waitForValue(client, `![...document.querySelectorAll('button')].some(node => /Standard mode|标准模式/.test(String(node.textContent || '')))`, Boolean, 'active conversation header', 10000)
  }
  let portableShell = await evaluate(client, `({
    updateActions: document.querySelectorAll('.dshPortableFooterUpdate').length,
    environmentChips: document.querySelectorAll('.dshPortableEnvironmentChip').length,
  })`)
  const portableSettings = await evaluate(client, `fetch('/dsh-portable/settings', { cache: 'no-store' }).then(response => response.json())`)
  let environmentPosition = null
  if (notificationProof) {
    const minimizeCommand = [
      'Add-Type @\"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class DshAuditWindow {',
      '  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
      '  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);',
      '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
      '  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);',
      '  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
      '  public static bool Minimize(uint targetPid) {',
      '    bool found = false;',
      '    EnumWindows(delegate(IntPtr hWnd, IntPtr unused) { uint pid; GetWindowThreadProcessId(hWnd, out pid); if (pid == targetPid && IsWindowVisible(hWnd)) { found = true; ShowWindowAsync(hWnd, 6); } return true; }, IntPtr.Zero);',
      '    return found;',
      '  }',
      '}',
      '\"@',
      'if (-not [DshAuditWindow]::Minimize([uint32]$env:DSH_AUDIT_PID)) { throw "desktop host has no visible top-level window" }',
    ].join('\n')
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', minimizeCommand], {
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, DSH_AUDIT_PID: String(launcher.pid) },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    const session = {
      id: 'notification-proof-session',
      title: 'Verify task completion notification',
      updatedAt: Date.now(),
      running: true,
      completed: false,
      finalReply: 'The real DSH-Portable desktop process completed this background task.',
      pendingInteraction: '',
      agentPreset: 'review',
    }
    const postState = async value => evaluate(client, `window.chrome.webview.postMessage(${JSON.stringify(value)})`)
    const baseline = { type: 'dsh-portable/state', schemaVersion: 1, locale: 'en', theme: 'light', currentSessionId: 'another-session', hasRunningSession: true, sessions: [session] }
    await postState(baseline)
    await new Promise(resolve => setTimeout(resolve, 200))
    await postState({ ...baseline, hasRunningSession: false, sessions: [{ ...session, running: false, completed: true }] })
    await new Promise(resolve => setTimeout(resolve, 700))
    await captureDesktop('07-native-task-notification.png')
  }
  if (environmentId) {
    assert.equal(portableSettings?.environments?.current, environmentId, 'Portable settings did not expose the selected environment')
    portableShell = await waitForValue(client, `({
      updateActions: document.querySelectorAll('.dshPortableFooterUpdate').length,
      environmentChips: document.querySelectorAll('.dshPortableEnvironmentChip').length,
    })`, value => value?.environmentChips === 1, 'selected Portable environment chip', 15000)
    assert.equal(portableShell.environmentChips, 1, 'the selected non-default environment is missing from the composer')
    environmentPosition = await evaluate(client, `(() => {
      const chip = document.querySelector('.dshPortableEnvironmentChip')
      const chipLabel = chip?.querySelector('span')
      const mode = [...document.querySelectorAll('button')].find(node => /Standard mode|标准模式/.test(String(node.textContent || '')))
      const editor = document.querySelector('textarea,[contenteditable="true"]')
      const rect = node => { const value = node?.getBoundingClientRect(); return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom } : null }
      return {
        chip: rect(chip),
        chipLabel: { rect: rect(chipLabel), text: String(chipLabel?.textContent || '').trim(), title: chip?.title || '', ariaLabel: chip?.getAttribute('aria-label') || '' },
        mode: rect(mode),
        editor: rect(editor),
      }
    })()`)
    assert.ok(environmentPosition.chip && environmentPosition.editor, 'environment position anchors are incomplete')
    assert.equal(environmentPosition.chipLabel.text, environmentId, 'environment chip visible label does not identify the selected environment')
    assert.ok(environmentPosition.chipLabel.title.toLowerCase().includes(environmentId.toLowerCase()), 'environment chip tooltip does not identify the selected environment')
    assert.equal(environmentPosition.chipLabel.ariaLabel, environmentPosition.chipLabel.title, 'environment chip accessible label does not match its tooltip')
    assert.ok(environmentPosition.chipLabel.rect.left >= environmentPosition.chip.left
      && environmentPosition.chipLabel.rect.right <= environmentPosition.chip.right, 'environment chip label overflows its visible chip')
    if (environmentPosition.mode) {
      assert.ok(environmentPosition.chip.left >= environmentPosition.mode.right, 'environment chip is not after the mode selector')
      assert.ok(Math.abs((environmentPosition.chip.top + environmentPosition.chip.bottom) / 2 - (environmentPosition.mode.top + environmentPosition.mode.bottom) / 2) <= 8, 'environment chip is not aligned with the Hero controls')
    } else {
      assert.ok(environmentPosition.chip.top < 160, 'environment chip is not in the active conversation header')
    }
    assert.ok(environmentPosition.chip.bottom < environmentPosition.editor.top, 'environment chip is still inside the composer toolbar')
    await capture(client, existingSessionProof ? '05-environment-chip-existing-session.png' : environmentPosition.mode ? '05-environment-chip-blank.png' : '05-environment-chip-session.png')

    const originalUpdateChannel = portableSettings?.settings?.updateChannel || 'stable'
    try {
      await evaluate(client, `fetch('/dsh-portable/settings', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updateChannel: 'candidate' }),
      }).then(response => response.json())`)
      await evaluate(client, 'location.reload()')
      await waitForValue(client, `(() => document.readyState === 'complete' && [...document.querySelectorAll('button')].some(node => /^(Settings|设置)$/.test(String(node.textContent || '').trim())))()`, Boolean, 'reloaded DSH shell', 30000)
      await dismissBlockingOnboarding(client)
      const settingsOpened = await evaluate(client, `(() => {
        const button = [...document.querySelectorAll('button')].find(node => /^(Settings|设置)$/.test(String(node.textContent || '').trim()))
        button?.click()
        return Boolean(button)
      })()`)
      assert.equal(settingsOpened, true, 'Settings button was unavailable for the update implementation audit')
      await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(node => /Settings|设置/.test(node.textContent || '')))`, Boolean, 'Settings dialog')
      await evaluate(client, `(() => {
        const button = [...document.querySelectorAll('button')].find(node => /^(General|General settings|通用设置)$/.test(String(node.textContent || '').trim()))
        button?.click()
        return Boolean(button)
      })()`)
      const candidateCatalog = await evaluate(client, `fetch('/dsh-portable/engine-versions', { cache: 'no-store' }).then(response => response.json())`)
      assert.ok(Array.isArray(candidateCatalog?.versions) && candidateCatalog.versions.length > 0, `candidate engine catalog is empty: ${JSON.stringify(candidateCatalog)}`)
      const engineCatalog = await waitForValue(client, `(() => {
        const text = document.body?.innerText || ''
        return {
          beta: /Beta(?: 测试版)?/.test(text),
          current: /0\.1\.2-rc\.1/.test(text),
          selector: Boolean(document.querySelector('button[aria-label="Engine version"],button[aria-label="内核版本"]')),
          buttons: [...document.querySelectorAll('button')].map(node => ({ label: node.getAttribute('aria-label'), text: String(node.textContent || '').trim() })).filter(item => item.label || item.text).slice(-30),
        }
      })()`, value => value?.beta && value.current && value.selector, 'candidate engine version controls', 30000)
      assert.equal(engineCatalog.selector, true)
      await evaluate(client, `(() => {
        const marker = [...document.querySelectorAll('*')].find(node => /^(Portable|便携版)$/.test(String(node.textContent || '').trim()))
        marker?.scrollIntoView?.({ block: 'start' })
        const selector = document.querySelector('button[aria-label="Engine version"],button[aria-label="内核版本"]')
        selector?.click()
        return Boolean(selector)
      })()`)
      await waitForValue(client, `Boolean(document.querySelector('button[aria-label="Engine version"][aria-expanded="true"],button[aria-label="内核版本"][aria-expanded="true"]'))`, Boolean, 'candidate engine version menu')
      await capture(client, '06-update-engine-selector.png')
    } finally {
      await evaluate(client, `fetch('/dsh-portable/settings', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updateChannel: ${JSON.stringify(originalUpdateChannel)} }),
      }).then(response => response.json())`).catch(() => {})
    }
  }
  console.log(JSON.stringify({
    output,
    samples: samples.length,
    capturedBoot,
    capturedReveal,
    capturedWorkspace,
    dismissedWelcome,
    dismissedProvider,
    portableShell,
    settingsEnvironment: portableSettings?.environments?.current,
    existingSession,
    environmentPosition,
    revealAt: Math.round(revealSample.at),
    workspaceAt: Math.round(workspaceSample.at),
    settledAfterRevealMs: Math.round(workspaceSample.at - revealSample.at),
  }))
} finally {
  client?.close()
  await execFileAsync(portableNode, [portableCli, ...stopArgs], {
    cwd: root,
    windowsHide: true,
    timeout: 60000,
  }).catch(() => {})
  if (launcher && launcher.exitCode === null) {
    await execFileAsync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
  }
}
