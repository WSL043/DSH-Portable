import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('usage: node smoke-windows-tray-bridge.mjs <DSH-Portable root>')
if (process.platform !== 'win32') throw new Error('the native tray bridge smoke is Windows-only')
const targetLocale = process.env.DSH_SMOKE_LOCALE === 'en' ? 'en' : 'zh'
const screenshotPath = process.env.DSH_SMOKE_SCREENSHOT ? path.resolve(process.env.DSH_SMOKE_SCREENSHOT) : ''
const generalScreenshotPath = process.env.DSH_SMOKE_GENERAL_SCREENSHOT
  ? path.resolve(process.env.DSH_SMOKE_GENERAL_SCREENSHOT)
  : ''
const generalBottomScreenshotPath = process.env.DSH_SMOKE_GENERAL_BOTTOM_SCREENSHOT
  ? path.resolve(process.env.DSH_SMOKE_GENERAL_BOTTOM_SCREENSHOT)
  : ''
const installedScreenshotPath = process.env.DSH_SMOKE_INSTALLED_SCREENSHOT
  ? path.resolve(process.env.DSH_SMOKE_INSTALLED_SCREENSHOT)
  : ''
const diagnosticsScreenshotPath = process.env.DSH_SMOKE_DIAGNOSTICS_SCREENSHOT
  ? path.resolve(process.env.DSH_SMOKE_DIAGNOSTICS_SCREENSHOT)
  : ''
const activationPlugin = String(process.env.DSH_SMOKE_PLUGIN_ACTIVATION || '').trim()
const updatePlugin = String(process.env.DSH_SMOKE_PLUGIN_UPDATE || '').trim()
const activationScreenshotPath = process.env.DSH_SMOKE_PLUGIN_ACTIVATION_SCREENSHOT
  ? path.resolve(process.env.DSH_SMOKE_PLUGIN_ACTIVATION_SCREENSHOT)
  : ''
const removeActivationPlugin = process.env.DSH_SMOKE_PLUGIN_REMOVE_AFTER === '1'
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
    env: { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' },
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
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`headless Chrome exited before DevTools became ready (code ${process.exitCode}): ${output.stderr || output.stdout}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(target => target.type === 'page')
        if (page?.webSocketDebuggerUrl) return page
      }
    } catch { /* Chrome is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for headless Chrome DevTools on 127.0.0.1:${port}: ${output.stderr || output.stdout}`)
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

async function waitForValue(client, expression, predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await evaluate(client, expression)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${label}; latest=${redactSensitive(JSON.stringify(latest))}`)
}

const initScript = String.raw`(() => {
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

const clickButton = names => `(() => {
  const names = ${JSON.stringify(names)}
  const button = [...document.querySelectorAll('button,[role="button"]')].find(item => {
    const label = item.getAttribute('aria-label') || item.getAttribute('title') || item.textContent || ''
    return names.includes(label.trim())
  })
  if (!button) return {
    clicked: false,
    controls: [...document.querySelectorAll('button,[role="button"],a')].slice(0, 80).map(item => ({
      tag: item.tagName,
      role: item.getAttribute('role') || '',
      ariaLabel: item.getAttribute('aria-label') || '',
      title: item.getAttribute('title') || '',
      text: (item.textContent || '').trim().slice(0, 80),
    })),
  }
  button.click()
  return { clicked: true }
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
  chrome = spawn(chromeExecutable(), [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  chrome.stdout.on('data', chunk => { chromeOutput.stdout = `${chromeOutput.stdout}${chunk}`.slice(-8000) })
  chrome.stderr.on('data', chunk => { chromeOutput.stderr = `${chromeOutput.stderr}${chunk}`.slice(-8000) })

  const page = await waitForDevTools(debugPort, chrome, chromeOutput)

  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  const exceptions = []
  client.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'runtime exception'))
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript })
  await client.send('Page.navigate', { url: launch.url })

  await waitForValue(client, 'document.readyState', value => value === 'complete', 'DSH document readiness')
  const stateExpression = `window.__dshTrayMessages?.filter(item => item.type === 'dsh-portable/state').at(-1) || null`
  let state = await waitForValue(client, stateExpression, value => value?.schemaVersion === 1, 'initial tray bridge state')
  assert.ok(['en', 'zh'].includes(state.locale))
  assert.ok(['light', 'dark'].includes(state.theme))
  assert.ok(Array.isArray(state.sessions))
  assert.ok(state.sessions.length <= 10)

  const onboarding = await evaluate(client, clickButton(['稍后配置', 'Set up later', 'Configure later']))
  if (onboarding?.clicked) {
    await waitForValue(
      client,
      `![...document.querySelectorAll('button')].some(item => ['稍后配置', 'Set up later', 'Configure later'].includes((item.textContent || '').trim()))`,
      Boolean,
      'onboarding dismissal',
    )
  }
  const testingNotice = await evaluate(client, clickButton(['Continue', '继续']))
  if (testingNotice?.clicked) {
    await waitForValue(
      client,
      `![...document.querySelectorAll('button')].some(item => ['Continue', '继续'].includes((item.textContent || '').trim()))`,
      Boolean,
      'testing notice dismissal',
    )
  }
  const providerOnboarding = await evaluate(client, clickButton(['稍后配置', 'Set up later', 'Configure later']))
  if (providerOnboarding?.clicked) {
    await waitForValue(
      client,
      `![...document.querySelectorAll('button')].some(item => ['稍后配置', 'Set up later', 'Configure later'].includes((item.textContent || '').trim()))`,
      Boolean,
      'provider onboarding dismissal',
    )
  }
  await waitForValue(client, `(() => {
    const labels = [...document.querySelectorAll('button')].map(item => (item.textContent || '').trim())
    return {
      ready: labels.some(label => ['Settings', '设置', '打开侧边栏', 'Open sidebar', 'Expand sidebar'].includes(label)),
      labels: labels.slice(0, 20),
      url: location.href,
      title: document.title,
      bodyText: (document.body?.innerText || '').trim().slice(0, 500),
      htmlBytes: document.documentElement?.outerHTML?.length || 0,
    }
  })()`, value => value?.ready, 'DSH shell controls', 60000)
  let settings = await evaluate(client, clickButton(['Settings', '设置']))
  if (!settings?.clicked) {
    const sidebar = await evaluate(client, clickButton(['打开侧边栏', 'Open sidebar', 'Expand sidebar']))
    if (!sidebar?.clicked) throw new Error(`Settings and sidebar controls are unavailable: ${redactSensitive(JSON.stringify(settings))}`)
    settings = await waitForValue(client, clickButton(['Settings', '设置']), value => value?.clicked, 'Settings button')
  }
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

  await waitForValue(client, clickButton(['General', 'General settings', '通用设置']), value => value?.clicked, 'General settings tab')
  const permissionLabels = await waitForValue(client, `(() => {
    const text = document.body?.innerText || ''
    return {
      localized: ${JSON.stringify(targetLocale)} === 'zh'
        ? /只读|仅可查看|工作区写入|可写入工作区|完全访问|完全权限/.test(text)
        : /Read [Oo]nly|Workspace [Ww]rite|Full access/.test(text),
      mixed: ${JSON.stringify(targetLocale)} === 'zh'
        ? /Read [Oo]nly|Workspace [Ww]rite|Full access/.test(text)
        : /只读|仅可查看|工作区写入|可写入工作区|完全访问|完全权限/.test(text),
    }
  })()`, value => value?.localized, 'localized permission label in General settings')
  assert.deepEqual(permissionLabels, { localized: true, mixed: false })
  const portableSettings = await waitForValue(client, `(() => {
    const text = document.body?.innerText || ''
    return {
      title: /(?:^|\\n)(?:Portable|便携版)(?:\\n|$)/.test(text),
      updates: /(?:^|\\n)(?:Updates|更新)(?:\\n|$)/.test(text),
      product: /DSH-Portable/.test(text),
      engine: /DeepSeek Harness/.test(text),
      notifications: /Task completion notifications|任务完成通知/.test(text),
      maintenance: /Check and repair|检查与修复/.test(text),
    }
  })()`, value => value?.title && value.updates && value.product && value.engine && value.notifications && value.maintenance, 'Portable controls in General settings')
  assert.deepEqual(portableSettings, { title: true, updates: true, product: true, engine: true, notifications: true, maintenance: true })
  const readPortableSettings = `fetch('/dsh-portable/settings', { cache: 'no-store' }).then(response => response.json()).then(body => body.settings)`
  const originalSettings = await evaluate(client, readPortableSettings)
  const updatePreference = async (title, key) => {
    const selectorLabel = `${title} · ${targetLocale === 'zh' ? '启动时检查' : 'Check at startup'}`
    const original = Boolean(originalSettings[key])
    await waitForValue(client, clickButton([selectorLabel]), value => value?.clicked, `${title} startup selector`)
    await waitForValue(client, clickChoice([original ? (targetLocale === 'zh' ? '关闭' : 'Off') : (targetLocale === 'zh' ? '开启' : 'On')]), value => value?.clicked, `${title} startup choice`)
    const changed = await waitForValue(client, readPortableSettings, value => value?.[key] === !original, `saved ${title} startup preference`)
    await waitForValue(client, clickButton([selectorLabel]), value => value?.clicked, `${title} startup selector restore`)
    await waitForValue(client, clickChoice([original ? (targetLocale === 'zh' ? '开启' : 'On') : (targetLocale === 'zh' ? '关闭' : 'Off')]), value => value?.clicked, `${title} startup choice restore`)
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
    await mkdir(path.dirname(generalScreenshotPath), { recursive: true })
    await writeFile(generalScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  }
  if (generalBottomScreenshotPath) {
    await evaluate(client, `(() => {
      const marker = [...document.querySelectorAll('*')].find(item => ['Portable', '便携版'].includes((item.textContent || '').trim()))
      let scroller = marker?.parentElement
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 20) scroller = scroller.parentElement
      if (!scroller) return false
      scroller.scrollTop = scroller.scrollHeight
      return true
    })()`)
    await new Promise(resolve => setTimeout(resolve, 120))
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await mkdir(path.dirname(generalBottomScreenshotPath), { recursive: true })
    await writeFile(generalBottomScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  }

  await waitForValue(client, clickButton(['Plugins', '插件']), value => value?.clicked, 'Plugins settings tab')
  const extensionUi = await evaluate(client, `({
    root: Boolean(document.querySelector('.dspx-root')),
    tab: [...document.querySelectorAll('button')].some(item => ['Portable extensions', '便携扩展'].includes((item.textContent || '').trim())),
  })`)
  assert.deepEqual(extensionUi, { root: false, tab: false })
  await waitForValue(client, clickButton(['Plugin Market', '插件市场']), value => value?.clicked, 'Plugin Market settings section')
  const expectedMarketSearch = targetLocale === 'zh'
    ? '搜索插件，比如：通知、终端、记忆…'
    : 'Search plugins: notify, terminal, memory…'
  const marketUi = await waitForValue(client, `(() => {
    const search = [...document.querySelectorAll('input')].find(item => item.placeholder === ${JSON.stringify(expectedMarketSearch)})
    const controls = [...document.querySelectorAll('button')]
    const installButtons = controls.filter(item => ['Install', '安装'].includes((item.textContent || '').trim())).length
    const ownerImages = [...document.querySelectorAll('img')].filter(item => item.src.includes('github.com/') && item.src.includes('.png?size=96')).length
    return { search: Boolean(search), installButtons, ownerImages }
  })()`, value => value?.search && value.installButtons > 0 && value.ownerImages > 0, 'visual Plugin Market cards', 60000)
  assert.ok(marketUi.installButtons > 0)
  assert.ok(marketUi.ownerImages > 0)
  const picturedPlugin = await evaluate(client, `(async () => {
    const response = await fetch('/dsh-market/registry', { cache: 'no-store' })
    const body = await response.json()
    const plugin = body.registry?.plugins?.find(item => Array.isArray(item.screenshots)
      && item.screenshots.some(value => /^[\\x00-\\x7F]+$/.test(value))
      && item.url)
    return plugin ? { name: plugin.name, projectHref: plugin.url, screenshots: plugin.screenshots } : null
  })()`)
  assert.ok(picturedPlugin?.name)
  assert.ok(picturedPlugin?.projectHref)
  assert.ok(picturedPlugin?.screenshots?.length > 0)
  await evaluate(client, `(() => {
    const input = [...document.querySelectorAll('input')].find(item => item.placeholder === ${JSON.stringify(expectedMarketSearch)})
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(picturedPlugin.name)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  const picturedUi = await waitForValue(client, `(() => {
    const projectHref = new URL(${JSON.stringify(picturedPlugin.projectHref)}, location.href).href
    const screenshotUrls = ${JSON.stringify(picturedPlugin.screenshots)}.map(value => new URL(value, location.href).href)
    const titleLink = [...document.querySelectorAll('a')].find(item => item.href === projectHref && (item.textContent || '').trim() === ${JSON.stringify(picturedPlugin.name)})
    const cardShot = [...document.querySelectorAll('img')].find(item => screenshotUrls.includes(item.src) && item.complete && item.naturalWidth > 0)
    const rect = cardShot?.getBoundingClientRect()
    return { projectHref: titleLink?.href || '', cardShot: Boolean(cardShot), width: rect?.width || 0, height: rect?.height || 0 }
  })()`, value => value?.projectHref && value.cardShot && value.width >= 200 && value.height >= 140, 'pictured plugin card and project link', 60000)
  assert.equal(picturedUi.projectHref, new URL(picturedPlugin.projectHref, launch.url).href)
  assert.ok(picturedUi.cardShot)
  if (screenshotPath) {
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await mkdir(path.dirname(screenshotPath), { recursive: true })
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  }
  await waitForValue(client, clickButton(['Compact', '紧凑']), value => value?.clicked, 'compact market view')
  await waitForValue(client, `(() => {
    const active = [...document.querySelectorAll('button[aria-pressed="true"]')].find(item => ['Compact', '紧凑'].includes((item.textContent || '').trim()))
    const screenshot = [...document.querySelectorAll('img')].find(item => item.naturalWidth > 0 && item.getBoundingClientRect().width >= 200)
    return { active: Boolean(active), saved: localStorage.getItem('dshm-market-view'), screenshotVisible: screenshot ? getComputedStyle(screenshot).display !== 'none' : false }
  })()`, value => value?.active && value.saved === 'compact' && value.screenshotVisible === false, 'persisted compact market view')
  await waitForValue(client, clickButton(['Cards', '图文']), value => value?.clicked, 'card market view')
  await waitForValue(client, `(() => ({
    active: [...document.querySelectorAll('button[aria-pressed="true"]')].some(item => ['Cards', '图文'].includes((item.textContent || '').trim())),
    saved: localStorage.getItem('dshm-market-view'),
  }))()`, value => value?.active && value.saved === 'cards', 'persisted card market view')

  if (updatePlugin !== '') {
    await waitForValue(client, clickButton(['Installed', '已安装']), value => value?.clicked, 'Installed plugin section for update')
    await waitForValue(client, `(() => {
      const title = [...document.querySelectorAll('a')].find(item =>
        (item.textContent || '').trim() === ${JSON.stringify(updatePlugin)}
        && item.getBoundingClientRect().width > 0
        && item.getBoundingClientRect().height > 0)
      const card = title?.closest('div[class*="_irow"]')
      const actions = card && [...card.querySelectorAll('button')].filter(item => ['Update', '更新'].includes((item.textContent || '').trim()))
      if (actions?.length === 1) { actions[0].click(); return true }
      return false
    })()`, Boolean, `${updatePlugin} update action`, 90_000)
    // A package inside the fresh-release safety window needs one explicit
    // confirmation. Older releases skip this branch.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const confirmed = await evaluate(client, clickButton(['Update now', '立即更新']))
      if (confirmed?.clicked) break
      const started = await evaluate(client, `(${JSON.stringify(targetLocale === 'zh' ? `更新\n${updatePlugin}` : `Update\n${updatePlugin}`)} && (document.body?.innerText || '').includes(${JSON.stringify(targetLocale === 'zh' ? `更新\n${updatePlugin}` : `Update\n${updatePlugin}`)}))`)
      if (started) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const updated = await waitForValue(client, `(() => {
      const text = document.body?.innerText || ''
      const present = text.includes(${JSON.stringify(`${targetLocale === 'zh' ? '更新' : 'Update'}\n${updatePlugin}`)})
      const refresh = /Complete · refresh to show changes|已完成 · 刷新页面后显示/.test(text)
      const restart = /Complete · restart DeepSeek Harness to apply|已完成 · 重启 DeepSeek Harness 后生效/.test(text)
      const live = /Complete and active|已完成并生效/.test(text)
      const refreshButtons = [...document.querySelectorAll('button')].filter(item => ['Refresh page', '刷新页面'].includes((item.textContent || '').trim())).length
      const restartButtons = [...document.querySelectorAll('button')].filter(item => ['Restart now', '立即重启'].includes((item.textContent || '').trim())).length
      return { present, refresh, restart, live, refreshButtons, restartButtons, text: text.slice(-1400) }
    })()`, value => value?.present && Number(value.refresh) + Number(value.restart) + Number(value.live) === 1, `${updatePlugin} update completion action`, 180_000)
    assert.equal(updated.refreshButtons + updated.restartButtons <= 1, true, 'update must offer no more than one apply action')
    process.stdout.write(`[plugin-update] ${updatePlugin}: ${updated.restart ? 'restart' : updated.refresh ? 'refresh' : 'live'}\n`)
  }

  if (activationPlugin !== '') {
    await evaluate(client, `(() => {
      const input = [...document.querySelectorAll('input')].find(item => ['Search plugins: notify, terminal, memory…', '搜索插件，比如：通知、终端、记忆…'].includes(item.placeholder || ''))
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, ${JSON.stringify(activationPlugin)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    const installClicked = await waitForValue(client, `(() => {
      const title = [...document.querySelectorAll('a')].find(item => (item.textContent || '').trim() === ${JSON.stringify(activationPlugin)})
      let card = title
      while (card && card !== document.body) {
        const action = [...card.querySelectorAll('button')].find(item => ['Install', '安装'].includes((item.textContent || '').trim()))
        if (action) { action.click(); return true }
        card = card.parentElement
      }
      return false
    })()`, Boolean, `${activationPlugin} install action`, 60_000)
    assert.equal(installClicked, true)
    await waitForValue(client, clickButton(['Confirm install', '确认安装']), value => value?.clicked, 'plugin install confirmation')
    const completion = await waitForValue(client, `(() => {
      const text = document.body?.innerText || ''
      const refresh = /Complete · refresh to show changes|已完成 · 刷新页面后显示/.test(text)
      const restart = /Complete · restart DeepSeek Harness to apply|已完成 · 重启 DeepSeek Harness 后生效/.test(text)
      const live = /Complete and active|已完成并生效/.test(text)
      const refreshButtons = [...document.querySelectorAll('button')].filter(item => ['Refresh page', '刷新页面'].includes((item.textContent || '').trim())).length
      const restartButtons = [...document.querySelectorAll('button')].filter(item => ['Restart now', '立即重启'].includes((item.textContent || '').trim())).length
      return { refresh, restart, live, refreshButtons, restartButtons, text: text.slice(-1200) }
    })()`, value => value && Number(value.refresh) + Number(value.restart) + Number(value.live) === 1, `${activationPlugin} completion action`, 180_000)
    assert.equal(completion.refreshButtons + completion.restartButtons <= 1, true, 'a plugin operation must offer no more than one apply action')
    if (completion.refresh) assert.equal(completion.refreshButtons, 1)
    if (completion.restart) assert.equal(completion.restartButtons, 1)
    if (completion.live) assert.equal(completion.refreshButtons + completion.restartButtons, 0)
    if (activationScreenshotPath) {
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      await mkdir(path.dirname(activationScreenshotPath), { recursive: true })
      await writeFile(activationScreenshotPath, Buffer.from(screenshot.data, 'base64'))
    }
    process.stdout.write(`[plugin-activation] ${activationPlugin}: ${completion.restart ? 'restart' : completion.refresh ? 'refresh' : 'live'}\n`)

    if (removeActivationPlugin) {
      if (completion.restart) throw new Error('remove-after smoke requires a live or refresh-activated plugin')
      if (completion.refresh) {
        await waitForValue(client, clickButton(['Refresh page', '刷新页面']), value => value?.clicked, 'apply plugin with page refresh')
        await new Promise(resolve => setTimeout(resolve, 600))
        await waitForValue(client, 'document.readyState', value => value === 'complete', 'reloaded DSH document readiness')
        await waitForValue(client, `(() => {
          const labels = [...document.querySelectorAll('button')].map(item => (item.textContent || '').trim())
          return labels.some(label => ['Settings', '设置', '打开侧边栏', 'Open sidebar', 'Expand sidebar'].includes(label))
        })()`, Boolean, 'reloaded DSH shell controls', 60_000)
        let reopened = await evaluate(client, clickButton(['Settings', '设置']))
        if (!reopened?.clicked) {
          await waitForValue(client, clickButton(['打开侧边栏', 'Open sidebar', 'Expand sidebar']), value => value?.clicked, 'reloaded sidebar control')
          reopened = await waitForValue(client, clickButton(['Settings', '设置']), value => value?.clicked, 'reloaded Settings button')
        }
        assert.equal(reopened.clicked, true)
        await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(item => /Settings|设置/.test(item.textContent || '')))`, Boolean, 'reloaded Settings dialog')
        await waitForValue(client, clickButton(['Plugins', '插件']), value => value?.clicked, 'reloaded Plugins settings tab')
      }
      await waitForValue(client, clickButton(['Installed', '已安装']), value => value?.clicked, 'Installed plugin section')
      await waitForValue(client, `(() => {
        const title = [...document.querySelectorAll('a')].find(item =>
          (item.textContent || '').trim() === ${JSON.stringify(activationPlugin)}
          && item.getBoundingClientRect().width > 0
          && item.getBoundingClientRect().height > 0)
        const card = title?.closest('div[class*="_irow"]')
        const actions = card && [...card.querySelectorAll('button')].filter(item => ['Uninstall', '卸载'].includes((item.textContent || '').trim()))
        if (actions?.length === 1) { actions[0].click(); return true }
        return false
      })()`, Boolean, `${activationPlugin} uninstall action`, 60_000)
      await waitForValue(client, `(() => {
        const expectedTitle = ${JSON.stringify((targetLocale === 'zh' ? '卸载 ' : 'Uninstall ') + activationPlugin + '?')}
        const heading = [...document.querySelectorAll('body *')].find(item =>
          item.children.length === 0
          && (item.textContent || '').trim() === expectedTitle
          && item.getBoundingClientRect().width > 0)
        let modal = heading?.parentElement
        while (modal && modal !== document.body) {
          const actions = [...modal.querySelectorAll('button')].filter(item => ['Uninstall', '卸载'].includes((item.textContent || '').trim()))
          const cancels = [...modal.querySelectorAll('button')].filter(item => ['Cancel', '取消'].includes((item.textContent || '').trim()))
          if (actions.length === 1 && cancels.length === 1) {
            actions[0].click()
            return true
          }
          modal = modal.parentElement
        }
        return false
      })()`, Boolean, 'plugin uninstall confirmation')
      const removal = await waitForValue(client, `(() => {
        const text = document.body?.innerText || ''
        const present = text.includes(${JSON.stringify(`${targetLocale === 'zh' ? '卸载' : 'Uninstall'}\n${activationPlugin}`)})
        const refresh = /Complete · refresh to show changes|已完成 · 刷新页面后显示/.test(text)
        const restart = /Complete · restart DeepSeek Harness to apply|已完成 · 重启 DeepSeek Harness 后生效/.test(text)
        const live = /Complete and active|已完成并生效/.test(text)
        const refreshButtons = [...document.querySelectorAll('button')].filter(item => ['Refresh page', '刷新页面'].includes((item.textContent || '').trim())).length
        const restartButtons = [...document.querySelectorAll('button')].filter(item => ['Restart now', '立即重启'].includes((item.textContent || '').trim())).length
        return { present, refresh, restart, live, refreshButtons, restartButtons, text: text.slice(-1400) }
      })()`, value => value?.present && Number(value.refresh) + Number(value.restart) + Number(value.live) === 1, `${activationPlugin} uninstall completion action`, 180_000)
      assert.equal(removal.refreshButtons + removal.restartButtons <= 1, true, 'uninstall must offer no more than one apply action')
      const afterRemoval = await evaluate(client, `fetch('/dsh-market/status', { cache: 'no-store' }).then(response => response.json())`)
      assert.equal(Object.hasOwn(afterRemoval.installed || {}, activationPlugin), false)
      process.stdout.write(`[plugin-uninstall] ${activationPlugin}: ${removal.restart ? 'restart' : removal.refresh ? 'refresh' : 'live'}\n`)
    }
  }

  if (installedScreenshotPath) {
    await waitForValue(client, clickButton(['Installed', '已安装']), value => value?.clicked, 'Installed native Plugins tab')
    const installedUi = await waitForValue(client, `(() => {
      const text = document.body?.innerText || ''
      const search = [...document.querySelectorAll('input')].some(item => ['Search plugins: notify, terminal, memory…', '搜索插件，比如：通知、终端、记忆…'].includes(item.placeholder || ''))
      const defaultPlugins = ['dsh-chat-manager', 'dsh-image-viewer'].filter(name => text.includes(name))
      const marketSelected = [...document.querySelectorAll('button')].some(item => {
        const label = (item.textContent || '').trim()
        return ['Plugin Market', '插件市场'].includes(label) && item.getAttribute('aria-selected') === 'true'
      })
      return { search, defaultPlugins, marketSelected }
    })()`, value => value?.search && value.defaultPlugins?.length === 2 && value.marketSelected === false, 'Installed sibling tab with both defaults', 60000)
    assert.equal(installedUi.defaultPlugins.length, 2)
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await mkdir(path.dirname(installedScreenshotPath), { recursive: true })
    await writeFile(installedScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  }

  const diagnosticContrastExpression = `(() => {
    const tag = [...document.querySelectorAll('[class*="_ovByTag"]')].find(item => {
      const rect = item.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (!tag) return null
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
  })()`
  const verifyDiagnosticContrast = async (themeLabel) => {
    await waitForValue(client, clickButton(['Installed', '已安装']), value => value?.clicked, `${themeLabel} installed plugin section`)
    await waitForValue(client, clickButton(['Diagnostics', '诊断']), value => value?.clicked, `${themeLabel} diagnostics section`)
    await waitForValue(client, `(() => {
      if ([...document.querySelectorAll('[class*="_ovByTag"]')].some(item => item.getBoundingClientRect().width > 0)) return { clicked: true }
      const titles = ['Override relationships', '覆盖关系']
      const button = [...document.querySelectorAll('button')].find(item => titles.some(title => (item.textContent || '').includes(title)))
      if (!button) return { clicked: false }
      button.click()
      return { clicked: true }
    })()`, value => value?.clicked, `${themeLabel} override relationship section`)
    const result = await waitForValue(client, diagnosticContrastExpression, value => value?.text && value.contrastRatio >= 4.5, `diagnostic override contrast in ${themeLabel} theme`)
    assert.ok(result.contrastRatio >= 4.5, `${themeLabel} diagnostic override contrast was ${result.contrastRatio}`)
  }
  await verifyDiagnosticContrast('light')
  await waitForValue(client, clickButton(['General', 'General settings', '通用设置']), value => value?.clicked, 'General settings before dark diagnostics')
  await waitForValue(client, clickButton(['Dark', '深色']), value => value?.clicked, 'dark theme button')
  state = await waitForValue(client, stateExpression, value => value?.theme === 'dark', 'theme dark for diagnostic contrast')
  await waitForValue(client, clickButton(['Plugins', '插件']), value => value?.clicked, 'Plugins settings tab in dark theme')
  await verifyDiagnosticContrast('dark')
  if (diagnosticsScreenshotPath) {
    await evaluate(client, `(() => {
      const tag = [...document.querySelectorAll('[class*="_ovByTag"]')].find(item => item.getBoundingClientRect().width > 0)
      tag?.scrollIntoView({ block: 'center', inline: 'nearest' })
      return Boolean(tag)
    })()`)
    await new Promise(resolve => setTimeout(resolve, 120))
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await mkdir(path.dirname(diagnosticsScreenshotPath), { recursive: true })
    await writeFile(diagnosticsScreenshotPath, Buffer.from(screenshot.data, 'base64'))
  }
  await waitForValue(client, clickButton(['General', 'General settings', '通用设置']), value => value?.clicked, 'General settings after dark diagnostics')
  await waitForValue(client, clickButton(['Light', '浅色', '亮色']), value => value?.clicked, 'restore light theme button')
  state = await waitForValue(client, stateExpression, value => value?.theme === 'light', 'restored light theme')

  const stateCountExpression = `window.__dshTrayMessages?.filter(item => item.type === 'dsh-portable/state').length || 0`
  const beforeClear = await evaluate(client, stateCountExpression)
  await evaluate(client, `window.chrome.webview.__emit({ type: 'dsh-portable/action', action: 'new-session' })`)
  const afterClear = await waitForValue(client, stateCountExpression, value => value > beforeClear, 'SessionRuntime.clear state update')
  assert.ok(afterClear > beforeClear)
  assert.deepEqual(exceptions, [])

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    locale: state.locale,
    theme: state.theme,
    sessions: state.sessions.length,
    headless: true,
  })}\n`)
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
