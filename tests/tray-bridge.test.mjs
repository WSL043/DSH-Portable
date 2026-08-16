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
  const exports = definition.factory(() => { throw new Error('the private bridge must not import another client bundle') })
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
  const disposers = []
  const ctx = {
    locale: { getLocale: () => locale },
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

  assert.deepEqual([...client.exports.inject], ['locale', 'theme', 'sessions'])
  client.exports.apply(runtime.ctx)

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
  assert.match(windowsBuild, /shellSchema\s*=\s*8/)
  assert.match(windowsBuild, /requiredShellSchema\s*=\s*8/)
  assert.match(macBuild, /"shellSchema": 8/)
  assert.match(macBuild, /"requiredShellSchema": 8/)
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
    await writeFile(path.join(first, 'app', 'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'package.json'), '{}\n')
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

test('Windows tray consumes official projected state and keeps a bounded native fallback menu', async () => {
  const source = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  const build = await readFile(new URL('../scripts/build-windows.ps1', import.meta.url), 'utf8')
  assert.match(source, /WebMessageReceived/)
  assert.match(source, /WebMessageAsJson/)
  assert.match(source, /PostWebMessageAsJson/)
  assert.match(source, /dsh-portable\/state/)
  assert.match(source, /open-session/)
  assert.match(source, /new-session/)
  assert.match(source, /Take\(3\)/)
  assert.match(source, /ShortcutKeyDisplayString/)
  assert.match(source, /More|更多/)
  assert.match(source, /DshMenuColorTable/)
  assert.match(source, /检查更新|Check for updates/)
  assert.match(source, /启动时检查更新|Check for updates at startup/)
  assert.match(source, /updateCheckEnabled/)
  assert.match(source, /反馈问题|Report a problem/)
  assert.match(source, /issues\/new\?template=bug-report\.yml/)
  assert.match(source, /check-update", "--json", "--force/)
  assert.match(source, /hasRunningSession/)
  assert.match(source, /任务仍在运行|task is still running/i)
  assert.match(source, /现在更新|Update now/)
  assert.match(source, /稍后|Later/)
  assert.match(source, /item\.Checked\s*=\s*true/)
  assert.doesNotMatch(source, /new Font\(trayMenu\.Font, FontStyle\.Bold\)/)
  assert.match(build, /System\.Web\.Extensions\.dll/)
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
