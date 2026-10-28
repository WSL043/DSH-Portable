/**
 * Keep the market reachable across Plugins hosts:
 *
 * - public Plugins slots contribute one Advanced tab and keep updates official;
 * - the Portable adapter exposes `plugins.portable.actions` on the modern
 *   manager toolbar;
 * - older hosts only expose `settings.plugins.tab`.
 *
 * `slots.inject` owns a contribution for one declaration lifetime. The
 * coordinator adds a small amount of state around it so a late declaration,
 * collapse, or plugin unload cannot leave an old tab behind.
 */

export const PORTABLE_ACTIONS_SLOT = 'plugins.portable.actions'
export const LEGACY_PLUGIN_TAB_SLOT = 'settings.plugins.tab'
export const OFFICIAL_PLUGIN_TAB_SLOT = 'plugins.tab'
export const OFFICIAL_PLUGIN_ACTIONS_SLOT = 'plugins.add.actions'

type Disposer = () => void
type SlotRegistration = () => unknown

export interface CompatibleSlots {
  inject(slot: string, register: SlotRegistration): unknown
  spec?: (slot: string) => unknown
  subscribe?: (slot: string, callback: () => void) => unknown
}

export interface MarketSurfaceFactories {
  modern: SlotRegistration
  official?: SlotRegistration
  updates?: SlotRegistration
  legacy: readonly SlotRegistration[]
}

const noop: Disposer = () => {}

function disposer(value: unknown): Disposer {
  if (typeof value !== 'function') return noop
  let done = false
  return () => {
    if (done) return
    done = true
    value()
  }
}

/** Whether this host can observe the Portable adapter declaration. */
export function supportsPortableActions(slots: CompatibleSlots): boolean {
  return typeof slots.spec === 'function' && typeof slots.subscribe === 'function'
}

function hasPortableActions(slots: CompatibleSlots): boolean {
  if (!supportsPortableActions(slots)) return false
  try {
    return slots.spec!(PORTABLE_ACTIONS_SLOT) !== undefined
  } catch {
    // A host with a partially initialized registry should use the legacy
    // surface until its normal declaration lifecycle becomes observable.
    return false
  }
}

/**
 * Coordinate the modern toolbar action and the legacy pair of tabs.
 *
 * The returned disposer is the plugin-lifetime boundary. It removes every
 * active injection and makes queued declaration callbacks harmless after
 * unload, including a declaration that appears after cleanup.
 */
function coordinateLegacyMarketSurfaces(
  slots: CompatibleSlots,
  factories: MarketSurfaceFactories,
): Disposer {
  let stopped = false
  const modernObservable = supportsPortableActions(slots)
  let modernDeclared = modernObservable && hasPortableActions(slots)
  let legacyGeneration = 0
  let legacyHandles = new Set<Disposer>()

  const disposeLegacy = () => {
    legacyGeneration += 1
    const handles = legacyHandles
    legacyHandles = new Set()
    for (const dispose of handles) dispose()
  }

  const enableLegacy = () => {
    if (stopped || modernDeclared || legacyHandles.size > 0) return
    const generation = ++legacyGeneration
    const handles = new Set<Disposer>()
    legacyHandles = handles
    for (const factory of factories.legacy) {
      const handle = disposer(slots.inject(LEGACY_PLUGIN_TAB_SLOT, () => {
        if (stopped || modernDeclared || generation !== legacyGeneration) return undefined
        return factory()
      }))
      // A declaration can change synchronously in a host implementation (or
      // in a test double) while an injection is being installed. Do not let a
      // handle created by that stale generation escape cleanup.
      if (stopped || modernDeclared || generation !== legacyGeneration) handle()
      else handles.add(handle)
    }
  }

  const onModernDeclarationChanged = () => {
    if (stopped) return
    const next = hasPortableActions(slots)
    if (next === modernDeclared) return
    modernDeclared = next
    if (next) disposeLegacy()
    else enableLegacy()
  }

  let unsubscribe = noop
  let modernHandle = noop
  let updateHandle = noop
  try {
    updateHandle = disposer(factories.updates?.())
    if (modernObservable) {
      unsubscribe = disposer(slots.subscribe!(PORTABLE_ACTIONS_SLOT, onModernDeclarationChanged))
      modernHandle = disposer(slots.inject(PORTABLE_ACTIONS_SLOT, () => {
        if (stopped) return undefined
        modernDeclared = true
        disposeLegacy()
        return factories.modern()
      }))
    }
    if (!modernDeclared) enableLegacy()
  } catch (error) {
    stopped = true
    unsubscribe()
    modernHandle()
    updateHandle()
    disposeLegacy()
    throw error
  }

  return () => {
    if (stopped) return
    stopped = true
    unsubscribe()
    modernHandle()
    updateHandle()
    disposeLegacy()
  }
}

/** Public Plugins slots own normal management; keep one Portable Advanced tab. */
export function coordinateMarketSurfaces(slots: CompatibleSlots, factories: MarketSurfaceFactories): Disposer {
  if (!factories.official || !supportsPortableActions(slots)) return coordinateLegacyMarketSurfaces(slots, factories)
  let stopped = false, initialized = false, official = false, generation = 0
  let current = noop
  const subscriptions: Disposer[] = []
  const publicSlots = [OFFICIAL_PLUGIN_TAB_SLOT, OFFICIAL_PLUGIN_ACTIONS_SLOT]
  const declared = () => {
    try {
      return publicSlots.every(slot => {
        const spec = slots.spec!(slot) as { kind?: unknown; scope?: unknown } | undefined
        return spec?.kind === 'list' && spec.scope === 'root'
      })
    } catch { return false }
  }
  const sync = () => {
    if (stopped) return
    const next = declared()
    if (initialized && next === official) return
    initialized = true; official = next
    const epoch = ++generation, previous = current; current = noop
    previous()
    if (stopped || epoch !== generation) return
    const handle = next
      ? disposer(slots.inject(OFFICIAL_PLUGIN_TAB_SLOT, () => {
        if (stopped || epoch !== generation || !declared()) return undefined
        return factories.official!()
      }))
      : coordinateLegacyMarketSurfaces(slots, factories)
    if (stopped || epoch !== generation) handle()
    else current = handle
  }
  const dispose = () => {
    if (stopped) return
    stopped = true; generation += 1
    for (const unsubscribe of subscriptions) unsubscribe()
    current()
  }
  try {
    for (const slot of publicSlots) subscriptions.push(disposer(slots.subscribe!(slot, sync)))
    sync()
  } catch (error) { dispose(); throw error }
  return dispose
}
