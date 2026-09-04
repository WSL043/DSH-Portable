import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'

const sourceUrl = new URL('../desktop-bridge/lib/client.js', import.meta.url)

async function loadBridgeClient(options = {}) {
  const source = await readFile(sourceUrl, 'utf8')
  const posted = []
  const webMessageListeners = new Set()
  let definition
  const nativeListeners = new Set()
  const native = options.native === true ? {
    capabilities: {
      pickDirectory: true,
      saveDataPackage: true,
      openDataPackage: true,
      importData: true,
      restartHost: true,
      preferences: true,
      sessionProjection: true,
    },
    addEventListener(name, listener) {
      if (name === 'message') nativeListeners.add(listener)
    },
    removeEventListener(name, listener) {
      if (name === 'message') nativeListeners.delete(listener)
    },
    postMessage(value) { posted.push(structuredClone(value)) },
  } : undefined
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
  if (native) {
    window.__DSH_PORTABLE_NATIVE__ = native
    delete window.chrome
  }
  vm.runInNewContext(source, { console, queueMicrotask, setTimeout, clearTimeout, window })
  assert.equal(definition?.id, '@wsl043/dsh-portable-desktop-bridge')
  const exports = definition.factory((id) => {
    if (id === 'react') return {}
    throw new Error(`the private bridge imported an unexpected client bundle: ${id}`)
  })
  return {
    exports,
    window,
    posted,
    send(value) {
      for (const listener of webMessageListeners) listener({ data: structuredClone(value) })
      for (const listener of nativeListeners) listener({ data: structuredClone(value) })
    },
  }
}

function fakeContext(initialSessions) {
  let listSnapshot = initialSessions
  const listListeners = new Set()
  const sessionEventListeners = new Map()
  const eventListeners = new Map()
  const opened = []
  const sent = []
  let cleared = 0
  let locale = { active: 'zh', revision: 1 }
  let theme = { active: { colorScheme: 'dark' }, revision: 1 }
  let downloadSnapshot = { bySession: {} }
  const disposers = []
  const slotEntries = []
  let workspaceSnapshot = { items: [], baselinesReady: true, recentWorkspaceId: undefined }
  const workspaceListeners = new Set()
  const createdWorkspaces = []
  const startedWorkspaces = []
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
      scope(id) {
        if (!listSnapshot.byId?.[id] || listSnapshot.byId[id].origin === 'subagent') return undefined
        return { conversation: { async send(text) { sent.push({ sessionId: id, text }) } } }
      },
      binding(id) {
        const item = listSnapshot.byId?.[id]
        if (!item) return undefined
        return {
          session: {
            async prompt(content, mode) {
              sent.push({ sessionId: id, content: structuredClone(content), mode })
              return item.promptResult ?? { ok: true }
            },
          },
          eventSource: {
            getSnapshot: () => ({ entries: item.events ?? [] }),
            subscribe(listener) {
              const listeners = sessionEventListeners.get(id) ?? new Set()
              listeners.add(listener)
              sessionEventListeners.set(id, listeners)
              return () => listeners.delete(listener)
            },
          },
        }
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => workspaceSnapshot,
        subscribe(listener) { workspaceListeners.add(listener); return () => workspaceListeners.delete(listener) },
      },
      async create(input) {
        createdWorkspaces.push(input)
        const workspace = { workspaceId: 'portable-workspace', path: input.path, sessionIds: [] }
        workspaceSnapshot = { ...workspaceSnapshot, items: [workspace], recentWorkspaceId: workspace.workspaceId }
        for (const listener of workspaceListeners) listener()
        return workspace
      },
      startSession(id) { startedWorkspaces.push(id) },
      async pickDirectory() { return 'node-owned-picker' },
    },
    uiWorkspace: {
      startSession(id) { startedWorkspaces.push(id) },
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
    sent,
    get cleared() { return cleared },
    get downloadSnapshot() { return downloadSnapshot },
    slotEntries,
    createdWorkspaces,
    startedWorkspaces,
    setWorkspaces(value) { workspaceSnapshot = value; for (const listener of workspaceListeners) listener() },
    emit(name, value) {
      if (name === 'locale/change') locale = value
      if (name === 'theme/change') theme = value
      for (const listener of eventListeners.get(name) ?? []) listener(value)
    },
    setSessions(value) {
      listSnapshot = value
      for (const listener of listListeners) listener()
    },
    replaceSessionsSilently(value) { listSnapshot = value },
    emitSessionEvent(id) { for (const listener of sessionEventListeners.get(id) ?? []) listener() },
    dispose() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

test('Portable registers its owned workspace only for a truly empty first run', async () => {
  const client = await loadBridgeClient()
  const fresh = fakeContext({ ids: [], byId: {}, current: undefined, phase: 'ready' })
  const created = await client.exports.ensurePortableWorkspace(fresh.ctx, 'C:\\Portable\\workspace')
  assert.equal(created.status, 'created')
  assert.equal(created.workspaceId, 'portable-workspace')
  assert.equal(fresh.createdWorkspaces.length, 1)
  assert.equal(fresh.createdWorkspaces[0].path, 'C:\\Portable\\workspace')
  assert.deepEqual(fresh.startedWorkspaces, ['portable-workspace'])

  const freshWithNullCurrent = fakeContext({ ids: [], byId: {}, current: null, phase: 'ready' })
  freshWithNullCurrent.setWorkspaces({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })
  const createdFromNull = await Promise.race([
    client.exports.ensurePortableWorkspace(freshWithNullCurrent.ctx, 'C:\\Portable\\workspace'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('workspace baseline wait timed out')), 100)),
  ])
  assert.equal(createdFromNull.status, 'created')
  assert.equal(freshWithNullCurrent.createdWorkspaces.length, 1)
  assert.equal(freshWithNullCurrent.createdWorkspaces[0].path, 'C:\\Portable\\workspace')
  assert.deepEqual(freshWithNullCurrent.startedWorkspaces, ['portable-workspace'])

  const existing = fakeContext({ ids: [], byId: {}, current: undefined, phase: 'ready' })
  existing.setWorkspaces({ items: [{ workspaceId: 'user', path: 'D:\\UserProject', sessionIds: [] }], baselinesReady: true, recentWorkspaceId: 'user' })
  assert.equal((await client.exports.ensurePortableWorkspace(existing.ctx, 'C:\\Portable\\workspace')).status, 'preserved')
  assert.deepEqual(existing.createdWorkspaces, [])
  assert.deepEqual(existing.startedWorkspaces, [])
})

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

test('Portable exposes a native restart contract and returns the host decision', async () => {
  const client = await loadBridgeClient()
  const runtime = fakeContext(sessionList(1))
  client.exports.apply(runtime.ctx)

  assert.equal(typeof client.window.__DSH_PORTABLE_HOST__?.restart, 'function')
  const restartPromise = client.window.__DSH_PORTABLE_HOST__.restart()
  const request = client.posted.at(-1)
  assert.equal(request.type, 'dsh-portable/restart-host')
  assert.match(request.requestId, /^host-restart-/)
  client.send({
    type: 'dsh-portable/restart-host-result',
    schemaVersion: 1,
    requestId: request.requestId,
    ok: true,
  })
  assert.equal((await restartPromise).ok, true)

  const refusedPromise = client.window.__DSH_PORTABLE_HOST__.restart()
  const refusedRequest = client.posted.at(-1)
  client.send({
    type: 'dsh-portable/restart-host-result',
    schemaVersion: 1,
    requestId: refusedRequest.requestId,
    ok: false,
    error: 'A task is still running.',
  })
  await assert.rejects(refusedPromise, error => {
    assert.equal(error.code, 'DSH_PORTABLE_RESTART_REJECTED')
    assert.match(error.message, /still running/)
    return true
  })

  const bridgeSource = await readFile(sourceUrl, 'utf8')
  assert.match(bridgeSource, /__DSH_PORTABLE_HOST__\s*=\s*\{\s*restart:\s*restartPortableHost\s*\}/)
  assert.match(bridgeSource, /dsh-portable\/restart-host-result/)
  const windowsHost = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  assert.match(windowsHost, /dsh-portable\/restart-host/)
  assert.match(windowsHost, /trayState != null && trayState\.hasRunningSession/)
  assert.match(windowsHost, /restart-host[\s\S]*request-accepted[\s\S]*reply-posted/)
  assert.match(windowsHost, /if \(restartAfterShutdown\)[\s\S]{0,300}RestartArguments\(\)/)
  assert.match(windowsHost, /private string\[\] RestartArguments\(\)[\s\S]*--dsh-restart-after-pid/)

  runtime.dispose()
  assert.equal(client.window.__DSH_PORTABLE_HOST__, undefined)
})

test('Portable uses one capability-aware host transport outside WebView2', async () => {
  const client = await loadBridgeClient({ native: true })
  const runtime = fakeContext(sessionList(1))
  const original = runtime.ctx.workspaces.pickDirectory

  client.exports.apply(runtime.ctx)
  assert.deepEqual(
    JSON.parse(JSON.stringify(client.window.__DSH_PORTABLE_HOST__?.capabilities)),
    {
      pickDirectory: true,
      saveDataPackage: true,
      openDataPackage: true,
      importData: true,
      restartHost: true,
      openEnvironment: false,
      openUpdate: false,
      preferences: true,
      sessionProjection: true,
    },
  )
  assert.notEqual(runtime.ctx.workspaces.pickDirectory, original)
  assert.equal(client.posted.at(-1).type, 'dsh-portable/state')

  const picked = runtime.ctx.workspaces.pickDirectory()
  const request = client.posted.at(-1)
  assert.equal(request.type, 'dsh-portable/pick-directory')
  client.send({
    type: 'dsh-portable/pick-directory-result',
    schemaVersion: 1,
    requestId: request.requestId,
    path: '/tmp/project',
  })
  assert.equal(await picked, '/tmp/project')

  runtime.dispose()
  assert.equal(client.window.__DSH_PORTABLE_HOST__, undefined)
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
      events: index === count - 2 ? [{
        type: 'event',
        event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `完整回复 ${index}\n第二行` }] } } },
      }] : [],
      pendingInteraction: index === count - 2 ? { kind: 'question', key: `question:${index}` } : undefined,
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

  assert.deepEqual([...client.exports.inject], ['slots', 'locale', 'theme', 'sessions', 'workspaces', 'uiWorkspace', 'sessionLogDownload'])
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
  assert.equal(initial.sessions[1].finalReply, '完整回复 10\n第二行')
  assert.equal(initial.sessions[1].pendingInteraction, 'question')
  assert.equal(initial.sessions[1].pendingInteractionKey, 'question:10')

  runtime.emit('locale/change', { active: 'en', revision: 2 })
  runtime.emit('theme/change', { active: { colorScheme: 'light' }, revision: 2 })
  assert.equal(client.posted.at(-1).locale, 'en')
  assert.equal(client.posted.at(-1).theme, 'light')

  client.send({ type: 'dsh-portable/action', action: 'open-session', sessionId: 'session-9' })
  client.send({ type: 'dsh-portable/action', action: 'open-session', sessionId: 'unknown' })
  client.send({ type: 'dsh-portable/action', action: 'new-session' })
  client.send({ type: 'dsh-portable/action', action: 'reply-session', sessionId: 'session-9', reply: '继续完善' })
  client.send({ type: 'dsh-portable/action', action: 'reply-session', sessionId: 'unknown', reply: '不能误发' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(runtime.opened, ['session-9'])
  assert.equal(runtime.cleared, 1)
  assert.deepEqual(runtime.sent, [{ sessionId: 'session-9', content: [{ type: 'text', text: '继续完善' }], mode: 'queue' }])

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

test('native notifications expose only safely answerable pending interactions and reject stale actions', async () => {
  const client = await loadBridgeClient()
  const answered = []
  const approval = {
    kind: 'approval',
    key: 'approval:7',
    toolName: 'shell',
    reason: '允许执行构建命令？',
    async answer(value) { answered.push({ sessionId: 'approval-session', value }) },
  }
  const question = {
    kind: 'question',
    key: 'question:9',
    questions: [{
      id: 'release-channel',
      question: '选择发布通道',
      options: [
        { label: 'Stable', description: '正式版' },
        { label: 'Preview', description: '预览版' },
      ],
    }],
    async answer(value) { answered.push({ sessionId: 'question-session', value }) },
  }
  const complexQuestion = {
    kind: 'question',
    key: 'question:complex',
    questions: [{ id: 'one', question: '第一题', options: [{ label: 'A' }] }, { id: 'two', question: '第二题' }],
    async answer(value) { answered.push({ sessionId: 'complex-session', value }) },
  }
  const sessions = {
    ids: ['approval-session', 'question-session', 'complex-session'],
    current: '',
    phase: 'ready',
    byId: {
      'approval-session': { id: 'approval-session', displayTitle: '构建任务', updatedAt: 3, running: true, blank: false, pendingInteraction: approval },
      'question-session': { id: 'question-session', displayTitle: '发布任务', updatedAt: 2, running: true, blank: false, pendingInteraction: question },
      'complex-session': { id: 'complex-session', displayTitle: '复杂任务', updatedAt: 1, running: true, blank: false, pendingInteraction: complexQuestion },
    },
  }
  const runtime = fakeContext(sessions)
  client.exports.apply(runtime.ctx)

  const projected = client.posted.at(-1).sessions
  assert.deepEqual(projected[0].pendingInteractionOptions, ['rejected', 'allowed-once'])
  assert.equal(projected[0].pendingInteractionPrompt, '允许执行构建命令？')
  assert.deepEqual(projected[1].pendingInteractionOptions, ['Stable', 'Preview'])
  assert.equal(projected[1].pendingInteractionPrompt, '选择发布通道')
  assert.deepEqual(projected[2].pendingInteractionOptions, [], 'multi-question batches must open in DSH instead of being partially answered')

  client.send({
    type: 'dsh-portable/action', action: 'resolve-interaction', sessionId: 'approval-session',
    activationId: 'a'.repeat(32), interactionKey: 'approval:7', response: 'allowed-once',
  })
  client.send({
    type: 'dsh-portable/action', action: 'resolve-interaction', sessionId: 'approval-session',
    activationId: 'a'.repeat(32), interactionKey: 'approval:7', response: 'allowed-once',
  })
  client.send({
    type: 'dsh-portable/action', action: 'resolve-interaction', sessionId: 'question-session',
    interactionKey: 'question:stale', response: 'Stable',
  })
  client.send({
    type: 'dsh-portable/action', action: 'resolve-interaction', sessionId: 'question-session',
    interactionKey: 'question:9', response: 'Unknown',
  })
  client.send({
    type: 'dsh-portable/action', action: 'resolve-interaction', sessionId: 'question-session',
    activationId: 'b'.repeat(32), interactionKey: 'question:9', response: 'Preview',
  })
  client.send({
    type: 'dsh-portable/action', action: 'resolve-interaction', sessionId: 'question-session',
    activationId: 'b'.repeat(32), interactionKey: 'question:9', response: 'Preview',
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(JSON.parse(JSON.stringify(answered)), [
    { sessionId: 'approval-session', value: 'allowed-once' },
    { sessionId: 'question-session', value: { answers: [{ id: 'release-channel', selected: ['Preview'] }] } },
  ])
  assert.deepEqual(client.posted.filter(item => item.type === 'dsh-portable/notification-action-result'), [
    { type: 'dsh-portable/notification-action-result', activationId: 'a'.repeat(32), terminal: true },
    { type: 'dsh-portable/notification-action-result', activationId: 'b'.repeat(32), terminal: true },
  ])
})

test('notification delivery defers an absent session until the official list is ready', async () => {
  const client = await loadBridgeClient()
  const runtime = fakeContext({ ids: [], byId: {}, current: null, phase: 'loading' })
  client.exports.apply(runtime.ctx)
  const action = {
    type: 'dsh-portable/action', action: 'reply-session', activationId: 'c'.repeat(32),
    sessionId: 'late-session', reply: 'continue',
  }
  client.send(action)
  assert.deepEqual(client.posted.at(-1), {
    type: 'dsh-portable/notification-action-result', activationId: 'c'.repeat(32), terminal: false,
  })
  runtime.setSessions({
    ids: ['late-session'], current: null, phase: 'ready',
    byId: { 'late-session': { id: 'late-session', blank: false, origin: 'user' } },
  })
  runtime.ctx.sessions.scope = () => { throw new Error('conversation is not injected') }
  client.send(action)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(runtime.sent, [{ sessionId: 'late-session', content: [{ type: 'text', text: 'continue' }], mode: 'queue' }])
  assert.deepEqual(client.posted.at(-1), {
    type: 'dsh-portable/notification-action-result', activationId: 'c'.repeat(32), terminal: true,
  })

  runtime.setSessions({
    ids: ['late-session'], current: null, phase: 'ready',
    byId: {
      'late-session': {
        id: 'late-session', blank: false, origin: 'user',
        promptResult: { ok: false, error: { code: 'missing-key', message: 'Missing API key' } },
      },
    },
  })
  client.send({ ...action, activationId: 'd'.repeat(32), reply: 'retry once' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(runtime.sent.at(-1), {
    sessionId: 'late-session', content: [{ type: 'text', text: 'retry once' }], mode: 'queue',
  })
  assert.deepEqual(client.posted.at(-1), {
    type: 'dsh-portable/notification-action-result', activationId: 'd'.repeat(32), terminal: true,
  }, 'a business failure after prompt admission must not be replayed')
})

test('task completion projection follows session events even when the list store does not publish', async () => {
  const client = await loadBridgeClient()
  const initial = sessionList(1)
  initial.byId['session-0'].running = true
  initial.byId['session-0'].completed = false
  initial.byId['session-0'].events = []
  const runtime = fakeContext(initial)
  client.exports.apply(runtime.ctx)

  const completed = structuredClone(initial)
  completed.byId['session-0'].running = false
  completed.byId['session-0'].completed = true
  completed.byId['session-0'].events = [{
    type: 'event',
    event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '后台完成' }] } } },
  }]
  runtime.replaceSessionsSilently(completed)
  runtime.emitSessionEvent('session-0')
  await new Promise(resolve => setImmediate(resolve))

  const projected = client.posted.at(-1)
  assert.equal(projected.sessions[0].completed, true)
  assert.equal(projected.sessions[0].finalReply, '后台完成')
  runtime.dispose()
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
  assert.match(windowsBuild, /shellSchema\s*=\s*25/)
  assert.match(windowsBuild, /requiredShellSchema\s*=\s*25/)
  assert.match(macBuild, /"shellSchema": 20/)
  assert.match(macBuild, /"requiredShellSchema": 20/)
  assert.match(macBuild, /"shellFingerprint": "\$SHELL_FINGERPRINT"/)
  assert.match(macBuild, /"requiredShellFingerprint": "\$SHELL_FINGERPRINT"/)
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

test('Windows task completion notifications use the native action center with exact-session reply and a taskbar badge', async () => {
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
  assert.match(handler, /session\.completed && !wasCompleted/)
  assert.match(handler, /if \(taskNotificationsEnabled\) completedThisFrame\.Add\(session\)/)
  assert.match(handler, /completedThisFrame\.Add\(session\)/)
  assert.match(handler, /ShowTaskCompletionNotifications\(completedThisFrame\)/)
  assert.match(handler, /taskCompletionState\.Clear\(\)/, 'sessions absent from a later snapshot must lose their old completion bit')

  const notificationStart = source.indexOf('private void ShowTaskCompletionNotifications(')
  const notificationEnd = source.indexOf('\n        private ', notificationStart + 1)
  assert.ok(notificationStart >= 0 && notificationEnd > notificationStart)
  const notification = source.slice(notificationStart, notificationEnd)
  assert.match(notification, /trayIcon\.Visible = true/)
  assert.match(notification, /sessions\.Take\(3\)/)
  assert.match(notification, /NativeTaskNotification\.Show/)
  assert.doesNotMatch(source, /TaskCompletionNotification\s*:\s*Form|new\s+TaskCompletionNotification|List<TaskCompletionNotification>/, 'completion alerts must not fall back to a self-drawn WinForms window')
  assert.match(source, /NativeTaskNotification\.Unregister\(\)/, 'native toast activation must be detached during host shutdown')
  assert.doesNotMatch(source, /ToastNotificationManagerCompat\.Uninstall\(\)/, 'stable actionable notifications must not be removed from Action Center when the process exits')
  assert.match(source, /internal static bool TryParseActivation\([\s\S]+IEnumerable<KeyValuePair<string, object>> userInput/, 'activation parsing must be a testable pure function')
  assert.match(source, /response\.Length == 0 \|\| response\.Length > 8000[\s\S]+return false/, 'invalid inline replies must be rejected instead of silently forwarded')
  assert.doesNotMatch(source, /GetMethod\("Add"\)|ToastActivationProbe|ValueSetProbe/, 'activation handling must not depend on the unsafe WinRT probe reflection path')
  assert.match(source, /DeleteSubKeyTree\(aumidPath,\s*false\)/, 'only the product-owned fixed AUMID may be removed directly')
  assert.match(source, /class DshNotificationActivator\s*:\s*NotificationActivator/)
  assert.match(source, /DesktopNotificationManagerCompat\.RegisterAumidAndComServer<DshNotificationActivator>\(AppUserModelId\)/)
  assert.match(source, /DesktopNotificationManagerCompat\.RegisterActivator<DshNotificationActivator>\(\)/)
  assert.match(source, /DesktopNotificationManagerCompat\.CreateToastNotifier\(\)\.Show/)
  assert.doesNotMatch(source, /ToastNotificationManagerCompat\.OnActivated/, 'the transient executable-path identity must not own actionable task notifications')
  assert.match(source, /ToastArguments\.Parse/)
  assert.match(source, /AddInputTextBox\("reply"/)
  assert.match(source, /SetTextBoxId\("reply"\)/)
  assert.match(source, /QueueNotificationAction[\s\S]+PostBridgeReply/)
  assert.match(source, /finalReply/)
  assert.match(source, /reply-session/)
  assert.match(source, /TaskbarList|SetOverlayIcon/)
  assert.match(source, /unreadCompletedSessions/)
  assert.match(source, /AddText\([\s\S]*finalReply/)
  assert.doesNotMatch(source, /Console\.Write.*finalReply|Log.*finalReply/)
  assert.match(source, /MarkTaskCompletionHandled\(sessionId\)[\s\S]+PostBridgeAction\("open-session", sessionId, activationId\)/)
})

test('Windows notifications distinguish background completion from tasks that need attention', async () => {
  const source = (await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  const client = await readFile(sourceUrl, 'utf8')

  assert.match(source, /Dictionary<string, string> taskInteractionState/)
  assert.match(source, /AddArgument\("environmentId", ownerEnvironmentId\)/)
  assert.match(source, /AddArgument\("instanceKey", ownerInstanceKey\)/)
  assert.match(source, /AddArgument\("rootKey", ownerRootKey\)/)
  assert.match(source, /TryResolveTrustedRoot\(envelope\.rootKey/)
  assert.match(source, /AddArgument\("activationId", activationId\)/)
  assert.match(source, /createdAt < now - 604800/)
  assert.match(source, /--dsh-notification-dispatch/)
  assert.match(source, /lock \(activationSync\)[\s\S]+DrainOwnerActivations/)
  assert.match(source, /DrainOwnerActivations\(\)/)
  assert.match(source, /dsh-portable\/notification-action-result/)
  assert.match(client, /notification-action-result/)
  assert.match(source, /File\.WriteAllText\(done, String\.Empty/)
  assert.match(source, /private bool IsCurrentTaskVisibleAndFocused\(TrayBridgeState state, TrayBridgeSession session\)/)

  const handlerStart = source.indexOf('private void HandleTaskCompletionNotifications(')
  const handlerEnd = source.indexOf('\n        private ', handlerStart + 1)
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart)
  const handler = source.slice(handlerStart, handlerEnd)
  assert.match(handler, /IsCurrentTaskVisibleAndFocused\(state, session\)/)
  assert.match(handler, /session\.completed && !wasCompleted && !currentTaskVisible/)
  assert.match(handler, /pendingInteraction[\s\S]+previousInteraction[\s\S]+attentionThisFrame\.Add\(session\)/)
  assert.match(handler, /ShowTaskAttentionNotifications\(attentionThisFrame\)/)

  const completionStart = source.indexOf('internal static bool ShowCompletion(')
  const completionEnd = source.indexOf('\n    }\n\n    internal sealed class DesktopWindowState', completionStart + 1)
  assert.ok(completionStart >= 0 && completionEnd > completionStart)
  const completion = source.slice(completionStart, completionEnd)
  assert.match(completion, /AddInputTextBox\("reply"/)
  assert.match(completion, /SetTextBoxId\("reply"\)/)

  const attentionStart = source.indexOf('internal static bool ShowAttention(')
  const attentionEnd = source.indexOf('\n        internal static bool ShowCompletion(', attentionStart + 1)
  assert.ok(attentionStart >= 0 && attentionEnd > attentionStart)
  const attention = source.slice(attentionStart, attentionEnd)
  assert.match(attention, /Task needs your attention|任务需要你处理/)
  assert.match(attention, /AddArgument\("action", "open"\)/)
  assert.doesNotMatch(attention, /AddInputTextBox|SetTextBoxId/, 'pending interactions must use bounded choices instead of an unsafe free-form answer')
  assert.match(source, /public string pendingInteractionPrompt \{ get; set; \}/)
  assert.match(source, /public List<string> pendingInteractionOptions \{ get; set; \}/)
  assert.match(attention, /resolve-interaction/)
  assert.match(attention, /interactionKey/)
  assert.match(attention, /allowed-once/)
  assert.match(attention, /rejected/)
  assert.match(attention, /pendingInteractionOptions[\s\S]+\.Take\(4\)/)
  assert.match(source, /PostBridgeInteractionAnswer/)
  assert.match(source, /interactionKey[\s\S]+response/)
  assert.match(source, /L\("任务通知", "Task notifications"\)/)
  assert.match(client, /notificationsHint:\s*'任务在后台完成，或等待回答和批准时显示系统通知。'/)
})

test('Portable settings explain when Windows has disabled system notifications', async () => {
  const [server, client] = await Promise.all([
    readFile(new URL('../desktop-bridge/lib/index.js', import.meta.url), 'utf8'),
    readFile(sourceUrl, 'utf8'),
  ])
  assert.match(server, /disabled-system/)
  assert.match(server, /PushNotifications[\s\S]+ToastEnabled/)
  assert.match(client, /Windows 通知已关闭/)
  assert.match(client, /Windows notifications are turned off/)
  assert.match(client, /notificationAvailability/)
})

test('Portable projects update availability and isolated environment context into official shell slots', async () => {
  const client = await readFile(sourceUrl, 'utf8')
  assert.match(client, /slots\.inject\('sidebar\.footer\.action'/)
  assert.match(client, /name:\s*'sidebar\.footer\.action',\s*id:\s*'portable-update'/)
  assert.match(client, /productUpdateCheckEnabled/)
  assert.match(client, /engineUpdateCheckEnabled/)
  assert.match(client, /background:\s*true/)
  assert.match(client, /dsh-portable\/open-update/)
  assert.match(client, /IconDownloadOutline16/)
  assert.match(client, /slots\.inject\('conversation\.hero\.portableContext'/)
  assert.match(client, /name:\s*'conversation\.hero\.portableContext',\s*id:\s*'portable-environment'/)
  assert.match(client, /slots\.inject\('conversation\.session\.header\.utilities'/)
  assert.match(client, /name:\s*'conversation\.session\.header\.utilities',\s*id:\s*'portable-environment'/)
  assert.match(client, /environments\.current\s*===\s*'default'/)
})

test('Windows native smoke exercises the native action-center delivery path and exact-session reply', async () => {
  const smoke = await readFile(new URL('../scripts/smoke-windows-native-tray.ps1', import.meta.url), 'utf8')
  assert.match(smoke, /NativeTaskNotification/)
  assert.match(smoke, /ToastNotificationManagerCompat/)
  assert.match(smoke, /reply/)
  assert.match(smoke, /sessionId/)
  assert.match(smoke, /CopyFromScreen|capture/i)
  assert.match(smoke, /pendingInteraction[\s\S]+approval/)
  assert.match(smoke, /resolve-interaction/)
  assert.match(smoke, /allowed-once/)
  assert.match(smoke, /rejected/)
  assert.match(smoke, /native-task-attention\.png/)
  assert.doesNotMatch(smoke, /TaskCompletionNotification\s*:\s*Form|OnMouseEnter|bodyFull|ReplyRequested/, 'the native smoke must not exercise the removed WinForms notification')
})

test('Windows launcher compiles the stable interactive notification identity against WinRT', async () => {
  const build = await readFile(new URL('../scripts/build-windows.ps1', import.meta.url), 'utf8')
  assert.match(build, /Windows Kits\\10\\UnionMetadata\\Facade\\Windows\.winmd/)
  assert.match(build, /Windows\.Foundation\.UniversalApiContract\.winmd/)
  assert.match(build, /System\.Runtime\.WindowsRuntime\.dll/)
  assert.match(build, /RequiredNotificationReference/)
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
