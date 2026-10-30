import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { isDeepStrictEqual, promisify } from 'node:util'
import { createServer } from 'node:net'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dismissOfficialOnboardingExpression } from './lib/official-onboarding.mjs'
import { safeDataTarget } from '../launcher/data-paths.mjs'
import { verifiedPackageFile } from './verified-package-file.mjs'
import { ensureRuntimeCapsule } from '../launcher/runtime-capsule.mjs'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

export function marketEvidenceLocation(value) {
  assert.ok(typeof value === 'string' && value.length > 0, 'market evidence directory is required')
  const requested = path.resolve(value)
  const base = path.resolve(tmpdir())
  if (path.dirname(base) !== base) {
    const relative = path.relative(base, requested)
    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      return { base, relative }
    }
  }
  const relative = path.relative(repositoryRoot, requested)
  const storage = path.join('complete-evidence', 'storage')
  if (relative === storage || relative.startsWith(`${storage}${path.sep}`)) {
    return { base: repositoryRoot, relative }
  }
  throw new Error('Market evidence must be below an actual temporary root or the fixed complete-evidence/storage directory')
}

export async function prepareMarketEvidenceOutput(value) {
  // Reject unapproved lexical paths before touching the requested directory.
  const selected = marketEvidenceLocation(value)
  const base = await realpath(selected.base)
  // The report is a fixed leaf; safeDataTarget checks every output-directory
  // ancestor, including dangling links, before creating missing directories.
  const report = await safeDataTarget(base, `${selected.relative.split(path.sep).join('/')}/category-geometry.json`)
  const output = await realpath(path.dirname(report))
  const relative = path.relative(base, output)
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Market evidence directory escapes its approved root')
  return output
}

/** Legacy JSON API compatibility plus the default select/cancel flow; no export UI is implied. */
export function assertMaintenanceReadOnly(requests, legacyExportApiCompatibility) {
  assert.deepEqual(requests.filter(item => !['GET', 'HEAD', 'OPTIONS'].includes(item.method)), [], 'opening legacy recovery and cancelling import must not mutate the profile')
  assert.deepEqual(requests.filter(item => item.path === '/dsh-market/check'), [], 'legacy recovery must not query a second compatibility assessment')
  const fixture = legacyExportApiCompatibility
  assert.ok(fixture?.originMatched === true && fixture.path === '/dsh-market/backup' && fixture.httpStatus === 200
    && Number.isSafeInteger(fixture.bytes) && fixture.bytes > 0 && fixture.bytes <= 2 * 1024 * 1024
    && /^[a-f0-9]{64}$/.test(fixture.sha256)
    && fixture.format === 'dsh-profile-backup' && fixture.version === 0.2
    && fixture.packageJson === true && fixture.manifestMatches === true,
    'the retained legacy export API must supply a valid owned profile fixture matching the actual manifest')
  assert.ok(requests.some(item => item.path === '/dsh-market/backup' && item.method === 'GET' && item.status === 200), 'the actual legacy export API GET must complete')
  // Existing official toolbar version refreshes can read installed inventory while this overlay is open.
  return { legacyExportApiCompatibility: true, diagnosticGets: 0, installedReads: requests.filter(item => item.path === '/dsh-market/installed' && item.method === 'GET').length, restorePosts: 0, mutationRequests: 0 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const root = process.argv[2] && path.resolve(process.argv[2])
assert.ok(process.argv.includes('--disposable'), 'use an isolated test installation with --disposable')
assert.ok(root && process.argv[3])
const output = await prepareMarketEvidenceOutput(process.argv[3])
const exec = promisify(execFile)
// Never inherit the developer's selected profile/data environment into a
// disposable test that can now explicitly reclaim managed logs and caches.
const env = { ...process.env, DSH_PORTABLE_ROOT: root, DSH_PORTABLE_STATE_ROOT: root,
  DSH_PORTABLE_BASE_STATE_ROOT: root, DSH_PORTABLE_ENVIRONMENT: 'default',
  DSH_PORTABLE_RUNTIME_CACHE: path.join(root, 'acceptance-runtime-cache'),
  DSH_PORTABLE_WEBVIEW_CACHE: path.join(root, 'acceptance-webview-cache'),
  DSH_PORTABLE_TEST_HIDDEN: '1', DSH_PORTABLE_TEST_AUTOMATION: '1', DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
  // Exercise the product's actual official Installed and Discover surfaces.
  DSH_PORTABLE_OFFICIAL_MARKET: '1' }
// A source-overlay probe must not load immutable server sources from the old
// release capsule while serving new client files off disk.
const sourceOverlay = process.argv.includes('--source-overlay')
if (sourceOverlay) env.DSH_PORTABLE_STARTUP_SOURCE_CACHE = '0'
const soak = process.argv.includes('--soak')
const maintenanceOnly = process.argv.includes('--maintenance-only')
const verifyLegacyRestore = process.argv.includes('--verify-legacy-restore')
assert.ok(!verifyLegacyRestore || !maintenanceOnly, '--verify-legacy-restore requires the plugin navigation checks')
const verifyWebView = process.argv.includes('--verify-webview-cache')
if (verifyWebView) env.DSH_PORTABLE_TEST_WEBVIEW2_MISSING = '1'
// Live npm availability is a separate integration check, not a layout prerequisite.
const verifyTotal = process.argv.includes('--verify-total')
const samples = []
const sampler = fileURLToPath(new URL('./sample-portable-processes.ps1', import.meta.url))
async function sample(phase) {
  if (!soak) return
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', sampler, '-Root', root], { windowsHide: true, timeout: 15000 })
  samples.push({ phase, ...JSON.parse(stdout) })
  await writeFile(path.join(output, 'resources.json'), JSON.stringify(samples, null, 2))
}
const cli = (...args) => exec(path.join(root, 'runtime/node/node.exe'), [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', ...args, '--json'], { cwd: root, env, windowsHide: true, timeout: 60000 })
assert.equal(JSON.parse((await cli('status')).stdout).status, 'stopped')
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const child = spawn(path.join(root, 'DeepSeek-Herness.exe'), [], { cwd: root, env: { ...env, DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${port}` }, windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, evaluate, passed = false
const exceptions = []
const networkRequests = [], requestById = new Map()
let legacyExportApiCompatibility = null, confirmedLegacyRestore = null
let publicMarket = false
try {
  let page
  const deadline = Date.now() + 90000
  while (!page && Date.now() < deadline) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(p.url)) } catch {}
    if (!page) await delay(200)
  }
  assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next = 0
  const pending = new Map()
  const ownedOrigin = new URL(page.url).origin
  const attachment = headers => Object.entries(headers || {}).some(([name, value]) =>
    name.toLowerCase() === 'content-disposition' && /^attachment\b/i.test(String(value)))
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data), params = message.params
    if (message.method === 'Network.requestWillBeSent') {
      const request = params.request, url = new URL(request.url)
      if (url.origin === ownedOrigin && url.pathname.startsWith('/dsh-market/')) {
        const item = { method: request.method, path: url.pathname }
        networkRequests.push(item); requestById.set(params.requestId, item)
      }
    }
    if (message.method === 'Network.responseReceived') {
      const item = requestById.get(params.requestId)
      if (item) { item.status = params.response.status; item.attachment ||= attachment(params.response.headers); item.responseReceived = true }
    }
    if (message.method === 'Network.loadingFailed') {
      const item = requestById.get(params.requestId)
      if (item) { item.loadingError = /^net::ERR_[A-Z0-9_]+$/.test(params.errorText) ? params.errorText : 'other'; item.canceled = params.canceled === true }
    }
    if (message.method === 'Network.loadingFinished') {
      const item = requestById.get(params.requestId)
      if (item) item.finished = true
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(params?.exceptionDetails?.exception?.description || params?.exceptionDetails?.text)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id); clearTimeout(entry.timer)
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) })
  evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value }
  let completedCredentialOnboarding = false
  const dismissLateOnboarding = dismissOfficialOnboardingExpression
  const until = async (expression, predicate, label) => {
    const limit = Date.now() + 30000
    let result
    while (Date.now() < limit) {
      // A provider notice can mount after settings are already interactive.
      // Dismiss only these known first-run prompts, never arbitrary dialogs.
      const onboarding = await evaluate(dismissLateOnboarding)
      if (onboarding?.clicked) {
        completedCredentialOnboarding ||= onboarding.clicked && onboarding.terminal
      } else {
        result = await evaluate(expression)
        if (predicate(result)) return result
      }
      await delay(100)
    }
    throw new Error(`${label}: ${JSON.stringify(result)}`)
  }
  const click = (names, scope = 'body') => `(() => {const names=${JSON.stringify(names)};const root=document.querySelector(${JSON.stringify(scope)});const button=[...(root?.querySelectorAll('button,[role="button"],[role="tab"],[role="menuitem"]')||[])].find(item=>names.includes((item.getAttribute('aria-label')||item.textContent||'').trim())&&item.getBoundingClientRect().width>0);button?.click();return Boolean(button)})()`
  const clickDiscoverTab = click(['Discover', '发现'], '[role="tablist"]')
  const openMarket = async () => {
    await until(clickDiscoverTab, Boolean, 'official Discover tab')
    await until('Boolean(document.querySelector(\'[data-plugin-tab="discover"]\'))', Boolean, 'official Discover content')
    assert.equal(await evaluate('Boolean(document.querySelector(\'[role="tab"][id$="-dsh-portable-plugin-advanced"]\'))'), false, 'no top-level Advanced tab')
    publicMarket = true
  }
  const nativeStateExpression = key => `new Promise(resolve => {
    const listener = event => { if (event.data?.type !== 'dsh-portable/test-desktop-result') return;
      chrome.webview.removeEventListener('message', listener); resolve(event.data); };
    chrome.webview.addEventListener('message', listener);
    chrome.webview.postMessage({type:'dsh-portable/test-desktop',${key == null ? '' : `key:${key},`}});
  })`
  const nativeState = key => evaluate(nativeStateExpression(key))
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  await evaluate(`(() => {
    const events = window.__portableAcceptanceDialogs = [];
    let previous = '';
    const observe = () => {
      const visible = [...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')]
        .filter(item => item.getBoundingClientRect().width > 0)
        .map(item => (item.textContent || '').slice(0, 160)).join(' | ');
      if (visible !== previous && events.length < 100) {
        events.push({ at: performance.now(), visible }); previous = visible;
      }
    };
    new MutationObserver(observe).observe(document, { childList: true, subtree: true, attributes: true });
    observe();
  })()`)

  // In this keyless disposable profile, the official final onboarding step is
  // Configure later. A newly appearing step deliberately closes Settings, so
  // complete that real flow before issuing any settings navigation.
  await until(`(() => {
    const dialogs = [...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')]
      .filter(item => item.getBoundingClientRect().width > 0)
    if (dialogs.length) return false
    const settings = [...document.querySelectorAll('button')].find(item =>
      ['Settings', '设置', 'More', '更多', 'Account menu', '账号菜单'].includes((item.getAttribute('aria-label') || item.textContent || '').trim()))
    return Boolean(settings && settings.getBoundingClientRect().width > 0 && !settings.closest('[inert]'))
  })()`, ready => ready && completedCredentialOnboarding, 'credential onboarding finishes before settings navigation')
  await until(nativeStateExpression(), state => state.nativeLoadingVisible === false, 'native workspace handoff completes')
  await until(`typeof window.__DSH_PORTABLE_SETTINGS__?.open === 'function'`, Boolean, 'official settings adapter is ready')
  await evaluate(`chrome.webview.postMessage({type:'dsh-portable/test-desktop',key:131260})`)
  await until(`Boolean([...document.querySelectorAll('dialog,[role="dialog"]')].find(item =>
    item.getBoundingClientRect().width > 0 && /Desktop & data|桌面与数据/.test(item.textContent || '')))` , Boolean, 'native settings command opens after onboarding')

  if (process.argv.includes('--layout')) {
    await until(click(['General', 'General settings', '通用设置']), Boolean, 'general theme baseline')
    await until(click(['Light', '浅色']), Boolean, 'explicit light theme baseline')
  }
  await writeFile(path.join(output, 'general-page.txt'), await evaluate('document.body.innerText'))
  await until(click(['Desktop & data', '桌面与数据', 'Portable']), Boolean, 'dedicated Portable settings navigation')
  await until(`document.body.innerText.includes('Check and repair') || document.body.innerText.includes('检查与修复')`, Boolean, 'Portable maintenance without update controls')
  assert.equal(await evaluate(`Boolean(document.querySelector('button[aria-label="Update channel"],button[aria-label="更新通道"]'))`), false)
  await until(click(['Updates', '更新']), Boolean, 'dedicated Updates navigation')
  await until(`Boolean(document.querySelector('button[aria-label="Engine version"],button[aria-label="内核版本"]'))`, Boolean, 'core version control')
  // Portable has a single release channel, so the Updates page must not offer a channel choice.
  assert.equal(await evaluate(`Boolean(document.querySelector('button[aria-label="Update channel"],button[aria-label="更新通道"]'))`), false)
  const updateNavigation = await evaluate(`(() => {
    const button = labels => [...document.querySelectorAll('button')].find(node => labels.includes((node.textContent || '').trim()))
    const general = button(['General', '通用设置']), updates = button(['Updates', '更新']), models = button(['Models', '模型'])
    return { ordered: general?.getBoundingClientRect().y < updates?.getBoundingClientRect().y && updates?.getBoundingClientRect().y < models?.getBoundingClientRect().y,
      distinctIcon: Boolean(updates?.querySelector('svg')) && updates.querySelector('svg').innerHTML !== general?.querySelector('svg')?.innerHTML }
  })()`)
  assert.deepEqual(updateNavigation, { ordered: true, distinctIcon: true })
  await writeFile(path.join(output, 'updates-navigation.json'), JSON.stringify(updateNavigation))
  await delay(500)
  await writeFile(path.join(output, 'updates-settings.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
  await until(click(['Engine version', '内核版本']), Boolean, 'core version selector')
  await until(`Boolean(document.querySelector('button[aria-label="Engine version"][aria-expanded="true"],button[aria-label="内核版本"][aria-expanded="true"]'))`, Boolean, 'core version menu open')
  await delay(150)
  await writeFile(path.join(output, 'updates-version-menu.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
  await until(click(['Engine version', '内核版本']), Boolean, 'close core version selector')
  await until(click(['Desktop & data', '桌面与数据', 'Portable']), Boolean, 'return to Portable maintenance')
  for (const key of [262214, 262230, 262216]) {
    assert.equal((await nativeState(key)).openMenus.length, 1, 'keyboard opens one native menu')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 130, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 130, button: 'left', clickCount: 1 })
    assert.deepEqual((await nativeState()).openMenus, [], 'WebView click closes native menus')
    await nativeState(key)
    assert.deepEqual((await nativeState(27)).openMenus, [], 'Escape closes the menu before affecting the page')
  }
  await writeFile(path.join(output, 'menu-dismissal.json'), JSON.stringify({ passed: true, menus: 3, webViewPointer: true, escape: true }))
  await evaluate(`document.querySelector('section[aria-label="Updates"],section[aria-label="更新"]')?.scrollIntoView({block:'start'})`)
  const portableScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(output, 'portable-settings.png'), Buffer.from(portableScreenshot.data, 'base64'))
  const generalBorders = await until(`(() => {
    const textOf = node => (node?.textContent || '').replace(/\\s+/g, ' ').trim()
    const portableLabels = new Set(['Desktop & data', '桌面与数据', 'Portable', '便携版'])
    const dataLabels = new Set(['Data', '数据'])
    const portableGroup = [...document.querySelectorAll('div')].find(node => {
      const heading = [...node.children].find(child => portableLabels.has(textOf(child)))
      const dataSections = [...node.children].filter(child => child.matches?.('section[aria-label]') && dataLabels.has(child.getAttribute('aria-label') || ''))
      return heading && dataSections.length > 0
    })
    if (!portableGroup) return null
    const sections = [...portableGroup.children].filter(child => child.matches?.('section[aria-label]'))
    const dataSection = sections.filter(section => dataLabels.has(section.getAttribute('aria-label') || '')).at(-1)
    // Each group's rows sit inside one card (dshPortableCard); the rows are the card's children.
    const rowsOf = section => [...section.children].slice(1).flatMap(child => child.classList?.contains('dshPortableCard') ? [...child.children] : [child])
    const dataRow = dataSection ? rowsOf(dataSection).at(-1) : null
    if (!dataSection || !dataRow) return null
    dataSection.scrollIntoView({ block: 'end' })
    const borderOf = node => {
      const value = getComputedStyle(node).borderBottomWidth
      return { value, px: Number.parseFloat(value) }
    }
    const internalRows = sections.flatMap(section => rowsOf(section).map(row => ({
      section: section.getAttribute('aria-label') || '', text: textOf(row).slice(0, 200), borderBottom: borderOf(row),
    })))
    return {
      portableGroup: { heading: textOf([...portableGroup.children].find(child => portableLabels.has(textOf(child)))), borderBottom: borderOf(portableGroup) },
      dataSection: { label: dataSection.getAttribute('aria-label') || '', lastRow: { text: textOf(dataRow).slice(0, 200), borderBottom: borderOf(dataRow) } },
      internalRows,
    }
  })()`, value => value !== null && value !== undefined, 'Portable general borders')
  await writeFile(path.join(output, 'general-borders.json'), JSON.stringify(generalBorders, null, 2))
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => resolve(true)))`)
  const generalScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(output, 'general-borders.png'), Buffer.from(generalScreenshot.data, 'base64'))
  assert.equal(generalBorders.portableGroup.borderBottom.px, 0, 'Portable group bottom border must be zero')
  assert.equal(generalBorders.dataSection.lastRow.borderBottom.px, 0, 'Data section last row bottom border must be zero')
  assert.ok(generalBorders.internalRows.some(row => row.borderBottom.px > 0), 'Portable internal rows must retain a separator')
  const { verifyMaintenance } = await import('./lib/native-maintenance-checks.mjs')
  await verifyMaintenance({ root, evaluate, until, click, send, output, sample, soak, nativePid: child.pid, verifyWebView, verifyPluginCache: process.argv.includes('--verify-plugin-cache') })
  if (!maintenanceOnly) {
    const expression = (fn, value = null) => '(' + fn.toString() + ')(' + JSON.stringify(value) + ')'
    const pageValue = (fn, value) => evaluate(expression(fn, value))
    const closeDialog = click(['Close', '关闭', 'Cancel', '取消'], '[role="dialog"]')
    await until(closeDialog, Boolean, 'close settings before official plugin management')
    await until(click(['Plugins', '插件']), Boolean, 'official Plugins')
    const components = JSON.parse(await readFile(path.join(root, 'licenses/COMPONENTS.json'), 'utf8'))
    assert.ok(Array.isArray(components.defaultPlugins), 'explicit community-default metadata')
    assert.equal(await pageValue(() => Boolean(document.querySelector('[role="tab"][id$="-dsh-portable-plugin-advanced"]'))), false, 'no Advanced tab')
    if (components.defaultPlugins.length > 0) {
      await until('Boolean(document.querySelector(\'[data-plugin-package="dsh-chat-manager"]\'))', Boolean, 'official Installed list')
      await until(expression(() => {
        const card = document.querySelector('[data-plugin-package="dsh-chat-manager"]')
        const button = card && [...card.querySelectorAll('button')].find(item => item.getAttribute('role') !== 'switch')
        button?.click(); return Boolean(button)
      }), Boolean, 'official installed plugin details')
      await until(expression(() => [...document.querySelectorAll('[data-plugin-panel] button')].some(item =>
        /^(?:Uninstall|卸载)(?:\s+.+)?$/.test((item.getAttribute('aria-label') || item.textContent || '').trim())
        && !item.disabled && item.getBoundingClientRect().width > 0)), Boolean, 'official plugin management controls remain available')
      await until(expression(() => {
        const button = document.querySelector('[data-plugin-panel] button[aria-label="Back to plugins"],[data-plugin-panel] button[aria-label="返回插件"],[data-plugin-panel] button[aria-label="返回插件列表"]')
        if (!button || button.disabled || button.getBoundingClientRect().width === 0) return false
        button.click(); return true
      }), Boolean, 'return to official Installed')
    } else {
      await until(expression(() => Boolean(document.querySelector('[data-plugin-panel]'))
        && [['Installed', '已安装'], ['Discover', '发现']].every(names => [...document.querySelectorAll('[role="tab"]')].some(item =>
          names.includes(item.textContent.trim()) && item.getBoundingClientRect().width > 0))
        && [...document.querySelectorAll('button')].some(item => /^(?:Add plugin|添加插件)$/.test(item.textContent.trim()))
        && !/Reading plugins…|正在读取插件…|Could not read all plugins|无法读取全部插件/.test(document.body.innerText)), Boolean, 'official empty Installed list loaded')
      assert.equal(await pageValue(() => document.querySelectorAll('[data-plugin-package="dsh-chat-manager"],[data-plugin-package="dsh-image-viewer"]').length), 0, 'community plugins are not installed by default')
    }


    await openMarket()
    await until(expression(() => document.querySelectorAll('[data-plugin-tab="discover"] [data-market-entry]').length > 0), Boolean, 'real official Discover catalog')
    if (verifyTotal) {
      const total = await evaluate("fetch('/dsh-market/download-total?name=dsh-codex-subscription').then(async r => ({status:r.status,body:await r.json()}))")
      assert.equal(total.status, 200)
      assert.ok(Number.isSafeInteger(total.body.downloads) && total.body.downloads > 0)
      assert.equal(total.body.complete, true)
      await writeFile(path.join(output, 'download-total.json'), JSON.stringify(total, null, 2))
    }
    const checks = []
    for (const width of (soak ? Array.from({ length: 30 }, (_, i) => i % 2 ? 1200 : 580) : [580, 1200, 580])) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      await evaluate('document.fonts.ready.then(() => true)')
      const geometry = await until(expression(() => {
        const pane = document.querySelector('[data-plugin-tab="discover"]')
        const cards = [...(pane?.querySelectorAll('[data-market-entry]') || [])]
        const categories = pane?.querySelector('[role="group"][aria-label="Categories"],[role="group"][aria-label="分类"]')
        if (!cards.length || !categories || pane.querySelector('[aria-busy="true"]')) return null
        return { count: cards.length, categories: categories.querySelectorAll('button').length,
          overflow: cards.some(card => card.scrollWidth > card.clientWidth + 1),
          controls: cards.every(card => card.querySelector('button[aria-label]')) }
      }), Boolean, 'official discovery layout at ' + width)
      assert.ok(geometry.count > 0 && geometry.categories > 1)
      assert.equal(geometry.overflow, false, 'official cards must fit the settings-column width')
      assert.equal(geometry.controls, true, 'official details/install or manage controls remain reachable')
      await until(expression(() => {
        const group = document.querySelector('[data-plugin-tab="discover"] [role="group"][aria-label="Categories"],[data-plugin-tab="discover"] [role="group"][aria-label="分类"]')
        const button = group?.querySelectorAll('button')[1]
        button?.click(); return Boolean(button)
      }), Boolean, 'select a real official category')
      await until(expression(() => {
        const group = document.querySelector('[data-plugin-tab="discover"] [role="group"][aria-label="Categories"],[data-plugin-tab="discover"] [role="group"][aria-label="分类"]')
        return group?.querySelectorAll('button')[1]?.getAttribute('aria-pressed') === 'true'
      }), Boolean, 'official category selection applied')
      await until(expression(() => {
        const group = document.querySelector('[data-plugin-tab="discover"] [role="group"][aria-label="Categories"],[data-plugin-tab="discover"] [role="group"][aria-label="分类"]')
        group?.querySelector('button')?.click(); return Boolean(group)
      }), Boolean, 'restore all official categories')
      await until(expression(() => document.querySelectorAll('[data-plugin-tab="discover"] [data-market-entry]').length > 0), Boolean, 'official catalog returns after clearing category')
      checks.push({ width, ...geometry })
      await writeFile(path.join(output, 'official-discover-' + width + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
      if (checks.length % 5 === 0) await sample('official-discover-' + checks.length)
    }
    await writeFile(path.join(output, 'category-geometry.json'), JSON.stringify(checks, null, 2))
    await until(expression(() => {
      const field = document.querySelector('[data-plugin-tab="discover"] input[type="search"]')
      field?.focus(); return Boolean(field)
    }), Boolean, 'official discovery search')
    await send('Input.insertText', { text: 'portable-no-match-acceptance-847291' })
    await until(expression(() => /No plugins match|没有符合条件的插件/.test(document.querySelector('[data-plugin-tab="discover"]')?.textContent || '')), Boolean, 'official search reports an empty result')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await until(expression(() => document.querySelectorAll('[data-plugin-tab="discover"] [data-market-entry]').length > 0), Boolean, 'official catalog returns after clearing search')
    const detailPackage = await until(expression(() => {
      const button = document.querySelector('[data-plugin-tab="discover"] [data-market-entry] button[aria-label^="View "],[data-plugin-tab="discover"] [data-market-entry] button[aria-label^="查看 "]')
      const name = button?.closest('[data-market-entry]')?.getAttribute('data-market-entry')
      if (!name || button.disabled || button.getBoundingClientRect().width === 0
        || !['View ' + name, '查看 ' + name].includes(button.getAttribute('aria-label'))) return null
      button.click(); return name
    }), value => typeof value === 'string' && value.length > 0, 'open real official plugin details')
    await until(expression(name => {
      const detail = document.querySelector('[data-plugin-tab="discover"] [data-market-detail]')
      return detail?.getAttribute('data-market-detail') === name && detail.getBoundingClientRect().width > 0
        && detail.querySelector('h3')?.textContent.trim() === name
        && [...detail.querySelectorAll('button[aria-label]')].some(button =>
          ['Install ' + name, '安装 ' + name].includes(button.getAttribute('aria-label'))
          && !button.disabled && button.getBoundingClientRect().width > 0)
    }, detailPackage), Boolean, 'official inline detail shows the selected package and its Install control')
    await writeFile(path.join(output, 'official-plugin-details.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
    await until(expression(name => {
      const detail = document.querySelector('[data-plugin-tab="discover"] [data-market-detail]')
      if (detail?.getAttribute('data-market-detail') !== name) return false
      // The observed official breadcrumb has no aria-label; its public text is Discover / 发现.
      const button = [...detail.querySelectorAll(':scope > button')].find(item =>
        ['Discover', '发现'].includes((item.getAttribute('aria-label') || item.textContent || '').trim()))
      if (!button || button.disabled || button.getBoundingClientRect().width === 0) return false
      button.click(); return true
    }, detailPackage), Boolean, 'return through the actual official Discover breadcrumb')
    await until(expression(() => !document.querySelector('[data-plugin-tab="discover"] [data-market-detail]')
      && document.querySelectorAll('[data-plugin-tab="discover"] [data-market-entry]').length > 0), Boolean, 'official Discover list returns after leaving inline details')
    if (process.argv.includes('--layout')) {
      // Keep the actual preview and appearance/localization checks on official Discover.
      await until(expression(() => {
        const image = document.querySelector('[data-plugin-tab="discover"] [data-portable-shot]')
        image?.scrollIntoView({ block: 'center' }); return Boolean(image?.complete && image.naturalWidth > 0)
      }), Boolean, 'real official catalog preview image')
      await pageValue(() => document.querySelector('[data-plugin-tab="discover"] [data-portable-shot]').click())
      await until(expression(() => Boolean(document.querySelector('[data-portable-viewer]'))), Boolean, 'official card preview opens the real viewer')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await until(expression(() => !document.querySelector('[data-portable-viewer]') && Boolean(document.querySelector('[data-plugin-tab="discover"]'))), Boolean, 'Escape closes only the image preview')
      await nativeState(131260)
      await until(click(['General', 'General settings', '通用设置']), Boolean, 'official appearance settings')
      await until(click(['Dark', '深色']), Boolean, 'official dark appearance')
      await until(closeDialog, Boolean, 'close appearance settings')
      await until(click(['Plugins', '插件']), Boolean, 'official Plugins in dark theme')
      await openMarket()
      await writeFile(path.join(output, 'official-discover-dark.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
      await nativeState(131260)
      await until(click(['General', 'General settings', '通用设置']), Boolean, 'official language settings')
      await until(click(['English']), Boolean, 'official language selector')
      await until(click(['简体中文', '中文', '中文（简体）', 'Chinese', 'Simplified Chinese']), Boolean, 'official Chinese locale')
      await until(closeDialog, Boolean, 'close Chinese settings')
      await until(click(['插件']), Boolean, 'official Chinese Plugins')
      await openMarket()
      await until(expression(() => Boolean(document.querySelector('[data-plugin-tab="discover"] [role="group"][aria-label="分类"]'))), Boolean, 'official categories follow Chinese locale')
      await writeFile(path.join(output, 'official-discover-zh-dark.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
      await nativeState(131260)
      await until(click(['通用设置']), Boolean, 'restore official language settings')
      await until(click(['简体中文', '中文', '中文（简体）']), Boolean, 'Chinese language selector')
      await until(click(['English']), Boolean, 'restore English for later independent checks')
      // Locale UI state precedes its asynchronous settings write; settle that write before the read-only baseline.
      const { runtimeRoot } = await ensureRuntimeCapsule(root, { env })
      const parseYaml = createRequire(path.join(runtimeRoot, 'app/package.json'))('yaml').parse
      const localeStarted = Date.now(), localeDeadline = localeStarted + 30000
      let preference, localePatch
      do {
        localePatch = await readFile(await verifiedPackageFile(root, 'data/dsh-home/profiles/web/cordis.patch.yml'))
        const patch = parseYaml(localePatch.toString('utf8'))
        preference = Array.isArray(patch) ? patch.find(entry => entry?.id === 'locale')?.config?.preference : undefined
        if (preference === 'en') break
        await delay(100)
      } while (Date.now() < localeDeadline)
      assert.equal(preference, 'en', 'English locale is persisted before the legacy read-only baseline')
      await writeFile(path.join(output, 'locale-persisted-before-legacy.json'), JSON.stringify({ preference, elapsedMs: Date.now() - localeStarted, patchSha256: createHash('sha256').update(localePatch).digest('hex') }, null, 2))
    }
    assert.deepEqual(exceptions, [])
    await writeFile(path.join(output, 'checks.json'), JSON.stringify(checks, null, 2))
    // Exercise browsing before an import, which explicitly requires restart.
    if (await pageValue(() => [...document.querySelectorAll('[role="dialog"]')].some(item => item.getBoundingClientRect().width > 0))) {
      await until(closeDialog, Boolean, 'close Settings before legacy recovery')
      await until(expression(() => ![...document.querySelectorAll('[role="dialog"]')].some(item => item.getBoundingClientRect().width > 0)), Boolean, 'Settings closes before recovery')
    }
    // Legacy JSON import is compatibility only. Daily backups remain on the existing Data settings page.
    // This disposable Native flow uses the retained, authenticated export API only to create its fixture.
    const markerRelative = 'workspace/maintenance-cancel-' + Date.now() + '.txt'
    await writeFile(await safeDataTarget(root, markerRelative), 'owned legacy recovery cancellation sentinel\n', { flag: 'wx' })
    const protectedNames = ['data/dsh-home/profiles/web/package.json', 'data/dsh-home/profiles/web/cordis.patch.yml',
      'data/dsh-home/profiles/web/pnpm-lock.yaml', 'data/dsh-home/settings.yaml', markerRelative]
    const snapshot = async () => {
      const result = {}
      for (const name of protectedNames) {
        try { result[name] = createHash('sha256').update(await readFile(await verifiedPackageFile(root, name))).digest('hex') }
        catch (error) { if (error.code !== 'ENOENT') throw error; result[name] = null }
      }
      return result
    }
    const beforeMaintenance = await snapshot()
    const requestStart = networkRequests.length
    const maintenanceSelector = '[role="dialog"]'
    const legacyTitles = ['Legacy plugin configuration recovery', '旧版插件配置恢复', 'Legacy plugin recovery', '旧插件配置恢复']
    const maintenanceReady = titles => [...document.querySelectorAll('[role="dialog"]')].some(dialog => {
      const label = dialog.getAttribute('aria-label') || document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent
      return titles.includes((label || '').trim())
    })
    const openLegacyRecovery = async () => {
      await until(expression(() => {
        const button = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(item =>
          ['More', '更多'].includes(item.getAttribute('aria-label')) && !item.closest('[role="dialog"]') && item.getBoundingClientRect().width > 0)
        button?.click(); return Boolean(button)
      }), Boolean, 'official sidebar More menu')
      await until(click(legacyTitles, '[role="menu"]'), Boolean, 'legacy plugin configuration recovery action')
      await until(expression(maintenanceReady, legacyTitles), Boolean, 'legacy recovery overlay survives menu dismissal')
      assert.equal(await pageValue(() => Boolean(document.querySelector('[role="menu"]'))), false, 'More menu closes before legacy recovery is used')
      assert.equal(await pageValue(() => [...document.querySelectorAll('[role="dialog"] button')].some(item =>
        ['Export backup', '导出备份', 'Diagnostic details', '诊断详情'].includes(item.textContent.trim()))), false,
        'legacy recovery must not expose a second backup exporter or plugin diagnostic surface')
    }
    const waitNetwork = async (predicate, label) => {
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) { if (predicate(networkRequests.slice(requestStart))) return; await delay(100) }
      throw new Error(label)
    }
    await openLegacyRecovery()
    await writeFile(path.join(output, 'legacy-recovery.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64'))
    const backupInput = await safeDataTarget(output, 'legacy-configuration-input.json')
    try {
      const response = await pageValue(async () => {
        const response = await fetch('/dsh-market/backup', { cache: 'no-store' })
        return { status: response.status, originMatched: new URL(response.url).origin === location.origin, text: await response.text() }
      })
      const backupBytes = Buffer.from(response.text, 'utf8')
      assert.ok(backupBytes.length > 0 && backupBytes.length <= 2 * 1024 * 1024, 'legacy API fixture must remain within its format limit')
      const backup = JSON.parse(response.text)
      const manifest = JSON.parse(await readFile(await verifiedPackageFile(root, 'data/dsh-home/profiles/web/package.json'), 'utf8'))
      const packageFile = Array.isArray(backup?.files) ? backup.files.find(item => item?.path === 'package.json') : undefined
      legacyExportApiCompatibility = { originMatched: response.originMatched, path: '/dsh-market/backup', httpStatus: response.status,
        bytes: backupBytes.length, sha256: createHash('sha256').update(backupBytes).digest('hex'), format: backup?.format, version: backup?.version,
        packageJson: packageFile?.json !== null && typeof packageFile?.json === 'object' && !Array.isArray(packageFile.json),
        manifestMatches: isDeepStrictEqual(packageFile?.json, manifest) }
      await waitNetwork(requests => requests.some(item => item.path === '/dsh-market/backup' && item.status === 200), 'retained legacy backup API GET did not finish')
      assertMaintenanceReadOnly(networkRequests.slice(requestStart), legacyExportApiCompatibility)
      assert.deepEqual(await snapshot(), beforeMaintenance, 'opening legacy recovery and reading its fixture must preserve the original protected bytes')
      // Protect every configuration file represented by the legacy fixture, in addition to the original guards.
      for (const file of backup.files) {
        const name = 'data/dsh-home/profiles/web/' + file.path
        if (!protectedNames.includes(name)) protectedNames.push(name)
      }
      Object.assign(beforeMaintenance, await snapshot())
      await writeFile(backupInput, backupBytes, { flag: 'wx' })
      const confirmationSelector = '[role="group"][aria-label="Confirm legacy configuration import"],[role="group"][aria-label="确认导入旧配置"]'
      const selectLegacyFixture = async () => {
        const input = await send('Runtime.evaluate', { expression: expression(() => {
          return [...document.querySelectorAll('[role="dialog"] input[type="file"]')]
            .find(item => ['Choose legacy configuration…', '选择旧配置文件…'].includes(item.getAttribute('aria-label')))
        }), returnByValue: false })
        assert.ok(input.result?.objectId, 'the labelled legacy file input must belong to the current recovery dialog')
        await send('DOM.setFileInputFiles', { objectId: input.result.objectId, files: [backupInput] })
        await until(expression(selector => Boolean(document.querySelector(selector)), confirmationSelector), Boolean, 'legacy import requires explicit confirmation')
      }
      await selectLegacyFixture()
      assert.equal(networkRequests.slice(requestStart).filter(item => item.path === '/dsh-market/restore' && item.method === 'POST').length, 0, 'choosing a legacy file must not import it')
      await until(click(['Cancel', '取消'], confirmationSelector), Boolean, 'cancel legacy import through its confirmation controls')
      await until(expression(selector => !document.querySelector(selector), confirmationSelector), Boolean, 'cancellation closes the confirmation')
      assert.equal(await pageValue(() => document.querySelector('[role="dialog"] input[type="file"]')?.files?.length), 0, 'cancel clears the selected legacy file')
      assert.deepEqual(await snapshot(), beforeMaintenance, 'choosing and cancelling legacy import preserves profile, settings and workspace bytes')
      await until(click(['Close', '关闭'], maintenanceSelector), Boolean, 'close legacy recovery and return to official Plugins')
      await until(expression(() => Boolean(document.querySelector('[data-plugin-panel]')) && !document.querySelector('[role="dialog"]')), Boolean, 'official management survives recovery close')
      await delay(250)
      assert.deepEqual(await snapshot(), beforeMaintenance, 'closing legacy recovery must not write profile or settings state')
      const audit = assertMaintenanceReadOnly(networkRequests.slice(requestStart), legacyExportApiCompatibility)
      await writeFile(path.join(output, 'maintenance-navigation.json'), JSON.stringify({ passed: true, ...audit, profileBytesUnchanged: true,
        legacyExportApiCompatibility, actualRestoreNotRun: true, noAdvanced: true, scope: 'legacy JSON API fixture and real Native select/cancel only' }, null, 2))
      if (verifyLegacyRestore) {
        await openLegacyRecovery()
        await selectLegacyFixture()
        assertMaintenanceReadOnly(networkRequests.slice(requestStart), legacyExportApiCompatibility)
        const beforeConfirm = networkRequests.length
        await until(click(['Confirm import', '确认导入'], confirmationSelector), Boolean, 'confirm actual legacy import in disposable Native')
        await waitNetwork(() => networkRequests.slice(beforeConfirm).some(item => item.path === '/dsh-market/restore' && item.method === 'POST' && item.finished), 'actual legacy restore response did not finish')
        const restoreRequests = networkRequests.slice(beforeConfirm).filter(item => item.path === '/dsh-market/restore' && item.method === 'POST')
        assert.equal(restoreRequests.length, 1, 'explicit confirmation issues exactly one restore POST')
        const request = restoreRequests[0]
        assert.equal(request.status, 200)
        const requestId = [...requestById].find(([, item]) => item === request)?.[0]
        assert.ok(requestId, 'the actual restore response must have an owned CDP request')
        const responseBody = await send('Network.getResponseBody', { requestId })
        const result = JSON.parse(responseBody.base64Encoded ? Buffer.from(responseBody.body, 'base64').toString('utf8') : responseBody.body)
        assert.equal(result.ok, true)
        assert.ok(Number.isSafeInteger(result.files) && result.files > 0)
        assert.deepEqual(result.errors ?? [], [])
        assert.deepEqual(result.unportable ?? [], [], 'disposable restore fixture must not depend on machine-local plugin sources')
        const restoredFileHashes = {}
        for (const file of backup.files) {
          const actual = await readFile(await verifiedPackageFile(root, 'data/dsh-home/profiles/web/' + file.path), 'utf8')
          restoredFileHashes[file.path] = createHash('sha256').update(actual).digest('hex')
          if (file.path === 'package.json') assert.ok(isDeepStrictEqual(JSON.parse(actual), file.json), 'confirmed import restores the backed-up profile manifest')
          else assert.ok(actual === file.lines.join('\n'), 'confirmed import restores the actual legacy configuration bytes')
        }
        const afterRestore = await snapshot()
        for (const name of ['data/dsh-home/settings.yaml', markerRelative]) assert.equal(afterRestore[name], beforeMaintenance[name], 'legacy import preserves unrelated settings and workspace')
        assert.deepEqual(networkRequests.slice(beforeConfirm).filter(item => !['GET', 'HEAD', 'OPTIONS'].includes(item.method) && item !== request), [], 'confirmed legacy import must not trigger other mutation requests')
        confirmedLegacyRestore = { passed: true, status: request.status, files: result.files, errors: 0,
          profileMatchesBackup: true, workspaceAndSettingsUnchanged: true, restartRequired: true, restoredFileHashes, restorePosts: 1, scope: 'disposable real Native confirmed legacy import' }
        await writeFile(path.join(output, 'confirmed-legacy-restore.json'), JSON.stringify(confirmedLegacyRestore, null, 2))
        await until(expression(selector => !document.querySelector(selector), confirmationSelector), Boolean, 'successful legacy import closes confirmation')
        await until(expression(selector => /Restart|重启/.test(document.querySelector(selector)?.textContent || ''), maintenanceSelector), Boolean, 'legacy recovery reports its restart requirement')
        await until(click(['Close', '关闭'], maintenanceSelector), Boolean, 'close after actual legacy import')
        await until(expression(() => Boolean(document.querySelector('[data-plugin-panel]')) && !document.querySelector('[role="dialog"]')), Boolean, 'official Plugins remains available after actual legacy import')
      }
    } finally {
      await rm(backupInput, { force: true })
    }

  }
  assert.deepEqual(exceptions, [])
  passed=true;
} finally {
  try {
    const requests = networkRequests.filter(item => item.path === '/dsh-market/backup')
    await writeFile(path.join(output, 'legacy-api-transport.json'), JSON.stringify({ legacyExportApiCompatibility, confirmedLegacyRestore,
      requests: requests.slice(0, 32), requestsTruncated: requests.length > 32 }, null, 2))
    if (evaluate) {
      await writeFile(path.join(output, 'dialog-events.json'), JSON.stringify(await evaluate('window.__portableAcceptanceDialogs').catch(String) ?? [], null, 2))
      await writeFile(path.join(output, 'page.txt'), await evaluate('document.body.innerText').catch(String))
      await writeFile(path.join(output, 'page.html'), await evaluate('document.documentElement.outerHTML').catch(String))
    }
  } finally {
    socket?.close()
    try {
      await exec(path.join(root, 'DeepSeek-Herness.exe'), ['stop'], { cwd: root, env, windowsHide: true, timeout: 60000 })
      const exitDeadline = Date.now() + 5000
      while (child.exitCode === null && child.signalCode === null && Date.now() < exitDeadline) await delay(50)
      assert.equal(child.exitCode, 0, 'the actual Native host exits normally after its public stop command')
    } catch (error) {
      passed = false
      throw error
    } finally {
      if (child.exitCode === null) child.kill()
      try {
        if (passed && verifyWebView) {
          const { verifyRetiredWebViewCleanup } = await import('./lib/native-maintenance-checks.mjs')
          await verifyRetiredWebViewCleanup({ root, output })
        }
        if (soak) {
          await delay(3000)
          await sample('after-exit')
          assert.equal(samples.at(-1).processes.length, 0, 'isolated Portable processes remain after exit')
        }
      } catch (error) { passed = false; throw error }
      finally { await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed, exceptions, sourceOverlay, maintenanceOnly, publicMarket, verifyLegacyRestore, confirmedLegacyRestore, verifiedLiveTotal: verifyTotal && !maintenanceOnly && passed }, null, 2)) }
    }
  }
}
console.log(JSON.stringify({ passed, output }))
}
