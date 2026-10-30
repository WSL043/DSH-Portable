import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { writeSmokeScreenshot } from './lib/smoke-screenshot.mjs'
import { dismissOfficialOnboardingExpression } from './lib/official-onboarding.mjs'
import { clickButton, builtInPluginCard, officialPowerShellDetailsReady } from './lib/native-smoke-interaction.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('usage: node smoke-windows-tray-bridge.mjs <DSH-Portable root>')
if (process.platform !== 'win32') throw new Error('the native tray bridge smoke is Windows-only')
const targetLocale = process.env.DSH_SMOKE_LOCALE === 'en' ? 'en' : 'zh'
const screenshotPath = process.env.DSH_SMOKE_SCREENSHOT ? process.env.DSH_SMOKE_SCREENSHOT : ''
const generalScreenshotPath = process.env.DSH_SMOKE_GENERAL_SCREENSHOT
  ? process.env.DSH_SMOKE_GENERAL_SCREENSHOT
  : ''
const generalBottomScreenshotPath = process.env.DSH_SMOKE_GENERAL_BOTTOM_SCREENSHOT
  ? process.env.DSH_SMOKE_GENERAL_BOTTOM_SCREENSHOT
  : ''
const installedScreenshotPath = process.env.DSH_SMOKE_INSTALLED_SCREENSHOT
  ? process.env.DSH_SMOKE_INSTALLED_SCREENSHOT
  : ''
const diagnosticsScreenshotPath = process.env.DSH_SMOKE_DIAGNOSTICS_SCREENSHOT
  ? process.env.DSH_SMOKE_DIAGNOSTICS_SCREENSHOT
  : ''
const retiredPluginOptions = ['DSH_SMOKE_PLUGIN_ACTIVATION', 'DSH_SMOKE_PLUGIN_UPDATE',
  'DSH_SMOKE_PLUGIN_REMOVE_AFTER', 'DSH_SMOKE_PLUGIN_ACTIVATION_SCREENSHOT'].filter(name => String(process.env[name] || '').trim())
if (retiredPluginOptions.length) throw new Error(
  'Retired private-market tray options: ' + retiredPluginOptions.join(', ') +
  '; run scripts/smoke-windows-official-plugin-cycle.mjs for real official plugin update/uninstall/reinstall/enable acceptance')
const checkPortableUpdate = process.env.DSH_SMOKE_CHECK_PORTABLE_UPDATE === '1'

function redactSensitive(value) {
  return String(value || '')
    .replace(/([?&]token=)[^&#\s"']+/gi, '$1[REDACTED]')
    .replace(/("(?:token|authorization|cookie)"\s*:\s*")[^"]*/gi, '$1[REDACTED]')
}

function validateWorkspaceUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value))
  } catch {
    throw new Error('portable start returned an invalid workspace URL')
  }
  const tokens = parsed.searchParams.getAll('token')
  const keys = [...parsed.searchParams.keys()]
  const validToken = tokens.length === 0 || (
    tokens.length === 1
    && /^[A-Za-z0-9_-]{32,128}$/.test(tokens[0])
  )
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || !/^\d+$/.test(parsed.port)
    || parsed.pathname !== '/'
    || parsed.username
    || parsed.password
    || parsed.hash
    || !validToken
    || keys.some(key => key !== 'token')
  ) {
    throw new Error('portable start returned an unsafe workspace URL')
  }
}

const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const portableCli = path.join(root, 'launcher', 'portable-cli.mjs')
const runtimeEntry = path.join(root, 'launcher', 'runtime-entry.mjs')
for (const filename of [portableNode, portableCli, runtimeEntry]) {
  if (!existsSync(filename)) throw new Error(`portable file is missing: ${filename}`)
}

function chromeExecutable() {
  if (process.env.CHROME_PATH && !existsSync(process.env.CHROME_PATH)) {
    throw new Error(`configured Chrome is missing: ${process.env.CHROME_PATH}`)
  }
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean)
  const match = candidates.find(existsSync)
  if (!match) throw new Error('Google Chrome is required for the background tray bridge smoke')
  return match
}

function lastJsonLine(source) {
  const lines = String(source || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]) } catch { /* continue */ }
  }
  throw new Error(`portable command returned no JSON: ${redactSensitive(source)}`)
}

async function portable(args) {
  const result = await execFileAsync(portableNode, [runtimeEntry, path.basename(portableCli), ...args], {
    cwd: root,
    env: { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1', DSH_PORTABLE_OFFICIAL_MARKET: '1' },
    timeout: 90000,
    windowsHide: true,
  })
  return lastJsonLine(result.stdout)
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
  if (!port) throw new Error('could not reserve a loopback port for headless Chrome')
  return port
}

async function waitForDevTools(port, process, output, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastProbe = 'not attempted'
  while (Date.now() < deadline) {
    if (output.error) throw new Error(`headless Chrome spawn failed: ${output.error}`)
    if (process.exitCode !== null) {
      throw new Error(`headless Chrome exited before DevTools became ready (code ${process.exitCode}): ${output.stderr || output.stdout}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
      lastProbe = `HTTP ${response.status}`
      if (response.ok) {
        const targets = await response.json()
        lastProbe = JSON.stringify(targets.map(target => ({ type: target.type, url: target.url })))
        const page = targets.find(target => target.type === 'page')
        if (page?.webSocketDebuggerUrl) return page
      }
    } catch (error) { lastProbe = String(error.cause || error) }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for headless Chrome DevTools on 127.0.0.1:${port}; pid=${process.pid}; exit=${process.exitCode}; probe=${lastProbe}; output=${JSON.stringify(output)}`)
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.events = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`))
        else pending.resolve(message.result)
        return
      }
      for (const listener of this.events.get(message.method) || []) listener(message.params)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const listeners = this.events.get(method) || []
    listeners.push(listener)
    this.events.set(method, listeners)
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  }
  return response.result?.value
}

let completedCredentialOnboarding = false
async function waitForValue(client, expression, predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    // The official first-run notice can mount after settings or locale changes.
    // Deal only with that known onboarding dialog, never click through a modal.
    const onboarding = await evaluate(client, dismissOfficialOnboardingExpression)
    completedCredentialOnboarding ||= Boolean(onboarding?.clicked && onboarding.terminal)
    latest = await evaluate(client, expression)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${label}; latest=${redactSensitive(JSON.stringify(latest))}`)
}

const initScript = String.raw`(() => {
  // Localhost must remain usable when Windows reports no external network.
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  const listeners = new Set()
  const posted = []
  const webview = {
    postMessage(value) { posted.push(JSON.parse(JSON.stringify(value))) },
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener) },
    __emit(data) { for (const listener of listeners) listener({ data }) },
  }
  window.chrome = window.chrome || {}
  Object.defineProperty(window.chrome, 'webview', { configurable: true, value: webview })
  Object.defineProperty(window, '__dshTrayMessages', { configurable: true, get: () => posted })
})()`

const clickChoice = names => `(() => {
  const names = ${JSON.stringify(names)}
  const menuCandidates = [...document.querySelectorAll('[role="menuitem"],[role="option"],[data-radix-collection-item]')]
  let target = menuCandidates.find(item => names.includes((item.textContent || '').trim()))
  if (!target) {
    target = [...document.querySelectorAll('button')].find(item => names.includes((item.textContent || '').trim()))
  }
  if (!target) {
    const leaf = [...document.querySelectorAll('body *')].find(item => item.children.length === 0 && names.includes((item.textContent || '').trim()))
    target = leaf?.closest('button,[role="menuitem"],[role="option"]') || leaf?.parentElement
  }
  if (!target) return { clicked: false }
  target.click()
  return { clicked: true }
})()`

let chrome = null
let client = null
let profile = ''
let started = false
const exceptions = []
const browserFailures = []
const marketRequests = [], marketRequestById = new Map()
const rememberBrowserFailure = value => {
  browserFailures.push(value)
  if (browserFailures.length > 40) browserFailures.shift()
}
try {
  const before = await portable(['status', '--json'])
  if (before.status === 'running') throw new Error('refusing to test a product root that is already running')

  const launch = await portable(['start', '--no-browser', '--json'])
  started = launch.status === 'started'
  assert.equal(started, true)
  validateWorkspaceUrl(launch.url)

  profile = await mkdtemp(path.join(os.tmpdir(), 'dsh-tray-headless-'))
  const debugPort = await reserveLoopbackPort()
  const chromeOutput = { stdout: '', stderr: '' }
  const executable = chromeExecutable()
  process.stdout.write(`${JSON.stringify({ phase: 'chrome-launch', executable, profile, debugPort, node: process.version })}\n`)
  chrome = spawn(executable, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-gpu',
    '--enable-logging=stderr',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  chrome.on('error', error => { chromeOutput.error = String(error) })
  chrome.stdout.on('data', chunk => { chromeOutput.stdout = `${chromeOutput.stdout}${chunk}`.slice(-8000) })
  chrome.stderr.on('data', chunk => { chromeOutput.stderr = `${chromeOutput.stderr}${chunk}`.slice(-8000) })

  const page = await waitForDevTools(debugPort, chrome, chromeOutput)

  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  client.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'runtime exception'))
  client.on('Network.loadingFailed', event => rememberBrowserFailure({
    type: event.type, error: event.errorText, canceled: event.canceled,
    blockedReason: event.blockedReason,
  }))
  client.on('Network.requestWillBeSent', event => {
    const url = new URL(event.request.url)
    if (url.origin !== new URL(launch.url).origin || !url.pathname.startsWith('/dsh-market/')) return
    const item = { method: event.request.method, path: url.pathname }
    marketRequests.push(item); marketRequestById.set(event.requestId, item)
  })
  client.on('Network.responseReceived', event => {
    const item = marketRequestById.get(event.requestId)
    if (item) item.status = event.response.status
    if (event.response.status < 400) return
    let resource = ''
    try { const url = new URL(event.response.url); resource = url.origin + url.pathname } catch { /* no credentials or query strings */ }
    rememberBrowserFailure({ type: event.type, status: event.response.status, resource })
  })
  await client.send('Runtime.enable')
  await client.send('Network.enable')
  await client.send('Page.enable')
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript })
  let navigation = await client.send('Page.navigate', { url: launch.url })
  // Chrome's startup navigation can cancel this first command while the target
  // is still about:blank. Retry only that pre-application state once; never
  // reload a loaded DSH page or conceal an application initialization failure.
  if (navigation.errorText === 'net::ERR_ABORTED'
    && await evaluate(client, 'location.href') === 'about:blank') {
    rememberBrowserFailure({ type: 'Document', error: navigation.errorText, recovery: 'initial-blank-only' })
    await client.send('Page.stopLoading')
    navigation = await client.send('Page.navigate', { url: launch.url })
  }
  if (navigation.errorText && navigation.errorText !== 'net::ERR_ABORTED') {
    throw new Error(`Workspace navigation failed: ${navigation.errorText}`)
  }
  if (navigation.errorText) rememberBrowserFailure({ type: 'Document', error: navigation.errorText })

  const expectedOrigin = new URL(launch.url).origin
  await waitForValue(client, `({ origin: location.origin, ready: document.readyState })`,
    value => value?.origin === expectedOrigin && value.ready === 'complete', 'DSH document readiness')
  const stateExpression = `window.__dshTrayMessages?.filter(item => item.type === 'dsh-portable/state').at(-1) || null`
  let state = await waitForValue(client, stateExpression, value => value?.schemaVersion === 1, 'initial tray bridge state')
  assert.ok(['en', 'zh'].includes(state.locale))
  assert.ok(['light', 'dark'].includes(state.theme))
  assert.ok(Array.isArray(state.sessions))
  assert.ok(state.sessions.length <= 10)

  // This isolated, keyless browser must complete the actual final provider
  // onboarding step. A transient empty overlay is not completion: the next
  // official step deliberately closes Settings and any open language menu.
  await waitForValue(client,
    `![...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')].some(item => item.getBoundingClientRect().width > 0)`,
    clear => clear && completedCredentialOnboarding, 'final credential onboarding dismissal')
  await waitForValue(client, `(() => {
    const labels = [...document.querySelectorAll('button')].map(item => (item.textContent || '').trim())
    return {
      ready: labels.some(label => ['Settings', '设置', 'More', '更多', 'Account menu', '账号菜单', '打开侧边栏', 'Open sidebar', 'Expand sidebar'].includes(label)),
      labels: labels.slice(0, 20),
      url: location.href,
      title: document.title,
      bodyText: (document.body?.innerText || '').trim().slice(0, 500),
      htmlBytes: document.documentElement?.outerHTML?.length || 0,
    }
  })()`, value => value?.ready, 'DSH shell controls', 60000)
  // First-run provider onboarding can mount after the shell labels appear.
  // Use the same bounded, known-dialog-aware wait instead of treating its inert
  // background controls as a broken sidebar or clicking through the modal.
  await waitForValue(client, `(() => {
    const settings = ${clickButton(['Settings', '设置'])}
    if (!settings.clicked) ${clickButton(['打开侧边栏', 'Open sidebar', 'Expand sidebar'])}
    return settings
  })()`, value => value?.clicked, 'Settings button')
  await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(item => /Settings|设置/.test(item.textContent || '')))`, Boolean, 'Settings dialog')

  if (state.locale !== targetLocale) {
    await waitForValue(client, clickButton(['English', '英文', '中文', 'Chinese']), value => value?.clicked, 'language menu button')
    await waitForValue(client, clickChoice(targetLocale === 'zh' ? ['中文'] : ['English']), value => value?.clicked, `${targetLocale} language choice`)
    state = await waitForValue(client, stateExpression, value => value?.locale === targetLocale, `locale ${targetLocale}`)
    const translatedTestingNotice = await evaluate(client, clickButton(['Continue', '继续']))
    if (translatedTestingNotice?.clicked) {
      await waitForValue(
        client,
        `![...document.querySelectorAll('button')].some(item => ['Continue', '继续'].includes((item.textContent || '').trim()))`,
        Boolean,
        'translated testing notice dismissal',
      )
    }
  }
  // DSH may mount its translated preview notice one render after the locale
  // state changes. Give that official modal a bounded chance to appear before
  // capturing the finished settings surface.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 150))
    const lateNotice = await evaluate(client, clickButton(['Continue', '继续', '稍后配置', 'Set up later', 'Configure later']))
    if (lateNotice?.clicked) await new Promise(resolve => setTimeout(resolve, 120))
  }
  assert.equal(state.locale, targetLocale)

  if (state.theme !== 'light') {
    await waitForValue(client, clickButton(['Light', '浅色', '亮色']), value => value?.clicked, 'light theme button')
    state = await waitForValue(client, stateExpression, value => value?.theme === 'light', 'theme light')
  }
  assert.equal(state.theme, 'light')

  // Newer DSH closes Settings when provider onboarding appears after a locale
  // change. Continue through the real sidebar entry instead of assuming the
  // old dialog remained mounted throughout the language transition.
  const settingsStillOpen = await evaluate(client,
    `Boolean([...document.querySelectorAll('[role="dialog"]')].some(item => item.getBoundingClientRect().width > 0 && /Settings|设置/.test(item.textContent || '')))`)
  if (!settingsStillOpen) {
    await waitForValue(client, clickButton(['Settings', '设置']), value => value?.clicked, 'reopen Settings after locale change')
    await waitForValue(client,
      `Boolean([...document.querySelectorAll('[role="dialog"]')].some(item => item.getBoundingClientRect().width > 0 && /Settings|设置/.test(item.textContent || '')))`,
      Boolean, 'Settings dialog after locale change')
  }
  await waitForValue(client, clickButton(['General', 'General settings', '通用设置']), value => value?.clicked, 'General settings tab')
  const permissionLabels = await waitForValue(client, `(() => {
    const text = document.body?.innerText || ''
    return {
      localized: ${JSON.stringify(targetLocale)} === 'zh'
        ? /只读|仅可查看|工作区写入|可写入工作区|工作区内修改|完全访问|完全权限/.test(text)
        : /Read [Oo]nly|Workspace [Ww]rite|Full access/.test(text),
      mixed: ${JSON.stringify(targetLocale)} === 'zh'
        ? /Read [Oo]nly|Workspace [Ww]rite|Full access/.test(text)
        : /只读|仅可查看|工作区写入|可写入工作区|工作区内修改|完全访问|完全权限/.test(text),
    }
  })()`, value => value?.localized, 'localized permission label in General settings')
  assert.deepEqual(permissionLabels, { localized: true, mixed: false })
  await waitForValue(client, clickButton(['Desktop & data', '桌面与数据', 'Portable']), value => value?.clicked, 'Portable settings navigation')
  const portableSettings = await waitForValue(client, `(() => {
    const text = document.body?.innerText || ''
    return {
      title: /(?:^|\\n)(?:Desktop & data|桌面与数据|Portable|便携版)(?:\\n|$)/.test(text),
      notifications: /Task notifications|任务通知/.test(text),
      maintenance: /Check and repair|检查与修复/.test(text),
    }
  })()`, value => value?.title && value.notifications && value.maintenance, 'Portable settings controls')
  assert.deepEqual(portableSettings, { title: true, notifications: true, maintenance: true })
  await waitForValue(client, clickButton(['Updates', '更新']), value => value?.clicked, 'Updates settings navigation')
  const readPortableSettings = `fetch('/dsh-portable/settings', { cache: 'no-store' }).then(response => response.json()).then(body => body.settings)`
  const originalSettings = await evaluate(client, readPortableSettings)
  const updatePreference = async (title, key) => {
    const selectorLabel = `${title} · ${targetLocale === 'zh' ? '启动时检查' : 'Check at startup'}`
    const original = Boolean(originalSettings[key])
    const toggle = async enabled => {
      await waitForValue(client, clickButton([selectorLabel]), value => value?.clicked, `${title} startup selector`)
      await waitForValue(client, clickChoice(enabled ? ['On', '开启'] : ['Off', '关闭']), value => value?.clicked, `${title} startup choice`)
    }
    await toggle(!original)
    const changed = await waitForValue(client, readPortableSettings, value => value?.[key] === !original, `saved ${title} startup preference`)
    await toggle(original)
    const restored = await waitForValue(client, readPortableSettings, value => value?.[key] === original, `restored ${title} startup preference`)
    assert.equal(changed[key], !restored[key])
    return restored
  }
  await updatePreference('DSH-Portable', 'productUpdateCheckEnabled')
  const settingsRoundTrip = await updatePreference('DeepSeek Harness', 'engineUpdateCheckEnabled')
  assert.equal(settingsRoundTrip.productUpdateCheckEnabled, originalSettings.productUpdateCheckEnabled)
  if (checkPortableUpdate) {
    await waitForValue(client, clickButton(['Check for updates', '检查更新']), value => value?.clicked, 'Portable update check')
    const updateFeedback = await waitForValue(client, `(() => {
      const button = [...document.querySelectorAll('button')].find(item => ['Check for updates', '检查更新'].includes((item.textContent || '').trim()))
      let row = button?.parentElement
      while (row && !/DSH-Portable/.test(row.innerText || '')) row = row.parentElement
      const status = row?.querySelector('[role="status"]')
      return { nearby: Boolean(status), text: (status?.textContent || '').trim() }
    })()`, value => value?.nearby && Boolean(value.text), 'Portable update feedback beside its row')
    assert.equal(updateFeedback.nearby, true)
  }
  if (generalScreenshotPath) {
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeSmokeScreenshot(generalScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  }
  await waitForValue(client, clickButton(['Desktop & data', '桌面与数据', 'Portable']), value => value?.clicked, 'Portable settings navigation after updates')
  if (generalBottomScreenshotPath) {
    await evaluate(client, `(() => {
      const marker = [...document.querySelectorAll('*')].find(item => ['Desktop & data', '桌面与数据', 'Portable', '便携版'].includes((item.textContent || '').trim()))
      let scroller = marker?.parentElement
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 20) scroller = scroller.parentElement
      if (!scroller) return false
      scroller.scrollTop = scroller.scrollHeight
      return true
    })()`)
    await new Promise(resolve => setTimeout(resolve, 120))
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeSmokeScreenshot(generalBottomScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  }

  const closeOverlay = async label => {
    await waitForValue(client, `(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(item => item.getBoundingClientRect().width > 0)
      const button = dialog && [...dialog.querySelectorAll('button')].find(item =>
        ['Close', '关闭'].includes((item.getAttribute('aria-label') || item.textContent || '').trim())
        && !item.disabled && item.getBoundingClientRect().width > 0)
      button?.click(); return Boolean(button)
    })()`, Boolean, label)
    await waitForValue(client, `![...document.querySelectorAll('[role="dialog"]')].some(item => item.getBoundingClientRect().width > 0)`, Boolean, label + ' completes')
  }
  const openSettings = async label => {
    await waitForValue(client, clickButton(['Settings', '设置']), value => value?.clicked, label)
    await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].some(item => item.getBoundingClientRect().width > 0 && /Settings|设置/.test(item.textContent || '')))`, Boolean, label + ' dialog')
  }
  const selectPluginTab = async (names, label) => {
    await waitForValue(client, `(() => {
      const names = ${JSON.stringify(names)}
      const button = [...document.querySelectorAll('[role="tab"]')]
        .find(item => names.includes((item.textContent || '').trim()) && !item.disabled
          && item.getAttribute('aria-disabled') !== 'true' && !item.closest('[inert],[aria-hidden="true"]')
          && getComputedStyle(item).visibility !== 'hidden'
          && item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0)
      button?.click(); return Boolean(button)
    })()`, Boolean, label)
  }
  const openMaintenance = async label => {
    const from = marketRequests.length
    await waitForValue(client, `(() => {
      const button = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(item =>
        ['More', '更多'].includes(item.getAttribute('aria-label')) && !item.closest('[role="dialog"]') && item.getBoundingClientRect().width > 0)
      button?.click(); return Boolean(button)
    })()`, Boolean, label + ' sidebar More')
    await waitForValue(client, `(() => {
      const button = [...document.querySelectorAll('[role="menu"] button,[role="menu"] [role="menuitem"]')].find(item =>
        ['Legacy plugin recovery', '旧插件配置恢复'].includes((item.getAttribute('aria-label') || item.textContent || '').trim()) && item.getBoundingClientRect().width > 0)
      button?.click(); return Boolean(button)
    })()`, Boolean, label + ' legacy configuration recovery action')
    await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(item => {
      const title = item.getAttribute('aria-label') || document.getElementById(item.getAttribute('aria-labelledby'))?.textContent
      return ['Legacy plugin recovery', '旧插件配置恢复'].includes((title || '').trim()) && item.getBoundingClientRect().width > 0
    }))`, Boolean, label + ' persistent maintenance overlay')
    await waitForValue(client, 'document.querySelectorAll(\'[role="menu"]\').length', value => value === 0, label + ' More menu dismissed')
    return from
  }
  await closeOverlay('close Settings before official plugin management')
  await waitForValue(client, clickButton(['Plugins', '插件']), value => value?.clicked, 'official sidebar Plugins')
  await waitForValue(client, 'document.querySelectorAll(\'[data-plugin-panel] [data-plugin-package]\').length', value => value > 0, 'official Installed cards')
  const extensionUi = await evaluate(client, `({
    root: Boolean(document.querySelector('.dspx-root')),
    tab: [...document.querySelectorAll('button')].some(item => ['Portable extensions', '便携扩展'].includes((item.textContent || '').trim())),
    advanced: Boolean(document.querySelector('[role="tab"][id$="-dsh-portable-plugin-advanced"]')),
  })`)
  assert.deepEqual(extensionUi, { root: false, tab: false, advanced: false })
  await selectPluginTab(['Discover', '发现'], 'official Discover tab')
  const marketUi = await waitForValue(client, `(() => {
    const pane = document.querySelector('[data-plugin-tab="discover"]'), cards = [...(pane?.querySelectorAll('[data-market-entry]') || [])]
    const installButtons = cards.flatMap(card => [...card.querySelectorAll('button[aria-label]')]).filter(item => /^(Install |安装 )/.test(item.getAttribute('aria-label') || '') && !item.disabled).length
    const icons = cards.filter(card => card.querySelector(':scope > span[aria-hidden="true"] img,:scope > span[aria-hidden="true"] svg')).length
    return { search: Boolean(pane?.querySelector('input[type="search"]')), cards: cards.length, installButtons, icons }
  })()`, value => value?.search && value.cards > 0 && value.installButtons > 0 && value.icons > 0, 'visual official Discover cards', 60000)
  assert.ok(marketUi.installButtons > 0)
  assert.ok(marketUi.icons > 0)
  const picturedUi = await waitForValue(client, `(() => {
    const card = [...document.querySelectorAll('[data-plugin-tab="discover"] [data-market-entry]')].find(item => item.querySelector('[data-portable-shot]'))
    const shot = card?.querySelector('[data-portable-shot]')
    const open = card?.querySelector('button[aria-label^="View "],button[aria-label^="查看 "]')
    shot?.scrollIntoView({ block: 'center' })
    const rect = shot?.getBoundingClientRect()
    return { name: card?.getAttribute('data-market-entry'), title: open?.textContent.trim(), cardShot: Boolean(shot?.complete && shot.naturalWidth > 0), width: rect?.width || 0, height: rect?.height || 0 }
  })()`, value => value?.name && value.title && value.cardShot && value.width > 0 && value.height > 0, 'actual official catalog preview', 60000)
  assert.ok(picturedUi.cardShot)
  if (screenshotPath) {
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeSmokeScreenshot(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  }
  await waitForValue(client, `(() => {
    const card = [...document.querySelectorAll('[data-plugin-tab="discover"] [data-market-entry]')].find(item => item.getAttribute('data-market-entry') === ${JSON.stringify(picturedUi.name)})
    const shot = card?.querySelector('[data-portable-shot]')
    shot?.click(); return Boolean(shot)
  })()`, Boolean, 'open the actual official preview')
  await waitForValue(client, 'Boolean(document.querySelector(\'[data-portable-viewer]\'))', Boolean, 'official preview viewer')
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitForValue(client, '!document.querySelector(\'[data-portable-viewer]\')', Boolean, 'Escape closes only the preview')
  await waitForValue(client, `(() => {
    const card = [...document.querySelectorAll('[data-plugin-tab="discover"] [data-market-entry]')].find(item => item.getAttribute('data-market-entry') === ${JSON.stringify(picturedUi.name)})
    const button = card && [...card.querySelectorAll('button[aria-label]')].find(item => ['View ', '查看 '].some(prefix => item.getAttribute('aria-label') === prefix + ${JSON.stringify(picturedUi.title)}))
    button?.click(); return Boolean(button)
  })()`, Boolean, 'open the actual official catalog detail')
  const project = await waitForValue(client, `(() => {
    const detail = document.querySelector('[data-plugin-tab="discover"] [data-market-detail]')
    if (detail?.getAttribute('data-market-detail') !== ${JSON.stringify(picturedUi.name)} || detail.querySelector('h3')?.textContent.trim() !== ${JSON.stringify(picturedUi.title)}) return null
    const source = [...detail.querySelectorAll('dt')].find(item => ['Source code', '源代码'].includes(item.textContent.trim()))
    const link = source?.nextElementSibling?.querySelector('a[href]')
    return { projectHref: link?.href || '', external: link?.target === '_blank' && link?.relList.contains('noopener') && link?.relList.contains('noreferrer') }
  })()`, value => value?.projectHref && value.external, 'the selected official plugin project source')
  assert.ok(['http:', 'https:'].includes(new URL(project.projectHref).protocol))
  await waitForValue(client, `(() => {
    const detail = document.querySelector('[data-plugin-tab="discover"] [data-market-detail]')
    if (detail?.getAttribute('data-market-detail') !== ${JSON.stringify(picturedUi.name)}) return false
    const button = [...detail.querySelectorAll(':scope > button')].find(item => ['Discover', '发现'].includes((item.getAttribute('aria-label') || item.textContent || '').trim()))
    button?.click(); return Boolean(button)
  })()`, Boolean, 'return via the actual official Discover breadcrumb')
  await waitForValue(client, '!document.querySelector(\'[data-plugin-tab="discover"] [data-market-detail]\') && document.querySelectorAll(\'[data-plugin-tab="discover"] [data-market-entry]\').length > 0', Boolean, 'official catalog returns after details')
  // Compact/Cards persistence belonged to the retired private renderer. The
  // official catalog and preview above are the current visual integration gate.
  if (installedScreenshotPath) {
    await selectPluginTab(['Installed', '已安装'], 'official Installed tab')
    await waitForValue(client, 'document.querySelectorAll(\'[data-plugin-panel] [data-plugin-package]\').length', value => value > 0, 'official Installed screenshot inventory')
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeSmokeScreenshot(installedScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  }
  await openSettings('Settings before theme and legacy recovery verification')

  const legacyRecoveryContrastExpression = `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(item => {
      const title = item.getAttribute('aria-label') || document.getElementById(item.getAttribute('aria-labelledby'))?.textContent
      return ['Legacy plugin recovery', '旧插件配置恢复'].includes((title || '').trim()) && item.getBoundingClientRect().width > 0
    })
    const paragraphs = [...(dialog?.querySelectorAll('p') || [])]
    const targets = [{ id: 'guidance', tag: paragraphs.find(item => /用于导入旧版插件配置 JSON|Import a legacy plugin configuration JSON file/.test(item.textContent || '')) },
      { id: 'credentials', tag: paragraphs.find(item => /配置文件可能含凭据|Configuration files may contain credentials/.test(item.textContent || '')) }]
    if (targets.some(({ tag }) => !tag || tag.getBoundingClientRect().width <= 0 || tag.getBoundingClientRect().height <= 0)) return null
    const measure = tag => {
      const parse = value => {
        const values = (value.match(/[\\d.]+/g) || []).map(Number)
        return { r: values[0] || 0, g: values[1] || 0, b: values[2] || 0, a: values.length > 3 ? values[3] : 1 }
      }
      const blend = (front, back) => ({
        r: front.r * front.a + back.r * (1 - front.a),
        g: front.g * front.a + back.g * (1 - front.a),
        b: front.b * front.a + back.b * (1 - front.a),
        a: front.a + back.a * (1 - front.a),
      })
      let background = { r: 0, g: 0, b: 0, a: 0 }
      let current = tag
      while (current && background.a < 0.999) {
        background = blend(background, parse(getComputedStyle(current).backgroundColor))
        current = current.parentElement
      }
      if (background.a < 0.999) background = blend(background, { r: 255, g: 255, b: 255, a: 1 })
      const foreground = parse(getComputedStyle(tag).color)
      const luminance = color => {
        const channel = value => {
          const normalized = value / 255
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
      }
      const light = Math.max(luminance(foreground), luminance(background))
      const dark = Math.min(luminance(foreground), luminance(background))
      return {
        text: (tag.textContent || '').trim(),
        foreground: getComputedStyle(tag).color,
        background: getComputedStyle(tag).backgroundColor,
        contrastRatio: (light + 0.05) / (dark + 0.05),
      }
    }
    return targets.map(({ id, tag }) => ({ id, ...measure(tag) }))
  })()`
  const verifyLegacyRecoveryContrast = async (themeLabel) => {
    const from = await openMaintenance(themeLabel)
    const result = await waitForValue(client, legacyRecoveryContrastExpression, value => value?.length === 2 && value.every(item => item.text && item.contrastRatio >= 4.5), 'legacy recovery text contrast in ' + themeLabel + ' theme')
    for (const item of result) assert.ok(item.contrastRatio >= 4.5, themeLabel + ' ' + item.id + ' contrast was ' + item.contrastRatio)
    assert.deepEqual(marketRequests.slice(from).filter(item => item.path === '/dsh-market/check'), [], 'legacy recovery must not query a second compatibility assessment')
    assert.deepEqual(marketRequests.slice(from).filter(item => !['GET', 'HEAD', 'OPTIONS'].includes(item.method)), [], 'opening legacy recovery must not write configuration')
    if (diagnosticsScreenshotPath && themeLabel === 'dark') {
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      await writeSmokeScreenshot(diagnosticsScreenshotPath, Buffer.from(screenshot.data, 'base64'))
    }
    await closeOverlay(themeLabel + ' close legacy recovery and return to the official shell')
  }
  const modernBuiltIns = await evaluate(client, `(() => [...document.querySelectorAll('button')].some(item =>
    ['Built-in plugins', '内置插件'].includes((item.textContent || '').trim()) && item.getBoundingClientRect().width > 0))()`)
  for (const theme of ['light', 'dark']) {
    await waitForValue(client, clickButton(['General', 'General settings', '通用设置']), value => value?.clicked, theme + ' general settings')
    await waitForValue(client, clickButton(theme === 'light' ? ['Light', '浅色', '亮色'] : ['Dark', '深色']), value => value?.clicked, theme + ' theme')
    state = await waitForValue(client, stateExpression, value => value?.theme === theme, theme + ' theme state')
    if (modernBuiltIns) {
      await waitForValue(client, clickButton(['Built-in plugins', '内置插件']), value => value?.clicked, theme + ' built-in plugin settings')
      await waitForValue(client, builtInPluginCard('tool-pwsh', false), value => value?.ready, theme + ' official PowerShell card')
      await waitForValue(client, builtInPluginCard('tool-pwsh'), value => value?.ready && !value.expanded && !value.detailsPresent, theme + ' collapsed official PowerShell details')
      const expanded = await waitForValue(client, builtInPluginCard('tool-pwsh', true), value => value?.ready, theme + ' expand official PowerShell card')
      assert.equal(expanded.clicked, true, 'the exact official PowerShell card must be clicked open')
      await waitForValue(client, builtInPluginCard('tool-pwsh'), officialPowerShellDetailsReady, theme + ' official PowerShell inventory facts')
      const collapsed = await waitForValue(client, builtInPluginCard('tool-pwsh', false), value => value?.ready, theme + ' collapse official PowerShell card')
      assert.equal(collapsed.clicked, true, 'the exact official PowerShell card must be clicked closed')
      await waitForValue(client, builtInPluginCard('tool-pwsh'), value => value?.ready && !value.expanded && !value.detailsPresent, theme + ' official PowerShell details removed')
    }
    await closeOverlay(theme + ' close Settings before public maintenance')
    await verifyLegacyRecoveryContrast(theme)
    await openSettings(theme + ' reopen Settings after public maintenance')
  }
  await waitForValue(client, clickButton(['General', 'General settings', '通用设置']), value => value?.clicked, 'General settings after dark legacy recovery')
  await waitForValue(client, clickButton(['Light', '浅色', '亮色']), value => value?.clicked, 'restore light theme button')
  state = await waitForValue(client, stateExpression, value => value?.theme === 'light', 'restored light theme')

  const stateCountExpression = `window.__dshTrayMessages?.filter(item => item.type === 'dsh-portable/state').length || 0`
  const beforeClear = await evaluate(client, stateCountExpression)
  if (modernBuiltIns) {
    await waitForValue(client, clickButton(['Close', '关闭']), value => value?.clicked, 'close settings before native new-session')
    await waitForValue(client, clickButton(['Plugins', '插件']), value => value?.clicked, 'open sidebar plugins before native new-session')
  }
  await evaluate(client, `window.chrome.webview.__emit({ type: 'dsh-portable/action', action: 'new-session' })`)
  if (modernBuiltIns) {
    // Modern DSH reuses a blank workspace session. An unchanged native
    // projection is deliberately deduplicated, so verify the actual navigation.
    await waitForValue(client, `(() => [...document.querySelectorAll('[role="textbox"][contenteditable="true"],textarea')]
      .some(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0
        && getComputedStyle(item).visibility !== 'hidden'))()`, Boolean, 'native new-session opens the conversation composer')
    // A visible composer is not proof that typing works. Use the browser's
    // input pipeline without sending a message or contacting a model.
    const probeText = 'Portable input acceptance 测试'
    await waitForValue(client, `(() => {
      const input = [...document.querySelectorAll('[role="textbox"][contenteditable="true"],textarea')]
        .find(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0
          && getComputedStyle(item).visibility !== 'hidden' && !item.disabled)
      if (!input) return false
      input.focus()
      return document.activeElement === input
    })()`, Boolean, 'conversation composer accepts focus')
    await client.send('Input.insertText', { text: probeText })
    await waitForValue(client, `(() => {
      const input = document.activeElement
      return (input?.value ?? input?.textContent ?? '').includes(${JSON.stringify(probeText)})
    })()`, Boolean, 'conversation composer accepts actual text input')
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await waitForValue(client, `(() => {
      const input = document.activeElement
      return (input?.value ?? input?.textContent ?? '').trim() === ''
    })()`, Boolean, 'synthetic input is cleared without sending')
  } else {
    const afterClear = await waitForValue(client, stateCountExpression, value => value > beforeClear, 'SessionRuntime.clear state update')
    assert.ok(afterClear > beforeClear)
  }
  assert.equal(await evaluate(client, 'navigator.onLine'), false)
  assert.deepEqual(exceptions, [])

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    locale: state.locale,
    theme: state.theme,
    sessions: state.sessions.length,
    headless: true,
    offlineLoopback: true,
    pluginSettingsSurface: 'official-manager-and-public-maintenance',
    diagnosticOverrideContrast: 'passed-light-and-dark',
    privateMarketLayout: 'retired-no-second-manager',
  })}\n`)
} catch (error) {
  // Keep the actual UI and theme projection before closing the isolated host.
  // A click acknowledgement alone does not establish that the setting changed.
  if (client) {
    try {
      const evidence = await evaluate(client, `(() => ({
        page: location.origin + location.pathname,
        ready: document.readyState,
        bridgeInstalled: Boolean(window.chrome?.webview),
        theme: document.documentElement.getAttribute('data-theme'),
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        states: (window.__dshTrayMessages || []).filter(item => item.type === 'dsh-portable/state').slice(-12),
        controls: [...document.querySelectorAll('button,[role="button"]')].map(item => ({
          label: (item.getAttribute('aria-label') || item.getAttribute('title') || item.textContent || '').trim().slice(0, 100),
          visible: item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0,
          disabled: Boolean(item.disabled),
          pressed: item.getAttribute('aria-pressed'),
          selected: item.getAttribute('aria-selected'),
        })),
      }))()`)
      await writeFile(path.join(root, 'data', 'tray-ui-failure.json'), redactSensitive(JSON.stringify({ error: String(error), exceptions, browserFailures, evidence }, null, 2)))
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      await writeFile(path.join(root, 'data', 'tray-ui-failure.png'), Buffer.from(screenshot.data, 'base64'))
    } catch (captureError) {
      process.stderr.write(`UI failure evidence unavailable: ${redactSensitive(String(captureError))}\n`)
    }
  }
  throw error
} finally {
  client?.close()
  if (chrome?.pid) {
    try { await execFileAsync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { windowsHide: true }) } catch { /* already stopped */ }
  }
  if (started) {
    try { await portable(['stop', '--no-browser', '--json']) } catch { /* preserve the primary failure */ }
  }
  if (profile) {
    const tempRoot = path.resolve(os.tmpdir()) + path.sep
    const resolved = path.resolve(profile)
    if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('dsh-tray-headless-')) {
      throw new Error(`refusing to remove unexpected Chrome profile: ${resolved}`)
    }
    await rm(resolved, { recursive: true, force: true })
  }
}
