import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { cp, readFile, writeFile, utimes, access, realpath, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { verifiedPackageFile } from './verified-package-file.mjs'
import { safeDataTarget } from '../launcher/data-paths.mjs'
import { dismissOfficialOnboardingExpression } from './lib/official-onboarding.mjs'
import { createHash, randomBytes } from 'node:crypto'

const [rootArg, driverPackage, evidenceArg, disposable, mode, concurrency, historicalSeedArg] = process.argv.slice(2)
if (!rootArg || !driverPackage || !evidenceArg || disposable !== '--disposable') {
  throw new Error('Expected a disposable extracted product, Playwright driver package and evidence directory.')
}

async function disposablePackage(argument) {
  const lexicalDirectory = path.resolve(argument)
  const temporaryRoots = [...new Set([process.env.RUNNER_TEMP, os.tmpdir()].filter(Boolean))]
  let directory
  for (const temporaryRoot of temporaryRoots) {
    const relative = path.relative(path.resolve(temporaryRoot), lexicalDirectory)
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue
    directory = await realpath(lexicalDirectory)
    break
  }
  if (!directory) throw new Error('Disposable product must be below an actual temporary directory')
  let insideTemporaryRoot = false
  for (const temporaryRoot of temporaryRoots) {
    let base
    try { base = await realpath(temporaryRoot) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    const relative = path.relative(base, directory)
    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) insideTemporaryRoot = true
  }
  assert.ok(insideTemporaryRoot, 'Disposable product must be below an actual temporary directory')
  const components = JSON.parse(await readFile(await verifiedPackageFile(directory, 'licenses', 'COMPONENTS.json'), 'utf8'))
  assert.equal(components.product, 'DSH-Portable', 'expected a real Portable component manifest')
  assert.equal(components.platform, 'windows-x64', 'only the Windows disposable package is supported')
  assert.match(components.portableVersion ?? '', /^0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'only the owned 0.x Portable host is supported')
  // A copied user installation is not a disposable fixture, even below TEMP.
  for (const name of ['data', 'workspace']) {
    const entries = await readdir(await verifiedPackageFile(directory, name))
    assert.ok(entries.every(entry => entry === 'README.txt'), 'Disposable product must have fresh data and workspace directories')
  }
  return {
    root: directory, components,
    node: await verifiedPackageFile(directory, 'runtime', 'node', 'node.exe'),
    entry: await verifiedPackageFile(directory, 'launcher', 'runtime-entry.mjs'),
    host: await verifiedPackageFile(directory, 'DeepSeek-Herness.exe'),
  }
}

const product = await disposablePackage(rootArg)
const { root, components, node: nodeExecutable, entry: runtimeEntry, host: hostExecutable } = product
const evidenceRelative = 'acceptance/official-plugin-cycle'
// Compare the caller's lexical layout (TEMP may be /var -> /private/var); all writes use canonical root below.
assert.equal(path.resolve(evidenceArg), path.resolve(rootArg, evidenceRelative), 'Evidence directory must be the disposable product acceptance/official-plugin-cycle directory')
const resultFile = await safeDataTarget(root, `${evidenceRelative}/result.json`)
const evidence = path.dirname(resultFile)
assert.deepEqual(await readdir(evidence), [], 'Evidence directory must be new or empty')
const evidenceFile = name => safeDataTarget(root, `${evidenceRelative}/${name}`)
// Products without community defaults still run real native official-UI qualification.
if (Array.isArray(components.defaultPlugins) && components.defaultPlugins.length === 0) {
  const { verifyNativeDefaultPlugins } = await import('./verify-default-plugin-ui.mjs')
  const coreUi = await verifyNativeDefaultPlugins(root, driverPackage)
  const result = { ok: true, scope: 'official-core-ui-no-defaults', requestedMode: mode ?? 'fresh', coreUi }
  await writeFile(resultFile, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  process.exit(0)
}
const reviewedNames = ['dsh-image-viewer', 'dsh-chat-manager']
assert.deepEqual(components.defaultPlugins?.map(plugin => plugin.package).sort(), [...reviewedNames].sort(),
  'the disposable component manifest must contain exactly the two reviewed default plugins')
const reviewedPlugins = reviewedNames.map(name => {
  const plugin = components.defaultPlugins.find(item => item.package === name)
  assert.match(plugin.version ?? '', /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `reviewed ${name} version`)
  return { package: name, version: plugin.version }
})
assert.ok(mode === undefined || mode === '--upgrade-defaults', 'unknown acceptance mode')
assert.ok(concurrency === undefined || concurrency === '--concurrent-writers' && mode === '--upgrade-defaults', 'concurrent acceptance requires historical upgrade mode')
let seed
if (mode === '--upgrade-defaults') {
  assert.ok(historicalSeedArg, 'Historical upgrade requires the isolated 0.7.7 seed runtime')
  seed = await disposablePackage(historicalSeedArg)
  assert.notEqual(seed.root, root, 'Historical seed runtime must be separate from the candidate')
  assert.equal(seed.components.portableVersion, '0.7.7')
  assert.equal(seed.components.dshVersion, '0.1.7-alpha.1')
}
const { chromium } = createRequire(path.resolve(driverPackage))('playwright')
const env = {
  ...process.env,
  DSH_PORTABLE_ROOT: root,
  DSH_PORTABLE_BASE_STATE_ROOT: root,
  DSH_PORTABLE_STATE_ROOT: root,
  DSH_HOME: path.join(root, 'data', 'dsh-home'),
  DSH_PORTABLE_RUNTIME_CACHE: path.join(root, 'acceptance-runtime-cache'),
  DSH_PORTABLE_WEBVIEW_CACHE: path.join(root, 'acceptance-webview-cache'),
  DSH_PORTABLE_ENVIRONMENT: 'default',
  DSH_PORTABLE_SKIP_UPDATE_CHECK: '1',
  DSH_TELEMETRY_MODE: 'DISABLED',
}
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === 'DSH_PORTABLE_RUNTIME_ROOT') delete env[key]
}
const historicalVersions = { 'dsh-chat-manager': '1.4.0-beta.3', 'dsh-image-viewer': '0.1.1' }
// Establish maintenance inputs before any CLI helper or native host can start
// the long-lived host's one-minute maintenance timer.
const managedLogsRelative = 'data/dsh-home/profiles/web/.plugin-manager/logs'
const oldLogRelative = `${managedLogsRelative}/operation-${randomBytes(3).toString('hex')}/pnpm.log`
const recentLogRelative = `${managedLogsRelative}/operation-${randomBytes(3).toString('hex')}/pnpm.log`
for (const relative of [oldLogRelative, recentLogRelative]) {
  const file = await safeDataTarget(root, relative)
  await writeFile(file, 'Disposable maintenance acceptance\n', { flag: 'wx' })
}
const expired = new Date(Date.now() - 30 * 86400000)
await utimes(await verifiedPackageFile(root, oldLogRelative), expired, expired)
if (mode === '--upgrade-defaults') {
  const seedRoot = seed.root
  const seedEnv = { ...env, DSH_PORTABLE_RUNTIME_CACHE: path.join(seedRoot, 'acceptance-runtime-cache') }
  for (const key of Object.keys(seedEnv)) {
    if (['DSH_PORTABLE_ROOT', 'DSH_PORTABLE_RUNTIME_ROOT', 'DSH_PORTABLE_BASE_STATE_ROOT'].includes(key.toUpperCase())) delete seedEnv[key]
  }
  assert.equal(await safeDataTarget(root, 'data/dsh-home/profiles/web/.dsh-portable-default-seed.json', { createParents: false }) !== null, false,
  'Historical upgrade acceptance requires a freshly extracted disposable profile; startup refreshes existing defaults.')
  // Establish a real old profile with its compatible released core before upgrading.
  // rc.2 correctly refuses a fresh install of these old peers; do not bypass it.
  const result = await promisify(execFile)(seed.node, [
    seed.entry, 'dsh-cli.mjs',
    'plugin', '--profile', 'web', 'add',
    ...Object.entries(historicalVersions).map(([name, version]) => `${name}@${version}`),
  ], { cwd: seedRoot, env: seedEnv, windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  await writeFile(await evidenceFile('historical-seed.log'), `${result.stdout}\n${result.stderr}`)
  for (const [name, version] of Object.entries(historicalVersions)) {
    const installed = JSON.parse(await readFile(await verifiedPackageFile(root, 'data/dsh-home/profiles/web/node_modules', name, 'package.json'), 'utf8'))
    assert.equal(installed.version, version, `historical ${name} must be seeded into the candidate profile`)
  }
}
const listener = createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const debugPort = listener.address().port
await new Promise(resolve => listener.close(resolve))
const host = spawn(hostExecutable, [], {
  cwd: root,
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...env,
    DSH_PORTABLE_TEST_HIDDEN: '1',
    DSH_PORTABLE_TEST_AUTOMATION: '1',
    // The startup refresh is covered by the release upgrade smoke; here the historical plugins must stay
    // so the plugin page's own Update flow (and its writer lock) is what gets exercised.
    ...(mode === '--upgrade-defaults' ? { DSH_PORTABLE_TEST_SKIP_DEFAULT_PLUGIN_REFRESH: '1' } : {}),
    DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
})
const report = { ok: false, portableVersion: components.portableVersion, dshVersion: components.dshVersion, pageErrors: [] }
async function verifyInstalledDefaults(expected = Object.fromEntries(reviewedPlugins.map(plugin => [plugin.package, plugin.version]))) {
  const versions = {}
  for (const plugin of reviewedPlugins) {
    const manifest = JSON.parse(await readFile(await verifiedPackageFile(root, 'data', 'dsh-home', 'profiles', 'web', 'node_modules', plugin.package, 'package.json'), 'utf8'))
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

  // Observe the first real deferred pass before UI package writers can take
  // the profile lock. A busy pass deliberately defers for six hours; the
  // official manager path does not restart the host to reset that timer.
  const maintenanceDeadline = Date.now() + 80000
  let removed = false
  while (Date.now() < maintenanceDeadline) {
    try { await verifiedPackageFile(root, oldLogRelative) }
    catch (error) { if (error.code !== 'ENOENT') throw error; removed = true; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(removed, 'real host did not run deferred plugin log maintenance')
  await access(await verifiedPackageFile(root, recentLogRelative))
  report.deferredLogMaintenance = true

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
    if ((await page.evaluate(dismissOfficialOnboardingExpression))?.clicked) continue
    await page.waitForTimeout(500)
  }

  await page.getByRole('button', { name: /^(Plugins|插件)$/ }).first().click()
  await page.locator(`[data-plugin-package="${reviewedPlugins[0].package}"]`).waitFor()
  const publicManager = await page.locator('[data-plugin-header-part="toolbar"]').count() > 0
  report.pluginManagerPath = publicManager ? 'official-public-update-ui' : 'legacy-portable-update-row'
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
    const writerLockExists = async () => await safeDataTarget(root, 'data/dsh-home/profiles/web/package.json.lock', { createParents: false }) !== null
    async function probeConcurrentWriters(plugin) {
      const deadline = Date.now() + 10_000
      while (!await writerLockExists()) {
        assert.ok(Date.now() < deadline, `${publicManager ? 'official manager' : 'Portable'} profile writer lock was not observed within 10s of update confirmation`)
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      const secondRequest = secondPage.evaluate(async name => {
        const response = await fetch('/dsh-market/update', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
        return { status: response.status, body: await response.json() }
      }, plugin.package)
      const cliRequest = promisify(execFile)(nodeExecutable, [
        runtimeEntry, 'dsh-cli.mjs', 'plugin', '--profile', 'web', 'install',
      ], { cwd: root, env, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })
        .then(value => ({ code: 0, ...value }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }))
      const [second, cli] = await Promise.all([secondRequest, cliRequest])
      report.concurrentWriters = { owner: publicManager ? 'official-plugin-manager' : 'portable-market', scope: 'shared-profile-writer-lock', secondPageStatus: second.status, cliExitCode: cli.code, actualWriterLockObserved: true }
      assert.equal(second.status, 409, JSON.stringify(second))
      assert.match(second.body.error, /operation|install.*running/i)
      assert.equal(cli.code, 1, JSON.stringify(cli))
      assert.match(cli.stderr, /lock|busy|already.*running/i)
    }
    let navigations = 0
    const observeNavigation = frame => { if (frame === page.mainFrame()) navigations++ }
    page.on('framenavigated', observeNavigation)
    for (const plugin of reviewedPlugins) {
      const card = page.locator(`[data-plugin-package="${plugin.package}"]`)
      const enabledBefore = await card.getByRole('switch').getAttribute('aria-checked')
      let update = card.getByRole('button', { name: /^(更新|Update)$/ })
      let detail
      if (publicManager) {
        await card.getByRole('button').first().click()
        detail = page.locator(`[data-plugin-detail="${plugin.package}"]`)
        const versions = detail.locator('[data-plugin-versions]')
        const expand = versions.locator('button[aria-expanded="false"]').first()
        await expand.waitFor({ timeout: 60_000 })
        await expand.click()
        await versions.locator(`[data-plugin-version="${plugin.version}"]`).getByRole('button', { name: /^(更新到 |Update to )/ }).click()
        await page.locator('[data-plugin-update="confirm"]').waitFor()
        update = page.getByRole('dialog').last().getByRole('button', { name: /^(更新|Update)$/ })
      }
      await update.waitFor({ timeout: 60_000 })
      await update.click({ trial: true })
      const pending = publicManager
        ? page.locator('[data-plugin-update="done"]').waitFor({ timeout: 180_000 })
        : page.waitForResponse(response => new URL(response.url()).pathname === '/dsh-market/update'
          && response.request().method() === 'POST', { timeout: 180_000 })
      pending.catch(() => {})
      let writerProbe
      if (secondPage && report.upgrades.length === 0) {
        assert.equal(await writerLockExists(), false, 'profile already had an unrelated writer before update')
        // Arm the actual lock observer before the UI starts either transaction.
        writerProbe = probeConcurrentWriters(plugin)
        writerProbe.catch(() => {})
      }
      await update.click()
      await writerProbe
      if (publicManager) {
        await pending
        const result = page.locator('[data-plugin-update="done"]')
        assert.equal(await result.locator('[data-state="failed"],[data-state="unknown"]').count(), 0, await result.innerText())
        await detail.getByText(`v${plugin.version}`, { exact: true }).waitFor()
        await page.getByRole('dialog').last().getByRole('button', { name: /^(完成|Done)$/ }).click()
        await detail.getByRole('button', { name: /^(返回插件|Back to plugins)$/ }).click()
        await card.waitFor()
      } else {
        const response = await pending
        const body = await response.json()
        assert.equal(response.status(), 200, JSON.stringify(body))
        assert.equal(body.ok, true, JSON.stringify(body))
      }
      const installed = JSON.parse(await readFile(await verifiedPackageFile(root, 'data/dsh-home/profiles/web/node_modules', plugin.package, 'package.json'), 'utf8'))
      assert.equal(installed.version, plugin.version, 'update must reach the exact reviewed product version')
      assert.equal(await card.isVisible(), true, 'download/install must preserve the plugin page')
      assert.equal(await card.getByRole('switch').getAttribute('aria-checked'), enabledBefore, 'update must preserve enablement')
      assert.equal(navigations, 0, 'update must not navigate before restart')
      report.upgrades.push({ package: plugin.package, from: historicalVersions[plugin.package], to: installed.version, enabledBefore })
      if (publicManager) report.ownedPublicUpdate = report.upgrades
      await page.screenshot({ path: await evidenceFile(`${plugin.package}-after-update.png`) })
    }
    page.off('framenavigated', observeNavigation)
    report.updatedDefaultVersions = await verifyInstalledDefaults()
    if (concurrency) {
      const files = ['package.json', 'pnpm-lock.yaml', 'node_modules/.modules.yaml']
      const snapshot = () => Promise.all(files.map(async file => createHash('sha256').update(await readFile(await verifiedPackageFile(root, 'data/dsh-home/profiles/web', file))).digest('hex')))
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
    await page.screenshot({ path: await evidenceFile(`${plugin.package}-after-uninstall.png`) })

    await page.getByRole('button', { name: /^(添加插件|Add plugin)$/ }).click()
    dialog = page.getByRole('dialog').last()
    await dialog.getByRole('textbox').first().fill(`${plugin.package}@${plugin.version}`)
    await dialog.getByRole('button', { name: /^(安装|Install)$/ }).click()
    const enableNow = page.getByRole('button', { name: /^(立即启用|Enable now)$/ })
    const installResult = await Promise.race([
      enableNow.waitFor({ timeout: 120_000 }).then(() => 'ready'),
      (publicManager ? page.locator('[data-install-phase="failed"]') : page.getByText(/(?:could not be installed|无法安装)/i)).waitFor({ timeout: 120_000 }).then(() => 'failed'),
    ])
    assert.equal(installResult, 'ready', `Official plugin installation failed: ${await page.getByRole('dialog').last().innerText()}`)
    await enableNow.click()
    if (publicManager) {
      await page.getByRole('dialog').last().waitFor({ state: 'hidden' })
      const back = page.getByRole('button', { name: /^(返回插件|Back to plugins)$/ })
      if (await back.isVisible()) await back.click()
    } else await page.getByRole('button', { name: /^(返回插件列表|Back to plugins)$/ }).click()
    await card.waitFor()
    await page.waitForFunction(selector => document.querySelector(`${selector} [role="switch"]`)?.getAttribute('aria-checked') === 'true', selector)
    assert.equal(await card.getByRole('switch').getAttribute('aria-checked'), 'true')
    cycle.reinstalledAndEnabled = true
    cycle.reinstalledDefaultVersions = await verifyInstalledDefaults()
    await page.screenshot({ path: await evidenceFile(`${plugin.package}-after-install.png`) })

  }
  if (!publicManager) {
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
    report.legacyRestart = true
  } else {
    report.legacyRestart = { status: 'not-applicable', reason: 'The official manager has no Portable private update row.' }
  }

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
  else await page.evaluate(dismissOfficialOnboardingExpression)
  await page.getByRole('button', { name: /^(新会话|新建会话|New session)$/ }).first().click()
  const composer = page.locator('[contenteditable="true"][role="textbox"]').first()
  await composer.fill('Disposable official plugin lifecycle check')
  assert.equal(await composer.isEditable(), true)
  await page.screenshot({ path: await evidenceFile(publicManager ? 'after-plugin-cycle-composer.png' : 'after-restart-composer.png') })
  assert.deepEqual(report.pageErrors, [])
  report.composer = true
  report.ok = true
} catch (error) {
  report.failure = String(error)
  try { await page?.screenshot({ path: await evidenceFile('failure.png') }) } catch {}
  throw error
} finally {
  await secondBrowser?.close().catch(() => {})
  try {
    await writeFile(await evidenceFile('result.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
    try {
      await cp(await verifiedPackageFile(root, managedLogsRelative),
        await safeDataTarget(root, `${evidenceRelative}/plugin-manager-logs`, { leaf: 'any' }), {
          recursive: true, filter: async source => { await verifiedPackageFile(root, path.relative(root, source)); return true },
        })
    } catch {}
  } finally {
    await browser?.close().catch(() => {})
    await promisify(execFile)(nodeExecutable, [runtimeEntry, 'portable-cli.mjs', 'stop', '--json'], {
      cwd: root, env, windowsHide: true, timeout: 120_000,
    }).catch(() => {})
    if (host.exitCode === null) host.kill()
    // Restart replaces the original child. Restrict cleanup to this disposable
    // executable, never to all Portable processes on the machine.
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'try { Get-Process -Name DeepSeek-Herness -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:DSH_ACCEPTANCE_HOST_EXE } | Stop-Process -ErrorAction Stop; exit 0 } catch { Write-Error $_; exit 1 }'], {
      windowsHide: true, timeout: 30000,
      env: { ...process.env, DSH_ACCEPTANCE_HOST_EXE: hostExecutable },
    })
  }
}
