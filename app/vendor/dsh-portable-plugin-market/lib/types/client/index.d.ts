import type { ThemeSnapshot, Translate } from './market-data.ts';
/**
 * Primitives this bundle relies on that did not exist before rc.6. The
 * primitives module is host-injected (external at build time), so on an
 * older host the module resolves but these named exports are undefined —
 * rendering would throw and blank the whole settings dialog. Returning the
 * gaps lets apply() skip registration for a clean downgrade instead.
 */
export declare const REQUIRED_PRIMITIVES: readonly ['Menu', 'DisclosureRow', 'Tooltip', 'Toast'];
export declare function missingPrimitives(mod: Record<string, unknown>, required?: readonly string[]): string[];
/** The subset of the theme service this plugin touches. */
interface ThemeService {
    getTheme(): ThemeSnapshot | null;
    setTheme(id: string): void;
}
/** The subset of the locale service this plugin touches. */
interface LocaleService {
    register(namespace: string, dicts: {
        zh: Record<string, string>;
        en: Record<string, string>;
    }): unknown;
    bind(namespace: string): Translate;
    subscribe(callback: () => void): () => void;
    getSnapshot(): {
        active: string;
    };
}
/** The subset of the slots service this plugin touches. */
interface SlotsService {
    inject(slot: string, register: () => unknown): void;
    register(meta: Record<string, unknown>, component: () => unknown): unknown;
}
/** The client cordis context shape this plugin relies on (structural: the
 * host provides the real Context; typing the touched surface keeps this
 * external package free of monorepo-internal type dependencies). */
interface MarketClientContext {
    effect(callback: () => unknown, label?: string): void;
    on(event: string, callback: () => void): () => void;
    locale: LocaleService;
    slots: SlotsService;
    theme: ThemeService;
}
export declare const name = "dsh-portable-plugin-market";
export declare const inject: string[];
export declare function apply(ctx: MarketClientContext): void;
export {};
