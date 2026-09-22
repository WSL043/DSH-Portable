# Plugin update recovery: existing profile faults

## Report and cause

The 0.7.0 user profile reported failed updates for chat manager, image viewer,
context, and a GitHub plugin. The real package-manager operations exited 0,
but the composition trial rejected a pre-existing missing layer:
`@deepseek-ai/dsh-experimental-agent-team-web-profile`.
The update route attributed every composition error to the new build and rolled
back unrelated valid updates. Earlier clean-profile acceptance missed this case.

The GitHub plugin also reached the current remote commit. Retrying an old card
treated an unchanged commit as failure without checking whether it was current.

## Fix boundary

Capture composition errors before mutation. Compare exact layer/message counts
afterward; newly introduced or worsened errors still roll back. Any error involving
the updated target remains blocking, even when present before the update.
Target entry/import checks remain active. Unchanged unrelated faults are retained
in configuration, returned as `profileWarnings`, and recorded in diagnostics.
Reorder validation remains strict. No user data or unrelated bundle is removed.

An unchanged Git commit is accepted only after a fresh remote ref lookup confirms
it is current. An unreachable remote or a different commit still produces the
stale-update result. Loading and composition checks still follow this check.

## Acceptance, 2026-09-23

- 47 targeted route, rollback, Git ref, preflight, transaction, and completion tests passed.
- Hidden native WebView2 using an isolated expanded 0.7.0 / DSH alpha.1 product
  with the rebuilt market: actual downloads and update clicks for chat manager
  1.4.0-beta.3 to 1.5.0, image viewer 0.1.1 to 0.1.2, context 0.54.3 to 0.54.4,
  and Qwen QoL Git commit 3280116 to 5fe5f74 succeeded while the missing official
  layer remained present. The plugin page stayed open; disabled chat stayed disabled.
- Repeated Git update at the current commit succeeded. A real restart-button
  operation opened a replacement native window; its composer accepted text and
  plugin state remained correct. Screenshots inspected; no captured page errors.
- Original restart harness failure retained: it waited on the closed pre-restart
  WebView. The focused follow-up reconnected to the new native window, without
  changing product code to bypass restart.

Local evidence: `build/existing-profile-update-acceptance`,
`build/existing-profile-update-final`, `build/existing-profile-update-restart`,
and `build/plugin-update-fix-final-tests.log`.
These prove the focused local fix, not publication or installation into the
user's currently running product. Full 0.7.1 artifact qualification is separate.
