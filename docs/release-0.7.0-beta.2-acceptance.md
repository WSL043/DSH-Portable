# 0.7.0-beta.2 acceptance

- Qualified source: `7b089bbbfa4cdd99aedf82809638f411024ca4da`.
- CI: [35270215366](https://github.com/WSL043/DSH-Portable/actions/runs/35270215366), all 35 jobs successful.
- Source suite: 679 passed, 1 skipped. Release/default-plugin preflight: 20 passed.
- Publication: public prerelease with all 10 user assets; latest stable remains
  `v0.6.9`. Candidate indexes on all five platforms include Beta 2 and exclude Beta 1.
- Publication attempt 1 stopped on GitHub HTTP 422 (`ReleaseAsset.name already
  exists`) after several uploads had completed. The release remained draft.
  One evidence-backed retry of publication was requested; the 35-job product
  qualification was not rerun or relaxed.
- Attempt 2 published the user release but stalled on channel uploads. It was
  cancelled; recovery reused four server-verified component archives and fetched
  only the missing macOS x64 component from qualified CI artifact 10518725507.
  The artifact wrapper and component SHA256 were both verified. An HTTP 500
  upload failed; one bounded retry completed. All five uploaded component
  digests and sizes match the qualified manifests. Versioned manifests were
  uploaded before latest manifests and indexes; all five indexes were read back
  with exact digest verification. This is manual recovery, not a successful
  publisher workflow run. Independent core-catalog synchronization still has a
  GitHub upload-service failure and is not counted as completed here.

## Regression and recovery evidence

The existing profile retained chat-manager 1.3.5 after the offline default-plugin
upgrade failed resolving an unrelated optional dependency. In an isolated alpha2
active-session A/B, the official workspace accepted text; enabling chat-manager
1.3.5 produced new-session failures and an inert composer.

Suspending only that bundle, while retaining its dependency, code and session
data, restored text entry and navigation from Plugins to an existing session.
The same checks passed with the user's other plugin versions represented by
code-only copies: image-viewer 0.1.0, subscription 2.1.2 and AppShots 0.1.0-alpha.3.
No message was submitted; no user credentials or conversations were copied.

Local evidence remains in `build/input-editability-control-20260918/`,
`build/input-editability-chat13-20260918/` and
`build/input-editability-oldstack-20260918/`. These are synthetic fixture results,
not direct DOM inspection of the user's running installation.

## Product and harness qualification

The first run, 35267639787, failed on Windows 2022 because a late official
provider onboarding dialog made the market harness choose legacy navigation.
Failure artifacts were preserved under `build/beta2-ci-evidence/`; the harness
now dismisses only recognized onboarding prompts and detects the actual settings
navigation. No timeout or release gate was relaxed.

The corrected harness also passed on the Windows Beta 2 artifact from that run
in hidden native WebView2. Payload SHA256:
`6ce69374528900364d7cd9f376c85646cd1eeec5e350956e65471a50a7d4c0a7`.
This local result is supplementary; the final source is qualified by the later
35-job run, including both Windows native runners and all packaged platforms.

The complete-offline build step took 18m36s, including download and packaging.
Its subsequent system/bundled WebView2 startup check took 55s and passed.
Download versus compression time is not separately measured by this workflow.

## Remaining limit

Offline default-plugin upgrades can still fail when unrelated existing plugin
dependencies are absent from the local store. Beta 2 recovers the specifically
reproduced chat-manager/core incompatibility; it does not claim universal plugin
compatibility or to solve every offline dependency resolution failure.
