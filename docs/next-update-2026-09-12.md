# Changes queued after 0.6.7

Scope: local commits for the next release; no version bump or publication.

## Update-feed reliability

- Read update manifests and version catalogs incrementally. Stop and cancel the
  response once decoded bytes exceed the existing 256 KiB limit, even when
  Content-Length is absent or incorrect. Previously the entire response was
  buffered before enforcing the limit. Normal responses retain the same timeout,
  JSON validation and compatibility checks.
- Report HTTP 404 for an explicitly configured Portable catalog URL instead of
  disguising a broken URL as an empty version list. Default unpublished feeds
  retain their existing empty-list behavior, consistent with the engine path.

Focused verification: 40 update-core tests passed, including a never-ending
chunked response, incorrect Content-Length, an exactly-at-limit valid catalog,
and default versus explicit 404 handling. The full source suite passed 611 tests
with no failures or skips; local output is build/next-update-source-tests.log.
Exact-package native and five-platform
release acceptance remains required before publication.

## Maintenance review

No open issues or pull requests were returned by GitHub on 2026-09-12.
Core publisher run 34633597815 failed while node-gyp fetched official Node
headers on macOS Intel (ConnectTimeoutError to nodejs.org), before runtime
acceptance. This is a build-network failure, not evidence of a Portable startup
regression. Later successful runs do not erase that failure. If recurring,
investigate using matching preinstalled SDK headers or a verified header cache;
do not add blanket build retries or relax qualification gates.

The older next-release-maintenance.md documents the 0.6.4-era work and is retained
as historical evidence, not the pending version's current checklist.
