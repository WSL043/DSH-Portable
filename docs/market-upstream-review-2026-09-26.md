# Market upstream intake — 2026-09-26

This is a scoped intake, not a declaration that Portable has synchronized the market or passed product acceptance. Latest published release reviewed: [1.66.1](https://github.com/dsh-market/dsh-market/releases/tag/v1.66.1). Upstream main also contains follow-up changes after that release.

## Findings and decisions

- **Plugin command capabilities and rollback (priority):** upstream commit `78de8d3d` fixes extra pnpm options rejected by the official desktop command bridge. Audit Portable's actual native and Electron adapters separately. Do not copy recovery flags across hosts or report unsupported operations when only an option is unsupported. Acceptance must include a failed update followed by verification of the actual restored version on disk.
- **Duplicate release-age rules (priority):** the same commit merges shadowed `minimumReleaseAgeExclude` entries; main's `d8b53972` extends repair to callers declining bypass. Compare our policy writer before importing this fix. Preserve the union of existing declarations and bare package exemptions; do not globally weaken age policy. This review has not established whether the current Portable path reproduces the defect.
- **Restart ownership:** `466732c5` fixes a recovery server taking the port from a still-starting replacement. Audit Portable's own process ownership and handoff. Do not add another restart/recovery owner or merely increase every timeout.
- **Official plugin settings slots:** upstream corrected its own initial claim that `plugins.bundle.config` did not exist (`1f1ed901`). Portable already has slot compatibility code. Verify each supported core's real slot contract before removing a fallback or creating another navigation entry.
- **Annotated Git tags:** Portable's `src/updates.ts` already resolves the peeled tag before the tag object. Retain its source-specific tests; no duplicate implementation is needed solely because upstream recently fixed the same case.
- **Theme pairs and warning hierarchy:** `451fbd3b` fixes themed fills combined with hardcoded white labels. Inspect Portable in both themes. Installation-time execution disclosures should remain visible; ordinary runtime capabilities belong in understandable details, without treating a clean scan as a safety guarantee.
- **Delivery monitoring:** upstream `63a6467c` compares the deployed catalog with its source. Apply the same principle when reviewing Portable core automation: successful workflow dispatch is not evidence that a user's update index contains the qualified release.

## Focused Portable verification

The current market chooses `createOfficialTransactionRuntime` (`src/routes.ts`) and calls `operations.runProfilePnpm` directly (`src/official-transaction.ts`). It does not use the strict upstream desktop `add/remove` wrapper. Its CLI adapter preserves recovery flags. Therefore importing `acceptsMarketPnpmFlags: false` would incorrectly disable existing recovery; do not apply that change wholesale.

Both `src/install.ts` and `desktop-bridge/lib/pnpm-service.mjs` implement a one-shot `--config.minimumReleaseAge=0` recovery. Neither merges duplicate exclusion rules. This is a persistent-policy repair candidate, not proof that current installs fail. Before implementation, reproduce the first-rule-wins behavior with bundled pnpm 11.11.0 in a disposable profile, including duplicate version rules, a bare package exemption, and a successful current one-shot recovery. No user configuration was modified by this audit.

Focused tests: `tests/pnpm-service.test.mjs` 14/14; `tests/plugin-market-official-transaction.test.mjs` 7/7. These cover temporary/mock transactions, not real pnpm duplicate-rule behavior.

## Release boundary

0.7.5 Native work and 1.0 Electron Alpha are separate qualification tracks. Shared fixes can be reused only where the runtime contract matches. Neither track justifies accepting unrelated window feature requests. Issue #148 tracks clearer maximize/fullscreen entry points and native validation; configurable F11 behavior has not been promised.

Open acceptance items above remain pending. Stable publication remains subject to `stable-release-readiness.json`, including the historical session-format blocker documented in `release-0.7.5-plan.md`.
