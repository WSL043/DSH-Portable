# Descriptor v2 read compatibility experiment

The reviewed transform is now a candidate build adaptation in `scripts/patch-historical-descriptor.mjs`; this directory contains its research and acceptance harness. Stable publication still requires final product qualification. The read-time launcher does not mutate the installed runtime.

## Source evidence

Official commit `f76a225a7d` changed `packages/subagent/subagent/src/descriptor.ts` from descriptor version 2 to 3 and added optional `agentReasoningEffort` to continuable descriptors. Existing provider/model, persona and tool-filter members remain. The current `foldSubagentDescriptor` refuses non-current versions; merely admitting v2 through the format validator is therefore insufficient for child composition recovery.

This experiment targets only the exact published alpha.1 migration bundle with SHA-256 `1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1`. It normalizes v2 in the v0-to-v1 read stage by creating detached event/data objects, forbids the v3-only reasoning-effort field on v2 input and retains the official key/semantic validation. It does not invent a reasoning effort, modify transcript files, weaken validation for unknown versions, or change the descriptor runtime parser.

## Execution

`node experiments/descriptor-v2/probe.mjs <verified-stable-app-directory> <new-experiment-directory>`

The harness refuses an existing destination and copies the app dependency closure before modifying its copy. Seven checks passed on 2026-09-27: one-shot v2, continuable v2, unchanged v3 control, rejection of unknown version, v2 reasoning-effort member, unknown member and unpaired provider/model. Successful restores traversed the actual official format catalog and were recognized by the actual subagent descriptor fold. All input rows remained byte-equivalent when serialized. Local report: `build/descriptor-v2-probe-1/result.json`.

These are synthetic schema/composition probes, not full historical recovery evidence. Remaining requirements before product integration:

- Generate or obtain complete fixtures from the released v2 writer; preserve physical headers, event sequence, delivery markers and parent/child facts.
- Verify parent/child reconstruction, inherited history, tool results and actual continuation with a local deterministic provider.
- Verify source file hashes before/after read-only loading and interrupted/error paths; check the official save path separately rather than promising all later writes are read-only.
- Test exact final product packages and bind compatibility-patch identity to qualification evidence; an upstream package integrity alone would no longer identify the modified runtime.
- Remove the adapter once an official release provides the equivalent migration, after running the same fixtures against that release.

Do not set historicalSessionMigration to passed based on this experiment.

## Candidate continuation and packaging

`continuation-probe.mjs` mounts the actual current Cordis services, JSONL persistence and AgentLoop. A local deterministic LlmAdapter receives the inherited parent and child tool results, produces a new response, and the official storage backend saves it. Reopening checks the response is durable; a persisted unclosed turn is closed as interrupted on resume and another model turn succeeds. Original historical files retain their hashes. This exercises official storage and agent execution; it is not a physical power-loss test or full subagent-manager UI test.

Local result: `build/descriptor-v2-continuation-4/result.json`. `scripts/verify-historical-session.mjs` now repeats the writer and continuation checks against each staged alpha.1 app. Old writer dependencies live in an isolated temporary directory outside the entire product stage, removed after the probe; structured evidence is printed to the build log. The output bundle SHA-256 and immutable patch identity are verified before packaging and required by the publication evidence check. The old source/unknown-input refusal remains strict. No RC2 runtime is adapted by this alpha.1 patch.

## Published writer probe (2026-09-27)

`writer/` pins the published 0.1.1-rc.2 writer packages and dependency lock. Install with pnpm 11.7.0 using `--frozen-lockfile --ignore-scripts`; automatic peers are disabled to avoid silently mixing current DSH packages. This is a writer-only closure, not a complete old DSH host.

`node experiments/descriptor-v2/writer-probe.mjs <writer-root> <patched-app> <unmodified-app> <new-output>`

The probe invokes the released Session, descriptor snapshot, seed builder and event packer. Physical header mapping follows the published JSONL backend; it does not invoke that backend's flush method. Turn/step numbering and message ordering follow the published agent-loop. The fixture is generated test data, not a recovered user transcript or an old full-agent execution.

Pinned execution passed seven checks: exact writer versions; original runtime rejects the identical child; migrated parent catalog discovers the child; inherited message identities and migrated contents agree; descriptor route/persona/tool filter survive; parent/child tool results survive; both source-file hashes remain unchanged. Evidence: `build/descriptor-v2-writer-probe-pinned-2/result.json`.

Early fixture attempts exposed mistakes in the test harness (message before step, zero-based turn, incorrect tool-call member names), corrected against the released agent-loop/types. Another assertion incorrectly expected unchanged raw event counts and payload shape: official migration adds the system head and converts tool-result representation. The final checks compare original message identities, exact tool content/call identity, and independently migrated parent contents. No production validator was relaxed to make these fixtures pass.

Actual agent continuation, official persistence write/reopen, interruption behavior and final product/native acceptance remain open. This result does not qualify a release.
