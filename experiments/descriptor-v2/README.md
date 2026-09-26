# Descriptor v2 read compatibility experiment

Not a production patch. No builder or launcher imports this directory. Stable publication remains blocked.

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
