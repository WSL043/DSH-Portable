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

### Exact-commit acceptance, 2026-09-23

[Run 35851853558](https://github.com/WSL043/DSH-Portable/actions/runs/35851853558)
qualified commit `079867f` with all 37 jobs passing. On the cold cache path,
the independent WebView2 capsule job completed in 9m18s and saved the verified
283,213,948-byte capsule. The complete-offline job then restored that exact
cache key, verified its pinned SHA-256 and composed the ZIP in **21.4s**
(27s for the whole step), versus **548s** for the corresponding packaging step
in run 35847051717. Both the system-WebView2 and bundled-WebView2 native
startup checks passed. The final complete ZIP uploaded successfully.

The full run took **26m20s**; the previous accepted run took **27m53s** but
included a transient diagnostic-upload rerun, so their difference is not a
controlled estimate of the cache's effect on total time. The current critical
path was the locked official package set (5m41s), Windows base build (10m03s),
then Windows 2025 native lifecycle (10m19s). The cached complete-offline job
finished earlier and no longer determined completion time. Measure those three
stages before changing their build or acceptance boundaries. The new cache key
has not yet been observed as a hit in a separate workflow run; the same-run
handoff and product acceptance are proven.

### Windows base build and cold-runner evidence

[Run 35855719210](https://github.com/WSL043/DSH-Portable/actions/runs/35855719210)
measured the Windows base builder after adding phase markers: runtime staging
and patches 63.0s, native host compilation 7.3s, component update packaging
169.8s, product archive and manifest 181.4s. The two archives reported the
same inner DSH capsule SHA-256, so the builder now prepares that capsule once
per build, verifies its bytes against its manifest when copying it into each
archive, and retains separate outer ZIP hashes and product smoke gates. The
exact-run speedup remains to be measured.

Splitting independent native UI checks from the Windows lifecycle shortened
the serial gate, but exposed cold-runner timing assumptions. The Windows 2022
UI fixture in run 35855719210 had not finished extracting its first
10,615-file capsule before a 90s total script deadline. After separating cold
extraction and post-extraction limits, both UI runners passed in
[run 35857746239](https://github.com/WSL043/DSH-Portable/actions/runs/35857746239).
That run's Windows 2022 lifecycle fixture then hit its 75s hosted-runner
ceiling while still writing file 6,654 of 10,615; it had not crashed or
reached the Host yet. The hosted functional ceiling is raised only for that
runner, with distinct preparation and post-preparation bounds. The controlled
machine's 20s first-start performance target is unchanged. The exact-head
qualification resolving this gate is recorded below.

### Exact-head product qualification after capsule reuse

[Run 35860110706](https://github.com/WSL043/DSH-Portable/actions/runs/35860110706)
qualified commit `4b1572f` with all **39 jobs passing** across Windows,
macOS and Linux, including Windows 2022/2025 native UI and lifecycle, the
complete-offline WebView2 bundle, previous-release upgrade and component
update. The run took **18m37s** from creation to its final gate. This is an
observed run duration, not a controlled estimate of one optimization: runner
load, the parallel job graph and a cold WebView2 capsule cache all differ from
the earlier 26m20s run.

The Windows base builder's own measured phases fell from **424.7s** in run
35855719210 to **254.4s** here. Its one DSH capsule preparation took 171.8s;
the component update package then took 4.1s and the outer product archive and
manifest 11.8s, instead of 169.8s and 181.4s for the corresponding two
packaging phases in the earlier run. The base-build job finished in 6m10s
versus 10m03s in run 35851853558. Both output manifests record the same
inner capsule SHA-256
`459b5dd3a7f440687e6f52212452bb85d43c6810d077448d6fc8f850b7d85d0c`;
their outer archives retain independent hashes. The archive size comparison
changed by only 290 bytes. This is build-time work elimination, not a package
size reduction or a claim that a user's first extraction is faster.

The reviewed WebView2 capsule cache missed on this run because the common
capsule-builder script changed the exact cache key. The CAB cache hit, the
capsule was rebuilt and verified, and the new cache entry was saved. Do not
count this run as a cross-run capsule cache hit.

The Windows 2022 cold-runner trace in 35857746239 showed about 0.52s for
the 10,615-entry index and hashes, 24.56s for 2,164 ancestor directories,
and file writes still active at its former 75s deadline. A separate local
directory-only A/B used a real 10,257-entry capsule with 2,070 directories:
four alternating trials of the current level barrier and a bounded
parent-ready DAG took 198–218ms, with no useful difference. That local disk
does not reproduce the hosted runner's 24.56s directory stage. The DAG change
was therefore not promoted; the shipped extraction algorithm, per-entry
verification and atomic ready marker remain unchanged. Hosted functional
limits were separated by phase; the controlled-machine first-start target
remains 20s.

A follow-up workflow audit found no redundant platform build or product gate.
The unrelated glib security regression took 69s on the same commit even
without Linux-native changes; a path-scoped trigger could save runner work,
but does not explain this product run's critical path. Duplicate footprint
artifact uploads cost about one second per builder. Neither small workflow
change was made just to improve a counter without a meaningful gate or
user-facing benefit.
