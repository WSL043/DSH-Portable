import type { Translate } from './market-data.ts';
/**
 * Fetch and render the profile check report. Refetches on every mount, so
 * switching tabs away and back re-runs the (cheap, read-only) analysis; the
 * ordering panel calls `refresh()` after applying an order.
 */
export declare function Diagnostics(props: {
    t: Translate;
}): any;
