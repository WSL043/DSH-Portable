# DSH 0.1.6-alpha.1 intake — 2026-09-15

Status: discovered, NOT qualified. Stable and preview product pins remain unchanged.

## Verified failure and fix

Official candidate intake run 34932222889 failed because the source metadata reader only recognized `packages/!(experimental)/*/package.json`. Upstream now uses `packages/*/*/package.json` and excludes manifests with `private: true` in its release member selection. The reader now supports both reviewed layouts, still rejects unknown globs, and reads private flags for the new layout in bounded batches. No upstream release script is executed during discovery.

Live discovery resolved `dsh-v0.1.6-alpha.1` to `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`, pnpm 11.7.0, 285 DSH packages, 9 vendor packages, and no standalone landlock package. Candidate integrity and notices were fetched by the existing intake code. The proposed lock is retained in ignored local evidence, not promoted into a qualified channel.

## Qualification blocker

Trying the proposed preview lock produced 638 passing contracts, one failure and one promotion-only skip. The failure is `the bundled market peer ranges cover each verified official DSH channel`: bundled `@deepseek-ai/dsh-settings` peer ranges do not include the 0.1.6 prerelease. No peer declaration or test was weakened to force acceptance. This is an eligibility failure, not evidence that every market operation actually breaks.

Before promotion:

1. Validate market settings and plugin install/remove/update against the 0.1.6 settings/loader services, then add the demonstrated supported range.
2. Validate default image viewer and session manager against the new preview and session APIs. Upstream introduces archived-session UI, changes agent initialization to `agent/created`, and deprecates synchronous session history APIs; do not infer default-plugin compatibility from the Portable source tests.
3. Inspect PTC package/service renames, module-route recovery and changed hot-reload failure behavior before preserving old integration assumptions.
4. Run actual candidate artifact builds. Current main CI selects the upstream lock by Portable product version, so green stable CI must not be described as 0.1.6 qualification. The candidate intake workflow's existing claim of full candidate qualification needs corresponding candidate build selection before it can serve as evidence.

## Desktop scope

## Follow-up implementation

- Fixed market hot activation cleanup: every activation rejection now attempts to dispose its partially mounted fiber, not just timeouts. This matters because upstream no longer promises transactional activation rollback. Disposal is best effort and never masks the original failure or blocks the request indefinitely; the UI still requires restart and does not claim rollback succeeded. Rebuilt the shipped server bundle.
- Executed the existing market settings adapter with real published `dsh-settings@0.1.6-alpha.1`, `cordis@4.0.2` and `schemastery@3.18.2`. In-memory provider writes toggled allowRestart both ways and preserved the unrelated beta channel. Added the corresponding optional settings peer range only after this probe passed. This resolves the declaration blocker above, not complete market qualification.
- In the separate dsh-chat-manager development repository, restoration now prefers official `workspaceRegistry.unarchiveSession()` and retains the old private registry fallback only when the public method is absent. Public API errors propagate without private writes. The Portable bundled plugin version is unchanged pending plugin release/acceptance.
- Portable regression: 642 passed. After peer metadata edits, affected market tests: 54 passed. Chat archive behavior: 15 passed; full plugin suite: 90 passed, one documentation-version assertion failed (README fixed 1.3.3 versus test expecting 1.3.4). No complete plugin acceptance is claimed.

Reproduce the settings probe by installing the three exact packages above in an isolated `build/alpha016-settings` directory, then running `node experiments/official-desktop/probe-market-settings.mjs`. It uses actual service lifecycle and synthetic memory persistence, not the user's running profile. Evidence is `build/alpha016-settings/result.json`.

## Desktop source report

The desktop source report observed 15 changed files since the reviewed baseline, at master `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`. Changes include host, main, profiles and packaging. The review baseline was NOT advanced automatically. This release has no GitHub release assets; a production signed desktop artifact has not been verified.

Evidence: `build/official-desktop-intake/alpha-intake.json`, `proposed-preview.json`, `alpha-regression.log`, `report.json`. Temporary candidate lock was restored after preserving the failing evidence.

Sources: [official release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1), [release family source](https://github.com/deepseek-ai/deepseek-harness/blob/0a15e36e7f82b6ed45af6fa9759f29b40dcd965d/scripts/release/families.ts), [failed intake](https://github.com/WSL043/DSH-Portable/actions/runs/34932222889).
