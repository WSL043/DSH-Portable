# Official plugin-page release-age recovery

The 0.1.7 official plugin page calls `pluginManager.removeBundle` / installation
services directly. Those calls do not pass through Portable CLI recovery or the
integrated market's `withHoistRecovery`. An existing recently published package
can therefore make pnpm reject an unrelated installation or removal while
verifying the whole lockfile.

Portable attaches a small, reversible adapter to the current host manager's
`runPnpm` method. This is an audited internal 0.1.7 seam, not a promised upstream
public API. It must be requalified when that service changes and removed when
upstream handles the error. No official files or UI are replaced. The original
method still owns subprocess cancellation, request IDs, logs and reconciliation,
inside the original mutation lock. A subprocess wrapper was rejected because it
would complicate Windows cancellation.

Only `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` on a mutating command receives one
command-local retry. Explicit age arguments, cancellation, unrelated errors and
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` do not receive this recovery. Persistent
profile configuration is untouched. Disposing the adapter restores only its own
method, never another extension's replacement.

## Acceptance

- 59 focused tests passed, including both offline default-plugin locks.
- Hidden native WebView2 on the existing isolated 0.1.7-alpha.1 fixture:
  cancel uninstall, confirm uninstall, reinstall image viewer 0.1.2 through the
  official Add plugin dialog, Enable now, return to list, enabled state and
  editable new-session composer passed with no page errors.
- Real pnpm logs record the original age violation on the existing context
  plugin, followed by successful recovery. No network response was mocked.
- Local evidence: `build/official-plugin-cycle/result.json` and screenshots.
  Earlier harness failures (wrong detail/list expectations and asynchronous
  enable-state assertion) are retained separately, not discarded.
- This fixture evidence does not replace exact release-artifact CI qualification.

The 0.7.2 default Chat Manager pin is the published 1.5.1 package. GitHub and npm
tarballs were compared byte for byte; SHA-256:
`ba0d411e21b09e8f4426c02d57ce4d619530e8235ea42ad4f1a5ccc4adc6899d`.
