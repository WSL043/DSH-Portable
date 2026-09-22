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

The plugin-update validation fix is a Portable change, not part of the already
published 0.7.0-based core component. See plugin-update-existing-profile-recovery.md.
