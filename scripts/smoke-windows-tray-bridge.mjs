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

const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const portableCli = path.join(root, 'launcher', 'portable-cli.mjs')
for (const filename of [portableNode, portableCli]) {
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
  throw new Error(`portable command returned no JSON: ${source}`)
}

async function portable(args) {
  const result = await execFileAsync(portableNode, [portableCli, ...args], {
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
  throw new Error(`timed out waiting for ${label}; latest=${JSON.stringify(latest)}`)
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
  assert.match(launch.url, /^http:\/\/127\.0\.0\.1:\d+$/)

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
    if (!sidebar?.clicked) throw new Error(`Settings and sidebar controls are unavailable: ${JSON.stringify(settings)}`)
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
        ? /只读|工作区写入|完全访问/.test(text)
        : /Read only|Workspace write|Full access/.test(text),
      mixed: ${JSON.stringify(targetLocale)} === 'zh'
        ? /Read only|Workspace Write|Workspace write|Full access/.test(text)
        : /只读|工作区写入|完全访问/.test(text),
    }
  })()`, value => value?.localized, 'localized permission label in General settings')
  assert.deepEqual(permissionLabels, { localized: true, mixed: false })
  const portableSettings = await waitForValue(client, `(() => {
    const text = document.body?.innerText || ''
    return {
      title: /(?:^|\\n)(?:Portable|便携版)(?:\\n|$)/.test(text),
      updates: /Automatic update checks|自动检查更新/.test(text),
      notifications: /Task completion notifications|任务完成通知/.test(text),
      maintenance: /Check and repair|检查与修复/.test(text),
    }
  })()`, value => value?.title && value.updates && value.notifications && value.maintenance, 'Portable controls in General settings')
  assert.deepEqual(portableSettings, { title: true, updates: true, notifications: true, maintenance: true })
  const readPortableSettings = `fetch('/dsh-portable/settings', { cache: 'no-store' }).then(response => response.json()).then(body => body.settings)`
  const originalSettings = await evaluate(client, readPortableSettings)
  const updateTitle = targetLocale === 'zh' ? '自动检查更新' : 'Automatic update checks'
  await waitForValue(client, clickButton([updateTitle]), value => value?.clicked, 'automatic update selector')
  await waitForValue(client, clickChoice([originalSettings.updateCheckEnabled ? (targetLocale === 'zh' ? '关闭' : 'Off') : (targetLocale === 'zh' ? '开启' : 'On')]), value => value?.clicked, 'automatic update choice')
  const changedSettings = await waitForValue(client, readPortableSettings, value => value?.updateCheckEnabled === !originalSettings.updateCheckEnabled, 'saved automatic update preference')
  await waitForValue(client, clickButton([updateTitle]), value => value?.clicked, 'automatic update selector restore')
  await waitForValue(client, clickChoice([originalSettings.updateCheckEnabled ? (targetLocale === 'zh' ? '开启' : 'On') : (targetLocale === 'zh' ? '关闭' : 'Off')]), value => value?.clicked, 'automatic update choice restore')
  const settingsRoundTrip = await waitForValue(client, readPortableSettings, value => value?.updateCheckEnabled === originalSettings.updateCheckEnabled, 'restored automatic update preference')
  assert.equal(changedSettings.updateCheckEnabled, !settingsRoundTrip.updateCheckEnabled)
  if (generalScreenshotPath) {
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await mkdir(path.dirname(generalScreenshotPath), { recursive: true })
    await writeFile(generalScreenshotPath, Buffer.from(screenshot.data, 'base64'))
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
