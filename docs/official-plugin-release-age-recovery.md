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

The exact 0.7.2 Windows package exposed a second bundled pnpm 11.11.0 failure during
official-page uninstall: `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` after
the lockfile passed verification. Only `remove` / `rm` / `uninstall` receive
the same one-time retry for that error. Adding or updating a package does not,
because those operations can select a new release that the age policy rejects.
The original failed run and the follow-up operation are kept in the package
manager's logs.

## Acceptance

- 92 focused tests passed, including both offline default-plugin locks.
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
- The first exact Windows candidate passed CI but failed native official-page
  uninstall on a fresh profile with
  `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED`. Its ZIP, initial failure
  screenshot and pnpm log were retained. A fresh isolated copy reproduced it.
  The bounded removal-only retry then passed cancel, uninstall, reinstall,
  enable and composer on that fresh copy. That diagnostic overlay disabled the
  runtime source cache, which otherwise correctly reads the immutable shipped
  capsule rather than modified extracted files. Release qualification now
  requires the exact Windows package to repeat the complete official plugin
  page cycle with its normal source cache; the CI job retains UI screenshots,
  result JSON and package-manager logs even on failure.

The 0.7.2 default Chat Manager pin is the published 1.5.1 package. GitHub and npm
tarballs were compared byte for byte; SHA-256:
`ba0d411e21b09e8f4426c02d57ce4d619530e8235ea42ad4f1a5ccc4adc6899d`.

## rc.3 package selection (2026-10-25)

[Chat Manager issue #32](https://github.com/WSL043/dsh-chat-manager/issues/32) reported pnpm11.21.0 selecting1.5.16 after an unversioned Hub install. Both pnpm11.11 and11.21 default to a24-hour minimum release age. At the issue timestamp,1.5.17/1.5.18 had not passed that window; a bare add may also reuse an existing dependency specifier. These mechanisms explain plausible old-version selection, but the original profile and complete logs are required to identify its unique cause. DSH checks peers after package selection; it does not search for a host-compatible alternative.

A fresh isolated profile using the complete0.9.7 rc.3 package now installs and activates1.5.18 through the bare official add command, with exit0 and no peer exemptions. Its declared rc.3 peers match. This is CLI/profile evidence; it does not reproduce the reporter's prior desktop carrier. The recovery adapter above does not disable release-age filtering for new additions or relax peer declarations.
