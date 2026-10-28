/**
 * DSH-Portable plugin market client: contributes a Portable action to the
 * modern Plugins manager and falls back to native Plugins tabs on older hosts,
 * plus the post-install toast in the shell overlay layer.
 * Built by tsdown into the __ModuleLoader__ factory bundle at
 * client/client.js; the only externals are the loader module table's react
 * entries.
 */
import { createElement as h } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh } from './locales.ts'
import { InstallToast } from './InstallToast.tsx'
import { MarketErrorBoundary } from './MarketErrorBoundary.tsx'
import { MarketSection } from './MarketSection.tsx'
import { MarketAction } from './MarketAction.tsx'
import { PluginUpdateRow } from './PluginUpdates.tsx'
import { forgetOfficialMarket, readOfficialMarket } from './official-market.ts'
import { coordinateMarketSurfaces, LEGACY_PLUGIN_TAB_SLOT, PORTABLE_ACTIONS_SLOT, OFFICIAL_PLUGIN_TAB_SLOT } from './slot-compat.ts'
import type { Translate } from './market-data.ts'

const NS = 'dsh-portable-plugin-market'

/**
 * Primitives this bundle relies on that did not exist before rc.6. The
 * primitives module is host-injected (external at build time), so on an
 * older host the module resolves but these named exports are undefined —
 * rendering would throw and blank the whole settings dialog. Returning the
 * gaps lets apply() skip registration for a clean downgrade instead.
 */
export const REQUIRED_PRIMITIVES = ['Menu', 'DisclosureRow', 'Tooltip', 'Toast'] as const

export function missingPrimitives(mod: Record<string, unknown>, required: readonly string[] = REQUIRED_PRIMITIVES): string[] {
  return required.filter(name => mod[name] === undefined)
}

/** The subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): Translate
  subscribe(callback: () => void): () => void
  getSnapshot(): { active: string }
}

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): unknown
  register(meta: Record<string, unknown>, component: (owner?: unknown) => unknown): unknown
  spec?: (slot: string) => unknown
  subscribe?: (slot: string, callback: () => void) => unknown
}

/** The client cordis context shape this plugin relies on (structural: the
 * host provides the real Context; typing the touched surface keeps this
 * external package free of monorepo-internal type dependencies). */
interface MarketClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
}

function registerPublicMarket(ctx: MarketClientContext, t: Translate): () => void {
  let stopped = false, checking = false, recheck = false
  const register = (id: string, view: 'discover' | 'installed', label: string, order: number) => ctx.slots.register({
    name: OFFICIAL_PLUGIN_TAB_SLOT, id, order, label: () => t(label), locale: NS,
  }, owner => {
    const manager = owner as { openPackage: (name: string) => void }
    return h(MarketErrorBoundary, { view }, h(MarketSection, {
      t, locale: ctx.locale, view, officialUpdates: true, onOfficialManage: manager.openPackage,
    }))
  }) as () => void
  const advanced = register('dsh-portable-plugin-advanced', 'installed', 'navAdvanced', 50)
  let discover: (() => void) | undefined = register('dsh-portable-plugin-market', 'discover', 'nav', 40)
  const refresh = async () => {
    if (stopped) return
    if (checking) { recheck = true; return }
    checking = true
    try {
      do {
        recheck = false
        forgetOfficialMarket()
        const state = await readOfficialMarket()
        if (stopped) return
        if (state === 'active') { const previous = discover; discover = undefined; previous?.() }
        else if (!discover) discover = register('dsh-portable-plugin-market', 'discover', 'nav', 40)
      } while (recheck && !stopped)
    } finally { checking = false }
  }
  // An optional official Discover contribution can appear or disappear while
  // Plugins stays open; recheck enablement without replacing Advanced.
  const unsubscribe = ctx.slots.subscribe?.(OFFICIAL_PLUGIN_TAB_SLOT, () => { void refresh() })
  void refresh()
  return () => {
    stopped = true
    if (typeof unsubscribe === 'function') unsubscribe()
    discover?.(); advanced()
  }
}
export const name = 'dsh-portable-plugin-market'
export const inject = ['slots', 'locale']
export function apply(ctx: MarketClientContext): void {
  // Older hosts resolve the primitives module but lack the rc.6 exports the
  // market renders with. Skip registration (market simply absent from the
  // settings list) rather than throwing mid-render and blanking the dialog.
  const gaps = missingPrimitives(primitives as unknown as Record<string, unknown>)
  if (gaps.length > 0) {
    console.warn('[dsh-portable-plugin-market] host ui-primitives missing ' + gaps.join(', ') + ' — market section disabled (dsh web >= 0.1.0-rc.6 required)')
    return
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-portable-plugin-market: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => coordinateMarketSurfaces(ctx.slots, {
    updates: () => ctx.slots.inject('plugins.portable.update', () => ctx.slots.register({
      name: 'plugins.portable.update', id: 'portable-update', order: 10,
    }, owner => {
      const item = owner as { name: string; busy?: boolean; view: 'summary' | 'action' }
      return h(MarketErrorBoundary, { view: 'installed' }, h(PluginUpdateRow, {
        ...item, zh: ctx.locale.getSnapshot().active.toLowerCase().startsWith('zh'),
      }))
    })),
    official: () => registerPublicMarket(ctx, t),
    modern: () => ctx.slots.register({
      name: PORTABLE_ACTIONS_SLOT,
      id: 'dsh-portable-plugin-market',
      order: 40,
      label: () => t('nav'),
      locale: NS,
    }, owner => {
      const manager = owner as { refresh?: () => void; openInstall?: () => void; editInstallSpec?: (spec: string) => void } | undefined
      return h(MarketAction, { t, locale: ctx.locale, ...manager })
    }),
    legacy: [
      () => ctx.slots.register({
        name: LEGACY_PLUGIN_TAB_SLOT,
        id: 'market',
        order: 40,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, () => h(MarketErrorBoundary, { view: 'discover' }, h(MarketSection, {
        t,
        locale: ctx.locale,
        view: 'discover',
      }))),
      () => ctx.slots.register({
        name: LEGACY_PLUGIN_TAB_SLOT,
        id: 'installed',
        order: 50,
        label: () => t('tabInstalled'),
        locale: NS,
        inject: () => ({ t }),
      }, () => h(MarketErrorBoundary, { view: 'installed' }, h(MarketSection, {
        t,
        locale: ctx.locale,
        view: 'installed',
      }))),
    ],
  }), 'dsh-portable-plugin-market: manager surfaces')

  const Toast = () => h(InstallToast, { t })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-portable-plugin-market-toast',
    label: () => 'DSH-Portable Plugin Market',
  }, Toast))
}
