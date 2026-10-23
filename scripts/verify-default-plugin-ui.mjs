import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const SIGN_IN_STEP = /登录 DeepSeek 账号，或添加 API Key|add an API Key to get started/i
const DECISION_BUTTON = /delete|删除|cancel|取消|confirm|确认|save|保存|install|安装|remove|移除|restore|恢复|archive|归档/i
const ONBOARDING_EXIT = /^(继续|Continue|稍后配置|Configure later|Set up later|Close|关闭|)$/

async function visibleOnboarding(page) {
  const dialog = page.getByRole('dialog').filter({
    hasText: /Internal Testing Notice|内测声明|Preview Notice|预览版说明|Add an API key to get started|添加 API 密钥|添加一个 API Key/i,
  }).last()
  if (await dialog.isVisible()) return dialog
  // A newly shipped official notice whose only action is Continue is a pure
  // acknowledgement; dialogs that offer a choice are never dismissed here.
  const dialogs = page.getByRole('dialog')
  for (let index = await dialogs.count() - 1; index >= 0; index--) {
    const candidate = dialogs.nth(index)
    if (!await candidate.isVisible()) continue
    const buttons = candidate.getByRole('button')
    if (await buttons.count() === 1 && /^(继续|Continue)$/.test((await buttons.first().innerText()).trim())) return candidate
    // Any first-run dialog without a destructive or confirming choice is onboarding, including steps a newer
    // official core adds later. Dialogs this script opens itself (delete, restore, viewer) are never matched.
    const labels = await buttons.allInnerTexts()
    if (!labels.some(label => DECISION_BUTTON.test(label.trim())) && labels.some(label => ONBOARDING_EXIT.test(label.trim())) || SIGN_IN_STEP.test(await candidate.innerText())) return candidate
  }
  return null
}

async function dismissOnboarding(page) {
  for (let step = 0; step < 4; step++) {
    const dialog = await visibleOnboarding(page)
    if (!dialog) return
    // Prefer the dialog's own acknowledge/later button; a step that offers only choices is declined with Close.
    let action = dialog.getByRole('button', { name: /^(继续|Continue|稍后配置|Configure later|Set up later)$/ }).first()
    if (!await action.count()) action = dialog.getByRole('button', { name: /^(Close|关闭)$/ }).first()
    const currentDialog = await dialog.elementHandle()
    await action.click()
    // A different onboarding dialog may appear immediately. Wait for the
    // exact element we just acted on, not a .last() locator that now points
    // at the next dialog in the sequence.
    await currentDialog.waitForElementState('hidden')
    await currentDialog.dispose()
  }
  assert.equal(await visibleOnboarding(page), null, 'known onboarding dialog should close before plugin actions')
}

async function clickAfterOnboarding(page, locator) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissOnboarding(page)
    try {
      await locator.click({ timeout: 2500 })
      return
    } catch (error) {
      // The official first-run dialog can appear between a visibility check
      // and the click. Retry only when that exact dialog blocked the action.
      if (!await visibleOnboarding(page)) throw error
    }
  }
  throw new Error('official onboarding kept covering the requested control')
}

async function openArchivedSessions(page) {
  await clickAfterOnboarding(page, page.locator('#archived-sessions'))
}

/** Operate real official controls; never remove onboarding DOM or patch the host. */
export async function verifyDefaultPluginUi(page, evidence, title = 'Portable default plugin qualification session', { confirmDelete = false, staleArchiveId } = {}) {
  const errors = []
  const onError = error => errors.push(error.message)
  const onConsole = message => {
    // React error boundaries report to console without emitting pageerror.
    if (message.type() === 'error' && /React error|slot entry crashed|TypeError|ReferenceError/.test(message.text())) errors.push(message.text())
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)
  try {
    await dismissOnboarding(page)
    await clickAfterOnboarding(page, page.getByRole('button', { name: /^(Plugins|插件)$/ }).first())
    for (const packageName of ['dsh-chat-manager', 'dsh-image-viewer']) {
      const toggle = page.locator(`[data-plugin-package="${packageName}"]`).getByRole('switch')
      await toggle.waitFor()
      if (await toggle.getAttribute('aria-checked') !== 'true') {
        await clickAfterOnboarding(page, toggle)
        await page.waitForFunction(packageName => document.querySelector(`[data-plugin-package="${packageName}"] [role="switch"]`)?.getAttribute('aria-checked') === 'true', packageName)
      }
    }
    // Below the official responsive breakpoint (the CI window is 1016x680) the sidebar starts collapsed to an icon rail.
    // Open it through the same button a user would press; the session tree only exists while it is open.
    const openSidebar = page.getByRole('button', { name: /^(打开侧边栏|Open sidebar|Expand sidebar)$/ })
    if (await openSidebar.first().isVisible()) await clickAfterOnboarding(page, openSidebar.first())
    const selected = page.getByRole('treeitem').filter({ hasText: title }).last()
    if (!await selected.isVisible()) {
      // The headless fixture belongs to its cwd workspace, which can start collapsed.
      // Expand real workspace rows through the same UI action a user takes.
      const workspaces = page.locator('[role="treeitem"][data-row-key^="workspace:"][aria-expanded="false"]')
      const count = await workspaces.count()
      for (let index = 0; index < count && !await selected.isVisible(); index += 1) {
        await clickAfterOnboarding(page, workspaces.first())
      }
      const ungrouped = page.getByText(/^(未分组|Ungrouped)$/, { exact: true })
      if (!await selected.isVisible() && await ungrouped.isVisible()) await clickAfterOnboarding(page, ungrouped)
    }
    await clickAfterOnboarding(page, selected)
    const later = page.getByRole('button', { name: /^(稍后配置|Configure later)$/ })
    if (await later.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)) await later.click()
    const input = page.locator('[contenteditable="true"][role="textbox"]').first()
    await input.fill('Disposable core qualification draft')
    const clipboard = await page.evaluateHandle(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 640; canvas.height = 480
      const context = canvas.getContext('2d')
      context.fillStyle = '#888'; context.fillRect(0, 0, 640, 480)
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'synthetic-core-qualification.png', { type: 'image/png' }))
      return data
    })
    try {
      await input.evaluate((element, clipboardData) => element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })), clipboard)
    } finally { await clipboard.dispose() }
    const thumbnails = page.locator('[role="group"] button[title]').filter({ has: page.locator(':scope > img') })
    await thumbnails.first().click()
    const viewer = page.locator('.niv-root')
    await viewer.waitFor()
    await viewer.getByRole('button', { name: /^(Mark region|标记区域)$/ }).click()
    await viewer.locator('.niv-image').click()
    await viewer.locator('textarea').fill('Qualification annotation')
    await page.screenshot({ path: path.join(evidence, 'image-annotation.png') })
    await viewer.locator('.niv-close-floating').click()
    await viewer.waitFor({ state: 'hidden' })
    await thumbnails.nth(1).waitFor()
    const text = await input.innerText()
    assert.ok(text.includes('Disposable core qualification draft'))
    assert.ok(text.includes('Qualification annotation'), 'annotation returns through the real attachment/draft API')
    const row = selected
    await row.hover()
    await row.getByRole('button', { name: /Session actions|会话.*操作/ }).click()
    await page.getByRole('menuitem', { name: /^(永久删除|删除会话|Delete session|Delete permanently)$/ }).click()
    const dialog = page.getByRole('dialog', { name: /^(永久删除会话？|Permanently delete session\?)$/ })
    await dialog.waitFor()
    await page.screenshot({ path: path.join(evidence, 'session-delete-confirmation.png') })
    await dialog.getByRole('button', { name: /^(取消|Cancel)$/ }).last().click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await input.isEditable(), true, 'cancelled deletion leaves composer editable')
    assert.ok((await input.innerText()).includes('Qualification annotation'), 'cancel preserves the draft')
    await page.screenshot({ path: path.join(evidence, 'composer-after-plugin-actions.png') })
    await row.hover()
    await row.getByRole('button', { name: /Session actions|会话.*操作/ }).click()
    await page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ }).click()
    await row.waitFor({ state: 'hidden' })
    // Archiving the active session can asynchronously open official onboarding.
    await openArchivedSessions(page)
    const search = page.getByRole('searchbox', { name: /^(Search archived sessions|搜索已归档会话)$/ })
    await search.waitFor()
    assert.equal(await page.getByRole('dialog', { name: /^(Archived sessions|归档会话)$/ }).count(), 0, 'archive shortcut opens official settings without a second popup')
    await search.fill(title)
    const restore = page.getByRole('button', { name: new RegExp(`^(Unarchive|取消归档) ${title}$`) })
    const remove = page.getByRole('button', { name: new RegExp(`^(Delete permanently|永久删除) ${title}$`) })
    await restore.waitFor()
    assert.notEqual(await remove.evaluate(e => getComputedStyle(e).color), await restore.evaluate(e => getComputedStyle(e).color), 'destructive action has a distinct color')
    await page.screenshot({ path: path.join(evidence, 'archive-settings.png') })
    const restored = page.waitForResponse(r => new URL(r.url()).pathname === '/plugins/dsh-session-delete/restore' && r.request().method() === 'POST')
    await restore.click()
    const response = await restored
    assert.equal(response.status(), 200)
    assert.equal((await response.json()).ok, true)
    await restore.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: /^(Close|关闭)$/ }).last().click()
    await search.waitFor({ state: 'hidden' })
    await clickAfterOnboarding(page, selected)
    await input.fill('Composer remains usable after archive restoration')
    if (confirmDelete) {
      await selected.hover()
      await selected.getByRole('button', { name: /Session actions|会话.*操作/ }).click()
      await page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ }).click()
      await selected.waitFor({ state: 'hidden' })
      await openArchivedSessions(page)
      await search.fill(title)
      await remove.click()
      const deleted = page.waitForResponse(r => new URL(r.url()).pathname === '/plugins/dsh-session-delete/delete' && r.request().method() === 'POST')
      await dialog.getByRole('button', { name: /^(永久删除|Delete permanently|确认永久删除|Confirm permanent deletion)$/ }).click()
      const deletion = await deleted
      assert.equal(deletion.status(), 200)
      assert.equal((await deletion.json()).ok, true)
      await selected.waitFor({ state: 'hidden' })
      await dialog.waitFor({ state: 'hidden' })
      await remove.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: /^(Close|关闭)$/ }).last().click()
    }
    for (const packageName of ['dsh-chat-manager', 'dsh-image-viewer']) {
      for (const enabled of [false, true]) {
        const configureLater = page.getByRole('button', { name: /^(稍后配置|Configure later)$/ })
        if (await configureLater.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) await configureLater.click()
        await clickAfterOnboarding(page, page.getByRole('button', { name: /^(Plugins|插件)$/ }).first())
        const toggle = page.locator(`[data-plugin-package="${packageName}"]`).getByRole('switch')
        await toggle.waitFor()
        if (await toggle.getAttribute('aria-checked') !== String(enabled)) await clickAfterOnboarding(page, toggle)
        await page.waitForFunction(({ packageName, enabled }) => document.querySelector(`[data-plugin-package="${packageName}"] [role="switch"]`)?.getAttribute('aria-checked') === String(enabled), { packageName, enabled })
        await clickAfterOnboarding(page, page.getByRole('button', { name: /^(New session|新建会话|新会话)$/i }).first())
        await input.fill(`Composer check after ${packageName} ${enabled}`)
        assert.equal(await input.isEditable(), true)
      }
    }
    await page.screenshot({ path: path.join(evidence, 'composer-after-enable-disable.png') })
    if (staleArchiveId) {
      await openArchivedSessions(page)
      await search.fill(staleArchiveId)
      const staleRemove = page.getByRole('button', { name: new RegExp(`^(Delete permanently|永久删除) ${staleArchiveId}$`) })
      await staleRemove.click()
      const staleDialog = page.getByRole('dialog', { name: /^(永久删除会话？|Permanently delete session\?)$/ })
      await staleDialog.getByRole('button', { name: /^(取消|Cancel)$/ }).last().click()
      await staleRemove.waitFor()
      await staleRemove.click()
      const deleted = page.waitForResponse(r => new URL(r.url()).pathname === '/plugins/dsh-session-delete/delete' && r.request().method() === 'POST')
      await staleDialog.getByRole('button', { name: /^(确认永久删除|Confirm permanent deletion)$/ }).click()
      const response = await deleted
      assert.equal(response.status(), 200)
      const body = await response.json()
      assert.equal(body.value.alreadyAbsent, true)
      assert.equal(body.value.archiveReconciled, true)
      await staleRemove.waitFor({ state: 'hidden' })
      await page.screenshot({ path: path.join(evidence, 'stale-archive-removed.png') })
      await page.getByRole('button', { name: /^(Close|关闭)$/ }).last().click()
    }
    assert.deepEqual(errors, [], 'no swallowed overlay or React errors')
    return { ok: true, imageAnnotation: true, draftPreserved: true, sessionDeleteCancel: true, archiveRestore: true, confirmedDelete: confirmDelete, pluginEnableDisable: true, errors }
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {})
    await writeFile(path.join(evidence, 'errors.json'), JSON.stringify({ error: String(error), errors }, null, 2))
    throw error
  } finally {
    page.off('pageerror', onError)
    page.off('console', onConsole)
  }
}

export async function seedStaleArchive(root, id) {
  const registryFile = path.join(root, 'data/dsh-home/storages/workspace.json')
  const registry = JSON.parse(await readFile(registryFile, 'utf8'))
  assert.ok(Array.isArray(registry.global?.archivedSessionIds))
  registry.global.archivedSessionIds = [...new Set([...registry.global.archivedSessionIds, id])]
  await mkdir(path.dirname(registryFile), { recursive: true })
  await writeFile(registryFile, JSON.stringify(registry))
}

export async function verifyNativeDefaultPlugins(root, playwrightManifest) {
  assert.equal(process.platform, 'win32', 'native WebView2 qualification requires Windows')
  root = path.resolve(root)
  const { chromium } = createRequire(path.resolve(playwrightManifest))('playwright')
  const components = JSON.parse(await readFile(path.join(root, 'licenses/COMPONENTS.json'), 'utf8'))
  const fixtureEnv = { ...process.env, DSH_PORTABLE_STATE_ROOT: root, DSH_PORTABLE_ENVIRONMENT: 'default',
    DSH_HOME: path.join(root, 'data/dsh-home'), DSH_TELEMETRY_MODE: 'DISABLED' }
  const seedEnv = { ...fixtureEnv }
  const title = `Portable qualification ${Date.now()}`
  for (const key of Object.keys(seedEnv)) if (/API_KEY|TOKEN|SECRET/i.test(key)) delete seedEnv[key]
  let seed
  try {
    seed = await exec(path.join(root, 'runtime/node/node.exe'), [path.join(root, 'launcher/runtime-entry.mjs'),
      'dsh-cli.mjs', '--profile', 'headless', title],
    { cwd: root, windowsHide: true, timeout: 90000, env: seedEnv })
  } catch (error) { seed = error }
  // A clean, keyless disposable product persists the synthetic prompt, but must
  // not call a real model. Other failures are not successful fixture creation.
  assert.match(`${seed.stdout ?? ''}\n${seed.stderr ?? ''}`, /MISSING_CREDENTIAL/, 'keyless synthetic session was created')
  const results = []
  for (const theme of ['dark', 'light']) {
    // Let the first web launch import the headless session and create its own
    // workspace registry. Precreating a partial registry suppresses that import.
    // Add the stale marker only after that host has shut down, before light mode.
    const staleArchiveId = process.env.DSH_CHAT_TEST_STALE_ARCHIVE === '1' && theme === 'light' ? `session-acceptance-absent-${theme}` : undefined
    if (staleArchiveId) {
      await seedStaleArchive(root, staleArchiveId)
    }
    const evidence = path.join(root, 'acceptance/default-plugin-ui', theme)
    await mkdir(evidence, { recursive: true })
    await mkdir(path.join(root, 'data/dsh-home'), { recursive: true })
    await writeFile(path.join(root, 'data/dsh-home/settings.yaml'), `ui-theme:\n  preference: ${theme}\n`)
    const reserve = createServer()
    await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
    const port = reserve.address().port
    await new Promise(resolve => reserve.close(resolve))
    const child = spawn(path.join(root, 'DeepSeek-Herness.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env: {
      ...fixtureEnv, DSH_PORTABLE_SKIP_UPDATE_CHECK: '1', DSH_PORTABLE_TEST_HIDDEN: '1', DSH_PORTABLE_TEST_AUTOMATION: '1',
      DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS: `--remote-debugging-port=${port}`,
    } })
    let browser
    try {
      const deadline = Date.now() + 120000
      while (Date.now() < deadline && !browser) {
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }) } catch { await delay(250) }
      }
      assert.ok(browser, 'native WebView2 remote debugging is available')
      const page = browser.contexts()[0].pages()[0]
      page.setDefaultTimeout(20000)
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 90000 })
      assert.equal(await page.evaluate(() => Boolean(window.chrome?.webview)), true, 'this is the native WebView, not a substitute browser')
      await page.waitForFunction(() => document.querySelector('[data-dsh-boot]') === null)
      results.push({ theme, staleArchiveId, ...(await verifyDefaultPluginUi(page, evidence, title, { confirmDelete: theme === 'light', staleArchiveId })) })
    } finally {
      await browser?.close().catch(() => {})
      try {
        await exec(path.join(root, 'runtime/node/node.exe'), [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', 'stop', '--json'], { cwd: root, env: fixtureEnv, windowsHide: true, timeout: 120000 })
      } finally { if (child.exitCode === null) child.kill() }
    }
  }
  const installedPlugins = await Promise.all(['dsh-chat-manager', 'dsh-image-viewer'].map(async name => {
    const manifest = JSON.parse(await readFile(path.join(root, 'data/dsh-home/profiles/web/node_modules', name, 'package.json'), 'utf8'))
    return { package: name, version: manifest.version }
  }))
  const report = { ok: true, portableVersion: components.portableVersion, dshVersion: components.dshVersion, defaultPlugins: components.defaultPlugins, installedPlugins, results }
  await writeFile(path.join(root, 'acceptance/default-plugin-ui/result.json'), JSON.stringify(report, null, 2))
  return report
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [root, playwrightManifest, disposable] = process.argv.slice(2)
  assert.ok(root && playwrightManifest && disposable === '--disposable', 'usage: verify-default-plugin-ui.mjs <disposable-product> <playwright-package-anchor> --disposable')
  console.log(JSON.stringify(await verifyNativeDefaultPlugins(root, playwrightManifest)))
}
