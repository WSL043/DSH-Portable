# 0.6.9 release acceptance — 2026-09-15

Published stable release: https://github.com/WSL043/DSH-Portable/releases/tag/v0.6.9

- Release source: `ef56623c129285ee9cf0e6d970d5368c240853fe`.
- Exact-source product CI: [34941054822](https://github.com/WSL043/DSH-Portable/actions/runs/34941054822), all 35 jobs passed. This includes Windows 2022/2025 native migration, startup themes and history, market resizing, complete offline WebView2 startup, macOS and Linux artifacts, component rollback and upgrade from 0.6.8.
- Publication: [34943440265](https://github.com/WSL043/DSH-Portable/actions/runs/34943440265), successful. The publisher reused the qualified artifacts without rebuilding. All 11 expected release assets are present; GitHub latest is v0.6.9.
- All ten public stable/candidate platform indexes were read back and include 0.6.9.

## Failure investigated before publication

The preceding Windows 2025 migration smoke encountered a late onboarding overlay. Its one-shot Settings click failed hit testing, then incorrectly required a collapsed-sidebar button. The harness now waits for an unobstructed Settings button while handling visible onboarding; it retains hit testing and captures the page and screenshot on failure. Both Windows runners passed the isolated migration check [34941092063](https://github.com/WSL043/DSH-Portable/actions/runs/34941092063), followed by the complete exact-source CI above. The failed run was not published.

## Scope

The bundled core remains qualified DSH 0.1.5-rc.2. New-core qualification against the published baseline was dispatched separately in [34943545998](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/34943545998). Its resolve jobs passed and runtime builds were running at this record's creation; this is not a claim that the new core has qualified or shipped. Default plugin package versions are unchanged.

This turn's finished-product evidence is from CI, not a new interactive local Windows acceptance. Logs, the failed migration report, successful run records, release metadata and public index readbacks are retained under `build/release-0.6.9`. No user Portable processes or data were modified during acceptance.
