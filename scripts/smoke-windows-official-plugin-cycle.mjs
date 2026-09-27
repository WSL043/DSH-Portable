import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { cp, mkdir, readFile, writeFile, utimes, access } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { verifiedPackageFile } from './verified-package-file.mjs'
import { createHash, randomBytes } from 'node:crypto'

const [rootArg, driverPackage, evidenceArg, disposable, mode, concurrency] = process.argv.slice(2)
if (!rootArg || !driverPackage || !evidenceArg || disposable !== '--disposable') {
  throw new Error('Expected a disposable extracted product, Playwright driver package and evidence directory.')
}
const root = path.resolve(rootArg)
const evidence = path.resolve(evidenceArg)
await mkdir(evidence, { recursive: true })
const components = JSON.parse(await readFile(await verifiedPackageFile(root, 'licenses', 'COMPONENTS.json'), 'utf8'))
const reviewedPlugins = ['dsh-image-viewer', 'dsh-chat-manager'].map(name => {
  const plugin = components.defaultPlugins?.find(item => item.package === name)
  assert.match(plugin?.version ?? '', /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `reviewed ${name} version`)
  return plugin
})
const { chromium } = createRequire(path.resolve(driverPackage))('playwright')
const env = {
  ...process.env,
  DSH_PORTABLE_STATE_ROOT: root,
  DSH_HOME: path.join(root, 'data', 'dsh-home'),
  DSH_PORTABLE_RUNTIME_CACHE: path.join(root, 'acceptance-runtime-cache'),
  DSH_PORTABLE_ENVIRONMENT: 'default',
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
  DSH_TELEMETRY_MODE: 'DISABLED',
}
assert.ok(mode === undefined || mode === '--upgrade-defaults', 'unknown acceptance mode')
assert.ok(concurrency === undefined || concurrency === '--concurrent-writers' && mode === '--upgrade-defaults', 'concurrent acceptance requires historical upgrade mode')
const historicalVersions = { 'dsh-chat-manager': '1.4.0-beta.3', 'dsh-image-viewer': '0.1.1' }
if (mode === '--upgrade-defaults') {
  assert.equal(await access(path.join(root, 'data/dsh-home/profiles/web/.dsh-portable-default-seed.json'))
    .then(() => true, error => { if (error.code === 'ENOENT') return false; throw error }), false,
  'Historical upgrade acceptance requires a freshly extracted disposable profile; startup refreshes existing defaults.')
  // Seed through the shipped CLI, not by replacing installed package manifests.
  // The fixture is disposable; production peer/supply-chain checks stay enabled.
  const result = await promisify(execFile)(path.join(root, 'runtime/node/node.exe'), [
    path.join(root, 'launcher/runtime-entry.mjs'), 'dsh-cli.mjs',
    'plugin', '--profile', 'web', 'add',
    ...Object.entries(historicalVersions).map(([name, version]) => `${name}@${version}`),
  ], { cwd: root, env, windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  await writeFile(path.join(evidence, 'historical-seed.log'), `${result.stdout}\n${result.stderr}`)
}
const listener = createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const debugPort = listener.address().port
await new Promise(resolve => listener.close(resolve))
const host = spawn(path.join(root, 'DeepSeek-Herness.exe'), [], {
  cwd: root,
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...env,
    DSH_PORTABLE_TEST_HIDDEN: '1',
    DSH_PORTABLE_TEST_AUTOMATION: '1',
    DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
})
const report = { ok: false, portableVersion: components.portableVersion, dshVersion: components.dshVersion, pageErrors: [] }
async function verifyInstalledDefaults(expected = Object.fromEntries(reviewedPlugins.map(plugin => [plugin.package, plugin.version]))) {
  const versions = {}
  for (const plugin of components.defaultPlugins ?? []) {
    const manifest = JSON.parse(await readFile(path.join(root, 'data', 'dsh-home', 'profiles', 'web', 'node_modules', plugin.package, 'package.json'), 'utf8'))
    assert.equal(manifest.name, plugin.package, 'installed default plugin identity')
    assert.equal(manifest.version, expected[plugin.package], `installed ${plugin.package} must match the expected version`)
    versions[plugin.package] = manifest.version
  }
  return versions
}
let browser
let page
let secondBrowser
try {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline && !browser) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 2_000 }) }
    catch { await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  assert.ok(browser, 'native WebView2 debugging endpoint did not appear')
  const pageDeadline = Date.now() + 30_000
  while (Date.now() < pageDeadline && !page) {
    page = browser.contexts().flatMap(context => context.pages())[0]
    if (!page) await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(page, `native WebView2 page did not appear (host exit: ${host.exitCode ?? 'running'}, contexts: ${browser.contexts().length})`)
  page.setDefaultTimeout(30_000)
  page.on('pageerror', error => report.pageErrors.push(error.message))
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 90_000 })
  await page.waitForFunction(() => !document.querySelector('[data-dsh-boot]'))
  const routeStatus = await page.evaluate(async () => (await fetch('/dsh-portable/settings')).status)
  assert.equal(routeStatus, 200, 'Portable bridge route is unavailable')
  report.initialDefaultVersions = await verifyInstalledDefaults(mode === '--upgrade-defaults' ? historicalVersions : undefined)

  // The first-run notice and model prompt are official DSH UI. No model key is
  // needed for this disposable package-manager acceptance.
  for (let attempt = 0; attempt < 20; attempt++) {
    const continueButton = page.locator('button').filter({ hasText: /^(Continue|继续)$/i }).first()
    const configureLater = page.locator('button').filter({ hasText: /^(Configure later|稍后配置)$/i }).first()
    if (await continueButton.isVisible() && await continueButton.isEnabled()) {
      await continueButton.click()
      continue
    }
    if (await configureLater.isVisible()) {
      await configureLater.click()
      continue
    }
    await page.waitForTimeout(500)
  }

  await page.getByRole('button', { name: /^(Plugins|插件)$/ }).first().click()
  if (mode === '--upgrade-defaults') {
    report.upgrades = []
    let secondPage
    if (concurrency) {
      // A separate headless client exercises the same authenticated service.
      // Creating a second WebView target could open a foreground native window.
      secondBrowser = await chromium.launch({ headless: true })
      const context = await secondBrowser.newContext({ storageState: await page.context().storageState() })
      secondPage = await context.newPage()
      await secondPage.goto(page.url(), { waitUntil: 'domcontentloaded' })
      assert.equal(await secondPage.evaluate(async () => (await fetch('/dsh-market/installed')).status), 200)
    }
    let navigations = 0
    const observeNavigation = frame => { if (frame === page.mainFrame()) navigations++ }
    page.on('framenavigated', observeNavigation)
    for (const plugin of reviewedPlugins) {
      const card = page.locator(`[data-plugin-package="${plugin.package}"]`)
      const enabledBefore = await card.getByRole('switch').getAttribute('aria-checked')
      const update = card.getByRole('button', { name: /^(更新|Update)$/ })
      await update.waitFor({ timeout: 60_000 })
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/dsh-market/update'
        && response.request().method() === 'POST', { timeout: 180_000 })
      await update.click()
      if (secondPage && report.upgrades.length === 0) {
        const profile = path.join(root, 'data/dsh-home/profiles/web')
        const lock = path.join(profile, 'package.json.lock')
        const deadline = Date.now() + 10_000
        while (!await access(lock).then(() => true, () => false)) {
          assert.ok(Date.now() < deadline, 'actual profile writer lock did not appear')
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        const secondRequest = secondPage.evaluate(async name => {
          const response = await fetch('/dsh-market/update', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
          return { status: response.status, body: await response.json() }
        }, plugin.package)
        const cliRequest = promisify(execFile)(path.join(root, 'runtime/node/node.exe'), [
          path.join(root, 'launcher/runtime-entry.mjs'), 'dsh-cli.mjs', 'plugin', '--profile', 'web', 'install',
        ], { cwd: root, env, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })
          .then(value => ({ code: 0, ...value }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }))
        const [second, cli] = await Promise.all([secondRequest, cliRequest])
        assert.equal(second.status, 409, JSON.stringify(second))
        assert.match(second.body.error, /operation|install.*running/i)
        assert.equal(cli.code, 1, JSON.stringify(cli))
        assert.match(cli.stderr, /lock|busy|already.*running/i)
        report.concurrentWriters = { secondPageStatus: second.status, cliExitCode: cli.code, actualWriterLockObserved: true }
      }
      const response = await pending
      const body = await response.json()
      assert.equal(response.status(), 200, JSON.stringify(body))
      assert.equal(body.ok, true, JSON.stringify(body))
      const installed = JSON.parse(await readFile(path.join(root, 'data/dsh-home/profiles/web/node_modules', plugin.package, 'package.json'), 'utf8'))
      assert.equal(installed.version, plugin.version, 'update must reach the exact reviewed product version')
      assert.equal(await card.isVisible(), true, 'download/install must preserve the plugin page')
      assert.equal(await card.getByRole('switch').getAttribute('aria-checked'), enabledBefore, 'update must preserve enablement')
      assert.equal(navigations, 0, 'update must not navigate before restart')
      report.upgrades.push({ package: plugin.package, from: historicalVersions[plugin.package], to: installed.version, enabledBefore })
      await page.screenshot({ path: path.join(evidence, `${plugin.package}-after-update.png`) })
    }
    page.off('framenavigated', observeNavigation)
    report.updatedDefaultVersions = await verifyInstalledDefaults()
    if (concurrency) {
      const profile = path.join(root, 'data/dsh-home/profiles/web')
      const files = ['package.json', 'pnpm-lock.yaml', 'node_modules/.modules.yaml']
      const snapshot = () => Promise.all(files.map(async file => createHash('sha256').update(await readFile(path.join(profile, file))).digest('hex')))
      const hashes = await snapshot()
      await new Promise(resolve => setTimeout(resolve, 500))
      assert.deepEqual(await snapshot(), hashes, 'rejected writers changed the completed profile')
      report.concurrentWriters.profileSettled = true
      await secondBrowser.close()
      secondBrowser = undefined
    }
  }
  report.pluginCycles = {}
  for (const plugin of reviewedPlugins) {
    const cycle = report.pluginCycles[plugin.package] = {}
    const selector = `[data-plugin-package="${plugin.package}"]`
    const card = page.locator(selector)
    await card.waitFor()
    await card.getByRole('button').first().click()
    await page.getByRole('button', { name: /^(卸载 |Uninstall )/ }).click()
    let dialog = page.getByRole('dialog').last()
    await dialog.getByRole('button', { name: /^(取消|Cancel)$/ }).click()
    cycle.versionsAfterCancel = await verifyInstalledDefaults()
    cycle.cancelUninstall = true
    await page.getByRole('button', { name: /^(卸载 |Uninstall )/ }).click()
    dialog = page.getByRole('dialog').last()
    await dialog.getByRole('button', { name: /^(卸载|Uninstall)$/ }).click()
    await page.getByRole('button', { name: /^(添加插件|Add plugin)$/ }).waitFor({ timeout: 90_000 })
    await page.waitForFunction(selector => !document.querySelector(selector), selector, { timeout: 90_000 })
    cycle.uninstalled = true
    await page.screenshot({ path: path.join(evidence, `${plugin.package}-after-uninstall.png`) })

    await page.getByRole('button', { name: /^(添加插件|Add plugin)$/ }).click()
    dialog = page.getByRole('dialog').last()
    await dialog.getByRole('textbox').first().fill(`${plugin.package}@${plugin.version}`)
    await dialog.getByRole('button', { name: /^(安装|Install)$/ }).click()
    const enableNow = page.getByRole('button', { name: /^(立即启用|Enable now)$/ })
    const installResult = await Promise.race([
      enableNow.waitFor({ timeout: 120_000 }).then(() => 'ready'),
      page.getByText(/(?:could not be installed|无法安装)/i).waitFor({ timeout: 120_000 }).then(() => 'failed'),
    ])
    assert.equal(installResult, 'ready', `Official plugin installation failed: ${await page.getByRole('dialog').last().innerText()}`)
    await enableNow.click()
    await page.getByRole('button', { name: /^(返回插件列表|Back to plugins)$/ }).click()
    await card.waitFor()
    await page.waitForFunction(selector => document.querySelector(`${selector} [role="switch"]`)?.getAttribute('aria-checked') === 'true', selector)
    assert.equal(await card.getByRole('switch').getAttribute('aria-checked'), 'true')
    cycle.reinstalledAndEnabled = true
    cycle.reinstalledDefaultVersions = await verifyInstalledDefaults()
    await page.screenshot({ path: path.join(evidence, `${plugin.package}-after-install.png`) })

  }
  const card = page.locator('[data-plugin-package="dsh-image-viewer"]')

  // The official switch may hot-unload immediately. Supply a loader mismatch
  // only for this view-layer check, then verify the Portable recovery action
  // is actually clickable and confirms a new native boot.
  await page.route('**/dsh-market/installed', async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.bundles = body.bundles.filter(name => name !== 'dsh-image-viewer')
    body.activation['dsh-image-viewer'] = { state: 'live' }
    await route.fulfill({ response, json: body })
  })
  await page.evaluate(() => window.dispatchEvent(new Event('dsh-portable/refresh-plugins')))
  const restartToVerify = card.getByRole('button', { name: /^(重启后确认|Restart to verify)$/ })
  await restartToVerify.waitFor({ state: 'visible', timeout: 15_000 })
  // Playwright's visible state includes elements below the viewport. Bring
  // the action into view before hit-testing so a tall plugin list does not
  // turn an offscreen button into a false overlay failure.
  await restartToVerify.scrollIntoViewIfNeeded()
  const clickTargetIsButton = await restartToVerify.evaluate(button => {
    const bounds = button.getBoundingClientRect()
    return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === button
  })
  assert.equal(clickTargetIsButton, true, 'plugin card title intercepts the Portable restart action')
  const previousBoot = await page.evaluate(async () => (await (await fetch('/dsh-market/status')).json()).boot)
  await restartToVerify.click()
  await page.waitForFunction(async boot => {
    try {
      const response = await fetch('/dsh-market/status', { cache: 'no-store' })
      return response.ok && (await response.json()).boot !== boot
    } catch { return false }
  }, previousBoot, { timeout: 90_000 })
  report.pluginMismatchRestart = true

  // Exercise maintenance through the actual long-lived host, not a helper call.
  // The native restart above gives the deferred maintenance a fresh 60s window.
  const managedLogs = path.join(root, 'data/dsh-home/profiles/web/.plugin-manager/logs')
  const oldLog = path.join(managedLogs, `operation-${randomBytes(3).toString('hex')}`, 'pnpm.log')
  const recentLog = path.join(managedLogs, `operation-${randomBytes(3).toString('hex')}`, 'pnpm.log')
  for (const file of [oldLog, recentLog]) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'Disposable maintenance acceptance\n', { flag: 'wx' })
  }
  const expired = new Date(Date.now() - 30 * 86400000)
  await utimes(oldLog, expired, expired)
  const maintenanceDeadline = Date.now() + 80000
  let removed = false
  while (Date.now() < maintenanceDeadline) {
    try { await access(oldLog) }
    catch (error) { if (error.code !== 'ENOENT') throw error; removed = true; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(removed, 'real host did not run deferred plugin log maintenance')
  await access(recentLog)
  report.deferredLogMaintenance = true

  if (page.isClosed() || !browser.isConnected()) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 30000 })
    page = browser.contexts().flatMap(context => context.pages())[0]
    assert.ok(page, 'restarted native host has no workspace page')
    page.on('pageerror', error => report.pageErrors.push(error.message))
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('[data-dsh-boot]'))
  }

  const configureAfterRestart = page.getByRole('button', { name: /^(Configure later|稍后配置)$/i })
  if (await configureAfterRestart.isVisible()) await configureAfterRestart.click()
  await page.getByRole('button', { name: /^(新会话|新建会话|New session)$/ }).first().click()
  const composer = page.locator('[contenteditable="true"][role="textbox"]').first()
  await composer.fill('Disposable official plugin lifecycle check')
  assert.equal(await composer.isEditable(), true)
  await page.screenshot({ path: path.join(evidence, 'after-restart-composer.png') })
  assert.deepEqual(report.pageErrors, [])
  report.composer = true
  report.ok = true
} catch (error) {
  report.failure = String(error)
  await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await secondBrowser?.close().catch(() => {})
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2))
  await cp(path.join(root, 'data', 'dsh-home', 'profiles', 'web', '.plugin-manager', 'logs'),
    path.join(evidence, 'plugin-manager-logs'), { recursive: true }).catch(() => {})
  await browser?.close().catch(() => {})
  const node = path.join(root, 'runtime', 'node', 'node.exe')
  const launcher = path.join(root, 'launcher', 'runtime-entry.mjs')
  await promisify(execFile)(node, [launcher, 'portable-cli.mjs', 'stop', '--json'], {
    cwd: root, env, windowsHide: true, timeout: 120_000,
  }).catch(() => {})
  if (host.exitCode === null) host.kill()
  // Restart replaces the original child. Restrict cleanup to this disposable
  // executable, never to all Portable processes on the machine.
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'try { Get-Process -Name DeepSeek-Herness -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:DSH_ACCEPTANCE_HOST_EXE } | Stop-Process -ErrorAction Stop; exit 0 } catch { Write-Error $_; exit 1 }'], {
    windowsHide: true, timeout: 30000,
    env: { ...process.env, DSH_ACCEPTANCE_HOST_EXE: path.join(root, 'DeepSeek-Herness.exe') },
  })
}
