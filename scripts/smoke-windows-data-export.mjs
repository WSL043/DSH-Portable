import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

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

async function readProductDefaultPlugins() {
  const componentsFile = path.join(root, 'licenses', 'COMPONENTS.json')
  const productComponents = JSON.parse(await readFile(componentsFile, 'utf8'))
  const defaultPlugins = productComponents.defaultPlugins
  assert.ok(Array.isArray(defaultPlugins) && defaultPlugins.length > 0, 'finished product has no default plugin metadata')
  assert.equal(new Set(defaultPlugins.map(plugin => plugin?.package)).size, defaultPlugins.length, 'default plugin metadata contains duplicate packages')
  for (const plugin of defaultPlugins) {
    assert.match(String(plugin?.package || ''), /^(?:@[^/]+\/)?[^/]+$/, 'default plugin metadata has an invalid package name')
    assert.match(String(plugin?.version || ''), /^\S+$/, 'default plugin metadata has an invalid version')
  }
  return { productComponents, defaultPlugins }
}

function profilePackageJson(profileRoot, packageName) {
  return path.join(profileRoot, 'node_modules', ...String(packageName).split('/'), 'package.json')
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

async function waitForPage(port, launcher, timeoutMs = 90000, previousWebSocketDebuggerUrl = '') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (launcher && launcher.exitCode !== null) throw new Error(`desktop host exited before WebView2 became ready: ${launcher.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(target => target.type === 'page'
          && /^http:\/\/127\.0\.0\.1:\d+/.test(target.url || '')
          && target.webSocketDebuggerUrl !== previousWebSocketDebuggerUrl)
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
    const label = item.getAttribute('aria-label') || item.textContent || item.getAttribute('title') || ''
    if (!names.includes(label.trim()) || item.disabled || item.getAttribute('aria-disabled') === 'true') return false
    const rect = item.getBoundingClientRect()
    const style = getComputedStyle(item)
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return Boolean(point && (point === item || item.contains(point)))
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

async function waitForSupportReport(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const names = (await readdir(outputDirectory)).filter(name => name.startsWith('DSH-Portable-support-') && name.endsWith('.json'))
    if (names.length === 1) return path.join(outputDirectory, names[0])
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for the support report')
}

let launcher = null
let client = null
let importFixtureRoot = ''
try {
  await mkdir(outputDirectory, { recursive: true })
  for (const name of await readdir(outputDirectory)) {
    if (name.endsWith('.dshdata') || name.endsWith('.png') || name.startsWith('DSH-Portable-support-') || name === 'private-password.txt') {
      await rm(path.join(outputDirectory, name), { force: true })
    }
  }
  await portable(['stop', '--no-browser', '--json']).catch(() => {})
  await stopDetachedDesktopHosts()
  const password = 'Portable-test-2026!'
  importFixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-import-fixture-'))
  const [{ createDataArchive }, { layoutForRoot, projectKey }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'launcher', 'data-transfer.mjs')).href),
    import(pathToFileURL(path.join(root, 'launcher', 'portable-core.mjs')).href),
  ])
  const { defaultPlugins } = await readProductDefaultPlugins()
  const fixtureLayout = layoutForRoot(importFixtureRoot, process.platform)
  const fixtureSessionId = 'session-11111111-1111-4111-8111-111111111111'
  const fixtureTimestamp = Date.parse('2026-09-04T00:00:00.000Z')
  const fixtureMarker = path.join(fixtureLayout.dshHome, '.agent-presets', 'import-smoke', 'agent.cordis.yml')
  const fixtureSession = path.join(fixtureLayout.dshHome, 'sessions', projectKey(fixtureLayout.workspace), fixtureSessionId, 'session.jsonl.zstd')
  const fixtureWorkspaceStorage = path.join(fixtureLayout.dshHome, 'storages', 'workspace.json')
  const fixtureSessionProjectionCache = path.join(fixtureLayout.dshHome, 'storages', 'session_projcache.json')
  const fixtureProfile = path.join(fixtureLayout.dshHome, 'profiles', 'web')
  await mkdir(fixtureLayout.workspace, { recursive: true })
  await mkdir(path.dirname(fixtureMarker), { recursive: true })
  await mkdir(path.dirname(fixtureSession), { recursive: true })
  await mkdir(path.dirname(fixtureWorkspaceStorage), { recursive: true })
  await mkdir(fixtureProfile, { recursive: true })
  await writeFile(fixtureMarker, 'name: imported-by-native-ui-smoke\n')
  const fixtureWorkspaceId = 'migration-workspace-smoke'
  await writeFile(fixtureWorkspaceStorage, `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [fixtureWorkspaceId], archivedSessionIds: [] },
    tables: {
      workspaces: {
        [fixtureWorkspaceId]: {
          path: fixtureLayout.workspace,
          title: 'Portable migration smoke',
          sessionIds: [fixtureSessionId],
          createdAt: '2026-09-04T00:00:00.000Z',
          updatedAt: '2026-09-04T00:00:00.000Z',
        },
      },
    },
  }, null, 2)}\n`)
  await writeFile(fixtureSessionProjectionCache, `${JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    global: null,
    tables: {
      sessions: {
        [fixtureSessionId]: {
          identity: {
            createdAt: fixtureTimestamp,
            cwd: fixtureLayout.workspace,
          },
          rows: {
            title: { ver: 1, seq: 6, val: 'Portable migration proof' },
            sessionListMetadata: {
              ver: 1,
              seq: 6,
              val: { blank: false, lastPromptAt: fixtureTimestamp + 3 },
            },
          },
        },
      },
    },
  }, null, 2)}\n`)
  const sessionHeader = Buffer.from(`${JSON.stringify({
    type: 'session',
    version: 0,
    id: fixtureSessionId,
    createdAt: fixtureTimestamp,
    cwd: fixtureLayout.workspace,
    delegationDepth: 0,
    agentPreset: 'standard',
  })}\n`)
  const sessionEvents = Buffer.from([
    { type: 'turn/start', seq: 0, time: fixtureTimestamp + 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: fixtureTimestamp + 2, data: { turn: 1, step: 1 } },
    {
      type: 'user/message',
      seq: 2,
      time: fixtureTimestamp + 3,
      surfaceOp: 'append',
      data: {
        id: 'migration-user-message',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Portable migration session smoke' }],
      },
    },
    {
      type: 'session/title',
      seq: 3,
      time: fixtureTimestamp + 4,
      data: {
        title: 'Portable migration proof',
        messageSeqs: [2],
        source: { kind: 'fallback' },
      },
    },
    {
      type: 'assistant/message',
      seq: 4,
      time: fixtureTimestamp + 5,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'migration-assistant-message',
          role: 'assistant',
          source: { kind: 'model', provider: 'smoke', model: 'smoke' },
          content: [{ type: 'text', text: 'migration-session-proof-2026-09-04' }],
        },
      },
    },
    { type: 'step/end', seq: 5, time: fixtureTimestamp + 6, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 6, time: fixtureTimestamp + 7, data: { turn: 1, reason: { kind: 'completed' } } },
  ].map(event => JSON.stringify(event)).join('\n') + '\n')
  const zstdOptions = { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } }
  const fixtureSessionBytes = Buffer.concat([zstdCompressSync(sessionHeader, zstdOptions), zstdCompressSync(sessionEvents, zstdOptions)])
  await writeFile(fixtureSession, fixtureSessionBytes)
  const importArchive = path.join(importFixtureRoot, 'import-private.dshdata')
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

  await cp(path.join(root, 'data', 'dsh-home', 'profiles', 'web'), fixtureProfile, {
    recursive: true,
    filter: source => !source.split(path.sep).includes('node_modules'),
  })
  const fixtureManifestFile = path.join(fixtureProfile, 'package.json')
  const fixtureManifest = JSON.parse(await readFile(fixtureManifestFile, 'utf8'))
  const currentBundles = fixtureManifest.dsh?.profile?.bundles
  assert.ok(Array.isArray(currentBundles) && currentBundles.length > 0, 'the finished product did not initialize a real web profile')
  const defaultDependencies = Object.fromEntries(defaultPlugins.map(plugin => [plugin.package, plugin.version]))
  fixtureManifest.dependencies = { ...fixtureManifest.dependencies, ...defaultDependencies }
  fixtureManifest.dsh.profile.bundles = [...new Set([...currentBundles, ...defaultPlugins.map(plugin => plugin.package)])]
  await writeFile(fixtureManifestFile, `${JSON.stringify(fixtureManifest, null, 2)}\n`)
  await createDataArchive(fixtureLayout, importArchive, { categories: ['settings', 'sessions', 'plugins'], password })

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const dismissed = await evaluate(client, clickButton(['Continue', '继续', '稍后配置', 'Set up later', 'Configure later']))
    await new Promise(resolve => setTimeout(resolve, dismissed?.clicked ? 250 : 150))
  }

  await waitForValue(client, `(() => {
    const names = new Set(['Settings', '设置', '打开侧边栏', 'Open sidebar', 'Expand sidebar'])
    return [...document.querySelectorAll('button,[role="button"]')].some(item => {
      const label = (item.getAttribute('aria-label') || item.textContent || item.getAttribute('title') || '').trim()
      const rect = item.getBoundingClientRect()
      const style = getComputedStyle(item)
      return names.has(label) && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    })
  })()`, Boolean, 'DSH navigation controls', 60000)

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

  const more = await evaluate(client, clickButton(['更多', 'More']))
  assert.equal(more.clicked, true, `maintenance menu unavailable: ${JSON.stringify(more)}`)
  await waitForValue(client, clickChoice(['导出支持报告', 'Export support report']), value => value?.clicked, 'support report action')
  const supportReport = await waitForSupportReport()
  assert.equal(existsSync(supportReport), true)

  await evaluate(client, `(() => {
    const target = [...document.querySelectorAll('button,[role="button"]')].find(item => /^(导出加密私密包|Export encrypted private package)$/.test((item.textContent || '').trim()))
    target?.scrollIntoView({ block: 'center' })
    return Boolean(target)
  })()`)
  await new Promise(resolve => setTimeout(resolve, 150))
  await waitForValue(
    client,
    clickButton(['导出加密私密包', 'Export encrypted private package']),
    value => value?.clicked,
    'private export action after transient settings overlays close',
  )
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

  await waitForValue(client, `(() => {
    const privatePasswordInput = [...document.querySelectorAll('input[type="password"][autocomplete="new-password"]')].find(item => {
      const rect = item.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    return !privatePasswordInput
  })()`, Boolean, 'private export completion')
  await waitForValue(client, `(() => {
    const action = [...document.querySelectorAll('button,[role="button"]')].find(item => /^(导出迁移包|Export migration package)$/.test((item.textContent || '').trim()))
    if (!action || action.disabled || action.getAttribute('aria-disabled') === 'true') return false
    action.scrollIntoView({ block: 'center' })
    return true
  })()`, Boolean, 'migration export availability')
  await waitForValue(client, clickButton(['导出迁移包', 'Export migration package']), value => value?.clicked, 'migration export action')
  const standardArchive = await waitForArchive('DSH-Portable-data-')

  await waitForValue(client, clickButton(['导入数据包', 'Import data package']), value => value?.clicked, 'data import action')
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
  const initialClientExceptions = client.exceptions
  const previousWebSocketDebuggerUrl = page.webSocketDebuggerUrl
  client.close()
  const importedMarker = path.join(root, 'data', 'dsh-home', '.agent-presets', 'import-smoke', 'agent.cordis.yml')
  const importDeadline = Date.now() + 120000
  while (!existsSync(importedMarker) && Date.now() < importDeadline) await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(await readFile(importedMarker, 'utf8'), 'name: imported-by-native-ui-smoke\n')
  // Dependency restoration may legitimately consume the bounded 180-second
  // install window before the native host can restart the imported profile.
  const restartDeadline = Date.now() + 240000
  let restarted = false
  while (Date.now() < restartDeadline) {
    try {
      const status = JSON.parse((await portable(['status', '--json'])).stdout.trim().split(/\r?\n/).at(-1))
      if (status.status === 'running') { restarted = true; break }
    } catch { /* restart is still in progress */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.equal(restarted, true)
  const restartedPage = await waitForPage(debugPort, null, 120000, previousWebSocketDebuggerUrl)
  client = new CdpClient(restartedPage.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await waitForValue(client, 'document.readyState', value => value === 'complete', 'restarted DSH document readiness', 60000)

  await waitForValue(
    client,
    `(() => {
      const visibleExactText = text => [...document.querySelectorAll('*')].find(candidate => {
        if ((candidate.textContent || '').trim() !== text) return false
        const rect = candidate.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      if (visibleExactText('Portable migration proof')) return { ready: true, expanded: true }
      const workspaceLabel = visibleExactText('Portable migration smoke')
      const workspace = workspaceLabel?.closest('[role="treeitem"][aria-expanded]')
      if (!workspace) return { ready: false }
      const expanded = workspace.getAttribute('aria-expanded') === 'true'
      if (!expanded) workspace.click()
      return { ready: true, expanded }
    })()`,
    value => value?.ready,
    'imported workspace is available in the restarted DSH workspace list',
    60000,
  )
  try {
    await waitForValue(
      client,
      `(() => {
        const title = 'Portable migration proof'
        const item = [...document.querySelectorAll('*')].find(candidate => {
          if ((candidate.textContent || '').trim() !== title) return false
          const rect = candidate.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })?.closest('[role="treeitem"]')
        if (!item) return {
          clicked: false,
          treeitems: [...document.querySelectorAll('[role="treeitem"]')]
            .slice(0, 40)
            .map(row => ({ text: (row.textContent || '').trim(), expanded: row.getAttribute('aria-expanded') })),
        }
        item.click()
        return { clicked: true }
      })()`,
      value => value?.clicked,
      'migrated session is available in the restarted DSH session list',
      60000,
    )
  } catch (error) {
    await capture(client, '07-restored-session-list-failure.png')
    throw error
  }
  await waitForValue(
    client,
    'document.body?.innerText || ""',
    text => String(text).includes('migration-session-proof-2026-09-04'),
    'migrated session is readable through the restarted DSH WebView',
    60000,
  )

  const expectedPackages = defaultPlugins.map(plugin => plugin.package)
  const installedState = await waitForValue(
    client,
    `fetch('/dsh-market/installed', { cache: 'no-store' }).then(response => response.ok ? response.json() : ({})).catch(() => ({}))`,
    state => state?.profile === 'web' && expectedPackages.every(packageName => Object.hasOwn(state.installed || {}, packageName)),
    'default plugins loaded through the restarted DSH surface',
    60000,
  )
  const migratedSessionFile = path.join(root, 'data', 'dsh-home', 'sessions', projectKey(fixtureLayout.workspace), fixtureSessionId, 'session.jsonl.zstd')
  const migratedSession = JSON.parse(zstdDecompressSync(await readFile(migratedSessionFile)).toString('utf8').split(/\r?\n/)[0])
  assert.equal(migratedSession.id, fixtureSessionId)
  const migratedPlugins = await Promise.all(defaultPlugins.map(async plugin => ({
    package: plugin.package,
    expectedVersion: plugin.version,
    version: JSON.parse(await readFile(profilePackageJson(path.join(root, 'data', 'dsh-home', 'profiles', 'web'), plugin.package), 'utf8')).version,
  })))
  assert.equal(migratedPlugins.every(plugin => plugin.version === plugin.expectedVersion), true, JSON.stringify(migratedPlugins))
  assert.equal(defaultPlugins.every(plugin => Object.hasOwn(installedState.installed || {}, plugin.package)), true, JSON.stringify(installedState))
  await portable(['stop', '--no-browser', '--json'])
  await rm(path.join(root, 'data', 'dsh-home', '.agent-presets', 'import-smoke'), { recursive: true, force: true })

  const passwordFile = path.join(outputDirectory, 'private-password.txt')
  await writeFile(passwordFile, password, { mode: 0o600 })
  const standardInspect = await portable(['inspect-data', '--input', standardArchive, '--json'])
  const privateInspect = await portable(['inspect-data', '--input', privateArchive, '--password-file', passwordFile, '--json'])
  await rm(passwordFile, { force: true })
  assert.match(standardInspect.stdout, /"categories"/)
  assert.match(privateInspect.stdout, /"categories"/)
  assert.deepEqual([...initialClientExceptions, ...client.exceptions], [])

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    supportReport,
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
