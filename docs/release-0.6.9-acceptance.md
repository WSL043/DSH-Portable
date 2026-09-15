# 0.6.9 release acceptance — 2026-09-15

Published stable release: https://github.com/WSL043/DSH-Portable/releases/tag/v0.6.9

- Release source: `ef56623c129285ee9cf0e6d970d5368c240853fe`.
- Exact-source product CI: [34941054822](https://github.com/WSL043/DSH-Portable/actions/runs/34941054822), all 35 jobs passed. This includes Windows 2022/2025 native migration, startup themes and history, market resizing, complete offline WebView2 startup, macOS and Linux artifacts, component rollback and upgrade from 0.6.8.
- Publication: [34943440265](https://github.com/WSL043/DSH-Portable/actions/runs/34943440265), successful. The publisher reused the qualified artifacts without rebuilding. All 11 expected release assets are present; GitHub latest is v0.6.9.
- All ten public stable/candidate platform indexes were read back and include 0.6.9.

## Failure investigated before publication

The preceding Windows 2025 migration smoke encountered a late onboarding overlay. Its one-shot Settings click failed hit testing, then incorrectly required a collapsed-sidebar button. The harness now waits for an unobstructed Settings button while handling visible onboarding; it retains hit testing and captures the page and screenshot on failure. Both Windows runners passed the isolated migration check [34941092063](https://github.com/WSL043/DSH-Portable/actions/runs/34941092063), followed by the complete exact-source CI above. The failed run was not published.

## Scope

The bundled core remains qualified DSH 0.1.5-rc.2. Default plugin package versions are unchanged.

## Independent core follow-up

The first new-core run [34943545998](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/34943545998) failed because the runtime verifier still checked the old conversation-local permission implementation, while the patcher already recognized the new connected permission slot. A build-only verifier adaptation reuses that patcher's unchanged-result check without modifying the released desktop.

The corrected run [34944747336](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/34944747336) passed all five platform builds and artifact update/rollback checks for DSH 0.1.6-alpha.1 and historical 0.1.5-rc.1, then published both. Public index readbacks confirm 0.1.6-alpha.1 in candidate and rc.2/rc.1 in stable, each targeting Portable 0.6.9 on all five platforms. The bounded queue automatically dispatched [34945852670](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/34945852670) to continue historical qualification; remaining historical versions were not yet all qualified at this follow-up.

The public download CDN also briefly returned an old index after successful publication. A cache-key refresh retrieved the newly published index, and the ordinary Windows URL subsequently returned it too. Client metadata refresh handling is committed after 0.6.9 and is not part of that released binary; the core discovery pipeline's metadata refresh is deployed independently. Evidence is retained in `build/release-0.6.9/core-fixed-public-indexes.json` and `core-fix-qualified.json`.

This turn's finished-product evidence is from CI, not a new interactive local Windows acceptance. Logs, the failed migration report, successful run records, release metadata and public index readbacks are retained under `build/release-0.6.9`. No user Portable processes or data were modified during acceptance.
