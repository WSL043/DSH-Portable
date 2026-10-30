import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coordinateMarketSurfaces,
  LEGACY_PLUGIN_TAB_SLOT,
  PORTABLE_ACTIONS_SLOT,
  OFFICIAL_PLUGIN_TAB_SLOT,
  OFFICIAL_PLUGIN_ACTIONS_SLOT,
  supportsPortableActions,
} from '../app/vendor/dsh-portable-plugin-market/src/client/slot-compat.ts'

function fakeSlots({ modern = false, official = false, updates = true, maintenance = false } = {}) {
  const declared = new Map([
    [PORTABLE_ACTIONS_SLOT, modern],
    [LEGACY_PLUGIN_TAB_SLOT, true],
    ['plugins.portable.update', updates],
    [OFFICIAL_PLUGIN_TAB_SLOT, official],
    [OFFICIAL_PLUGIN_ACTIONS_SLOT, official],
    ['sidebar.panellist.actions', maintenance],
    ['shell.overlay', maintenance],
  ])
  const injections = new Set()
  const listeners = new Set()
  const entries = new Set()
  const injectCalls = []

  function spec(slot) {
    return declared.get(slot) ? { kind: 'list', scope: 'root' } : undefined
  }

  function subscribe(slot, callback) {
    const listener = { slot, callback }
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function register(meta, component) {
    const entry = { meta, component, disposed: false }
    entries.add(entry)
    return () => {
      if (entry.disposed) return
      entry.disposed = true
      entries.delete(entry)
    }
  }

  function inject(slot, callback) {
    injectCalls.push(slot)
    let active = true
    let effectDispose = () => {}
    const injection = {
      slot,
      reconcile() {
        if (!active) return
        effectDispose()
        effectDispose = () => {}
        if (!declared.get(slot)) return
        const effect = callback()
        effectDispose = typeof effect === 'function' ? effect : () => {}
      },
    }
    injections.add(injection)
    injection.reconcile()
    return () => {
      if (!active) return
      active = false
      effectDispose()
      injections.delete(injection)
    }
  }

  function setSlot(slot, value) {
    if (declared.get(slot) === value) return
    declared.set(slot, value)
    for (const injection of [...injections]) {
      if (injection.slot === slot) injection.reconcile()
    }
    // The real registry batches ordinary subscriptions in a microtask.
    notify(slot)
  }

  function notify(slot) {
    for (const listener of listeners) if (listener.slot === slot) queueMicrotask(listener.callback)
  }

  return {
    notify,
    spec,
    subscribe,
    inject,
    register,
    entries,
    injectCalls,
    setModern: value => setSlot(PORTABLE_ACTIONS_SLOT, value),
    setSlot,
    activeEntries: () => [...entries],
    flush: () => new Promise(resolve => queueMicrotask(resolve)),
  }
}

function factories(slots) {
  return {
    modern: () => slots.register({ surface: 'modern' }, () => null),
    legacy: [
      () => slots.register({ surface: 'legacy-market' }, () => null),
      () => slots.register({ surface: 'legacy-installed' }, () => null),
    ],
  }
}

test('modern Portable action replaces both legacy tabs and unload leaves no entry', async () => {
  const slots = fakeSlots({ modern: true })
  assert.equal(supportsPortableActions(slots), true)
  const dispose = coordinateMarketSurfaces(slots, factories(slots))

  assert.deepEqual(slots.activeEntries().map(entry => entry.meta.surface), ['modern'])
  dispose()
  assert.equal(slots.activeEntries().length, 0)

  slots.setModern(false)
  await slots.flush()
  assert.equal(slots.activeEntries().length, 0, 'unload must not recreate legacy tabs')
})

test('legacy tabs survive a late modern declaration, switch back, and switch again', async () => {
  const slots = fakeSlots()
  const dispose = coordinateMarketSurfaces(slots, factories(slots))

  assert.deepEqual(slots.activeEntries().map(entry => entry.meta.surface), ['legacy-market', 'legacy-installed'])

  slots.setModern(true)
  await slots.flush()
  assert.deepEqual(slots.activeEntries().map(entry => entry.meta.surface), ['modern'])

  slots.setModern(false)
  await slots.flush()
  assert.deepEqual(slots.activeEntries().map(entry => entry.meta.surface), ['legacy-market', 'legacy-installed'])

  slots.setModern(true)
  await slots.flush()
  assert.deepEqual(slots.activeEntries().map(entry => entry.meta.surface), ['modern'])

  dispose()
  assert.equal(slots.activeEntries().length, 0)
  slots.setModern(false)
  await slots.flush()
  assert.equal(slots.activeEntries().length, 0)
})

test('a host without declaration observation uses the legacy pair only', () => {
  const slots = fakeSlots()
  delete slots.spec
  delete slots.subscribe
  const dispose = coordinateMarketSurfaces(slots, factories(slots))

  assert.equal(supportsPortableActions(slots), false)
  assert.deepEqual(slots.activeEntries().map(entry => entry.meta.surface), ['legacy-market', 'legacy-installed'])
  assert.equal(slots.injectCalls.includes(PORTABLE_ACTIONS_SLOT), false)
  dispose()
  assert.equal(slots.activeEntries().length, 0)
})

test('queued declaration changes after unload cannot register a surface', async () => {
  const slots = fakeSlots()
  const dispose = coordinateMarketSurfaces(slots, factories(slots))
  dispose()
  slots.setModern(true)
  await slots.flush()
  assert.equal(slots.activeEntries().length, 0)
})

test('native public Plugins without the Portable renderer need no private management tab or legacy updates', async () => {
  const slots = fakeSlots({ official: true, updates: false })
  let updateRegistrations = 0
  const dispose = coordinateMarketSurfaces(slots, {
    ...factories(slots),
    official: () => () => {},
    updates: () => { updateRegistrations += 1; return slots.register({ surface: 'updates' }, () => null) },
  })
  assert.deepEqual(slots.activeEntries().map(entry => entry.meta.surface), [])
  assert.equal(updateRegistrations, 0)
  dispose()
  slots.setSlot(OFFICIAL_PLUGIN_TAB_SLOT, false)
  await slots.flush()
  assert.equal(slots.activeEntries().length, 0)
})

test('RC3 public slots retain Portable updates until the actual native renderer replaces the adapter', async () => {
  const slots = fakeSlots({ modern: true })
  const dispose = coordinateMarketSurfaces(slots, {
    ...factories(slots),
    official: () => () => {},
    updates: () => slots.register({ surface: 'updates' }, () => null),
  })
  const surfaces = () => slots.activeEntries().map(entry => entry.meta.surface).sort()
  assert.deepEqual(surfaces(), ['modern', 'updates'])
  slots.setSlot(OFFICIAL_PLUGIN_TAB_SLOT, true)
  await slots.flush()
  assert.deepEqual(surfaces(), ['modern', 'updates'], 'one public slot cannot establish the complete host contract')
  slots.setSlot(OFFICIAL_PLUGIN_ACTIONS_SLOT, true)
  await slots.flush()
  assert.deepEqual(surfaces(), ['modern', 'updates'], 'RC3 public tabs do not supply native version-update consumers')
  slots.setModern(false)
  slots.setSlot('plugins.portable.update', false)
  await slots.flush()
  assert.deepEqual(surfaces(), [])
  slots.setModern(true)
  slots.setSlot('plugins.portable.update', true)
  await slots.flush()
  assert.deepEqual(surfaces(), ['modern', 'updates'], 'restoring the actual legacy renderer creates one toolbar and update contribution')
  slots.setModern(false)
  slots.setSlot('plugins.portable.update', false)
  dispose()
  await slots.flush()
  assert.deepEqual(surfaces(), [], 'queued public declarations cannot revive an unloaded plugin')
})

test('shipped client keeps official management primary and legacy configuration import in the public More menu', async () => {
  const { readFile } = await import('node:fs/promises')
  const { createRequire } = await import('node:module')
  const { runInNewContext } = await import('node:vm')
  const require = createRequire(new URL('../app/package.json', import.meta.url))
  const React = require('react')
  let hookEffects = [], stateFrame = null
  const hookReact = { ...React,
    useState: initial => {
      const readInitial = () => typeof initial === 'function' ? initial() : initial
      if (!stateFrame) return [readInitial(), () => {}]
      const frame = stateFrame, index = frame.index++
      if (index === frame.values.length) frame.values.push(readInitial())
      return [frame.values[index], next => {
        frame.values[index] = typeof next === 'function' ? next(frame.values[index]) : next
      }]
    },
    useMemo: read => read(), useRef: initial => ({ current: initial }),
    useSyncExternalStore: (_subscribe, get) => get(), useCallback: callback => callback,
    useEffect: callback => hookEffects.push(callback),
  }
  const externals = {
    react: hookReact, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-dom': require('react-dom'),
    '@deepseek-ai/dsh-client-ui-primitives': Object.fromEntries(['Menu', 'DisclosureRow', 'Tooltip', 'Toast', 'MenuItemButton', 'Modal', 'Button', 'StateDot',
      'IconCordisPluginOutlineRegular', 'IconChevronDownOutlineRegular', 'IconChevronRightOutlineRegular',
      'IconLoadingOutlineRegular', 'IconRefreshOutlineRegular'].map(name => [name, () => null])),
  }
  const bundle = await readFile(new URL('../app/vendor/dsh-portable-plugin-market/client/client.js', import.meta.url), 'utf8')
  for (const state of ['active', 'inactive', 'failed']) {
    let client
    const requests = [], updateChecks = []
    hookEffects = []
    let respondingActive = state === 'active', failing = state === 'failed'
    const window = { __ModuleLoader__: { load: definition => {
      assert.equal(definition.id, '@wsl043/dsh-portable-plugin-market')
      client = definition.factory(name => { assert.ok(name in externals, `unexpected host import: ${name}`); return externals[name] })
    } }, addEventListener() {}, removeEventListener() {} }
    const fetch = async url => {
      if (url === '/dsh-market/updates' || url === '/dsh-market/installed') {
        updateChecks.push(url)
        return { ok: true, json: async () => url === '/dsh-market/updates' ? { updates: {} } : { bundles: [], activation: {} } }
      }
      requests.push(url)
      if (failing) throw new Error('offline')
      return { ok: true, json: async () => ({ active: respondingActive }) }
    }
    runInNewContext(bundle, { window, console, fetch, AbortSignal })
    assert.equal(typeof client?.apply, 'function')
    const slots = fakeSlots({ modern: true, maintenance: state !== 'failed' }), effects = []
    const own = stop => { if (typeof stop === 'function') effects.push(stop); return stop }
    client.apply({
      effect: callback => own(callback()),
      locale: { register: () => () => {}, bind: () => key => key, subscribe: () => () => {}, getSnapshot: () => ({ active: 'en' }) },
      slots: { ...slots, inject: (name, callback) => own(slots.inject(name, callback)) },
    })
    const managerEntries = () => slots.activeEntries().filter(entry => !['shell.overlay', 'sidebar.panellist.actions'].includes(entry.meta.name))
    const names = () => managerEntries().map(entry => entry.meta.name).sort()
    const maintenance = slots.activeEntries().filter(entry => entry.meta.name === 'sidebar.panellist.actions')
    assert.equal(maintenance.length, state !== 'failed' ? 1 : 0, 'Legacy import remains available with an inactive market, but not without the public More slot')
    if (maintenance.length) {
      const more = maintenance[0]
      assert.equal(more.meta.id, 'dsh-portable-plugin-maintenance')
      assert.equal(more.meta.label(), 'maintenanceTitle')
      assert.equal(more.component({}), null, 'a public onDismiss owner is required')
      let dismissed = 0
      const menu = more.component({ onDismiss: () => dismissed++ })
      const action = menu.type(menu.props)
      assert.equal(action.type, externals['@deepseek-ai/dsh-client-ui-primitives'].MenuItemButton)
      action.props.onSelect()
      assert.equal(dismissed, 1)
      const overlayEntry = slots.activeEntries().find(entry => entry.meta.id === 'dsh-portable-plugin-maintenance-overlay')
      const boundary = overlayEntry.component()
      const overlay = boundary.props.children
      const dialog = overlay.type(overlay.props)
      assert.ok(React.isValidElement(dialog), 'the dialog survives after the More menu has closed')
      if (state === 'active') {
        const nodes = children => React.Children.toArray(children).flatMap(child =>
          React.isValidElement(child) ? [child, ...nodes(child.props.children)] : [child])
        const maintenanceStates = []
        const renderMaintenance = () => {
          stateFrame = { values: maintenanceStates, index: 0 }
          try { return nodes(dialog.type(dialog.props)) }
          finally { stateFrame = null }
        }
        const initial = renderMaintenance()
        assert.equal(initial.some(child => child?.props?.readOnly === true || child?.type === externals['@deepseek-ai/dsh-client-ui-primitives'].DisclosureRow), false, 'More does not expose generic diagnostics or compatibility categories')
        assert.equal(initial.some(child => child?.type === 'a' || child?.props?.children === 'maintenanceExport'), false, 'More does not export a new configuration backup')
        const initialButtons = initial.filter(child => child?.type === externals['@deepseek-ai/dsh-client-ui-primitives'].Button)
        assert.equal(initialButtons.length, 1, 'legacy import starts with one official file chooser button')
        assert.equal(initialButtons[0].props.children, 'maintenanceChoose')
        const fileInput = initial.find(child => child?.type === 'input' && child.props.type === 'file')
        assert.equal(fileInput.props.hidden, true)
        fileInput.props.onChange({ currentTarget: { files: [{ name: 'trusted-backup.json' }] } })
        const confirmation = renderMaintenance().find(child => child?.props?.role === 'group' && child.props['aria-label'] === 'maintenanceConfirmTitle')
        assert.ok(confirmation, 'selecting a file shows explicit confirmation before any restore')
        assert.ok(nodes(confirmation).some(child => child?.type === externals['@deepseek-ai/dsh-client-ui-primitives'].Button && child.props.children === 'maintenanceConfirm'))
        const cancel = nodes(confirmation).find(child => child?.type === externals['@deepseek-ai/dsh-client-ui-primitives'].Button && child.props.children === 'cancel')
        assert.ok(cancel)
        cancel.props.onClick()
        assert.equal(renderMaintenance().some(child => child?.props?.role === 'group' && child.props['aria-label'] === 'maintenanceConfirmTitle'), false, 'cancelling clears the pending confirmation')
        assert.deepEqual(requests, [], 'choosing and cancelling legacy configuration never sends a restore request')
        assert.deepEqual(updateChecks, [], 'opening legacy import does not assess plugin loading state')
      }
      dialog.props.onClose()
      assert.equal(overlay.type(overlay.props), null)
    }
    assert.deepEqual(names(), ['plugins.portable.actions', 'plugins.portable.update'])
    slots.setSlot(OFFICIAL_PLUGIN_TAB_SLOT, true)
    slots.setSlot(OFFICIAL_PLUGIN_ACTIONS_SLOT, true)
    await slots.flush()
    assert.deepEqual(names(), ['plugins.portable.actions', 'plugins.portable.update'], 'the delivered RC3 branch retains real legacy update surfaces')
    // Exercise the delivered toolbar/status components; this is not a substitute for actual UI clicks.
    const toolbarEntry = slots.activeEntries().find(entry => entry.meta.name === PORTABLE_ACTIONS_SLOT)
    const toolbarElement = toolbarEntry.component({ refresh() {}, openInstall() {}, editInstallSpec() {} })
    const toolbar = toolbarElement.type(toolbarElement.props)
    const statusBoundary = React.isValidElement(toolbar.props.children) && typeof toolbar.props.children.props.zh === 'boolean'
      ? toolbar : React.Children.toArray(toolbar.props.children).find(child => React.isValidElement(child?.props?.children) && typeof child.props.children.props.zh === 'boolean')
    assert.ok(statusBoundary, 'the real legacy toolbar mounts its update status component')
    hookEffects = []
    const status = statusBoundary.props.children
    status.type(status.props)
    assert.equal(hookEffects.length, 1)
    const stopStatus = hookEffects[0]()
    await new Promise(setImmediate)
    assert.deepEqual(updateChecks, ['/dsh-market/updates', '/dsh-market/installed'], 'initial legacy update checking runs without opening another tab or pressing refresh')
    stopStatus()

    slots.setModern(false)
    slots.setSlot('plugins.portable.update', false)
    await slots.flush()
    assert.ok(managerEntries().every(entry => entry.meta.name === 'plugins.tab'))
    await new Promise(setImmediate)
    assert.deepEqual(requests, [], 'public manager ownership never depends on active/inactive/error status of the optional market')
    assert.equal(managerEntries().length, 0, 'a current public manager never gets a second Discover or Advanced tab')
    failing = false
    for (const active of [true, false]) {
      respondingActive = active
      slots.notify(OFFICIAL_PLUGIN_TAB_SLOT)
      await new Promise(setImmediate)
      assert.equal(managerEntries().length, 0, 'stopping the official market must not create a second manager')
    }
    assert.equal(requests.length, 0, 'activation changes do not trigger a renderer-availability lookup')
    slots.setModern(true)
    slots.setSlot('plugins.portable.update', true)
    slots.setSlot(OFFICIAL_PLUGIN_ACTIONS_SLOT, false)
    await slots.flush()
    assert.deepEqual(names(), ['plugins.portable.actions', 'plugins.portable.update'])
    slots.setSlot(OFFICIAL_PLUGIN_ACTIONS_SLOT, true)
    slots.setModern(false)
    slots.setSlot('plugins.portable.update', false)
    for (const stop of effects.reverse()) stop()
    await slots.flush()
    assert.deepEqual(names(), [], 'queued declarations and fetch results must not revive an unloaded bundle')
    assert.equal(slots.activeEntries().length, 0, 'More action and persistent overlay must unload together')
  }
})
