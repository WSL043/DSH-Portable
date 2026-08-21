/**
 * Response shapes of the /dsh-market/* host routes plus the pure helpers the
 * Market UI shares between its section and toast components.
 */
import type { DiagnosticReportV1 } from '../diagnostics.ts';
export type { SharedHostPackageDependencyFinding } from '../diagnostics.ts';
/** Localized text keyed by language ('zh' / 'en'). */
export type LocalizedText = Record<string, string | undefined>;
/** One registry entry from /dsh-market/registry. */
export interface RegistryPlugin {
    name: string;
    owner: string;
    url: string;
    /** Catalog detail page; fall back to the repository URL when absent. */
    page?: string;
    npm?: string;
    category: string;
    description?: LocalizedText;
    stars?: number;
    /**
     * npm downloads in the last 30 days, when the entry has a published
     * package. Absent means "no npm package" — a coverage gap, not a zero.
     */
    downloads?: number | null;
    added?: string;
    install?: string;
    /**
     * Catalog-side deprecation flags (#60): absent for every normal entry, so
     * catalogs without the fields render exactly as before.
     */
    deprecated?: boolean;
    /** Catalog name of the suggested replacement plugin, when deprecated. */
    replacement?: string;
    /** Author-curated screenshot URLs from the registry (#61); optional. */
    screenshots?: string[];
}
/** The catalog payload under `registry` in /dsh-market/registry. */
export interface Registry {
    count: number;
    categories: Record<string, LocalizedText>;
    plugins: RegistryPlugin[];
}
/** Profile dependency map: package name → install spec. */
export type InstalledMap = Record<string, string>;
/** Strong repo identities discovered for local link:/file: dependencies (#141). */
export type InstalledRepoIdentities = Record<string, string[]>;
/** Weak Git-origin hints used only to disambiguate multiple same-named entries. */
export type InstalledRepoHints = Record<string, string[]>;
/** Response of the /dsh-market/gist export action. */
export interface GistExportResult {
    ok: boolean;
    gistId: string;
    gistUrl: string;
}
/** Per-package update status from /dsh-market/updates. */
export interface UpdateStatus {
    updateAvailable?: boolean;
    version?: string;
    kind?: string;
}
/** Poll payload from /dsh-market/status. */
export interface MarketStatus {
    /** The market's own version — rendered in the heading so screenshots carry it. */
    version?: string;
    active?: boolean;
    lastLine?: string;
    seconds?: number;
    installed?: InstalledMap;
    pnpm?: boolean;
    boot?: string;
    /** pnpm ndjson stage, when the structured reporter produced events. */
    phase?: 'resolving' | 'downloading' | 'linking' | 'building' | null;
    done?: number;
    total?: number | null;
    currentPackage?: string | null;
    downloaded?: number | null;
    size?: number | null;
    /** True once the user asked to cancel and the host is killing the run. */
    cancelling?: boolean;
    /**
     * The route-level operation lock (#91): stays true through install
     * post-processing after pnpm already exited (progress.active false).
     * Restart must not be offered while it is held.
     */
    busy?: boolean;
}
/** Post-install activation state (P0-2), per installed package. */
export type ActivationState = 'live' | 'restart' | 'inert' | 'broken' | 'missing' | 'disabled';
export interface ActivationInfo {
    state: ActivationState;
    reasons: string[];
    bundle: boolean;
    hot: boolean;
}
/** The /dsh-market/installed payload (fields the market UI consumes). */
export interface InstalledPayload {
    profile?: string;
    installed: InstalledMap;
    /** Strong source identities for local link:/file: dependencies (#141). */
    repoIdentities?: InstalledRepoIdentities;
    /** Weak local Git-origin hints; never used to reject a unique match. */
    repoHints?: InstalledRepoHints;
    activation?: Record<string, ActivationInfo>;
    diagnostics?: DiagnosticReportV1;
    live?: string[];
    /** Plugins the user switched off; persisted across restarts (#60). */
    disabled?: string[];
    /**
     * Packages whose bundle rows the user patch layer (cordis.patch.yml)
     * disables / force-enables (port of dsh-plugin-hub). Covers toggles made
     * OUTSIDE the market — hand-edited patch files, the dsh CLI — which the
     * market's own disable list never sees.
     */
    patchDisabled?: string[];
    patchForced?: string[];
    /** Custom plugin groups: group name → member package names. */
    groups?: Record<string, string[]>;
    /** Display order of group names. */
    groupOrder?: string[];
}
/**
 * A group's derived switch state: all members enabled / all disabled /
 * mixed / no members. Pure — the UI renders exactly this and the group
 * switch itself is never persisted (#60).
 */
export type GroupSwitchState = 'on' | 'off' | 'mixed' | 'empty';
export declare function groupSwitchState(members: string[] | undefined, disabled: ReadonlySet<string>): GroupSwitchState;
/** Registered theme definition surfaced by the theme service snapshot. */
export interface ThemeDef {
    id: string;
    colorScheme?: string;
    tokens?: Record<string, string | undefined>;
}
/** Theme service snapshot; null when the composition has no theme service. */
export interface ThemeSnapshot {
    preference: string;
    themes: ThemeDef[];
}
/** Bound locale translator for the dsh-market namespace. */
export type Translate = (key: string) => string;
export declare function avatarColor(name: string): string;
export declare function readSession(key: string): any;
/** Sortable field for the Discover list. */
export type SortField = 'downloads' | 'stars' | 'added';
/** Sort direction: desc = newest/most first, asc = oldest/least first. */
export type SortDir = 'desc' | 'asc';
/** Combined sort key sent to visiblePlugins. */
export type SortKey = `${SortField}-${SortDir}`;
/** Recency windows for the "published within" filter. */
export type TimeRange = 'all' | 'day' | 'week' | 'month' | 'quarter' | 'year';
/** Days per TimeRange (`all` has no cutoff and is handled by the caller). */
export declare const TIME_RANGE_DAYS: Record<Exclude<TimeRange, 'all'>, number>;
/** True when `added` is a date within the last `days` days (inclusive). */
export declare function withinDays(added: string | undefined, days: number): boolean;
/** Filters and sort order driving the discover list. */
export interface ListQuery {
    /** Active category id, or 'all'. */
    category: string;
    /** Raw search input (trimmed and lowercased internally). */
    query: string;
    /** UI language for description matching ('zh' / 'en'). */
    lang: string;
    /** 'stars-desc' | 'stars-asc' | 'added-desc' | 'added-asc'; anything else keeps registry order. */
    sort: string;
    /** Keep only plugins published within the last N days; undefined = any time. */
    sinceDays?: number;
}
/**
 * Whether a catalog entry IS the market itself. The catalog still carries
 * it — nothing about the data changes, and the Installed tab still shows it
 * — this is purely "a store has no reason to sell itself to someone already
 * standing in it."
 */
export declare function isMarketItself(plugin: Pick<RegistryPlugin, 'name' | 'npm'>): boolean;
/**
 * The discover list: category filter, then the published-within window, then
 * search across name / owner / localized description, then the selected sort.
 * Pure — the section renders exactly this.
 */
export declare function visiblePlugins(plugins: RegistryPlugin[], options: ListQuery): RegistryPlugin[];
/** The themes tab listing: theme category only, most-starred first. */
export declare function themePlugins(plugins: RegistryPlugin[]): RegistryPlugin[];
/**
 * Category chip order: collapsed with an active non-'all' chip that would
 * otherwise be clipped out of the two-row preview, the active one moves to
 * the front so it stays visible.
 *
 * Reported as "点了某个分类，标签就跑到前面来了，好奇怪": the earlier version
 * moved the active chip to the front unconditionally, so clicking a category
 * that was ALREADY visible inside the two rows still reshuffled it — and
 * every chip after it — for no reason, since nothing was at risk of being
 * hidden. `visibleCount` is how many chips (the 'all' chip included) the
 * two-row clip fits; a category already within that budget in its natural
 * position is left exactly where it was.
 *
 * `visibleCount === null` (not yet measured, e.g. the very first collapsed
 * render) keeps the old unconditional behaviour: with no measurement to
 * check against, guaranteeing visibility is the safe default.
 */
export declare function orderedCategories(categories: string[], active: string, open: boolean, visibleCount?: number | null): string[];
/**
 * Page-number list for the discover pager. With few pages it is simply
 * 1..total; with many it windows around the current page and inserts '…'
 * so a 400-plugin catalog stays a compact `1 … 4 5 6 … 17` instead of a
 * long row of numbered buttons. Always begins with 1 and ends with total.
 */
export declare function pageItems(current: number, total: number): Array<number | '…'>;
/** The installed dependency name a registry entry corresponds to, or null. */
export declare function matchInstalledName(plugin: RegistryPlugin, installed: InstalledMap, repoIdentities?: InstalledRepoIdentities, plugins?: RegistryPlugin[], repoHints?: InstalledRepoHints): string | null;
/** The registry entry an installed dependency corresponds to, or undefined. */
export declare function entryForDep(plugins: RegistryPlugin[], name: string, spec: string, repoIdentities?: readonly string[], repoHints?: readonly string[]): RegistryPlugin | undefined;
export declare function isInstalled(plugin: RegistryPlugin, installed: InstalledMap, repoIdentities?: InstalledRepoIdentities, plugins?: RegistryPlugin[], repoHints?: InstalledRepoHints): boolean;
/**
 * The header brand mark now lives in MarketSection.tsx as an inline SVG
 * (official-style monochrome glyph, fill="currentColor") so it follows the
 * active theme; the colored assets/logo.svg tile is no longer inlined here.
 */
/** Four representative colors for a theme card's preview strip. */
export declare function themeSwatch(def: ThemeDef): string[];
/** Keep only https URLs on allowlisted image hosts; SVG dropped (logos/badges). */
export declare function safeScreenshots(urls: unknown): string[];
/**
 * Image URLs extracted from a repo README, in document order — the fallback
 * when an entry has no curated screenshots (#61). Markdown and <img> forms;
 * relative paths resolve against the README's directory on
 * raw.githubusercontent.com; badges fall out naturally (shields.io etc. are
 * not allowlisted) and SVG is skipped as logo/badge noise.
 */
export declare function extractReadmeImages(markdown: string, owner: string, repo: string, subpath: string | null): string[];
/** Test hook: the cache is module-level and outlives component unmounts. */
export declare function resetScreenshotsCache(): void;
/**
 * Screenshots for a plugin: the registry's curated list when present,
 * otherwise lazily extracted from the repo README. Only ever called AFTER
 * the user opens the detail dialog — browsing the list must make zero
 * external requests. Failures resolve to [] (silent degradation).
 */
export declare function pluginScreenshots(plugin: RegistryPlugin): Promise<string[]>;
/**
 * The human-readable part of a failed command's output.
 *
 * pnpm's ndjson reporter writes one JSON object per progress tick, and a
 * large `github:` download emits thousands of them. When a failure matches
 * none of the known signatures there is no diagnosis to show, so the UI
 * falls back to the tail of stdout/stderr — which for exactly that case is
 * 600 characters of `{"name":"pnpm:fetching-progress","downloaded":…}`.
 * The user is handed machine noise at the one moment they need a sentence
 * (#148, and the same shape behind #161).
 *
 * Progress objects are dropped; anything else — including JSON carrying a
 * real message — is kept, because an unrecognized failure is precisely when
 * throwing information away is most expensive.
 */
export declare function humanOutput(raw: string): string;
/**
 * The plugin's own name, for display.
 *
 * The catalog's `name` is an IDENTITY, and for the 104 entries that live in
 * a repository holding several plugins it is a compound one:
 * `dsh-web-ui#packages/dsh-web-ui-all`. Shown verbatim it puts a repository
 * path in front of a user who did not ask about repositories — and worse, it
 * disagrees with the market's own installed list, which reads names out of
 * the profile manifest and calls the same plugin `dsh-web-ui-all`. The same
 * thing had two names either side of the Install button.
 *
 * A card answers two questions: who made it, and what is it called. The
 * author is drawn beside their avatar as one unit, so the title is free to
 * be just the plugin. Duplicate titles across authors are fine — the byline
 * is what separates them — which is why this does not try to keep the
 * repository as a qualifier.
 *
 * The repository name IS the plugin name in the ordinary case, because a
 * repository holding one plugin is named after it. Only the compound form
 * needs unpicking, and its last segment is the plugin's own directory.
 *
 * Not a substitute for the identity: every key, lookup and install still
 * uses `name` unchanged.
 */
export declare function pluginName(name: string): string;
/**
 * Compact display for a count that can run into the tens of thousands
 * (npm downloads, star counts): "11.9k" instead of "11862". Reported —
 * the raw number made the card byline visibly cramped once downloads was
 * added alongside stars.
 *
 * Below 1000 the exact number is shown; a small count is exactly the case
 * where the precision matters and abbreviating it buys nothing.
 */
export declare function formatCount(n: number): string;
