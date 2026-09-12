import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const sourceUrl = new URL('../desktop-bridge/lib/client.js', import.meta.url)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body } }
}

function invalidJsonResponse({ ok = true, status = 200 } = {}) {
  return { ok, status, async json() { throw new Error('invalid json') } }
}

function sameDependencies(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createReactHarness() {
  let activeRunner = null
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(initial) { return activeRunner.useState(initial) },
    useEffect(effect, dependencies) { return activeRunner.useEffect(effect, dependencies) },
    useRef(initial) { return activeRunner.useRef(initial) },
  }

  function mount(Component) {
    const hooks = []
    let hookIndex = 0
    let pendingEffects = []
    let renderQueued = false
    let tree

    const schedule = () => {
      if (renderQueued) return
      renderQueued = true
      queueMicrotask(() => {
        renderQueued = false
        render()
      })
    }
    const runner = {
      useState(initial) {
        const index = hookIndex++
        if (index >= hooks.length) hooks.push({ kind: 'state', value: typeof initial === 'function' ? initial() : initial })
        const slot = hooks[index]
        return [slot.value, nextValue => {
          const next = typeof nextValue === 'function' ? nextValue(slot.value) : nextValue
          if (Object.is(slot.value, next)) return
          slot.value = next
          schedule()
        }]
      },
      useRef(initial) {
        const index = hookIndex++
        if (index >= hooks.length) hooks.push({ kind: 'ref', current: initial })
        return hooks[index]
      },
      useEffect(effect, dependencies) {
        const index = hookIndex++
        const previous = hooks[index]
        const changed = !previous || !sameDependencies(previous.dependencies, dependencies)
        if (!previous) hooks.push({ kind: 'effect', dependencies, cleanup: null })
        const slot = hooks[index]
        if (!changed) return
        slot.cleanup?.()
        slot.dependencies = dependencies
        pendingEffects.push({ effect, slot })
      },
    }

    function render() {
      hookIndex = 0
      pendingEffects = []
      activeRunner = runner
      tree = Component()
      activeRunner = null
      for (const pending of pendingEffects) {
        const cleanup = pending.effect()
        pending.slot.cleanup = typeof cleanup === 'function' ? cleanup : null
      }
    }

    render()
    return {
      get tree() { return tree },
      unmount() { for (const hook of hooks) hook.cleanup?.() },
    }
  }

  return { React, mount }
}

function findNode(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate)
      if (found) return found
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}

function textContent(node) {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return textContent(node.children || [])
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await new Promise(resolve => setImmediate(resolve))
}

async function loadSettingsComponent(fetchImpl, { nativeMessages = null, page = 'portable-updates', productFetch = null } = {}) {
  const source = await readFile(sourceUrl, 'utf8')
  const harness = createReactHarness()
  const registered = []
  const primitives = Object.fromEntries([
    'Button', 'Input', 'Menu', 'Modal', 'Tooltip',
    'IconChevronDownOutline14', 'IconDownloadOutline16', 'IconFolderOpenOutline16',
  ].map(name => [name, function Primitive() {}]))
  let definition
  let productChannel = 'stable'
  const document = {
    documentElement: { lang: 'en' },
    head: { appendChild() {} },
    getElementById() { return null },
    createElement() { return {} },
  }
  const native = nativeMessages && {
    capabilities: { preferences: true, openUpdate: true },
    postMessage(message) { nativeMessages.push(message) },
    addEventListener() {},
    removeEventListener() {},
  }
  const window = { __ModuleLoader__: { load(value) { definition = value } }, ...(native ? { __DSH_PORTABLE_NATIVE__: native } : {}) }
  vm.runInNewContext(source, {
    console,
    document,
    fetch: async (url, options) => {
      if (url === '/dsh-portable/product-versions') return productFetch ? productFetch(url, options) : jsonResponse({ schemaVersion: 1, current: '', releaseChannel: productChannel, versions: [] })
      const response = await fetchImpl(url, options)
      if (url === '/dsh-portable/settings') {
        const read = response.json.bind(response)
        response.json = async () => { const body = await read(); productChannel = body.settings?.updateChannel || productChannel; return body }
      }
      return response
    },
    queueMicrotask,
    requestAnimationFrame(callback) { callback(); return 0 },
    setTimeout,
    clearTimeout,
    structuredClone,
    window,
  })
  const exports = definition.factory(id => {
    if (id === 'react') return harness.React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected client dependency: ${id}`)
  })
  const ctx = {
    effect: native ? () => {} : undefined,
    locale: { getLocale: () => ({ active: 'en' }) },
    theme: { getTheme: () => ({ active: { colorScheme: 'light' } }) },
    slots: {
      inject(_name, factory) { return factory() },
      register(options, component) {
        const entry = { options, component }
        registered.push(entry)
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  const registration = registered.find(entry => entry.options.id === page)
  assert.ok(registration, 'Portable settings registration is present')
  assert.equal(registration.options.name, 'settings.section', 'Portable owns a settings navigation entry')
  return { harness, mount: () => harness.mount(registration.component) }
}

function settings(updateChannel = 'stable', overrides = {}) {
  return {
    schemaVersion: 2,
    updateChannel,
    updateCheckEnabled: false,
    productUpdateCheckEnabled: false,
    engineUpdateCheckEnabled: false,
    taskNotificationsEnabled: true,
    closeBehavior: 'tray',
    ...overrides,
  }
}

test('core update feedback names the DSH version instead of the Portable version', async () => {
  const nativeMessages = []
  const client = await loadSettingsComponent(async url => {
    if (url === '/dsh-portable/settings') return jsonResponse({ settings: settings('candidate'), versions: { portable: '0.6.4', engine: '0.1.2-rc.1' } })
    if (url === '/dsh-portable/engine-versions') return jsonResponse({ schemaVersion: 1, releaseChannel: 'candidate', versions: [] })
    if (url === '/dsh-portable/check-update') return jsonResponse({ status: 'available', latest: '0.6.4', engineLatest: '0.1.3-alpha.2' })
    throw Error(`unexpected request: ${url}`)
  }, { nativeMessages })
  const mounted = client.mount()
  try {
    await settle()
    const row = findNode(mounted.tree, node => node.type === 'div' && node.children?.length === 2 && textContent(node.children[0]).startsWith('DeepSeek Harness'))
    assert.ok(row)
    const button = findNode(row.children[1], node => typeof node.props?.onClick === 'function')
    button.props.onClick()
    await settle()
    const feedback = findNode(mounted.tree, node => node.props?.role === 'status' && textContent(node).includes('available'))
    assert.match(textContent(feedback), /0\.1\.3-alpha\.2/)
    assert.doesNotMatch(textContent(feedback), /0\.6\.4/)
    const install = findNode(mounted.tree, node => typeof node.props?.onClick === 'function' && textContent(node) === 'Install update')
    assert.ok(install, 'an available update can be installed from settings')
    install.props.onClick()
    assert.equal(nativeMessages.at(-1)?.type, 'dsh-portable/open-update')
    assert.equal(nativeMessages.at(-1)?.scope, 'engine')
  } finally { mounted.unmount() }
})

test('switching channels discards an old update response and its install action', async () => {
  const pending = deferred()
  let channel = 'stable'
  const client = await loadSettingsComponent(async (url, options) => {
    if (url === '/dsh-portable/settings') {
      if (options?.method === 'POST') channel = JSON.parse(options.body).updateChannel || channel
      return jsonResponse({ settings: settings(channel), versions: { portable: '0.6.4', engine: '0.1.2-rc.1' } })
    }
    if (url === '/dsh-portable/engine-versions') return jsonResponse({ schemaVersion: 1, releaseChannel: channel, versions: [] })
    if (url === '/dsh-portable/check-update') return pending.promise
    throw Error(url)
  })
  const mounted = client.mount()
  try {
    await settle()
    findNode(mounted.tree, node => typeof node.props?.onClick === 'function' && textContent(node) === 'Check for updates').props.onClick()
    await settle()
    findNode(mounted.tree, node => node.props?.label === 'Update channel').props.onSelect('candidate')
    await settle()
    pending.resolve(jsonResponse({ status: 'available', latest: '0.6.5' }))
    await settle()
    assert.doesNotMatch(textContent(mounted.tree), /0\.6\.5|Install update/)
  } finally { mounted.unmount() }
})

test('channel catalog state follows the final confirmed save and localizes unavailable versions', async () => {
  const calls = []
  const settingsGet = deferred()
  const saves = []
  const catalogs = []
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options })
    if (url === '/dsh-portable/settings' && !options.method) return settingsGet.promise
    if (url === '/dsh-portable/settings' && options.method === 'POST') {
      const patch = JSON.parse(options.body)
      const request = { patch, channel: patch.updateChannel, response: deferred() }
      saves.push(request)
      return request.response.promise
    }
    if (url === '/dsh-portable/engine-versions') {
      const request = { response: deferred() }
      catalogs.push(request)
      return request.response.promise
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const client = await loadSettingsComponent(fetchImpl)
  const mounted = client.mount()

  assert.equal(calls.filter(call => call.url === '/dsh-portable/engine-versions').length, 0, 'null settings do not load a catalog')
  settingsGet.resolve(jsonResponse({ settings: settings(), versions: { portable: '0.6.3', engine: '0.1.2' } }))
  await settle()
  assert.equal(catalogs.length, 1, 'the catalog loads only after persisted settings arrive')
  catalogs[0].response.resolve(jsonResponse({
    schemaVersion: 1,
    current: '0.1.2',
    releaseChannel: 'stable',
    versions: [{ version: '0.1.2', manifestUrl: '/stable.json', status: 'current' }],
    unavailable: [
      { version: '0.1.1', status: 'core-incompatible', reason: 'core-incompatible', requiredPortableVersion: '0.6.2' },
      { version: '0.1.0', status: 'full-package-required', reason: 'full-package-required', requiredPortableVersion: '0.6.2' },
      { version: '0.0.9', status: 'channel-mismatch', reason: 'channel-mismatch' },
      { version: '0.0.8', status: 'wrong-platform', reason: 'wrong-platform' },
      { version: '0.0.7', status: 'future-status', reason: 'future-status' },
    ],
  }))
  await settle()
  const initialText = textContent(mounted.tree)
  assert.match(initialText, /Version 0\.1\.1: This update package was built for Portable 0\.6\.2 and is not qualified for the current version\./)
  assert.match(initialText, /Version 0\.1\.0: A matching full Portable package is required\./)
  assert.match(initialText, /Version 0\.0\.9: Switch to the candidate channel\./)
  assert.match(initialText, /Version 0\.0\.8: Not available for this system\./)
  assert.match(initialText, /Version 0\.0\.7: Compatibility with this version has not been verified\./)
  assert.doesNotMatch(initialText, /core-incompatible|full-package-required|channel-mismatch|wrong-platform|future-status/)

  let channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  channel.props.onSelect('candidate')
  await settle()
  assert.equal(saves.length, 1)
  assert.equal(saves[0].channel, 'candidate')
  assert.equal(catalogs.length, 1, 'saving a channel does not load its catalog before the POST resolves')
  channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  channel.props.onSelect('stable')
  await settle()
  assert.equal(saves.length, 1, 'the second save waits for the first save')
  assert.doesNotMatch(textContent(mounted.tree), /Unavailable version 0\.1\.1/)

  saves[0].response.resolve(jsonResponse({ settings: settings('candidate') }))
  await settle()
  assert.equal(saves.length, 2, 'the queued save starts after the first response')
  assert.equal(saves[1].channel, 'stable')
  assert.equal(catalogs.length, 1, 'a stale first save response cannot trigger a candidate catalog load')
  saves[1].response.resolve(jsonResponse({ settings: settings('stable') }))
  await settle()
  assert.equal(catalogs.length, 2, 'the final stable confirmation refreshes the catalog even when it was already persisted')
  catalogs[1].response.resolve(jsonResponse({ schemaVersion: 1, current: '0.1.2', releaseChannel: 'stable', versions: [], unavailable: [] }))
  await settle()

  channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  channel.props.onSelect('candidate')
  await settle()
  assert.equal(saves.length, 3)
  saves[2].response.resolve(jsonResponse({ settings: settings('candidate') }))
  await settle()
  assert.equal(catalogs.length, 3, 'a successful channel save triggers the matching catalog load')
  const staleCatalog = catalogs[2]
  channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  channel.props.onSelect('stable')
  await settle()
  assert.equal(saves.length, 4)
  assert.equal(saves[3].channel, 'stable')
  saves[3].response.resolve(jsonResponse({ error: 'stable save failed' }, { ok: false, status: 500 }))
  await settle()
  channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  assert.equal(channel.props.value, 'candidate', 'a latest save failure restores the most recently confirmed channel')
  assert.equal(catalogs.length, 4, 'a failed save also refreshes the restored confirmed channel catalog')
  staleCatalog.response.resolve(jsonResponse({
    schemaVersion: 1,
    current: '0.1.2-candidate',
    releaseChannel: 'candidate',
    versions: [{ version: '0.1.2-candidate', manifestUrl: '/stale.json', status: 'available' }],
    unavailable: [],
  }))
  catalogs[3].response.resolve(jsonResponse({ schemaVersion: 1, current: '0.1.2-candidate', releaseChannel: 'candidate', versions: [], unavailable: [] }))
  await settle()
  assert.doesNotMatch(textContent(mounted.tree), /0\.1\.2-candidate|stale\.json/)
  mounted.unmount()
})

test('channel and non-channel saves stay ordered through startup preference changes', async () => {
  const calls = []
  const saves = []
  const catalogs = []
  const nativeMessages = []
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options })
    if (url === '/dsh-portable/settings' && !options.method) {
      return Promise.resolve(jsonResponse({ settings: settings('stable', { productUpdateCheckEnabled: true }), versions: { portable: '0.6.3', engine: '0.1.2' } }))
    }
    if (url === '/dsh-portable/settings' && options.method === 'POST') {
      const patch = JSON.parse(options.body)
      const request = { patch, response: deferred() }
      saves.push(request)
      return request.response.promise
    }
    if (url === '/dsh-portable/engine-versions') {
      const request = { response: deferred() }
      catalogs.push(request)
      return request.response.promise
    }
    throw new Error(`unexpected request: ${url}`)
  }
  const client = await loadSettingsComponent(fetchImpl, { nativeMessages })
  const mounted = client.mount()
  await settle()
  assert.equal(catalogs.length, 1)
  catalogs[0].response.resolve(jsonResponse({ schemaVersion: 1, current: '0.1.2', releaseChannel: 'stable', versions: [], unavailable: [] }))
  await settle()

  let notifications = findNode(mounted.tree, node => node.props?.label === 'DSH-Portable · Check at startup')
  notifications.props.onSelect('off')
  await settle()
  assert.equal(saves.length, 1)
  assert.deepEqual(saves[0].patch, { productUpdateCheckEnabled: false })

  let channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  channel.props.onSelect('candidate')
  await settle()
  assert.equal(saves.length, 1, 'the channel POST waits for the non-channel POST')
  const checkButton = findNode(mounted.tree, node => node.props?.size === 'sm' && typeof node.props?.onClick === 'function')
  assert.equal(checkButton.props.disabled, true, 'update checks are disabled while settings are saving')
  checkButton.props.onClick()
  await settle()
  assert.equal(calls.filter(call => call.url === '/dsh-portable/check-update').length, 0, 'a pending settings save blocks update checks')
  assert.equal(nativeMessages.length, 0, 'pending responses do not publish to the native host')

  channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  channel.props.onSelect('stable')
  await settle()
  assert.equal(saves.length, 1, 'a quick switch back to stable stays in the same queue')

  saves[0].response.resolve(jsonResponse({ settings: settings('candidate', { productUpdateCheckEnabled: true }) }))
  await settle()
  assert.equal(saves.length, 2)
  assert.deepEqual(saves[1].patch, { updateChannel: 'candidate' })
  notifications = findNode(mounted.tree, node => node.props?.label === 'DSH-Portable · Check at startup')
  assert.equal(notifications.props.value, 'off', 'a stale response does not overwrite the local preference preview')
  assert.equal(nativeMessages.length, 0, 'stale responses do not publish to the native host')

  saves[1].response.resolve(jsonResponse({ settings: settings('candidate', { productUpdateCheckEnabled: true }) }))
  await settle()
  assert.equal(saves.length, 3)
  assert.deepEqual(saves[2].patch, { updateChannel: 'stable' })

  const close = findNode(mounted.tree, node => node.props?.label === 'DeepSeek Harness · Check at startup')
  close.props.onSelect('on')
  await settle()
  assert.equal(saves.length, 3, 'a non-channel save waits behind the return to stable')

  saves[2].response.resolve(jsonResponse({ settings: settings('stable', { productUpdateCheckEnabled: false, engineUpdateCheckEnabled: false }) }))
  await settle()
  assert.equal(saves.length, 4)
  assert.deepEqual(saves[3].patch, { engineUpdateCheckEnabled: true })
  assert.equal(nativeMessages.length, 0, 'intermediate channel responses do not publish to the native host')

  saves[3].response.resolve(jsonResponse({ settings: settings('stable', { productUpdateCheckEnabled: false, engineUpdateCheckEnabled: true }) }))
  await settle()
  channel = findNode(mounted.tree, node => node.props?.label === 'Update channel')
  notifications = findNode(mounted.tree, node => node.props?.label === 'DSH-Portable · Check at startup')
  assert.equal(channel.props.value, 'stable')
  assert.equal(notifications.props.value, 'off')
  assert.equal(catalogs.length, 2, 'the final non-channel response reloads a catalog invalidated by channel switches')
  assert.equal(nativeMessages.length, 1, 'only the final confirmed response is published to the native host')
  assert.equal(nativeMessages[0].updateChannel, 'stable')
  assert.equal(nativeMessages[0].productUpdateCheckEnabled, false)
  assert.equal(nativeMessages[0].engineUpdateCheckEnabled, true)
  catalogs[1].response.resolve(jsonResponse({ schemaVersion: 1, current: '0.1.2', releaseChannel: 'stable', versions: [], unavailable: [] }))
  await settle()

  const closeAgain = findNode(mounted.tree, node => node.props?.label === 'DeepSeek Harness · Check at startup')
  closeAgain.props.onSelect('off')
  await settle()
  assert.equal(saves.length, 5)
  saves[4].response.resolve(jsonResponse({ settings: settings('stable', { productUpdateCheckEnabled: false, engineUpdateCheckEnabled: false }) }))
  await settle()
  assert.equal(catalogs.length, 2, 'a pure non-channel preference save does not reload the catalog')
  assert.equal(nativeMessages.length, 2)
  mounted.unmount()
})

test('engine catalog HTTP and JSON failures surface in the engine status', async () => {
  const failures = [
    { response: invalidJsonResponse() },
    { response: jsonResponse({ error: 'catalog unavailable' }) },
    { response: jsonResponse({}) },
    {
      response: jsonResponse({
        schemaVersion: 1,
        current: '0.1.2',
        releaseChannel: 'candidate',
        versions: [{ version: 'wrong-channel', manifestUrl: '/wrong.json', status: 'available' }],
        unavailable: [],
      }),
      forbiddenVersion: 'wrong-channel',
    },
  ]
  for (const failure of failures) {
    const settingsGet = deferred()
    const catalog = deferred()
    const fetchImpl = (url, options = {}) => {
      if (url === '/dsh-portable/settings' && !options.method) return settingsGet.promise
      if (url === '/dsh-portable/engine-versions') return catalog.promise
      throw new Error(`unexpected request: ${url}`)
    }
    const client = await loadSettingsComponent(fetchImpl)
    const mounted = client.mount()
    settingsGet.resolve(jsonResponse({ settings: settings() }))
    await settle()
    catalog.resolve(failure.response)
    await settle()
    assert.match(textContent(mounted.tree), /Operation failed:/)
    if (failure.forbiddenVersion) assert.doesNotMatch(textContent(mounted.tree), new RegExp(failure.forbiddenVersion))
    mounted.unmount()
  }
})

test('initial settings failures show an error instead of checking forever', async () => {
  const client = await loadSettingsComponent(async url => {
    assert.equal(url, '/dsh-portable/settings')
    return jsonResponse({ error: 'settings unavailable' }, { ok: false, status: 503 })
  })
  const mounted = client.mount()
  await settle()
  assert.match(textContent(mounted.tree), /settings unavailable/)
  mounted.unmount()
})


test('Portable maintenance stays separate from Updates and does not fetch the core catalog', async () => {
  const requests = []
  const client = await loadSettingsComponent(async url => {
    requests.push(url)
    assert.equal(url, '/dsh-portable/settings')
    return jsonResponse({ settings: settings(), versions: { portable: '0.6.4', engine: '0.1.2-rc.1' } })
  }, { page: 'portable' })
  const mounted = client.mount()
  await settle()
  assert.match(textContent(mounted.tree), /Check and repair/)
  assert.equal(findNode(mounted.tree, node => node.props?.label === 'Update channel'), null)
  assert.deepEqual(requests, ['/dsh-portable/settings'])
  mounted.unmount()
})


test('installed core is not shown as an unavailable install target', async () => {
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings(), versions: { portable: '0.6.4', engine: '0.1.2-rc.1' } }
    : { schemaVersion: 1, releaseChannel: 'stable', current: '0.1.2-rc.1', versions: [], unavailable: [
        { version: '0.1.2-rc.1', status: 'requires-full-package' },
        { version: '0.1.3', status: 'requires-full-package' },
      ] }))
  const mounted = client.mount()
  await settle()
  assert.doesNotMatch(textContent(mounted.tree), /Version 0\.1\.2-rc\.1:/)
  assert.match(textContent(mounted.tree), /Version 0\.1\.3:/)
  mounted.unmount()
})


test('Portable version selection sends the exact approved manifest to the desktop host', async () => {
  const messages = []
  const manifestUrl = 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-candidate/portable-update-windows-x64-0.6.5-rc.1.json'
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings('candidate'), versions: { portable: '0.6.4', engine: '0.1.3-alpha.2' } }
    : { schemaVersion: 1, releaseChannel: 'candidate', current: '0.1.3-alpha.2', versions: [], unavailable: [] }), {
    nativeMessages: messages,
    productFetch: async () => jsonResponse({ schemaVersion: 1, releaseChannel: 'candidate', current: '0.6.4', versions: [{ version: '0.6.5-rc.1', manifestUrl }] }),
  })
  const mounted = client.mount()
  await settle()
  const selector = findNode(mounted.tree, node => node.props?.label === 'Portable version')
  assert.deepEqual(Array.from(selector.props.items, item => item.id), ['0.6.4', '0.6.5-rc.1'])
  findNode(mounted.tree, node => textContent(node) === 'Install selected version' && typeof node.props?.onClick === 'function').props.onClick()
  assert.equal(messages.at(-1).scope, 'product')
  assert.equal(messages.at(-1).manifestUrl, manifestUrl)
  mounted.unmount()
})

test('Portable current version remains visible with an empty approved catalog', async () => {
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings('candidate'), versions: { portable: '0.6.5-rc.2', engine: '0.1.5-rc.1' } }
    : { schemaVersion: 1, releaseChannel: 'candidate', current: '0.1.5-rc.1', versions: [], unavailable: [] }))
  const mounted = client.mount()
  await settle()
  const selector = findNode(mounted.tree, node => node.props?.label === 'Portable version')
  assert.equal(selector.props.value, '0.6.5-rc.2')
  assert.deepEqual(Array.from(selector.props.items, item => item.id), ['0.6.5-rc.2'])
  mounted.unmount()
})
