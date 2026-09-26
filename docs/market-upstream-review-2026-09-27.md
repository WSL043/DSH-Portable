# Market intake and screenshot UX — 2026-09-27

## Reviewed upstream evidence

Live GitHub API: latest stable is [v1.66.2](https://github.com/dsh-market/dsh-market/releases/tag/v1.66.2), tag commit `6450b0a5670839e0bf3cd6af260bb1a56d9e6c23`; main is `9bc6120ba589461647c0f61ccaf73239122dcbd4` at inspection. These are review references, not a claim of wholesale synchronization.

- [f4478f53](https://github.com/dsh-market/dsh-market/commit/f4478f5301f1e3b1c6a977804adf1774a42452f7): translate known core-bundle scanner verbs, retaining a generic fallback for unknown details. Portable does not have this exact scanner string surface; do not add a second scanner for translation. Applied the principle to catalog text/categories and verified both actual host languages.
- [f063c3b8](https://github.com/dsh-market/dsh-market/commit/f063c3b8cd9e49e67875b36cd2597076f3c57a66): upstream retracts its earlier version-union repair for minimumReleaseAgeExclude. **Supersedes the 2026-09-26 review's union suggestion.** Do not introduce `name@v1 || v2` as a repair. Portable currently uses a one-shot command flag; it does not implement that upstream union writer. Existing external profiles with malformed policy still need an isolated pnpm-version-specific reproduction before choosing a persistent repair; never reproduce the reported huge allocation on a user profile. Broadening an affected package exemption is a policy change and needs explicit accounting, not a silent generic cleanup.
- [9bc6120b](https://github.com/dsh-market/dsh-market/commit/9bc6120ba589461647c0f61ccaf73239122dcbd4): exclude shared parent installations when identifying host peers. Portable's `src/check.ts:analyzeProfile` still calls `readProfileVisibleVersion` before the located host. This is a concrete follow-up candidate: test a profile whose shared parent is an older CLI and whose host is newer, then constrain host-package resolution. Do not treat this audit alone as a repaired/accepted transaction.

## Implemented discovery design

- Use one continuous list with natural row heights and a cumulative download number without Total text. A wide row puts catalog screenshots beside the content; a narrow container stacks them. No-image rows consume the full content width. This supersedes the earlier two-column experiment: mixed media left unacceptable blank grid areas, which the prior visual review failed to reject.
- One bounded, uncropped catalog screenshot per card; additional image count opens the existing image viewer. No carousel timer or per-card README fetch. Offscreen images use native lazy loading; broken images advance to the next approved screenshot or remove the preview if none remains.
- README-only fallback remains in details: registry-provided screenshots display directly in the list; missing catalog screenshots are not replaced with logos or invented previews.
- Screenshot buttons have localized accessible names. Opening/closing the viewer transfers/restores keyboard focus; Escape leaves the market open.
- Catalog descriptions, search and multi-category labels share language fallback; missing translation retains the available author's text instead of hiding it. Plugin/package names and screenshots themselves are not machine-translated.
- The modern market action subscribes to host locale changes. The English and Chinese dictionaries have identical keys/placeholders.

## Acceptance

Full repository tests: 881 total, 867 passed, 14 skipped, zero failures. Isolated Native WebView2 source-overlay checks include real catalog image load, preview open/Escape, detail open/close, explicit light/dark appearance, English/Chinese through official settings, and 1200/580-width overflow checks. Mixed-media layout assertions require inter-row gaps of at most 12px and full-width text for no-image entries. Focused tests after the row restructure: 58 passed. Final evidence: `build/native-market-rows-v5`. This is development-source acceptance, not a new immutable release package or an update to the user's current installation.

Pending upstream policy/peer-resolution investigations above remain separate maintenance work; no update engine or pnpm policy change is included in this visual delivery.

## Design acceptance rules

Judge actual mixed content, not only uniform cards: screenshots absent/present/broken, long translated titles/descriptions, multiple categories, wide/narrow containers, both themes and both host languages. Preserve package identity, installation ownership and cumulative-stat provenance. Do not declare a visual change accepted solely because nothing overflows; reject unused media slots and excessive gaps visible in the captured product. Never reorder the catalog to promote entries merely because they have screenshots. The gallery keeps DOM order down each column; the compact mode keeps a single full-width ordered list.


## Visual revision after user review

The bordered full-width rows were rejected visually. The next development revision narrows the market to 840px, replaces repeated card boxes with subtle row dividers, separates the action into a consistently aligned trailing column, and uses smaller inline screenshot previews. Missing screenshots reserve no media column. Narrow containers keep actions alongside text and put previews below. Current evidence supersedes v5: `build/native-market-refined-v6`; actual English light, Chinese dark, narrow/wide, image open/close and detail navigation passed, as did 58 focused tests. These results establish operation/layout checks, not user approval of the visual direction. The installed user product remains unchanged.


## Image-rich category review

The 2026-09-27 catalog inspection found 152 theme entries (66 with declared screenshots) and 211 model/provider entries (53 with screenshots). These counts are a time-specific observation, not a product constant. Reviewed the actual Themes & Appearance and Models & Providers pages before changing the design; the former has landscape previews while the latter includes long portrait screenshots. The tiny right-hand preview did not communicate those interfaces well.

Current design: the existing explicit Cards/Compact preference owns the choice. Cards uses natural-height two-column CSS layout (one column at narrow widths), a larger uncropped 16:10 preview, three lines of localized description, and a consistent footer for category/install. Entries without screenshots have no media slot. Compact retains a single ordered row list for scanning. CSS columns preserve DOM order down each column; they do not promise row-major ranking. No JavaScript positioning engine, image-priority sorting, or per-category automatic mode switch was introduced. Screenshot source validation, lazy loading, keyboard-openable preview and host-owned installation remain shared.

Final current native evidence: `build/native-market-gallery-v8`, including actual theme/model categories, gallery/compact switching, English light/Chinese dark, narrow/wide layout, preview close and detail navigation. Passed with no page exceptions. Focused source tests: 58 passed. This remains an isolated development preview, not a replacement of the current user installation or a released artifact. Earlier screenshots in this note are superseded for visual review.
