import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coordinateMarketSurfaces,
  LEGACY_PLUGIN_TAB_SLOT,
  PORTABLE_ACTIONS_SLOT,
  supportsPortableActions,
} from '../app/vendor/dsh-portable-plugin-market/src/client/slot-compat.ts'

function fakeSlots({ modern = false } = {}) {
  const declared = new Map([
    [PORTABLE_ACTIONS_SLOT, modern],
    [LEGACY_PLUGIN_TAB_SLOT, true],
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

  function setModern(value) {
    if (declared.get(PORTABLE_ACTIONS_SLOT) === value) return
    declared.set(PORTABLE_ACTIONS_SLOT, value)
    for (const injection of [...injections]) {
      if (injection.slot === PORTABLE_ACTIONS_SLOT) injection.reconcile()
    }
    // The real registry batches ordinary subscriptions in a microtask.
    for (const listener of listeners) {
      if (listener.slot === PORTABLE_ACTIONS_SLOT) queueMicrotask(listener.callback)
    }
  }

  return {
    spec,
    subscribe,
    inject,
    register,
    entries,
    injectCalls,
    setModern,
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
