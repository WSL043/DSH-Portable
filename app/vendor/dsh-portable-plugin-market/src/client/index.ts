/**
 * DSH-Portable plugin market client: registers a native Plugins tab rendering the
 * plugin market UI, plus the post-install toast in the shell overlay layer.
 * Built by tsdown into the __ModuleLoader__ factory bundle at
 * client/client.js; the only externals are the loader module table's react
 * entries.
 */
import { createElement as h } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh } from './locales.ts'
import { InstallToast } from './InstallToast.tsx'
import { MarketSection } from './MarketSection.tsx'
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
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** The client cordis context shape this plugin relies on (structural: the
 * host provides the real Context; typing the touched surface keeps this
 * external package free of monorepo-internal type dependencies). */
interface MarketClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
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

  // The market belongs to the Plugins settings domain. DSH exposes a native
  // sub-page slot for exactly this use; registering as a top-level settings
  // section makes one plugin look like a product category of its own.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'market',
      order: 40,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(MarketSection, {
      t,
      locale: ctx.locale,
      view: 'discover',
    })))

  // Installed plugins are a sibling of the market in DSH's native Plugins
  // navigation. Keeping it out of the market surface removes one unnecessary
  // level and makes "what I have" reachable without first entering discovery.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'installed',
      order: 50,
      label: () => t('tabInstalled'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(MarketSection, {
      t,
      locale: ctx.locale,
      view: 'installed',
    })))

  const Toast = () => h(InstallToast, { t })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-portable-plugin-market-toast',
    label: () => 'DSH-Portable Plugin Market',
  }, Toast))
}
