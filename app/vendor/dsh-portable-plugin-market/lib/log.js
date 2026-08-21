/**
 * Bounded in-memory event log used for runtime safety and diagnostics.
 * Entries are never persisted or exposed through a market-specific export.
 */
import { homedir } from 'node:os';
const MAX_ENTRIES = 200;
const DETAIL_MAX = 600;
const entries = [];
function sanitize(text) {
    return text
        .replaceAll(homedir(), '~')
        // Log-injection guard: control characters (newlines above all) would
        // forge extra lines in the exported log file. The #98 routes pass
        // user-supplied names into logEvent (bundle-order order entries, trial
        // messages), so strip them at the single choke point (issue #98
        // analysis: log filtering).
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
        .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, 'gh*_***')
        .replace(/npm_[A-Za-z0-9]{16,}/g, 'npm_***')
        .replace(/bearer\s+\S+/gi, 'Bearer ***')
        .replace(/(authorization|token|apikey|api-key|password)(["':=\s]+)\S+/gi, '$1$2***');
}
/**
 * Append one event, sanitized and truncated.
 * @param level - severity for the export listing.
 * @param event - short machine-ish event name (e.g. `install`, `hot-mount`).
 * @param detail - free-form context; credentials and home paths are masked.
 */
export function logEvent(level, event, detail) {
    entries.push({
        at: new Date().toISOString(),
        level,
        event,
        detail: sanitize(detail).slice(0, DETAIL_MAX),
    });
    if (entries.length > MAX_ENTRIES)
        entries.splice(0, entries.length - MAX_ENTRIES);
}
