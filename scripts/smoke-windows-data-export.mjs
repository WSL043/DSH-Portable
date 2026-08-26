import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
const outputDirectory = path.resolve(process.argv[3] || '')
if (!root || !process.argv[2] || !process.argv[3]) {
  throw new Error('usage: node smoke-windows-data-export.mjs <DSH-Portable root> <evidence directory>')
}
if (process.platform !== 'win32') throw new Error('the native data-export smoke is Windows-only')

const executable = path.join(root, 'DeepSeek-Herness.exe')
const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const portableCli = path.join(root, 'launcher', 'portable-cli.mjs')
const runtimeEntry = path.join(root, 'launcher', 'runtime-entry.mjs')
for (const filename of [executable, portableNode, portableCli, runtimeEntry]) {
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

async function waitForPage(port, launcher, timeoutMs = 90000) {
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
    this.exceptions = []
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'runtime exception')
      }
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

const clickButton = names => `(() => {
  const names = ${JSON.stringify(names)}
  const button = [...document.querySelectorAll('button,[role="button"]')].find(item => {
    const label = item.getAttribute('aria-label') || item.getAttribute('title') || item.textContent || ''
    return names.includes(label.trim())
  })
  if (!button) return { clicked: false, labels: [...document.querySelectorAll('button,[role="button"]')].slice(0, 80).map(item => (item.textContent || item.getAttribute('aria-label') || '').trim()) }
  button.click()
  return { clicked: true }
})()`

const clickChoice = names => `(() => {
  const names = ${JSON.stringify(names)}
  const candidates = [...document.querySelectorAll('[role="menuitem"],[role="option"],[data-radix-collection-item],button')]
  const target = candidates.find(item => names.includes((item.textContent || '').trim()))
  if (!target) return { clicked: false }
  target.click()
  return { clicked: true }
})()`

async function capture(client, filename) {
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(outputDirectory, filename), Buffer.from(screenshot.data, 'base64'))
}

async function portable(args) {
  return execFileAsync(portableNode, [runtimeEntry, path.basename(portableCli), ...args], {
    cwd: root,
    env: { ...process.env, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1' },
    timeout: 120000,
    windowsHide: true,
  })
}

async function stopDetachedDesktopHosts() {
  const script = `$target=$env:DSH_PORTABLE_SMOKE_EXECUTABLE; for ($attempt=0; $attempt -lt 24; $attempt++) { $owned=@(Get-CimInstance Win32_Process -Filter "Name='DeepSeek-Herness.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($target, [System.StringComparison]::OrdinalIgnoreCase) }); if ($owned.Count -gt 0) { $owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }; Start-Sleep -Milliseconds 250 }; $remaining=@(Get-CimInstance Win32_Process -Filter "Name='DeepSeek-Herness.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($target, [System.StringComparison]::OrdinalIgnoreCase) }); if ($remaining.Count -gt 0) { throw 'finished-product smoke left an owned desktop host running' }`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, DSH_PORTABLE_SMOKE_EXECUTABLE: executable },
  })
}

async function waitForArchive(prefix, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const names = (await readdir(outputDirectory)).filter(name => name.startsWith(prefix) && name.endsWith('.dshdata'))
    if (names.length === 1) return path.join(outputDirectory, names[0])
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${prefix} archive`)
}

let launcher = null
let client = null
let importFixtureRoot = ''
try {
  await mkdir(outputDirectory, { recursive: true })
  for (const name of await readdir(outputDirectory)) {
    if (name.endsWith('.dshdata') || name.endsWith('.png') || name === 'private-password.txt') {
      await rm(path.join(outputDirectory, name), { force: true })
    }
  }
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  await stopDetachedDesktopHosts()
  const password = 'Portable-test-2026!'
  importFixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-import-fixture-'))
  const [{ createDataArchive }, { layoutForRoot }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'launcher', 'data-transfer.mjs')).href),
    import(pathToFileURL(path.join(root, 'launcher', 'portable-core.mjs')).href),
  ])
  const fixtureLayout = layoutForRoot(importFixtureRoot, process.platform)
  const fixtureMarker = path.join(fixtureLayout.dshHome, '.agent-presets', 'import-smoke', 'agent.cordis.yml')
  await mkdir(path.dirname(fixtureMarker), { recursive: true })
  await writeFile(fixtureMarker, 'name: imported-by-native-ui-smoke\n')
  const importArchive = path.join(importFixtureRoot, 'import-private.dshdata')
  await createDataArchive(fixtureLayout, importArchive, { categories: ['settings'], password })
  const debugPort = await reserveLoopbackPort()
  launcher = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
      DSH_PORTABLE_TEST_AUTOMATION: '1',
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
      DSH_PORTABLE_DATA_EXPORT_DIRECTORY: outputDirectory,
      DSH_PORTABLE_DATA_IMPORT_FILE: importArchive,
    },
    stdio: 'ignore',
  })

  const page = await waitForPage(debugPort, launcher)
  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await waitForValue(client, 'document.readyState', value => value === 'complete', 'DSH document readiness', 60000)

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const dismissed = await evaluate(client, clickButton(['Continue', '继续', '稍后配置', 'Set up later', 'Configure later']))
    await new Promise(resolve => setTimeout(resolve, dismissed?.clicked ? 250 : 150))
  }

  let settings = await evaluate(client, clickButton(['Settings', '设置']))
  if (!settings?.clicked) {
    const sidebar = await evaluate(client, clickButton(['打开侧边栏', 'Open sidebar', 'Expand sidebar']))
    assert.equal(sidebar.clicked, true, `Settings unavailable: ${JSON.stringify(settings)}`)
    settings = await waitForValue(client, clickButton(['Settings', '设置']), value => value?.clicked, 'Settings button')
  }
  await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(item => /Settings|设置/.test(item.textContent || '')))`, Boolean, 'Settings dialog')

  if (!/(^|\n)语言(\n|$)/.test(await evaluate(client, 'document.body?.innerText || ""'))) {
    const language = await evaluate(client, clickButton(['English', '英文', 'Chinese', '中文']))
    if (language?.clicked) await waitForValue(client, clickChoice(['中文']), value => value?.clicked, 'Chinese locale choice')
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dismissed = await evaluate(client, clickButton(['Continue', '继续', '稍后配置', 'Set up later', 'Configure later']))
    await new Promise(resolve => setTimeout(resolve, dismissed?.clicked ? 200 : 120))
  }
  await waitForValue(client, clickButton(['General', 'General settings', '通用设置']), value => value?.clicked, 'General settings tab')
  await waitForValue(client, `/(迁移与备份|Migration and backup)/.test(document.body?.innerText || '')`, Boolean, 'migration settings')
  await evaluate(client, `(() => {
    const marker = [...document.querySelectorAll('*')].find(item => /^(迁移与备份|Migration and backup)$/.test((item.textContent || '').trim()))
    marker?.scrollIntoView({ block: 'center' })
    return Boolean(marker)
  })()`)
  await new Promise(resolve => setTimeout(resolve, 200))
  await capture(client, '03-general-settings.png')

  const privateOpen = await evaluate(client, clickButton(['导出加密私密包', 'Export encrypted private package']))
  assert.equal(privateOpen.clicked, true, `private export action unavailable: ${JSON.stringify(privateOpen)}`)
  await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(item => /导出加密私密包|Export encrypted private package/.test(item.textContent || '')))`, Boolean, 'private export dialog')
  const privateGeometry = await evaluate(client, `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(item => /导出加密私密包|Export encrypted private package/.test(item.textContent || ''))
    const inputs = [...document.querySelectorAll('input[type="password"][autocomplete="new-password"]')].filter(input => {
      const rect = input.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (!dialog || inputs.length !== 2) return { ok: false, count: inputs.length }
    const dialogRect = dialog.getBoundingClientRect()
    const rects = inputs.map(input => input.getBoundingClientRect())
    return {
      ok: rects.every(rect => rect.left >= dialogRect.left && rect.right <= dialogRect.right && rect.width > 0),
      dialog: { left: dialogRect.left, right: dialogRect.right },
      inputs: rects.map(rect => ({ left: rect.left, right: rect.right, width: rect.width })),
    }
  })()`)
  assert.equal(privateGeometry.ok, true, `password inputs overflow the modal: ${JSON.stringify(privateGeometry)}`)
  await capture(client, '04-private-export-modal.png')

  const filled = await evaluate(client, `(() => {
    const inputs = [...document.querySelectorAll('input[type="password"][autocomplete="new-password"]')].filter(input => {
      const rect = input.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (inputs.length !== 2) return { count: inputs.length, inputs: inputs.map(input => ({
      placeholder: input.getAttribute('placeholder') || '',
      ariaLabel: input.getAttribute('aria-label') || '',
      parent: (input.parentElement?.parentElement?.textContent || '').trim().slice(0, 100),
    })) }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    for (const input of inputs) {
      setter.call(input, ${JSON.stringify(password)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return { count: inputs.length }
  })()`)
  assert.equal(filled.count, 2, JSON.stringify(filled.inputs || []))
  await waitForValue(client, clickButton(['选择位置并导出', 'Choose location and export']), value => value?.clicked, 'private export confirmation')
  const privateArchive = await waitForArchive('DSH-Portable-private-')

  await waitForValue(client, clickButton(['导出迁移包', 'Export migration package']), value => value?.clicked, 'migration export action')
  const standardArchive = await waitForArchive('DSH-Portable-data-')

  const importOpen = await evaluate(client, clickButton(['导入数据包', 'Import data package']))
  assert.equal(importOpen.clicked, true, `data import action unavailable: ${JSON.stringify(importOpen)}`)
  await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(item => /输入数据包密码|Enter package password/.test(item.textContent || '')))`, Boolean, 'import password dialog')
  await capture(client, '05-import-password-modal.png')
  const importFilled = await evaluate(client, `(() => {
    const input = [...document.querySelectorAll('input[type="password"][autocomplete="current-password"]')].find(item => {
      const rect = item.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(password)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  assert.equal(importFilled, true)
  await waitForValue(client, clickButton(['确认导入', 'Confirm import']), value => value?.clicked, 'import package inspection')
  await waitForValue(client, `Boolean([...document.querySelectorAll('[role="dialog"]')].find(item => /确认导入|Confirm import/.test(item.textContent || '')))`, Boolean, 'import confirmation dialog')
  await capture(client, '06-import-confirm-modal.png')
  await waitForValue(client, clickButton(['重启并导入', 'Restart and import']), value => value?.clicked, 'restart and import')
  const importedMarker = path.join(root, 'data', 'dsh-home', '.agent-presets', 'import-smoke', 'agent.cordis.yml')
  const importDeadline = Date.now() + 120000
  while (!existsSync(importedMarker) && Date.now() < importDeadline) await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(await readFile(importedMarker, 'utf8'), 'name: imported-by-native-ui-smoke\n')
  const restartDeadline = Date.now() + 90000
  let restarted = false
  while (Date.now() < restartDeadline) {
    try {
      const status = JSON.parse((await portable(['status', '--json'])).stdout.trim().split(/\r?\n/).at(-1))
      if (status.status === 'running') { restarted = true; break }
    } catch { /* restart is still in progress */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.equal(restarted, true)
  await portable(['stop', '--no-browser', '--json'])
  await rm(path.join(root, 'data', 'dsh-home', '.agent-presets', 'import-smoke'), { recursive: true, force: true })

  const passwordFile = path.join(outputDirectory, 'private-password.txt')
  await writeFile(passwordFile, password, { mode: 0o600 })
  const standardInspect = await portable(['inspect-data', '--input', standardArchive, '--json'])
  const privateInspect = await portable(['inspect-data', '--input', privateArchive, '--password-file', passwordFile, '--json'])
  await rm(passwordFile, { force: true })
  assert.match(standardInspect.stdout, /"categories"/)
  assert.match(privateInspect.stdout, /"categories"/)
  assert.deepEqual(client.exceptions, [])

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    standardArchive,
    privateArchive,
    imported: true,
    screenshots: ['03-general-settings.png', '04-private-export-modal.png', '05-import-password-modal.png', '06-import-confirm-modal.png'],
  })}\n`)
} finally {
  client?.close()
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  if (launcher?.pid) {
    try { await execFileAsync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true }) } catch { /* already stopped */ }
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
  await stopDetachedDesktopHosts()
  if (importFixtureRoot) await rm(importFixtureRoot, { recursive: true, force: true })
}
