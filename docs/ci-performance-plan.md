# CI critical path review — 2026-09-18

Observed run: 35270215366, source 7b089bbbfa4cdd99aedf82809638f411024ca4da.
At inspection: Windows contracts 1.8 min, official source package set 5.0 min,
Windows base artifacts 9.1 min; complete offline packaging step 18m36s,
followed by 55s of successful native system/bundled runtime startup checks.
These are job wall times, not individual download/compression measurements.

Confirmed redundant work:

- Every preview qualification reinstalls and packs the same locked official
  commit; there is no dependency/package-set cache.
- Complete offline packaging downloads, expands, verifies and compresses the
  same locked WebView2 payload on every run, with Zstd level 22 and no cache.
- That product-independent payload work starts only after Windows base build.
- The outer ZIP and artifact upload recompress already compressed capsules.
- One build step combines download and packaging, preventing attribution of
  its elapsed time to individual phases.

Implement in order, retaining release gates:

1. Emit phase timings for download, source verification, capsule compression,
   outer ZIP and upload. Disable PowerShell download progress output in CI.
2. Cache the verified WebView2 capsule by source CAB SHA256, architecture,
   Node version, capsule format and builder script hashes. No broad fallback
   restore keys. Recheck source-lock identity, capsule hash and length on reuse;
   reject corrupt entries. Never cache user data or mutable runtime state.
3. Produce that capsule independently of the Portable base build; compose the
   final offline ZIP after both are ready. Keep both system-runtime and bundled
   runtime startup acceptance on every final product.
4. Reuse official source packages only by exact upstream commit, frozen lock,
   package-manager/toolchain versions and build recipe. Still validate expected
   package inventory and integrity on every use.
5. Measure outer ZIP store mode and artifact upload compression-level 0 before
   changing defaults. Preserve download size requirements; do not lower inner
   compression merely to make a CI timer green.
6. Record per-asset release upload duration and impose bounded job/step timeouts.
   A release must stay draft until all expected assets are uploaded and checked.
   Resume only missing/failed uploads after verifying existing asset identity,
   instead of blindly uploading every large archive again. The Beta 2 publishing
   run showed long-lived `starter` assets, followed by successful transitions;
   that observation alone does not establish a hung request or its cause.

Implemented after qualification:

- Sequential release uploads bounded to 10 minutes per file, with server SHA256,
  size and uploaded-state verification. Identical files are reused; lost responses
  are checked without blind re-upload. Immutable conflicts fail. Public user
  releases are verification-only when resuming; shared channel publishing is serialized.
- Component archives upload once under immutable versioned names. Latest
  manifests reference those URLs; stable promotion reuses the stable assets.
  Index publication follows completed assets. No duplicate bootstrap ZIP is
  uploaded to the channel: its manifest references the public version release.
- Exact-lock CAB download cache, checked against the reviewed SHA256 on every
  use; corrupt hits are discarded. Download bounded to 300 seconds.
- Separate download/packaging timing, no PowerShell progress rendering, artifact
  compression level zero for the already compressed complete-offline ZIP.

Capsule compression caching, upstream package-set caching and job parallelization
remain follow-up work. No measured timing reduction is claimed before a new CI run.
Product qualification has not been rerun or weakened for these workflow changes.

## 2026-09-23 follow-up

Run 35847051717 reached qualification in about 28 minutes. The Windows complete
offline packaging step took 548 seconds; the CAB download took about one second.
Repacking an already extracted complete bundle locally took 9 seconds with the
existing ZIP writer. A selective ZIP experiment saved only about four seconds,
so it was discarded. The expensive work is the independently versioned,
level-22 WebView2 capsule created from about 837 MiB of signed runtime files.

The reviewed WebView2 lock now pins the exact capsule digest, byte count and
file inventory from the published 0.7.5-alpha.1 package. A separate CI job
prepares or restores this product-independent capsule in parallel with the
official DSH build. The complete-offline job reuses it only after checking the
pin, manifest and lock identity; on a cache miss it builds and verifies the
same capsule. Both system-WebView and bundled-WebView native startup gates stay
in place. A local build using the pinned cache took 11 seconds to compose the
complete ZIP; the new CI cold and warm paths still require exact-commit runs.

The prior CI's macOS x64 native smoke passed, but its diagnostic artifact
upload failed with a GitHub endpoint DNS error. CI now retries that upload once
and still fails if both attempts fail. Artifact transfers were secondary in the
timing data, so splitting every build artifact was not promoted as the first
optimization. Official-source package-set caching remains a separate measured
follow-up.
