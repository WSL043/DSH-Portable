# DSH 0.1.7-alpha.1 intake — 2026-09-22

Status: isolated alpha.1 native development acceptance passed; release-package qualification and delivery remain blocked. Current supported locks and the user's installation are unchanged.

Official release: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.1
Immutable tag commit: `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`.

## Confirmed intake blocker

Manual dispatch 35701803158 discovered the new npm alpha/tag, then failed `the bundled market peer ranges cover each verified official DSH channel`. Do not widen the peer range merely to silence the test. The previous workflow stopped before recording a review PR. Intake now records a draft review even when contracts fail, includes the run link and failure status, keeps the workflow failed, and does not dispatch product qualification in that case. It neither merges nor publishes candidates.

## Required integration work

1. **Session manager:** the published 1.4.0-beta.3 client adapter explicitly targets 0.1.6-alpha.2; invoking its build adapter with the real 0.1.7-alpha.1 workspace package refuses the unsupported version. The new official workspace exposes `sidebar.workspaces.session.menu.item` and `sidebar.workspaces.session.row.action`; its pin/rename/fork/archive entries register through these slots. Implement deletion through those public slots instead of copying WorkspaceBrowser or changing its header width. Official archive filtering, undo and running-session confirmation must remain official-owned. Permanent deletion is not among the observed official session menu registrations. Decide archive-settings retention only after testing official content search and deletion requirements.
2. **Session data:** upstream upgrades logs to V4. Verify V3 import, export and backup using synthetic sessions and official APIs. Program rollback must not be described as a V4-to-V3 data downgrade. Custom-event attachments no longer automatically read/export; inspect image annotation attachment delivery against this boundary.
3. **Market:** official installation adds registry choice, progress, dismiss/reopen and reconnect recovery. Reuse that lifecycle rather than duplicate it. Bundle patches now accept ordered multiple files; current market preflight/profile/stack helpers still assume one path and need a coordinated update. Do not claim compatibility after changing only the peer declaration. The public runProfilePnpm/withFileLock boundary still exists in the downloaded package, but new-version execution acceptance is pending.
4. **File APIs:** workspace reads move to readBytes. Audit default image-viewer and Portable adapters before enabling the candidate.
5. **Retire patches:** re-evaluate all packaging patches against actual built 0.1.7 artifacts, especially session export, client startup and subprocess hiding. Remove only behavior demonstrated upstream, retaining older-core qualification where still supported.

## Evidence and remaining acceptance

Downloaded npm packages: workspace UI, plugin manager and session, each exactly 0.1.7-alpha.1. Local evidence: build/alpha7-packages, build/alpha7-intake.log, build/upstream-alpha7-candidate.lock.json, build/alpha7-intake-ci-failure.log and build/probe-alpha7-chat.mjs. The release comparison API returns a limited file list and is not a complete large-diff audit.

No real user session migration, alpha.1 default-plugin publication or new-core delivery has been performed. Subsequent sections distinguish the original host checks from the newer native development acceptance; neither qualifies a released archive.

## Candidate progress (not a compatibility declaration)

- Chat Manager source now has an opt-in official session-menu-slot client, without copying the workspace. Actual alpha.1 host with synthetic V4 sessions passed archive content search, restore, confirmed deletion, active deletion followed by new-session typing, and three enable/disable transitions. Light/dark screenshots were inspected in headless Chrome; this is not native WebView2 acceptance. Plugin tests: 104 passed. Source commit `7b12118`; not published.
- Market patch-path resolution now accepts ordered arrays as well as a single string, matching official `packages/boot/app-boot/src/profile.ts` at the immutable release commit. Empty arrays remain valid. Diagnostics, ownership discovery, import preflight and legacy hot mounting read the full list; unsafe members reject the whole declaration. Diagnostics displays every path. A missing later file cannot leave a partially accepted layer.
- Market regression: 126 passed; server/client bundles built. Tests probe an actual failing import from the second patch, missing later files, order, empty arrays and unsafe members. Evidence: `build/alpha7-market-regression.log`, `build/alpha7-market-build.log`. These are source-boundary tests; full modern official installation/reconnect and native candidate qualification remain pending. Peer declarations and supported locks remain unchanged.

Formal publication remains blocked on the uncompleted integration and product gates above and the architecture audit. Do not promote these targeted passes into full release readiness.

## Further acceptance and packaging blocker

Image Viewer initially failed to open on the real alpha.1 host: React error 130 was caught by the overlay boundary because the official sized icon names were removed. Source commit `3286adf` now uses official Regular icons with older-host fallbacks. Actual isolated-host acceptance passed navigation, zoom/pan, download, annotations and returning the annotated image/notes to the original draft. Screenshot inspected; 31 source tests passed. Not yet a published/default-pinned artifact.

Portable full local regression: 769 tests, 756 passed, 6 failed during file-symlink fixture creation (EPERM), 7 skipped. Original log: build/alpha7-full-regression.log. Security CI 35706496568 on the exact 5681eb1 revision passed the affected filesystem checks in Windows/macOS/Linux jobs; it does not turn the local result into an all-pass result.

Product CI 35706496652 failed all five packaging jobs because the preview offline dependency lock still referenced Chat Manager beta.1 while the reviewed release pins referenced beta.3. This is a real delivery mismatch, not a reason to bypass archive verification. The lock was regenerated from SHA-256-verified pinned archives; only the chat archive version/integrity changed. New stable/preview lock contracts check versions, integrity, importer specifiers and package sets before packaging. Actual prepare-default-plugin-store succeeded with the two reviewed preview archives. Original CI log: build/alpha7-product-ci-failure.log; correction evidence: build/default-plugin-store-lock-tests.log and build/default-store-preparation.log. Product CI must pass again before qualification.

Cleanup: two obsolete v2 storage-test fixtures were moved to the Recycle Bin after validating their synthetic package identity. Their result/log files remain in build/cleanup-evidence-20260922. Current candidate runtimes and acceptance evidence are retained for the outstanding work.

## Default-plugin delivery gate follow-up

Both plugin READMEs now lead with the official Plugins / Add plugin page and a copyable package spec, distinguish terminal commands, and state that alpha.1 support is not yet published (Chat Manager `5a1ab86`, Image Viewer `2022e53`).

Manual core sync 35708190729 and 35708194147 selected 0.1.7-alpha.1 automatically. They were stopped before publication after identifying that the existing core smoke only proved default packages remained installed, not that their UI worked. Updates commit `5083b94` adds a Windows native WebView2 light/dark plugin operation gate before core publication. Its browser-level probe accepts the repaired candidate and rejects the actual published image package with reproduced React/overlay errors. A first negative fixture attempt retained a stale development link despite a changed package spec; it was not counted as published-package evidence. After remove/add and target verification, the real archive reproduced the failure. Replacement sync runs: 35709894539 and 35709898860. Their results are still required.

Product run 35707647941 passed Windows base packaging after the offline-lock correction, but Windows 2022 tray-bridge acceptance failed when API-key onboarding appeared between shell discovery and the one-shot Settings click. Original evidence: build/native-2022-28c198d-failure.log. The harness now uses the existing bounded known-dialog-aware wait and accepts the official title's `API Key` capitalization; it never clicks through an inert modal. Focused tests cover that known dialog and refusal to dismiss unrelated confirmations. Native rerun is required; this is not a product rendering fix or a pass claim.

## Native default-plugin acceptance follow-up

Focused Windows run 35710045734 passed both 2022 and 2025 using product artifact 35707647941 (source 28c198d) and harness 0b235f4. Full product run 35710044353 is still separate qualification.

The SHA-256-verified Windows offline artifact was extracted into an isolated build directory and exercised through its actual hidden WebView2 desktop host. Portable 0.7.0-beta.3 / DSH 0.1.6-alpha.2, Chat Manager 1.4.0-beta.3 and Image Viewer 0.1.2-beta.1 passed light/dark image annotation return, original draft preservation, deletion cancellation, official archive-settings navigation, archive restoration, and both plugins' disable/enable transitions with editable composer. Confirmed deletion passed in the light pass on a synthetic session. Runtime error collection remained empty. Inspected screenshots include archive settings with red destructive actions, image annotation, delete confirmation and the composer after toggling; all four workspace toolbar actions remain visible.

Evidence: build/native-default-plugin-ui-lifecycle-enabled.log and build/native-candidate-28c198d/product/DSH-Portable/acceptance/default-plugin-ui/. Updates 3c8c68e carries the repeatable native gate. Earlier fixture failures are retained: late new-session onboarding, reused session titles, and official title truncation were corrected in the harness rather than bypassing overlays. This does not qualify alpha.1, fresh plugin installation/update, or real user-data migration.

Triggered alpha.1 core sync 35709898860 failed at the native-settings adapter on Linux x64 and macOS arm64: `native settings command seam changed upstream: expected 1 match, found 0`. Original Linux log: build/updates-alpha7-linux-failure.log. The existing published baseline cannot yet build this new core; selection and official source packaging succeeded, but core publication is blocked. Do not report it as delivered to the version list.

## Alpha.1 native development acceptance and remaining delivery work

The settings adapter now recognizes the official trigger-row focus effect, preserves the localized plugin-card signature, and limits explicit close-state cleanup to the official close callback. Portable settings and market icons resolve the new Regular artwork with legacy fallbacks. All nine packaging adapters execute successfully on copied, actual npm alpha.1 packages; market client rebuilt; 33 focused regression tests passed.

An isolated expanded-layout development product was assembled from the verified Windows shell, current launcher/bridge/market source and npm DSH 0.1.7-alpha.1. It is explicitly marked qualificationOnly, does not carry a release package-set hash, and has no published default-plugin pins. The two candidate plugins were installed through the Portable CLI using local source specifications. This is native integration evidence, not an immutable release artifact or a replacement for cross-platform packaging.

Native WebView2 light/dark acceptance passed annotation return, original draft preservation, delete cancellation, archive restoration, both plugins' disable/enable cycles and composer typing. Confirmed synthetic-session deletion passed in light mode. Initial native acceptance caught a missing archive shortcut in the new slot-based chat client. Portable now exposes one narrow workspace-header extension slot; Chat Manager uses it without replacing WorkspaceBrowser. Width is allocated for all original controls plus the archive shortcut. Four visible controls and the new core settings page were visually inspected. Evidence: build/alpha7-native-default-ui.log (original failure), build/alpha7-native-default-ui-header.log (corrected pass), build/alpha7-native-surfaces.log and build/alpha7-native-development/acceptance/default-plugin-ui/. The first market screenshot only covers loading and opening/closing; catalog completion is checked separately.

Do not rerun the unchanged core publisher expecting this source fix to apply: it intentionally builds from the last published Portable baseline. Remaining delivery gates, in order:

1. Package the two alpha.1-compatible plugin candidates, verify actual archives through official install/update, then publish and pin them with regenerated offline locks.
2. Complete synthetic V3/V4 session import/export and rollback-boundary checks; no claim of lossless V4-to-V3 downgrade.
3. Qualify the exact new Portable candidate across platforms, including default-plugin operations and native screenshot review. Preserve previous failures; old run 35710044353 was cancelled after a later push and is not a pass.
4. Publish only the qualified product, trigger core sync against that baseline, and read back channel manifests and the in-product list. Discovery alone is not delivery.

CI workflow refinement: docs/README-only main pushes no longer start the full product build matrix. Pull requests and explicit dispatch remain unchanged, and final release qualification still requires the exact candidate. This avoids documentation updates cancelling ongoing product qualification.

Catalog follow-up: build/alpha7-native-surfaces-catalog.log passed both themes after waiting for the real catalog search field. The inspected native screenshot shows loaded categories, plugin cards and install actions; opening/closing market returns to an editable composer. This proves browsing/rendering, not installation. Chat Manager source 1f00e4e passed 105 tests; the initial full run's one stale README-copy assertion is retained in .artifacts/alpha7-shortcut-regression.log and was replaced with checks against the actual qualified target and official installation page.

## Packaged alpha.1 delivery checkpoint

Published plugin candidates: Chat Manager 1.5.0-beta.1 (5f43cc5, release run 35714821496) and Image Viewer 0.1.2-beta.2 (a14cc5b, release run 35714841606). Both release workflows passed official-host acceptance. GitHub asset SHA-256 and npm tarball bytes match; GitHub reports these releases as published but not immutable. Portable pins exact SHA-256 and npm integrity rather than relying on mutable tags. The candidate core and offline dependency lock now select the new artifacts; stable pins are unchanged.

Actual archive installation into the isolated native alpha.1 product passed light/dark WebView2 annotation return, preserved drafts, cancel/delete, archive restore and plugin toggles. Evidence: build/alpha7-install-release-plugins.log and build/alpha7-native-release-tar-ui-2.log. Installed package versions and resolved paths were checked before acceptance. The earlier attempt retained local development links despite changed tarball declarations; its result is not archive qualification. Removing the isolated source-linked packages and reinstalling the archives resolved this fixture issue. Production local-source-to-archive switching remains a separate source-identity check.

V4 migration fixes cover both moving the Portable directory and importing a data archive. Both use one explicit supported session filename list. Header relocation preserves the subsequent event bytes. Targeted migration/filesystem tests: 60 passed, 6 platform skips. An actual official alpha.1 synthetic V4 session completed archive export, import to a new workspace and idempotent repeated import with all event content preserved (build/alpha7-v4-real-roundtrip.log). This is not a V4-to-V3 downgrade guarantee.

## Stable defaults and restart action checkpoint

Chat Manager 1.5.0 (3ff5b3b, release run 35717753631) and Image Viewer 0.1.2 (9e68c8a, release run 35717757600) are published stable releases after official-host qualification. npm and GitHub tarball hashes agree. Preview pins and the offline plugin store now select these archives. Chat Manager 1.5 targets alpha.1; older-core stable product pins are deliberately unchanged. Both plugins use official package icon/localized-metadata resources; native WebView2 inspection covered Chinese/English and light/dark themes. No card DOM replacement is needed.

Plugin cards now offer Restart app or Reload page according to the server activation verdict, without duplicated completion text. Restart uses the same implementation as the catalog, validates a new boot before reloading, preserves native refusal, and handles bounded HTTP operation-lock contention. Real inline update from image beta.1 to beta.2 stayed on the plugin page until Restart app was clicked; the next boot and keyboard input passed in an isolated native alpha.1 host. This development fixture is not the final product ZIP. Evidence: build/restart-action-native-onboarding.log and native screenshots. Earlier failures are preserved: an obsolete native test window prevented reconnection on one attempt; a keyless official API-key dialog blocked input after restart on another. Acceptance now waits for the new document, restored draft and the known Configure later action. Only the exact disposable native executable was stopped during cleanup.

82 targeted tests passed. The full local run recorded 772 passes, 7 failures and 7 skips: six Windows file-symlink EPERM failures and one outdated footprint assertion. The footprint assertion was updated for independently capped official speech libraries and document-preview growth; its targeted rerun passed (17 passed, 1 promotion-only skip). Original aggregate output remains build/stable-plugin-release-contracts.log. See alpha7-footprint.md for failed CI 35715835410 and the measured budget changes. A new exact-commit cross-platform product gate is still required.

Ownership: official voice input, models and permission flows remain upstream-owned. Portable preserves the matching speech runtime and verifies packaging/host boundaries; this checkpoint does not claim microphone or speech-recognition acceptance. No voice runtime was removed for size reduction.

A failed offline default refresh on alpha.1 now pauses known incompatible 1.3.5/1.4 Beta chat clients without removing their files, dependencies or sessions. Thirteen default-plugin tests passed. The full local run has 768 passes, 6 EPERM failures creating file symlinks and 7 skips (build/alpha7-final-contracts.log); preserve those failures and use the cross-platform gate, not a green claim about this local run. Previous baseline build 35713201685 passed, but does not qualify these new changes. The Windows 2025 product gate now also runs the exact packaged defaults through the pinned shared native UI verifier used by core-update qualification.
