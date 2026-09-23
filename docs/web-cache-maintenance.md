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

## 2026-09-23: revisioned plugin bundles

The [official 0.1.7-alpha.2 client-module server](https://github.com/deepseek-ai/deepseek-harness/blob/00102833dfaee1da9f48a3a8eae9d34005a75218/packages/client/modules/src/index.ts#L1057-L1083) marks revisioned plugin bundles
`public, max-age=31536000, immutable`. Its [Electron Desktop host](https://github.com/deepseek-ai/deepseek-harness/blob/00102833dfaee1da9f48a3a8eae9d34005a75218/apps/desktop/README.md#L3-L5) instead serves
those responses as `no-store` to avoid retaining a disk entry for each launch
revision. Portable currently navigates WebView2 directly to the loopback Host
and does not override those response headers. This is a **possible** source of
cache growth, subject to Chromium's own eviction; no unbounded growth or saved
byte count has been measured.

Before changing the native host, capture the shipped bundle response headers
in an isolated profile. If they match upstream, scope any no-store handling to
the authenticated application loopback plugin-bundle route. Verify unchanged
status, body and content type, and prove two different revisions are fetched
across launches. Do not proxy unrelated Host or external requests, and keep
Cookies, LocalStorage and IndexedDB outside cache cleanup.
