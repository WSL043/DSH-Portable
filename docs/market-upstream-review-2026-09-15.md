# Market 1.47.0 review and core update ownership

Reviewed release: [v1.47.0](https://github.com/dsh-market/dsh-market/releases/tag/v1.47.0), published 2026-09-15. Previous reviewed basis remains v1.45.1: this is a partial applicability review, not wholesale synchronization.

## Applied

- Upstream [#550](https://github.com/dsh-market/dsh-market/pull/550): resolve a hot-mounted host package from its installed profile, rather than from the loader's package. Portable now writes the resolved entry file URL for host packages. Client-only shim names remain names so the no-op host interception still works. Unresolved entries retain normal loader error behavior; we do not guess an index.js file for exports-only packages.
- Activation failure disposal had already been fixed in the preceding Portable commit for all failures rather than only timeouts. This matches the same upstream change's intent. Cleanup remains best effort, not a promise of transaction rollback.
- Rebuilt the distributed server bundle and passed 643 repository tests. Two independent synthetic profile roots verify that package resolution does not cross profiles.

## Compatibility behavior actually found

Upstream `compatibility.ts` distinguishes risks from warnings, including explicit bounds versus loose caret bounds and optional peers. `discovery-compatibility.ts` reports compatible/incompatible/unknown from manifest facts, with expiry and bounded lookup concurrency. These are declarations and checks, not proof that arbitrary plugin code works.

Portable already has installation/update compatibility assessments, risk responses and rollback actions. This review did not establish an upgrade-time, pre-loader quarantine system that automatically disables every incompatible installed plugin. Do not tell users that such protection is complete. A market that only loads after the core starts cannot by itself protect an earlier startup failure.

Required design boundary: user-installed optional plugins must not globally block a qualified core channel. Before changing the user's core, assess the installed profile; explicit incompatibilities can be persistently disabled with a reason and recoverable configuration, unknown declarations remain warnings. Re-check after core selection changes, preserving intentional user disable choices. Runtime startup faults need scoped diagnostics; do not blindly disable infrastructure, authentication, storage or the market itself. Implement and test this separately before claiming automatic quarantine.

## Other 1.45.1 → 1.47.0 changes still requiring integration review

- Single-plugin update-all visibility (#563): compare against Portable's own client controls.
- Local link/file catalog matching memoization (#592): preserve cache invalidation on profile/source changes.
- Repository-root conflict and changelog identity fixes (#606/#604): apply to our supported sources without implying private Git update/rollback support.
- Annotated-tag peeling (#601): check the actual acceleration path Portable uses before copying it.
- Discovery compatibility and pnpm lock-shape changes: compare behavior and fixtures, not only version numbers.

## Core automation evidence

The separate Updates repository runs hourly discovery, then build/qualification/publication for eligible channels. Manual trigger [34937869845](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/34937869845) selected `0.1.6-alpha.1` at `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d` and entered candidate source build. The selection field `publish:true` means eligible to proceed, not already published. Stable correctly does not select an Alpha release.

The earlier Portable candidate-intake glob failure and this independent published-shell core delivery pipeline are different paths. Fixing the former is not proof of the latter, and an old green run before the official release cannot establish new-version delivery. Full qualification still protects Portable's own runtime/bridge/default composition, not every arbitrary user plugin.
