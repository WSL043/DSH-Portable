# CodeQL initial triage — 2026-09-17

This is a partial review, not a completed security audit. The raw open-alert
snapshot is retained locally in `build/codeql-open.jsonl`.

## Confirmed hardening

Alerts #788–#790 identify environment/configurable timer durations in the plugin
market. Negative, non-finite and overflowing values previously reached Node
timers directly. Invalid values now use the existing default; hot activation is
capped at 60 seconds and installation at one hour. Small positive CI overrides
remain supported. The desktop provider timeout receives the same validation.
This is robustness hardening, not evidence of a remotely exploitable attack.
Scanner closure still requires a subsequent analysis.

## Individually reviewed findings

- #861, `tests/windows-terminal.test.mjs`: a test-only compiler executable path
  derives from the locally inherited WINDIR. The compiler receives separate
  argument-array entries. No network/client input reaches the executable path.
- #811, `launcher/portable-core.mjs`: the PowerShell executable derives from
  locally inherited SystemRoot/WINDIR. The only interpolated process ID is
  checked with Number.isSafeInteger and must be positive. No arbitrary command
  text from the caller is interpolated.
- #812, the same module: the browser-process query is a fixed command; only the
  locally inherited Windows directory affects executable selection.

These three are false positives for command injection across the application's
input boundary, assuming the launching user's environment is trusted. This does
not assert safety when an attacker already controls the launch environment or
can replace system executables. No other alerts are dismissed by similarity.

## Remaining work

- Review the URL passed to the Windows default-browser shell fallback.
- Review launcher, desktop bridge and market path traversal findings using actual
  input sources, canonicalization and write/delete boundaries.
- Review plugin import execution, network requests and the Actions cache finding.
- Treat test/build paths individually; their location alone is not dismissal evidence.
- Keep the separate Linux glib dependency advisory open pending a compatible fix.

Do not disable scanning or bulk-dismiss alerts to reduce the displayed count.

## Follow-up: browser fallback

The Windows workspace fallback no longer passes a URL through cmd.exe /c start.
It invokes Explorer with an argument array and validates an HTTP loopback URL
without credentials. macOS uses /usr/bin/open; Linux uses xdg-open. Tests cover
query separators and rejected remote/executable URLs. Native default-browser
acceptance remains pending; this change is not a claim that all command alerts
are resolved.
