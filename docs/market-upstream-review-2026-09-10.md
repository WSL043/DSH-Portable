# dsh-market intake review — 2026-09-10

Reviewed latest release: [v1.45.1](https://github.com/dsh-market/dsh-market/releases/tag/v1.45.1), commit `1664caec99219b4902f1686e2e34614815d38346`. This already matches `upstream.lock.json`; it records review, not identical implementation.

| Upstream improvement | Portable evidence and disposition |
| --- | --- |
| Remove unused client injection dependencies (1.45.1) | The bundled manifest declares only locale and UI settings; the unused connection/runtime dependencies are absent. |
| Hide Windows helper consoles (1.45.0) | `src/dsh-cli.ts` uses `windowsHide` for spawn and taskkill. Portable also hides its restart helpers. |
| Never replace a private Git install with a same-name npm package (1.45.0) | `src/sources.ts` and `src/updates.ts` classify external sources separately. Portable rejects unsupported external-source update mutations with original-source guidance. Full private Git update/rollback is not implemented; see `update-startup-0.6.4.md`. |
| Avoid silent old-version installs through moving npm tags | `src/install.ts` pins the selected update and checks the result, with bounded release-age recovery. |
| Remove published client sourcemaps | The bundled package ships `client/client.js`, not a client map. |
| Stop committing an obsolete registry snapshot (unreleased main commit 88c8ce33) | This is upstream repository validation/website maintenance, not a new market runtime feature. Portable uses the live Awesome catalog and conditional HTTP requests in `src/registry.ts`; do not import upstream website tooling merely to match main. |

Follow-up: review future runtime changes against Portable behavior and retained tests; keep private Git update support distinct from the already-fixed npm-source substitution. Do not change the reviewed release marker for an unreleased tooling-only commit. No release is created by this review.
