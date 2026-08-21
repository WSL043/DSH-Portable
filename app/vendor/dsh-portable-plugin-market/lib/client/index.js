/**
 * DSH-Portable plugin market client: registers a native Plugins tab rendering the
 * plugin market UI, plus the post-install toast in the shell overlay layer.
 * Built by tsdown into the __ModuleLoader__ factory bundle at
 * client/client.js; the only externals are the loader module table's react
 * entries.
 */
import { createElement as h } from 'react';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import { en, zh } from './locales.js';
import { InstallToast } from './InstallToast.js';
import { MarketSection } from './MarketSection.js';
const NS = 'dsh-portable-plugin-market';
/**
 * Primitives this bundle relies on that did not exist before rc.6. The
 * primitives module is host-injected (external at build time), so on an
 * older host the module resolves but these named exports are undefined —
 * rendering would throw and blank the whole settings dialog. Returning the
 * gaps lets apply() skip registration for a clean downgrade instead.
 */
export const REQUIRED_PRIMITIVES = ['Menu', 'DisclosureRow', 'Tooltip', 'Toast'];
export function missingPrimitives(mod, required = REQUIRED_PRIMITIVES) {
    return required.filter(name => mod[name] === undefined);
}
export const name = 'dsh-portable-plugin-market';
// 'theme' is safe to require: ui-layout (mandatory in every web composition)
// already hard-depends on it. This cordis's object-form inject means
// intercept config, NOT {required,optional} — do not use it here.
export const inject = ['slots', 'locale', 'theme'];
export function apply(ctx) {
    // Older hosts resolve the primitives module but lack the rc.6 exports the
    // market renders with. Skip registration (market simply absent from the
    // settings list) rather than throwing mid-render and blanking the dialog.
    const gaps = missingPrimitives(primitives);
    if (gaps.length > 0) {
        console.warn('[dsh-portable-plugin-market] host ui-primitives missing ' + gaps.join(', ') + ' — market section disabled (dsh web >= 0.1.0-rc.6 required)');
        return;
    }
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-portable-plugin-market: dictionaries');
    const t = ctx.locale.bind(NS);
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
        theme: ctx.theme,
        themeStore: {
            subscribe: (cb) => ctx.on('theme/change', cb),
            getSnapshot: () => ctx.theme.getTheme(),
        },
    })));
    const Toast = () => h(InstallToast, { t });
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-portable-plugin-market-toast',
        label: () => 'DSH-Portable Plugin Market',
    }, Toast));
}
