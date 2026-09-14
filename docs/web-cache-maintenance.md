# WebView2 cache maintenance

Implemented for the next Windows desktop build: Settings > Portable > Maintenance > More > Clear web cache. The host explicitly advertises support; older hosts and non-WebView2 clients do not show this command.

Only the current WebView2 profile's `DiskCache` is cleared, using `ClearBrowsingDataAsync`. Cookies, LocalStorage, IndexedDB, browser profiles, runtime capsules and old instance directories are outside the operation. Normal engine eviction remains enabled. No startup scan, background daemon, hard size limit or scheduled cache purge is added.

Native cleanup is serialized. Client requests use correlated replies and a bounded wait; an unconfirmed reply is not reported as success. Logs contain completion, elapsed time and exception type, not browsing content. No freed-byte figure is claimed because there is no corresponding measured cache-size result.

Validation on 2026-09-14:

- Windows launcher compiled against the existing packaged WebView2 SDK; existing notification API deprecation warnings remain.
- Settings tests verify old-host exclusion and matching native completion before success; 11 tests pass.
- Existing desktop host contract tests passed before the final test-harness-only change.
- An isolated, nonactivating native WebView2 fixture completed DiskCache cleanup and retained seeded Cookies, LocalStorage and IndexedDB. Evidence: `build/web-cache-acceptance/result.json`, fixture `Probe.cs`.
- No installed application was replaced. Full packaged settings-click acceptance, offline restart and before/after timing remain release qualification work. This fixture verifies the real API and state preservation, not the complete shipped UI path or reclaimed byte count.

Old-instance identification is deferred until ownership and usage metadata can distinguish obsolete locations from disconnected removable drives and copies still in use. Whole-profile automatic deletion is not authorized by this feature.
