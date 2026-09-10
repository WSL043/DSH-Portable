# Issue 132: small-release follow-up

## Verified

- 0.4.13 and 0.6.4 reject a non-link at the private bridge fallback.
- Current startup reaches the private fallback before the general resolver repair.
- General resolver pruning preserves the two private Portable components.
- 0.4.13 data export excludes node_modules; import preflight reinstalls profile dependencies with install --force.
- Before the follow-up refactor, generated bridge diagnostics accepted any existing path. Startup, diagnosis and repair now share inspectPackageFallback, including link target identity and unknown-content protection.
- The Windows 0.6.4 targeted package passed synthetic conflict recovery and backend startup/shutdown, not user-data or automode acceptance.

## Landed for the next release

The bounded refactor stays in portable-core rather than adding a separate packaging dependency. repair-core consumes its read-only inspection API; unknown generated content no longer implies a missing product package. Startup and repair use the same state classifier.

- Preserve recognized materialized private packages and empty directories outside node_modules before rebuilding their links.
- Preserve unknown content unchanged.
- Report the retained backup location when both link creation and rollback fail.
- Cover both private components, original bytes, unchanged web profile, idempotence and relocation in regression tests. Test fixtures clean up their own temporary parent.

## Still requires evidence

- The reporter has not confirmed a pristine 0.6.4 installation. Their third scenario is not proof of a clean-environment reproduction.
- Capture link type before and after actual automode installation/profile rehydration. The component that materialized the directory is not established.
- Validate recovery against the reporter's copy before closing the issue.
- Session grouping recovery is separate; do not promise lossless recovery based on startup success.
- Filesystem fault injection now verifies both link creation failure with successful rollback and simultaneous rollback failure: original bytes remain available. Physical power-loss recovery is not qualified.

Do not recommend deleting the whole resolver tree as a first-line user recovery step. Do not replace the published stable asset with this diagnostic build.
