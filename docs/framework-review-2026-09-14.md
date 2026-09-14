# Portable framework review — 2026-09-14

This is engineering evidence for the next release, not release qualification.

## Changes

- Native hosts publish protocol version 1 and explicit capabilities. Missing capabilities are disabled; unknown protocol versions do not fall through to another transport. Legacy unversioned hosts remain compatible.
- Windows cache maintenance uses the same transport and capability contract as other desktop operations. macOS/Linux do not advertise this Windows-specific operation.
- Desktop version catalogs and the CLI share `listInstalledVersions`. Desktop reads no longer spawn a Node process. The existing manifest validation, compatibility checks, channel rules and request timeout remain in `update-core.mjs`.
- Preferences are reread for each catalog request. There is no new persistent version cache to become stale after a channel change.

## Decisions from the ownership and operation audit

Keep the existing launch lock, shared product lock, update journal and runtime leases. Adding a second generic operation framework would duplicate these mechanisms and complicate lock ordering.

Update rollback already protects application/runtime changes. Data import has exception rollback and retains replaced data, but does not have a durable crash journal; process termination or power loss during import is not covered by the exception test. Do not describe application rollback as proof of data-format downgrade support or power-loss recovery.

Runtime GC protects the active hash, live leases, unknown leases, and recent or active incomplete preparations. Log retention already has count, age and byte limits. WebView user profiles include cookies and local storage, so old profile directories must not be treated as disposable runtime caches. Keep targeted DiskCache maintenance; no automatic deletion of old profile trees was added.

No broad file splitting was justified by this review. The shared catalog entry point removes an actual process boundary without duplicating upstream functionality or introducing another service layer.

## Measurement and acceptance

Local evidence is in `build/framework-acceptance/` (ignored build output). Five paired Windows measurements used the real runtime-entry/CLI path and the shared in-process reader with the same mocked HTTP 404 response. Both returned identical catalog results. Median elapsed time was 65.21 ms versus 0.55 ms. This isolates local dispatch overhead; it does not measure real network latency, UI paint or complete application startup.

Tests cover explicit/legacy/unknown capability contracts, missing capability disabling, channel changes, and desktop catalogs operating without a CLI executable. Existing update/data-import and full regression results are recorded alongside native compile output. Platform artifact checks are required before a release; source tests and local compilation alone do not qualify a shipped package.

Final local regression: 635 passed, zero failed or skipped (`node --test tests/*.test.mjs`, the package test command). The first run had one stale exact capability-object assertion; it was corrected to expect the unsupported cache capability to be false. The Windows production compiler block succeeded with four existing obsolete toast API warnings. The injected Windows script also passed message forwarding, listener removal and repeated-injection checks in a JavaScript fixture; this is not a substitute for native artifact acceptance.
