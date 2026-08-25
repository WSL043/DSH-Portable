# Plugin market upstream policy

The Portable market is maintained here as a small, product-specific component.
It is not a drop-in copy of `dsh-market` and does not automatically inherit its
release, process-supervision, sponsorship, or theme-gallery surfaces.

Reviewed upstream baseline: `dsh-market` `v1.26.0`
(`53cb827b12fad5021d9ccdecd1a2797f537e712d`).

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
| Keep screenshot portals inside the market root | Adopted |
| Keep running plugin updates visible in the activity panel | Adopted |
| Unicode profiles and Git subpath installs | Independently implemented and tested |
| Catalog, images, filters, direct author links, list/card views | Portable-native implementation |
| Market-managed DSH restart/supervisor | Not applicable; the desktop host owns lifecycle |
| Global `PNPM_HOME` integration | Not applicable; Portable uses its pinned private pnpm |
| Sponsored cards, advertisements, theme gallery | Excluded from the core Portable product |
| Profile snapshots and named plugin presets | Excluded; Portable data migration already owns full-profile recovery |
| Restore local development links to catalog sources | Deferred; useful for plugin authors but outside the beginner install path |
| Third-party desktop-host compatibility branches | Reviewed only when they affect the official DSH contract |

When `dsh-market` publishes a newer release, review its user-visible fixes
against this matrix. Port the smallest applicable behavior with a failing test
first; do not merge an upstream working tree or silently expand the product.
