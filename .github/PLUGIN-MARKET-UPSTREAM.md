# Plugin market upstream policy

The Portable market is maintained here as a small, product-specific component.
It is not a drop-in copy of `dsh-market` and does not automatically inherit its
release, process-supervision, sponsorship, or theme-gallery surfaces.

Reviewed upstream baseline: `dsh-market` `v1.21.2`
(`bb0f128ad14ee5de383412a817d53e21e6a0d7c6`).

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
| Keep screenshot portals inside the market root | Adopted |
| Keep running plugin updates visible in the activity panel | Adopted |
| Unicode profiles and Git subpath installs | Independently implemented and tested |
| Catalog, images, filters, direct author links, list/card views | Portable-native implementation |
| Market-managed DSH restart/supervisor | Not applicable; the desktop host owns lifecycle |
| Global `PNPM_HOME` integration | Not applicable; Portable uses its pinned private pnpm |
| Sponsored cards, advertisements, theme gallery | Excluded from the core Portable product |
| Third-party desktop-host compatibility branches | Reviewed only when they affect the official DSH contract |

When `dsh-market` publishes a newer release, review its user-visible fixes
against this matrix. Port the smallest applicable behavior with a failing test
first; do not merge an upstream working tree or silently expand the product.
