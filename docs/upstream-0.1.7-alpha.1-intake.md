# DSH 0.1.7-alpha.1 intake — 2026-09-22

Status: discovered, blocked for qualification. Current supported locks and the user's installation are unchanged.

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

No real user session migration, default-plugin publication, new-core delivery or native desktop acceptance has been performed. Candidate changes belong on the intake branch until the above gates pass.

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
