/**
 * Bounded in-memory event log used for runtime safety and diagnostics.
 * Entries are never persisted or exposed through a market-specific export.
 */
export type LogLevel = 'info' | 'warn' | 'error';
/**
 * Append one event, sanitized and truncated.
 * @param level - severity for the export listing.
 * @param event - short machine-ish event name (e.g. `install`, `hot-mount`).
 * @param detail - free-form context; credentials and home paths are masked.
 */
export declare function logEvent(level: LogLevel, event: string, detail: string): void;
