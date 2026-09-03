# Plugin market upstream policy

The Portable market is maintained here as a small, product-specific component.
It is not a drop-in copy of `dsh-market` and does not automatically inherit its
release, process-supervision, sponsorship, or theme-gallery surfaces.

Reviewed upstream baseline: `dsh-market` `v1.40.0`
(`ad3548f47775c0e4dba3d61cd874ffbc9804f8c7`).

## Compatibility matrix

| Upstream behavior | Portable decision |
| --- | --- |
| Clean carrier disable patches on removal | Adopted |
| Run every activation cleanup on removal | Adopted |
| Exclude backup files from exports | Adopted |
| Reject newly introduced duplicate loader names | Adopted |
| Compile-check client bundles before accepting an install or update | Adopted |
| Detect client bundles elsewhere in the profile that the current pnpm operation newly broke | Adopted |
| Treat ESM syntax as unknown instead of falsely reporting corruption with a classic-script parser | Adopted |
| Report non-portable absolute `file:` and `link:` restore dependencies | Adopted |
| Classify pnpm store and patch failures with actionable messages | Adopted |
| Retry unpublished DSH host peers without pnpm auto-install | Adopted, scoped to `@deepseek-ai/*` and one retry |
| Prefer repository-bound prebuilt GitHub Release archives | Adopted; cross-repository and unverifiable CDN URLs are rejected |
| Reconcile a manifest when a failed uninstall already removed the package | Adopted; only the half-removed case follows disk truth |
| Tier confirmed peer mismatches into risk, warning, and information | Adopted; repair actions are offered only for directional risks |
| Prevent an AI repair prompt from mutating its own running Harness | Adopted; defaults to read-only analysis and external apply/rollback scripts |
| Keep screenshot portals inside the market root and attach them only after React commits | Adopted |
| Keep full-screen screenshot navigation manual | Adopted; card strips remain user-driven too |
| Keep running plugin updates visible in the activity panel | Adopted |
| Keep failed plugin updates visible with their concrete server error | Already covered; the operation remains `failed`, the activity surface is opened, and error/stderr/stdout detail is surfaced |
| Preserve an in-flight install across a Settings-page remount | Adopted; the host task URL remains authoritative |
| Restore the exact dependency and bundle shape after a failed mutation | Adopted; order, duplicates, and field absence are preserved |
| Reject a successful mutation that newly leaves unresolved profile bundles | Adopted; the previous profile state is restored before reporting failure |
| Refuse uninstall while a user-authored patch still loads the package | Adopted; Portable never silently rewrites that patch |
| Normalize pnpm `workspace:` peer ranges and tolerate unknown protocols | Adopted; avoids false incompatibility warnings |
| Accept catalog entries with more than one category | Adopted |
| Check GitHub-only updates through the unmetered git ref advertisement | Adopted; still honors the configured proxy path |
| Preserve the selected GitHub branch/tag across update detection and update action | Adopted; commit pins still re-resolve, branch/tag and monorepo `path:` stay selected, and exact rollback replaces the floating ref with the captured commit |
| Treat an unlocatable in-box bundle as unknown and ignore a stale direct profile shadow | Adopted; unresolved community bundles remain boot errors |
| Verify the npm version actually resolved after update and roll back downgrades or target mismatches | Adopted; an explicit channel switch may move backwards only to its resolved target |
| Preserve a selected market channel across plugin toggle and group writes | Adopted; partial state writers keep fields they do not own |
| Make every rejected npm or GitHub update rollback source-exact | Adopted; automatic and deferred rollback require the captured prior version or commit |
| Reconcile validation-triggered removals when pnpm deleted the package before saving the manifest | Adopted; disk truth is used only when the package is gone |
| Explain tarballs missing integrity metadata without inventing a checksum | Adopted |
| Explain Windows locked-file rename failures without automatic retry | Adopted |
| Reset scrolling when catalog state changes and disable browser scroll anchoring | Adopted |
| Prompt for a page refresh after hot-removing a client-part plugin | Adopted |
| Restore and verify the exact previous npm version or GitHub commit after a failed update command | Adopted; the original dependency spelling is preserved even when recovery fails |
| Unicode profiles and Git subpath installs | Independently implemented and tested |
| Catalog, images, filters, direct author links, list/card views | Portable-native implementation |
| Avoid runtime named imports from DSH settings helpers removed by Alpha 2 | Independently implemented with stable/Alpha capability checks and verified by both product lanes |
| Rank search results by field relevance | Deferred; useful discovery polish, not an installation-safety or host-compatibility fix |
| Plugin name and a separate source link point to the same repository | Keep the plugin name as the single project link; remove the duplicate footer action |
| Market-level Discover, Themes, Installed, Advanced, and Backup navigation | Flattened to Discover and Installed; themes remain a catalog category, diagnostics is an Installed action, and Portable data migration owns transfer |
| Market-managed DSH restart/supervisor | Not applicable; the desktop host owns lifecycle |
| Global `PNPM_HOME` integration | Not applicable; Portable uses its pinned private pnpm |
| Sponsored cards, advertisements, theme gallery | Excluded from the core Portable product |
| Profile snapshots and named plugin presets | Excluded; Portable data migration already owns full-profile recovery |
| Reverse-proxy base-path routing | Not applicable to the native desktop host, which serves DSH at its own origin root |
| Persistent market server logs and full-profile export | Excluded; Portable support reports and migration own those product-level surfaces |
| Browser-side self-check facts in exported diagnostics | Deferred to the Portable support report so one privacy-bounded product report owns both host and WebView evidence |
| Resolve a bundled Electron DSH host and normalize an implicit `DSH_HOME` | Not applicable; Portable supplies an explicit profile directory and a non-empty product-owned `DSH_HOME` |
| Name pnpm 11.21+ missing-integrity entries | Deferred until the pinned private pnpm advances from 11.7; retain the current fail-closed checksum policy |
| Offer online updates for local `file:` installs and settings deep links | Deferred; useful expansion, not an installation-safety fix for the beginner path |
| Restore local development links to catalog sources | Deferred; useful for plugin authors but outside the beginner install path |
| Personal notes, update-note previews, plugin discussions, and public update APIs | Deferred; these are product expansion rather than Portable safety fixes |
| Third-party desktop-host compatibility branches | Reviewed only when they affect the official DSH contract |

When `dsh-market` publishes a newer release, review its user-visible fixes
against this matrix. Port the smallest applicable behavior with a failing test
first; do not merge an upstream working tree or silently expand the product.
