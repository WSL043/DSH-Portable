# Official 0.1.7-alpha.2 intake

Official immutable source: `00102833dfaee1da9f48a3a8eae9d34005a75218`.
The preview lock records its npm integrity and notices hash. Stable bundled
baseline remains alpha.1; independent core delivery is separate.

Upstream adds backend-restart reconnection preserving history/drafts, first-use
public registry selection while retaining configured/private registries, scrolling
and input fixes, speech preference persistence, model labels, and token-based
tool-result budgets. Portable does not replace these official capabilities.

## Confirmed delivery

[Core qualification 35759953027](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/35759953027)
passed all five platforms, including native Windows default-plugin UI, and
published successfully. Read back all five candidate indexes: each contains
alpha.2 for Portable 0.7.0 at the immutable source above. Windows capsule SHA256:
`d21db170590004d9fb983242a889e0babee2c94ba19dcbdd171ce4c4b03dffa5`.
Readback evidence: `build/alpha7-2-published`.

The earlier run 35731464185 also published alpha.1 successfully; its overall red
status came from historical-core backfill. Do not describe this as no core delivery.
Updates commit `3d7a2ee` adds early checking for the bundled chat 1.5.0 official
session-menu capability and separate per-channel delivery summaries. Old cores
without that capability are not eligible merely because they can boot. Its
38 tests and actionlint passed; the alpha.2 run started before this workflow change.

Preview product run 35759613918 separately reported a Windows previous-release
upgrade compatibility failure. Its original job log is retained at
`build/alpha7-2-upgrade-job.log`; independent core success does not erase this
product qualification failure. The next product must pass its own exact build.

Investigation of that original log found successful workspace readiness followed
by a five-second CIM process-query timeout during preflight shutdown. The 0.7.1
candidate now closes its existing Windows kernel job when that query times out;
without an active owned job it still fails closed. It neither treats unknown
processes as gone nor kills processes by name. Native fault-injection acceptance
confirmed a replacement WebView and new backend boot ID, with diagnostics
exported; evidence `build/query-timeout-native.log`. This injected case is now
part of both Windows native artifact jobs. Full artifact rerun remains required.

The plugin-update validation fix is a Portable change, not part of the already
published 0.7.0-based core component. See plugin-update-existing-profile-recovery.md.
# Published Portable 0.7.1 baseline

Run [35766664331](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/35766664331)
completed all five platform builds and published the candidate channel. Public
catalog readback confirms DSH 0.1.7-alpha.2, source
`00102833dfaee1da9f48a3a8eae9d34005a75218`, for Portable 0.7.1.
Windows shell fingerprint is
`09a5c271e17aea3e6bee65c8739ecc36d36fe303b89caba4566e23cd811fffc3`;
capsule SHA-256 is
`b47655e898dbd086c09f9159436e406f755bdfde39394bfc8ba92ac34d261e31`.
This is delivered evidence, not merely a dispatched run. Historical cores still
require their own compatible-baseline qualification.
