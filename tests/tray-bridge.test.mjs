import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'

const sourceUrl = new URL('../desktop-bridge/lib/client.js', import.meta.url)

async function loadBridgeClient() {
  const source = await readFile(sourceUrl, 'utf8')
  const posted = []
  const webMessageListeners = new Set()
  let definition
  const window = {
    __ModuleLoader__: {
      load(value) { definition = value },
    },
    chrome: {
      webview: {
        addEventListener(name, listener) {
          if (name === 'message') webMessageListeners.add(listener)
        },
        removeEventListener(name, listener) {
          if (name === 'message') webMessageListeners.delete(listener)
        },
        postMessage(value) { posted.push(structuredClone(value)) },
      },
    },
  }
  vm.runInNewContext(source, { console, queueMicrotask, window })
  assert.equal(definition?.id, '@wsl043/dsh-portable-desktop-bridge')
  const exports = definition.factory((id) => {
    if (id === 'react') return {}
    throw new Error(`the private bridge imported an unexpected client bundle: ${id}`)
  })
  return {
    exports,
    posted,
    send(value) {
      for (const listener of webMessageListeners) listener({ data: structuredClone(value) })
    },
  }
}

function fakeContext(initialSessions) {
  let listSnapshot = initialSessions
  const listListeners = new Set()
  const eventListeners = new Map()
  const opened = []
  let cleared = 0
  let locale = { active: 'zh', revision: 1 }
  let theme = { active: { colorScheme: 'dark' }, revision: 1 }
  let downloadSnapshot = { bySession: {} }
  const disposers = []
  const slotEntries = []
  const ctx = {
    locale: {
      getLocale: () => locale,
      register() { return () => {} },
      bind() { return key => key },
    },
    slots: {
      inject(_name, factory) { const dispose = factory(); if (typeof dispose === 'function') disposers.push(dispose) },
      register(options, component) {
        const entry = { options, component }
        slotEntries.push(entry)
        return () => { const index = slotEntries.indexOf(entry); if (index >= 0) slotEntries.splice(index, 1) }
      },
    },
    theme: { getTheme: () => theme },
    sessions: {
      list: {
        getSnapshot: () => listSnapshot,
        subscribe(listener) {
          listListeners.add(listener)
          return () => listListeners.delete(listener)
        },
      },
      open(id) { opened.push(id) },
      clear() { cleared += 1 },
    },
    workspaces: {
      async pickDirectory() { return 'node-owned-picker' },
    },
    sessionLogDownload: {
      store: {
        getSnapshot: () => downloadSnapshot,
        update(updater) {
          const next = structuredClone(downloadSnapshot)
          updater(next)
          downloadSnapshot = next
        },
      },
    },
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    on(name, listener) {
      const listeners = eventListeners.get(name) ?? new Set()
      listeners.add(listener)
      eventListeners.set(name, listeners)
      return () => listeners.delete(listener)
    },
  }
  return {
    ctx,
    opened,
    get cleared() { return cleared },
    get downloadSnapshot() { return downloadSnapshot },
    slotEntries,
    emit(name, value) {
      if (name === 'locale/change') locale = value
      if (name === 'theme/change') theme = value
      for (const listener of eventListeners.get(name) ?? []) listener(value)
    },
    setSessions(value) {
      listSnapshot = value
      for (const listener of listListeners) listener()
    },
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

test('Portable desktop bridge owns workspace picking through the WebView host and restores the runtime on dispose', async () => {
  const client = await loadBridgeClient()
  const runtime = fakeContext(sessionList(1))
  const original = runtime.ctx.workspaces.pickDirectory

  client.exports.apply(runtime.ctx)
  assert.notEqual(runtime.ctx.workspaces.pickDirectory, original)

  const picked = runtime.ctx.workspaces.pickDirectory()
  const request = client.posted.at(-1)
  assert.equal(request.type, 'dsh-portable/pick-directory')
  assert.equal(request.schemaVersion, 1)
  assert.match(request.requestId, /^workspace-/)
  client.send({
    type: 'dsh-portable/pick-directory-result',
    schemaVersion: 1,
    requestId: request.requestId,
    path: 'C:\\Projects\\Harness',
  })
  assert.equal(await picked, 'C:\\Projects\\Harness')

  const cancelled = runtime.ctx.workspaces.pickDirectory()
  const cancelRequest = client.posted.at(-1)
  client.send({
    type: 'dsh-portable/pick-directory-result',
    schemaVersion: 1,
    requestId: cancelRequest.requestId,
    cancelled: true,
  })
  assert.equal(await cancelled, null)

  runtime.dispose()
  assert.equal(runtime.ctx.workspaces.pickDirectory, original)
})

function sessionList(count = 12) {
  const byId = {}
  const ids = []
  for (let index = 0; index < count; index += 1) {
    const id = `session-${index}`
    ids.push(id)
    byId[id] = {
      id,
      displayTitle: `真实会话 ${index}`,
      updatedAt: index * 100,
      running: index === count - 1,
      completed: index === count - 2,
      pendingInteraction: index === count - 2 ? 'question' : undefined,
      agentPreset: index % 2 === 0 ? 'coding' : undefined,
      blank: false,
    }
  }
  ids.push('blank', 'child')
  byId.blank = { id: 'blank', displayTitle: 'New Session', updatedAt: 9999, blank: true, running: false }
  byId.child = { id: 'child', displayTitle: 'Subagent', updatedAt: 9998, blank: false, running: true, origin: 'subagent' }
  return { ids, byId, current: `session-${count - 1}`, phase: 'ready' }
}

test('private tray bridge projects bounded official runtime state and invokes only SessionRuntime actions', async () => {
  const client = await loadBridgeClient()
  const runtime = fakeContext(sessionList())

  assert.deepEqual([...client.exports.inject], ['slots', 'locale', 'theme', 'sessions', 'workspaces', 'sessionLogDownload'])
  client.exports.apply(runtime.ctx)
  assert.equal(runtime.slotEntries.length, 0)

  const initial = client.posted.at(-1)
  assert.equal(initial.type, 'dsh-portable/state')
  assert.equal(initial.schemaVersion, 1)
  assert.equal(initial.locale, 'zh')
  assert.equal(initial.theme, 'dark')
  assert.equal(initial.currentSessionId, 'session-11')
  assert.equal(initial.hasRunningSession, true, 'the native shell must know if any visible user session is still running')
  assert.equal(initial.sessions.length, 10, 'the native menu payload stays bounded')
  assert.deepEqual(initial.sessions.slice(0, 3).map(item => item.id), ['session-11', 'session-10', 'session-9'])
  assert.equal(initial.sessions.some(item => item.id === 'blank' || item.id === 'child'), false)
  assert.equal(initial.sessions[0].running, true)
  assert.equal(initial.sessions[1].completed, true, 'the bridge must forward the official task-completion signal')
  assert.equal(initial.sessions[1].pendingInteraction, 'question')

  runtime.emit('locale/change', { active: 'en', revision: 2 })
  runtime.emit('theme/change', { active: { colorScheme: 'light' }, revision: 2 })
  assert.equal(client.posted.at(-1).locale, 'en')
  assert.equal(client.posted.at(-1).theme, 'light')

  client.send({ type: 'dsh-portable/action', action: 'open-session', sessionId: 'session-9' })
  client.send({ type: 'dsh-portable/action', action: 'open-session', sessionId: 'unknown' })
  client.send({ type: 'dsh-portable/action', action: 'new-session' })
  assert.deepEqual(runtime.opened, ['session-9'])
  assert.equal(runtime.cleared, 1)

  client.send({
    type: 'dsh-portable/download',
    schemaVersion: 1,
    sessionId: 'session-9',
    state: 'downloading',
    fileName: 'session-9.zip',
    percent: 42,
    bytesReceived: 420,
    totalBytes: 1000,
  })
  assert.equal(runtime.downloadSnapshot.bySession['session-9'].status, 'downloading')
  assert.equal(runtime.downloadSnapshot.bySession['session-9'].nativeDownload.percent, 42)
  client.send({
    type: 'dsh-portable/download',
    schemaVersion: 1,
    sessionId: 'session-9',
    state: 'completed',
    fileName: 'session-9.zip',
    percent: 100,
  })
  assert.equal(runtime.downloadSnapshot.bySession['session-9'].status, 'success')

  const idle = sessionList(2)
  for (const item of Object.values(idle.byId)) item.running = false
  runtime.setSessions(idle)
  assert.equal(client.posted.at(-1).hasRunningSession, false)

  const beforeDispose = client.posted.length
  runtime.dispose()
  runtime.setSessions(sessionList(2))
  assert.equal(client.posted.length, beforeDispose)
})

test('portable launch and packages compose the bridge as a private official DSH overlay', async () => {
  const [app, lock, core, cli, windowsBuild, macBuild] = await Promise.all([
    readFile(new URL('../app/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../app/package-lock.json', import.meta.url), 'utf8'),
    readFile(new URL('../launcher/portable-core.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../launcher/portable-cli.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-windows.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-macos.sh', import.meta.url), 'utf8'),
  ])
  for (const text of [app, lock]) assert.match(text, /@wsl043\/dsh-portable-desktop-bridge/)
  assert.match(core, /desktopBridgePatch/)
  assert.match(cli, /'--profile',\s*'web'/)
  assert.match(cli, /'--patch',\s*layout\.desktopBridgePatch/)
  assert.match(windowsBuild, /desktop-bridge/)
  assert.match(macBuild, /desktop-bridge/)
  assert.match(windowsBuild, /shellSchema\s*=\s*21/)
  assert.match(windowsBuild, /requiredShellSchema\s*=\s*21/)
  assert.match(macBuild, /"shellSchema": 16/)
  assert.match(macBuild, /"requiredShellSchema": 16/)
})

test('Portable maintenance is a native General settings item backed by same-origin product routes', async () => {
  const [client, host] = await Promise.all([
    readFile(new URL('../desktop-bridge/lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../desktop-bridge/lib/index.js', import.meta.url), 'utf8'),
  ])
  assert.match(client, /settings\.general\.item/)
  assert.doesNotMatch(client, /settings\.section/)
  assert.match(client, /id:\s*'portable'/)
  assert.match(client, /\/dsh-portable\/settings/)
  assert.match(client, /\/dsh-portable\/doctor/)
  assert.match(client, /\/dsh-portable\/repair/)
  assert.match(client, /\/dsh-portable\/support-report/)
  assert.match(client, /默认关闭|Off by default/)
  assert.match(host, /sameOrigin\(request\)/)
  assert.match(host, /MAX_BODY\s*=\s*16 \* 1024/)
  assert.match(host, /repair-requested\.json/)
})

test('portable bridge fallback follows the moved product without entering a user plugin manifest', async () => {
  const core = await import('../launcher/portable-core.mjs')
  assert.equal(typeof core.ensureDesktopBridgeFallback, 'function')
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-tray-fallback-'))
  const first = path.join(parent, 'first')
  const second = path.join(parent, 'second')
  try {
    const layout = core.layoutForRoot(first, process.platform)
    await mkdir(path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge'), { recursive: true })
    await mkdir(path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-plugin-market'), { recursive: true })
    await writeFile(path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'package.json'), '{}\n')
    await writeFile(path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-plugin-market', 'package.json'), '{}\n')
    await core.ensureDesktopBridgeFallback(layout)
    assert.equal(
      await realpath(layout.desktopBridgeFallback),
      await realpath(path.dirname(layout.desktopBridgePatch)),
    )

    await rename(first, second)
    const moved = core.layoutForRoot(second, process.platform)
    await core.ensureDesktopBridgeFallback(moved)
    assert.equal(
      await realpath(moved.desktopBridgeFallback),
      await realpath(path.dirname(moved.desktopBridgePatch)),
    )
    const profile = JSON.parse(await readFile(path.join(second, 'data', 'dsh-home', 'profiles', 'web', 'package.json'), 'utf8').catch(() => '{}'))
    assert.equal(profile.dependencies?.['@wsl043/dsh-portable-desktop-bridge'], undefined)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('Windows tray consumes official projected state in one bounded compact native menu', async () => {
  const source = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  const build = await readFile(new URL('../scripts/build-windows.ps1', import.meta.url), 'utf8')
  assert.match(source, /WebMessageReceived/)
  assert.match(source, /WebMessageAsJson/)
  assert.match(source, /PostWebMessageAsJson/)
  assert.match(source, /dsh-portable\/state/)
  assert.match(source, /dsh-portable\/preferences/)
  assert.match(source, /updateCheckEnabled = \(bool\)value/)
  assert.match(source, /SaveLauncherSettings\(\);[\s\S]+RebuildTrayMenu\(\);/)
  assert.match(source, /open-session/)
  assert.match(source, /new-session/)
  assert.doesNotMatch(source, /TrayTaskFlyout/)
  assert.doesNotMatch(source, /TraySessionRow/)
  assert.doesNotMatch(source, /ShowTrayTaskFlyout/)
  assert.match(source, /CreateSessionMenuItem/)
  assert.match(source, /ShortcutKeyDisplayString[\s\S]+SessionHintForLocale/)
  assert.match(source, /Take\(3\)/)
  assert.match(source, /More|更多/)
  assert.match(source, /已完成|Completed/)
  assert.match(source, /more\.DropDownItems\.Add\(checkUpdateItem\)/)
  assert.match(source, /more\.DropDownItems\.Add\(automaticUpdateCheckItem\)/)
  assert.match(source, /more\.DropDownItems\.Add\(closeBehaviorItem\)/)
  assert.match(source, /trayMenu\.Items\.Add\(CreateOpenItem\(\)\)[\s\S]+foreach \(TrayBridgeSession session in sessions\.Take\(3\)\)/)
  assert.match(source, /more\.DropDownItems\.Add\(CreateReportProblemItem\(\)\)/)
  assert.doesNotMatch(source, /more\.DropDownItems\.Add\(CreateOpenItem\(\)\)/)
  assert.doesNotMatch(source, /trayMenu\.Items\.Add\(CreateReportProblemItem\(\)\)/)
  assert.doesNotMatch(source, /more\.DropDownItems\.Add\(closeToTrayItem\)/)
  assert.doesNotMatch(source, /more\.DropDownItems\.Add\(closeToExitItem\)/)
  assert.doesNotMatch(source, /more\.DropDownItems\.Add\(updateMenu\)/)
  assert.doesNotMatch(source, /more\.DropDownItems\.Add\(closeBehaviorMenu\)/)
  assert.match(source, /automaticUpdateCheckItem\.ShortcutKeyDisplayString\s*=\s*updateCheckEnabled/)
  assert.match(
    source,
    /automaticUpdateCheckItem\.Click \+= delegate[\s\S]+updateCheckEnabled = enabled;[\s\S]+engineUpdateCheckEnabled = enabled;[\s\S]+RefreshAutomaticUpdateCheckItem\(\);[\s\S]+SaveLauncherSettings\(\);/,
  )
  assert.match(
    source,
    /private void RefreshAutomaticUpdateCheckItem\(\)[\s\S]+ShortcutKeyDisplayString = updateCheckEnabled && engineUpdateCheckEnabled/,
  )
  assert.match(source, /closeBehaviorItem\.ShortcutKeyDisplayString\s*=\s*closeBehavior/)
  assert.match(source, /Equals\("standard"[\s\S]*chinese\s*\?\s*"标准"\s*:\s*"Standard"/)
  assert.match(source, /MeasureTrayMenuWidth/)
  assert.doesNotMatch(source, /more\.DropDown\.MinimumSize\s*=\s*new Size\(300,\s*0\)/)
  assert.match(source, /DshMenuColorTable/)
  assert.match(source, /Color\.FromArgb\(31,\s*32,\s*34\)/)
  assert.match(source, /Color\.FromArgb\(45,\s*47,\s*50\)/)
  assert.doesNotMatch(source, /MinimumSize\s*=\s*new Size\(300,\s*0\)/)
  assert.doesNotMatch(source, /new Size\(298,\s*35\)/)
  assert.match(source, /new Font\("Segoe UI Variable Text",\s*8\.0F/)
  assert.match(source, /DwmSetWindowAttribute/)
  assert.match(source, /DwmWindowCornerPreference/)
  assert.match(source, /pendingInteraction[\s\S]+running[\s\S]+SessionHint/)
  assert.match(source, /OnRenderArrow[\s\S]+ControlPaint\.DrawMenuGlyph[\s\S]+MenuGlyph\.Arrow/)
  assert.match(source, /OnRenderMenuItemBackground[\s\S]+item\.Selected[\s\S]+RoundedRectangle[\s\S]+selectedColor[\s\S]+FillPath/)
  assert.match(source, /ContextMenuStrip\s*=\s*trayMenu/)
  assert.match(source, /trayIcon\.MouseUp\s*\+=\s*HandleTrayMouseUp/)
  assert.match(source, /private void HandleTrayMouseUp[\s\S]+eventArgs\.Button\s*==\s*MouseButtons\.Left[\s\S]+RestoreFromTray\(\)/)
  assert.doesNotMatch(source, /eventArgs\.Button\s*==\s*MouseButtons\.Left[\s\S]+ShowTrayMenu/)
  assert.doesNotMatch(source, /trayMenu\.Show\(Cursor\.Position\)/)
  assert.match(source, /检查更新|Check for updates/)
  assert.match(source, /启动时检查更新|Check for updates at startup/)
  assert.match(source, /updateCheckEnabled/)
  assert.match(source, /反馈问题|Report a problem/)
  assert.match(source, /issues\/new\?template=bug-report\.yml/)
  assert.match(source, /check-update", "--scope", scope, "--json", "--force/)
  assert.match(source, /update", "--scope", scope, "--no-browser", "--json", "--progress-json/)
  assert.match(source, /hasRunningSession/)
  assert.match(source, /任务仍在运行|task is still running/i)
  assert.match(source, /现在更新|Update now/)
  assert.match(source, /DSH-Portable 更新|DSH-Portable update/)
  assert.match(source, /官方 DSH|Bundled official DSH/)
  assert.match(source, /稍后|Later/)
  assert.doesNotMatch(source, /item\.Checked\s*=\s*true/)
  assert.doesNotMatch(source, /item\.Tag\s*=\s*"current"/)
  assert.match(source, /SelectedColor/)
  assert.match(source, /ShowCheckMargin\s*=\s*false/)
  assert.doesNotMatch(source, /new Font\(trayMenu\.Font, FontStyle\.Bold\)/)
  assert.match(build, /System\.Web\.Extensions\.dll/)
})

test('Windows task completion notifications are edge-triggered, private, clickable, and user-controlled', async () => {
  const source = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')

  assert.match(source, /public bool completed \{ get; set; \}/)
  assert.match(source, /private bool taskNotificationsEnabled;/)
  assert.match(source, /private bool taskCompletionBaselineReady;/)
  assert.match(source, /Dictionary<string, bool> taskCompletionState/)
  assert.match(source, /taskNotificationsEnabled = LoadTaskNotificationsEnabled\(\);/)
  assert.match(source, /more\.DropDownItems\.Add\(taskNotificationsItem\)/)
  assert.match(
    source,
    /taskNotificationsItem\.Click \+= delegate[\s\S]+taskNotificationsEnabled = !taskNotificationsEnabled;[\s\S]+RefreshTaskNotificationsItem\(\);[\s\S]+SaveLauncherSettings\(\);/,
  )

  const loaderStart = source.indexOf('private bool LoadTaskNotificationsEnabled()')
  const loaderEnd = source.indexOf('\n        private ', loaderStart + 1)
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart)
  const loader = source.slice(loaderStart, loaderEnd)
  assert.match(loader, /Regex\.IsMatch[\s\S]+taskNotificationsEnabled[\s\S]+false/)
  assert.match(loader, /catch \{ return true; \}/, 'missing settings must keep notifications enabled by default')

  const saveStart = source.indexOf('private void SaveLauncherSettings()')
  const saveEnd = source.indexOf('\n        private ', saveStart + 1)
  const save = source.slice(saveStart, saveEnd)
  assert.match(save, /taskNotificationsEnabled/)

  const handlerStart = source.indexOf('private void HandleTaskCompletionNotifications(')
  const handlerEnd = source.indexOf('\n        private ', handlerStart + 1)
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart)
  const handler = source.slice(handlerStart, handlerEnd)
  assert.match(
    handler,
    /if \(!taskCompletionBaselineReady\)[\s\S]+taskCompletionBaselineReady = true;[\s\S]+return;/,
    'the first official state snapshot is a silent baseline',
  )
  assert.match(handler, /taskCompletionState\.TryGetValue\(session\.id, out previouslyCompleted\) && previouslyCompleted/)
  assert.match(handler, /List<TrayBridgeSession> completedThisFrame/)
  assert.match(handler, /session\.completed && !wasCompleted && taskNotificationsEnabled/)
  assert.match(handler, /completedThisFrame\.Add\(session\)/)
  assert.match(handler, /ShowTaskCompletionNotifications\(completedThisFrame\)/)
  assert.match(handler, /taskCompletionState\.Clear\(\)/, 'sessions absent from a later snapshot must lose their old completion bit')

  const notificationStart = source.indexOf('private void ShowTaskCompletionNotifications(')
  const notificationEnd = source.indexOf('\n        private ', notificationStart + 1)
  assert.ok(notificationStart >= 0 && notificationEnd > notificationStart)
  const notification = source.slice(notificationStart, notificationEnd)
  assert.match(notification, /trayIcon\.Visible = true/)
  assert.match(notification, /sessions\.Count == 1/)
  assert.match(notification, /ShowBalloonTip\([\s\S]+MenuTitle\(session\.title\)/)
  assert.match(notification, /sessions\.Count\.ToString/)
  assert.doesNotMatch(notification, /\b(answer|response|cwd|path|log|reason|details)\b/i)
  assert.match(
    source,
    /trayIcon\.BalloonTipClicked \+= delegate[\s\S]+RestoreFromTray\(\);[\s\S]+if \(!String\.IsNullOrEmpty\(sessionId\)\) PostBridgeAction\("open-session", sessionId\);/,
  )
})

test('Windows CI verifies the real tray bridge in a background browser without desktop input', async () => {
  const [smoke, workflow] = await Promise.all([
    readFile(new URL('../scripts/smoke-windows-tray-bridge.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  ])
  assert.match(smoke, /--headless=new/)
  assert.match(smoke, /--remote-debugging-port=\$\{debugPort\}/)
  assert.doesNotMatch(smoke, /--remote-debugging-port=0/)
  assert.match(smoke, /headless Chrome exited before DevTools became ready/)
  assert.match(smoke, /Page\.addScriptToEvaluateOnNewDocument/)
  assert.match(smoke, /dsh-portable\/state/)
  assert.match(smoke, /dsh-portable\/action/)
  assert.match(smoke, /locale.*zh/s)
  assert.match(smoke, /theme.*light/s)
  assert.match(smoke, /portable-cli\.mjs/)
  assert.match(workflow, /smoke-windows-tray-bridge\.mjs/)
})
