# Market intake and screenshot UX — 2026-09-27

## Reviewed upstream evidence

Live GitHub API: latest stable is [v1.66.2](https://github.com/dsh-market/dsh-market/releases/tag/v1.66.2), tag commit `6450b0a5670839e0bf3cd6af260bb1a56d9e6c23`; main is `9bc6120ba589461647c0f61ccaf73239122dcbd4` at inspection. These are review references, not a claim of wholesale synchronization.

- [f4478f53](https://github.com/dsh-market/dsh-market/commit/f4478f5301f1e3b1c6a977804adf1774a42452f7): translate known core-bundle scanner verbs, retaining a generic fallback for unknown details. Portable does not have this exact scanner string surface; do not add a second scanner for translation. Applied the principle to catalog text/categories and verified both actual host languages.
- [f063c3b8](https://github.com/dsh-market/dsh-market/commit/f063c3b8cd9e49e67875b36cd2597076f3c57a66): upstream retracts its earlier version-union repair for minimumReleaseAgeExclude. **Supersedes the 2026-09-26 review's union suggestion.** Do not introduce `name@v1 || v2` as a repair. Portable currently uses a one-shot command flag; it does not implement that upstream union writer. Existing external profiles with malformed policy still need an isolated pnpm-version-specific reproduction before choosing a persistent repair; never reproduce the reported huge allocation on a user profile. Broadening an affected package exemption is a policy change and needs explicit accounting, not a silent generic cleanup.
- [9bc6120b](https://github.com/dsh-market/dsh-market/commit/9bc6120ba589461647c0f61ccaf73239122dcbd4): exclude shared parent installations when identifying host peers. Portable's `src/check.ts:analyzeProfile` still calls `readProfileVisibleVersion` before the located host. This is a concrete follow-up candidate: test a profile whose shared parent is an older CLI and whose host is newer, then constrain host-package resolution. Do not treat this audit alone as a repaired/accepted transaction.

## Implemented discovery design

- Keep the responsive two-column/one-column layout and cumulative download number without Total text.
- One bounded, uncropped catalog screenshot per card; additional image count opens the existing image viewer. No carousel timer or per-card README fetch. Offscreen images use native lazy loading; broken images advance to the next approved screenshot or remove the preview if none remains.
- README-only fallback remains in details: registry-provided screenshots display directly in the list; missing catalog screenshots are not replaced with logos or invented previews.
- Screenshot buttons have localized accessible names. Opening/closing the viewer transfers/restores keyboard focus; Escape leaves the market open.
- Catalog descriptions, search and multi-category labels share language fallback; missing translation retains the available author's text instead of hiding it. Plugin/package names and screenshots themselves are not machine-translated.
- The modern market action subscribes to host locale changes. The English and Chinese dictionaries have identical keys/placeholders.

## Acceptance

Full repository tests: 881 total, 867 passed, 14 skipped, zero failures. Isolated Native WebView2 source-overlay checks include real catalog image load, preview open/Escape, detail open/close, explicit light/dark appearance, English/Chinese through official settings, and 1200/580-width overflow checks. Final evidence: `build/native-market-preview-v4`. This is development-source acceptance, not a new immutable release package or an update to the user's current installation.

Pending upstream policy/peer-resolution investigations above remain separate maintenance work; no update engine or pnpm policy change is included in this visual delivery.
