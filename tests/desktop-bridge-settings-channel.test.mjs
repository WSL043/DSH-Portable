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

function visibleTextContent(node) {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(visibleTextContent).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node.type === 'details' && !node.props?.open) return visibleTextContent(node.children?.[0] ?? [])
  return visibleTextContent(node.children || [])
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await new Promise(resolve => setImmediate(resolve))
}

async function loadSettingsComponent(fetchImpl, { nativeMessages = null, nativeFileUpdates = true, page = 'portable-updates', productFetch = null, webCacheHost = null, modernIcons = false, lang = 'en' } = {}) {
  const source = await readFile(sourceUrl, 'utf8')
  const harness = createReactHarness()
  const registered = []
  const primitives = Object.fromEntries([
    'Button', 'Input', 'Menu', 'Modal', 'Tooltip',
    'IconChevronDownOutline14', 'IconDownloadOutline16', 'IconFolderOpenOutline16',
  ].map(name => [name, function Primitive() {}]))
  if (modernIcons) {
    for (const name of ['IconChevronDownOutline14', 'IconDownloadOutline16', 'IconFolderOpenOutline16']) {
      primitives[name.replace(/\d+$/, 'Regular')] = primitives[name]
      delete primitives[name]
    }
  }
  let definition
  let productChannel = 'stable'
  const document = {
    documentElement: { lang },
    head: { appendChild() {} },
    getElementById() { return null },
    createElement() { return {} },
  }
  const native = nativeMessages && {
    capabilities: { preferences: true, openUpdate: true, openUpdateFromFile: nativeFileUpdates },
    postMessage(message) { nativeMessages.push(message) },
    addEventListener() {},
    removeEventListener() {},
  }
  const pageListeners = new Map()
  const window = { __ModuleLoader__: { load(value) { definition = value } }, ...(native ? { __DSH_PORTABLE_NATIVE__: native } : {}),
    addEventListener(name, listener) {
      if (!pageListeners.has(name)) pageListeners.set(name, new Set())
      pageListeners.get(name).add(listener)
    },
    removeEventListener(name, listener) { pageListeners.get(name)?.delete(listener) },
  }
  if (webCacheHost) Object.assign(window, { __DSH_PORTABLE_WEB_CACHE__: true, chrome: { webview: webCacheHost } })
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
    effect: (native || webCacheHost) ? () => {} : undefined,
    locale: { getLocale: () => ({ active: lang }) },
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
  return { harness, mount: () => harness.mount(registration.component), pageListeners,
    pageEvent(name) { for (const listener of pageListeners.get(name) ?? []) listener() },
  }
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

test('alpha7 regular artwork still registers and renders Portable settings', async () => {
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings(), versions: { portable: '0.7.0-beta.3', engine: '0.1.7-alpha.1' } }
    : { schemaVersion: 1, releaseChannel: 'stable', versions: [], unavailable: [] }), { modernIcons: true })
  const mounted = client.mount()
  try {
    await settle()
    assert.match(textContent(mounted.tree), /0\.1\.7-alpha\.1/)
  } finally { mounted.unmount() }
})

test('update from file opens the native review for the selected scope without checking a feed', async () => {
  for (const [nativeMessages, nativeFileUpdates] of [[[], true], [[], false], [null, false]]) {
    let requests = 0
    const client = await loadSettingsComponent(async url => {
      requests++
      return jsonResponse(url === '/dsh-portable/settings'
        ? { settings: settings(), versions: { portable: '0.9.4', engine: '0.1.7-alpha.7' } }
        : { schemaVersion: 1, releaseChannel: 'stable', versions: [], unavailable: [] })
    }, { nativeMessages, nativeFileUpdates })
    const mounted = client.mount()
    try {
      await settle()
      const before = requests
      for (const [scope, title] of [['product', 'DSH-Portable'], ['engine', 'DeepSeek Harness']]) {
        const row = findNode(mounted.tree, node => node.type === 'section' && node.props['aria-label'] === title)
        const button = findNode(row, node => typeof node.props?.onClick === 'function' && textContent(node) === 'Update from file')
        if (!nativeFileUpdates) {
          assert.equal(button, null, 'old shells and browser hosts cannot silently fall back to an online update')
          continue
        }
        assert.ok(button)
        button.props.onClick()
        await settle()
        if (nativeMessages) assert.deepEqual(JSON.parse(JSON.stringify(nativeMessages.at(-1))), {
          type: 'dsh-portable/open-update', schemaVersion: 1, scope, offline: true,
        })
      }
      assert.equal(requests, before)
    } finally { mounted.unmount() }
  }
})

test('delayed product catalogs never insert empty-state text into the selector row', async () => {
  for (const additionalVersions of [[], [{ version: '0.6.8' }]]) {
    const pending = deferred()
    const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
      ? { settings: settings(), versions: { portable: '0.6.9', engine: '0.1.5-rc.2' } }
      : { schemaVersion: 1, releaseChannel: 'stable', versions: [], unavailable: [] }), {
      productFetch: () => pending.promise,
    })
    const mounted = client.mount()
    const hint = 'No other qualified versions are available.'
    const selectorRow = () => findNode(mounted.tree, node => node.children?.some(child => child?.props?.label === 'Portable version'))
    try {
      await settle()
      assert.ok(!textContent(mounted.tree).includes(hint), 'loading is not an empty result')
      assert.equal(selectorRow().children.length, 2)
      pending.resolve(jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: '0.6.9', versions: [{ version: '0.6.9' }, ...additionalVersions] }))
      await settle()
      assert.equal(textContent(mounted.tree).includes(hint), additionalVersions.length === 0)
      assert.equal(selectorRow().children.length, 2, 'the label and selector retain their two-column layout')
      assert.ok(!textContent(selectorRow()).includes(hint), 'empty-state text has its own row')
    } finally { mounted.unmount() }
  }
})

test('core update feedback names the DSH version instead of the Portable version', async () => {
  const nativeMessages = []
  const client = await loadSettingsComponent(async url => {
    if (url === '/dsh-portable/settings') return jsonResponse({ settings: settings('candidate'), versions: { portable: '0.6.4', engine: '0.1.2-rc.1' } })
    if (url === '/dsh-portable/engine-versions') return jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', versions: [] })
    if (url === '/dsh-portable/check-update') return jsonResponse({ status: 'available', latest: '0.6.4', engineLatest: '0.1.3-alpha.2' })
    throw Error(`unexpected request: ${url}`)
  }, { nativeMessages, productFetch: async () => jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: '0.6.4', versions: [] }) })
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

test('legacy candidate preferences are silently normalized and the selector is absent', async () => {
  const requested = []
  const client = await loadSettingsComponent(async url => {
    requested.push(url)
    if (url === '/dsh-portable/settings') return jsonResponse({ settings: settings('candidate'), versions: { portable: '0.6.4', engine: '0.1.2-rc.1' } })
    if (url === '/dsh-portable/engine-versions') return jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', versions: [], unavailable: [] })
    throw Error(url)
  })
  const mounted = client.mount()
  try {
    await settle()
    assert.ok(requested.includes('/dsh-portable/engine-versions'))
    assert.equal(findNode(mounted.tree, node => node.props?.label === 'Update channel'), null)
    assert.doesNotMatch(textContent(mounted.tree), /Update channel|Candidate \(Alpha \/ Beta \/ RC\)/i)
  } finally { mounted.unmount() }
})

test('single-channel catalog state keeps unavailable versions collapsed and localized', async () => {
  const client = await loadSettingsComponent(async url => {
    if (url === '/dsh-portable/settings') return jsonResponse({ settings: settings('candidate'), versions: { portable: '0.6.3', engine: '0.1.2' } })
    if (url === '/dsh-portable/engine-versions') return jsonResponse({
      schemaVersion: 1, current: '0.1.2', releaseChannel: 'stable',
      versions: [{ version: '0.1.2', manifestUrl: '/stable.json', status: 'current' }],
      unavailable: [
        { version: '0.1.1', status: 'core-incompatible', requiredPortableVersion: '0.6.2' },
        { version: '0.1.0', status: 'full-package-required', requiredPortableVersion: '0.6.2' },
        { version: '0.1.05', status: 'core-awaiting-qualification', requiredPortableVersion: '0.6.2' },
        { version: '0.0.8', status: 'wrong-platform' },
        { version: '0.0.7', status: 'future-status' },
      ],
    })
    throw Error(url)
  })
  const mounted = client.mount()
  try {
    await settle()
    const details = findNode(mounted.tree, node => node.type === 'details')
    assert.ok(details)
    assert.equal(details.props.open, undefined, 'unavailable reasons are collapsed by default')
    assert.match(visibleTextContent(mounted.tree), /5 newer core version\(s\) cannot be selected yet; open to see why\./)
    assert.doesNotMatch(visibleTextContent(mounted.tree), /Version 0\.1\.1:/)
    const selector = findNode(mounted.tree, node => node.props?.label === 'Engine version')
    assert.deepEqual(Array.from(selector.props.items, item => item.id), ['0.1.2'])
    details.props.open = true
    const expanded = visibleTextContent(mounted.tree)
    assert.match(expanded, /Version 0\.1\.1: Update Portable to 0\.6\.2 first to use this core version\./)
    assert.match(expanded, /Version 0\.1\.0: A matching full Portable package is required\./)
    assert.match(expanded, /Version 0\.1\.05: The new core must pass testing before it can be used with this Portable\. You do not need to do anything/)
    assert.match(expanded, /Version 0\.0\.8: Not available for this system\./)
    assert.match(expanded, /Version 0\.0\.7: Compatibility with this version has not been verified\./)
    assert.doesNotMatch(expanded, /core-incompatible|core-awaiting-qualification|full-package-required|wrong-platform|future-status/)
  } finally { mounted.unmount() }
})

test('core versions list newest first, mark the current one, and label official test builds', async () => {
  const client = await loadSettingsComponent(async url => {
    if (url === '/dsh-portable/settings') return jsonResponse({ settings: settings('stable'), versions: { portable: '0.8.6', engine: '0.2.0-rc.2' } })
    if (url === '/dsh-portable/engine-versions') return jsonResponse({
      schemaVersion: 1, current: '0.2.0-rc.2', releaseChannel: 'stable',
      versions: [
        { version: '0.2.0-rc.2', manifestUrl: '/rc2.json', status: 'current' },
        { version: '0.2.1-alpha.1', manifestUrl: '/alpha1.json', status: 'available' },
        { version: '0.2.0-rc.1', manifestUrl: '/rc1.json', status: 'available' },
      ],
      unavailable: [],
    })
    throw Error(url)
  })
  const mounted = client.mount()
  try {
    await settle()
    const selector = findNode(mounted.tree, node => node.props?.label === 'Engine version')
    assert.deepEqual(Array.from(selector.props.items, item => item.id), ['0.2.1-alpha.1', '0.2.0-rc.2', '0.2.0-rc.1'])
    assert.deepEqual(Array.from(selector.props.items, item => item.label),
      ['0.2.1-alpha.1 (official test build)', '0.2.0-rc.2 (current)', '0.2.0-rc.1'])
  } finally { mounted.unmount() }
})

test('non-channel preference saves remain ordered and do not reload the stable catalog', async () => {
  const calls = []
  const saves = []
  const catalogs = []
  const nativeMessages = []
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options })
    if (url === '/dsh-portable/settings' && !options.method) return Promise.resolve(jsonResponse({ settings: settings('candidate', { productUpdateCheckEnabled: true }), versions: { portable: '0.6.3', engine: '0.1.2' } }))
    if (url === '/dsh-portable/settings' && options.method === 'POST') {
      const request = { patch: JSON.parse(options.body), response: deferred() }
      saves.push(request)
      return request.response.promise
    }
    if (url === '/dsh-portable/engine-versions') { const request = { response: deferred() }; catalogs.push(request); return request.response.promise }
    if (url === '/dsh-portable/check-update') return Promise.resolve(jsonResponse({ status: 'current' }))
    throw new Error(`unexpected request: ${url}`)
  }
  const client = await loadSettingsComponent(fetchImpl, { nativeMessages })
  const mounted = client.mount()
  await settle()
  assert.equal(catalogs.length, 1)
  catalogs[0].response.resolve(jsonResponse({ schemaVersion: 1, current: '0.1.2', releaseChannel: 'stable', versions: [], unavailable: [] }))
  await settle()
  findNode(mounted.tree, node => node.props?.label === 'DSH-Portable · Check at startup').props.onSelect('off')
  await settle()
  assert.deepEqual(saves[0].patch, { productUpdateCheckEnabled: false })
  const checkButton = findNode(mounted.tree, node => node.props?.size === 'sm' && typeof node.props?.onClick === 'function')
  assert.equal(checkButton.props.disabled, true)
  checkButton.props.onClick()
  await settle()
  assert.equal(calls.filter(call => call.url === '/dsh-portable/check-update').length, 0, 'a pending settings save blocks update checks')
  findNode(mounted.tree, node => node.props?.label === 'DeepSeek Harness · Check at startup').props.onSelect('on')
  await settle()
  assert.equal(saves.length, 1, 'the second preference save waits behind the first')
  saves[0].response.resolve(jsonResponse({ settings: settings('candidate', { productUpdateCheckEnabled: true, engineUpdateCheckEnabled: false }) }))
  await settle()
  assert.equal(saves.length, 2)
  assert.deepEqual(saves[1].patch, { engineUpdateCheckEnabled: true })
  saves[1].response.resolve(jsonResponse({ settings: settings('candidate', { productUpdateCheckEnabled: false, engineUpdateCheckEnabled: true }) }))
  await settle()
  assert.equal(catalogs.length, 1, 'preference saves do not refresh the stable catalog')
  assert.equal(nativeMessages.length, 1)
  assert.equal(nativeMessages[0].updateChannel, 'stable', 'legacy candidate responses are normalized before reaching native code')
  assert.equal(nativeMessages[0].productUpdateCheckEnabled, false)
  assert.equal(nativeMessages[0].engineUpdateCheckEnabled, true)
  assert.equal(findNode(mounted.tree, node => node.props?.label === 'Update channel'), null)
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
    assert.match(textContent(mounted.tree), /Operation failed:|The update service is unavailable/)
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

test('Portable maintenance reports an incomplete doctor result', async () => {
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/doctor'
    ? {}
    : { settings: settings(), versions: {} }), { page: 'portable' })
  const mounted = client.mount()
  try {
    await settle()
    const check = findNode(mounted.tree, node => typeof node.props?.onClick === 'function' && textContent(node) === 'Run check')
    assert.ok(check)
    check.props.onClick()
    await settle()
    const content = textContent(mounted.tree)
    assert.match(content, /incomplete result/)
    assert.doesNotMatch(content, /No issues found/)
  } finally { mounted.unmount() }
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


test('an empty unavailable-core list does not render a summary row', async () => {
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings(), versions: { portable: '0.6.4', engine: '0.1.2' } }
    : { schemaVersion: 1, releaseChannel: 'stable', current: '0.1.2', versions: [], unavailable: [] }))
  const mounted = client.mount()
  await settle()
  assert.equal(findNode(mounted.tree, node => node.type === 'details'), null)
  assert.doesNotMatch(visibleTextContent(mounted.tree), /newer core version\(s\) cannot be selected yet/)
  mounted.unmount()
})


test('unavailable-core summary is localized in Chinese', async () => {
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings(), versions: { portable: '0.6.4', engine: '0.1.2' } }
    : { schemaVersion: 1, releaseChannel: 'stable', current: '0.1.2', versions: [], unavailable: [
        { version: '0.1.1', status: 'core-awaiting-qualification' },
      ] }), { lang: 'zh-CN' })
  const mounted = client.mount()
  await settle()
  const details = findNode(mounted.tree, node => node.type === 'details')
  assert.ok(details)
  assert.equal(textContent(details.children[0]), '另有 1 个更新的内核版本暂时不能选，点开看原因')
  assert.equal(visibleTextContent(details), '另有 1 个更新的内核版本暂时不能选，点开看原因')
  mounted.unmount()
})


test('Portable version selection sends the exact approved stable manifest to the desktop host', async () => {
  const messages = []
  const manifestUrl = 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-update-windows-x64-0.6.5.json'
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings('candidate'), versions: { portable: '0.6.4', engine: '0.1.3-alpha.2' } }
    : { schemaVersion: 1, releaseChannel: 'stable', current: '0.1.3-alpha.2', versions: [], unavailable: [] }), {
    nativeMessages: messages,
    productFetch: async () => jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: '0.6.4', versions: [{ version: '0.6.5', manifestUrl }] }),
  })
  const mounted = client.mount()
  await settle()
  const selector = findNode(mounted.tree, node => node.props?.label === 'Portable version')
  assert.deepEqual(Array.from(selector.props.items, item => item.id), ['0.6.4', '0.6.5'])
  assert.equal(selector.props.value, '0.6.4')
  assert.equal(selector.props.items[0].label, '0.6.4 (current)')
  selector.props.onSelect('0.6.5')
  await settle()
  findNode(mounted.tree, node => textContent(node) === 'Install 0.6.5' && typeof node.props?.onClick === 'function').props.onClick()
  assert.equal(messages.at(-1).scope, 'product')
  assert.equal(messages.at(-1).manifestUrl, manifestUrl)
  mounted.unmount()
})

test('an installed Portable absent from the feed is not implicitly downgraded', async () => {
  const messages = [], checks = []
  const manifestUrl = 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-update-windows-x64-0.9.4.json'
  const client = await loadSettingsComponent(async (url, options) => {
    if (url === '/dsh-portable/settings') return jsonResponse({ settings: settings(), versions: { portable: '0.9.5', engine: '0.2.1-rc.2' } })
    if (url === '/dsh-portable/check-update') {
      checks.push(JSON.parse(options.body))
      return jsonResponse({ status: 'current' })
    }
    return jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: '0.2.1-rc.2', versions: [], unavailable: [] })
  }, {
    lang: 'zh', nativeMessages: messages,
    productFetch: async () => jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: '0.9.5', versions: [{ version: '0.9.4', manifestUrl }] }),
  })
  const mounted = client.mount()
  try {
    await settle()
    const selector = findNode(mounted.tree, node => node.props?.label === 'Portable 版本')
    assert.equal(selector.props.value, '0.9.5')
    assert.deepEqual(Array.from(selector.props.items, item => [item.id, item.label]), [['0.9.5', '0.9.5（当前）'], ['0.9.4', '0.9.4']])
    const product = () => findNode(mounted.tree, node => node.type === 'section' && node.props?.['aria-label'] === 'DSH-Portable')
    assert.doesNotMatch(textContent(product()), /所选 Portable 比当前的旧/)
    findNode(product(), node => textContent(node) === '检查更新' && typeof node.props?.onClick === 'function').props.onClick()
    await settle()
    assert.deepEqual(checks, [{ scope: 'product' }])
    assert.equal(messages.length, 0, 'the default action checks normally instead of opening an older manifest')
    selector.props.onSelect('0.9.4')
    await settle()
    assert.match(textContent(product()), /所选 Portable 比当前的旧/)
    findNode(product(), node => textContent(node) === '安装 0.9.4' && typeof node.props?.onClick === 'function').props.onClick()
    assert.equal(messages.at(-1).scope, 'product')
    assert.equal(messages.at(-1).manifestUrl, manifestUrl, 'explicit historical selection keeps the existing approved-manifest path')
  } finally { mounted.unmount() }
})

test('a listed current Portable is marked without adding a duplicate option', async () => {
  const client = await loadSettingsComponent(async url => jsonResponse(url === '/dsh-portable/settings'
    ? { settings: settings(), versions: { portable: '0.9.4', engine: '0.2.1-rc.2' } }
    : { schemaVersion: 1, releaseChannel: 'stable', current: '0.2.1-rc.2', versions: [], unavailable: [] }), {
    productFetch: async () => jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: '0.9.4', versions: [{ version: '0.9.5' }, { version: '0.9.4' }] }),
  })
  const mounted = client.mount()
  try {
    await settle()
    const selector = findNode(mounted.tree, node => node.props?.label === 'Portable version')
    assert.equal(selector.props.value, '0.9.4')
    assert.deepEqual(Array.from(selector.props.items, item => [item.id, item.label]), [['0.9.5', '0.9.5'], ['0.9.4', '0.9.4 (current)']])
  } finally { mounted.unmount() }
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

test('web cache maintenance requires host support and waits for the matching native result', async () => {
  const listeners = new Set(), sent = []
  const bridge = { addEventListener(_, fn) { listeners.add(fn) }, removeEventListener(_, fn) { listeners.delete(fn) }, postMessage(message) { sent.push(message) } }
  const fetchSettings = async () => jsonResponse({ settings: settings(), versions: {} })
  const oldClient = await loadSettingsComponent(fetchSettings, { page: 'portable' })
  const old = oldClient.mount()
  await settle()
  assert.equal(findNode(old.tree, n => n.props?.items?.some(i => i.id === 'web-cache')), null)
  old.unmount()
  const client = await loadSettingsComponent(fetchSettings, { page: 'portable', webCacheHost: bridge })
  const mounted = client.mount()
  try {
    await settle()
    const menu = findNode(mounted.tree, n => n.props?.items?.some(i => i.id === 'web-cache'))
    assert.ok(menu)
    menu.props.onSelect('web-cache')
    await settle()
    for (const fn of listeners) fn({ data: { type: 'dsh-portable/clear-web-cache-result', requestId: 'other', ok: true } })
    await settle()
    assert.ok(!textContent(mounted.tree).includes('Web cache cleared.'))
    for (const fn of [...listeners]) fn({ data: { type: 'dsh-portable/clear-web-cache-result', requestId: sent[0].requestId, ok: true } })
    await settle()
    assert.ok(textContent(mounted.tree).includes('Web cache cleared.'))
    assert.equal(listeners.size, 0)
    assert.equal(client.pageListeners.get('pagehide').size, 0)

    menu.props.onSelect('web-cache')
    await settle()
    const abandoned = sent.at(-1)
    client.pageEvent('pagehide')
    await settle()
    assert.equal(listeners.size, 0)
    assert.equal(client.pageListeners.get('pagehide').size, 0)
    assert.ok(!textContent(mounted.tree).includes('Web cache cleared.'))
    assert.ok(!textContent(mounted.tree).includes('Operation failed:'))

    menu.props.onSelect('web-cache')
    await settle()
    const next = sent.at(-1)
    for (const fn of [...listeners]) fn({ data: { type: 'dsh-portable/clear-web-cache-result', requestId: abandoned.requestId, ok: true } })
    await settle()
    assert.ok(!textContent(mounted.tree).includes('Web cache cleared.'))
    for (const fn of [...listeners]) fn({ data: { type: 'dsh-portable/clear-web-cache-result', requestId: next.requestId, ok: true } })
    await settle()
    assert.ok(textContent(mounted.tree).includes('Web cache cleared.'))
    assert.equal(listeners.size, 0)
    assert.equal(client.pageListeners.get('pagehide').size, 0)
  } finally { mounted.unmount() }
})

test('Portable export options live in the export dialog and HTTP failure keeps it open', async () => {
  const exports = []
  const client = await loadSettingsComponent(async (url, options) => {
    if (url === '/dsh-portable/data-export') { exports.push(JSON.parse(options.body)); return jsonResponse({}, { ok: false, status: 503 }) }
    return jsonResponse({ settings: settings(), versions: {} })
  }, { page: 'portable' })
  const mounted = client.mount()
  try {
    await settle()
    const sections = mounted.tree.children.filter(n => n?.type === 'section').map(n => n.props['aria-label'])
    assert.deepEqual(sections, ['Desktop behavior', 'Data', 'Maintenance', 'Help and feedback'])
    const feedback = findNode(mounted.tree, n => n.type === 'a' && n.props?.href === 'https://github.com/WSL043/DSH-Portable/issues/new/choose')
    assert.ok(feedback)
    assert.equal(feedback.props.rel, 'noopener noreferrer')
    assert.equal(findNode(mounted.tree, n => n.props?.label === 'Export scope'), null)
    const button = findNode(mounted.tree, n => typeof n.props?.onClick === 'function' && textContent(n) === 'Export data')
    assert.ok(button)
    button.props.onClick(); await settle()
    const modal = findNode(mounted.tree, n => n.props?.title === 'Export data' && n.props?.footer)
    assert.ok(modal)
    const choices = []
    const walk = n => { if (!n || typeof n !== 'object') return; if (n.props?.items) choices.push(n); for (const c of n.children || []) Array.isArray(c) ? c.forEach(walk) : walk(c) }
    walk(modal)
    const formatChoice = choices.find(n => n.props.items.some(i => i.id === 'private'))
    assert.equal(formatChoice.props.value, 'private', 'exports are password-encrypted unless the user picks a plain file')
    assert.ok(textContent(modal).includes('Not encrypted') === false)
    choices.find(n => n.props.items.some(i => i.id === 'data-only')).props.onSelect('data-only')
    formatChoice.props.onSelect('standard')
    await settle()
    const updated = findNode(mounted.tree, n => n.props?.title === 'Export data' && n.props?.footer)
    findNode(updated.props.footer, n => typeof n.props?.onClick === 'function' && textContent(n) === 'Continue').props.onClick()
    await settle()
    assert.equal(exports[0].scope, 'data-only')
    assert.equal(exports[0].kind, 'standard')
    assert.ok(findNode(mounted.tree, n => n.props?.title === 'Export data' && n.props?.footer))
    assert.ok(textContent(mounted.tree).includes('HTTP 503'))
  } finally { mounted.unmount() }
})

test('desktop settings render while supplementary notification status is pending', async () => {
  const pending = deferred(); let notificationRequests = 0
  const client = await loadSettingsComponent(async url => {
    if (url === '/dsh-portable/notification-status') { notificationRequests++; return pending.promise }
    return jsonResponse({ settings: settings(), versions: {}, notificationAvailability: { status: 'unknown' } })
  }, { page: 'portable' })
  const mounted = client.mount()
  try {
    await settle()
    assert.ok(textContent(mounted.tree).includes('Migration and backup'))
    assert.equal(notificationRequests, 1)
    pending.resolve(jsonResponse({ status: 'disabled-system' }))
    await settle()
    assert.ok(textContent(mounted.tree).includes('Windows notifications are turned off.'))
  } finally { mounted.unmount() }
})

const mountUpdates = async (body, extra = {}) => {
  const client = await loadSettingsComponent(async url => {
    if (url === '/dsh-portable/settings') return jsonResponse({ settings: settings(), ...body })
    if (url === '/dsh-portable/engine-versions') return extra.engine ?? jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: body.versions?.engine, versions: [] })
    throw Error(`unexpected request: ${url}`)
  }, { productFetch: async () => jsonResponse({ schemaVersion: 1, releaseChannel: 'stable', current: body.versions?.portable, versions: [] }) })
  const mounted = client.mount()
  await settle()
  return mounted
}

test('the rolled-back notice only describes the program that is running and fades with time', async () => {
  const rolled = (restoredVersion, recordedAt) => ({ lastUpdate: { status: 'rolled-back', restoredVersion, recordedAt } })
  const now = new Date().toISOString()
  for (const [running, record, shown] of [
    ['0.8.17', rolled('0.8.17', now), true],
    ['0.8.18', rolled('0.8.17', now), false],
    ['0.8.17', rolled('0.8.17', '2020-01-01T00:00:00Z'), false],
  ]) {
    const mounted = await mountUpdates({ versions: { portable: running, engine: '0.2.0-rc.2' }, ...record })
    try { assert.equal(textContent(mounted.tree).includes('automatically restored'), shown) } finally { mounted.unmount() }
  }
})

test('after an update that could not bring back the chosen core, the updates page says why', async () => {
  const mounted = await mountUpdates({ versions: { portable: '0.8.17', engine: '0.2.0-rc.2' }, coreRestore: { preferredCore: '0.2.1-alpha.2', status: 'awaiting-qualification' } })
  try {
    const text = textContent(mounted.tree)
    assert.match(text, /Your chosen engine .*alpha\.2.* is still being qualified/)
  } finally { mounted.unmount() }
  const restored = await mountUpdates({ versions: { portable: '0.8.17', engine: '0.2.1-alpha.2' }, coreRestore: { preferredCore: '0.2.1-alpha.2', status: 'awaiting-qualification' } })
  try { assert.doesNotMatch(textContent(restored.tree), /still being qualified/) } finally { restored.unmount() }
})

test('catalog failures read as a plain sentence, not as HTTP codes', async () => {
  const mounted = await mountUpdates({ versions: { portable: '0.8.17', engine: '0.2.0-rc.2' } }, { engine: jsonResponse({ error: 'HTTP 502' }, { ok: false, status: 502 }) })
  try {
    const text = textContent(mounted.tree)
    assert.match(text, /update service is unavailable/i)
    assert.doesNotMatch(text, /HTTP 502/)
  } finally { mounted.unmount() }
})
