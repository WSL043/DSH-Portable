# 0.6.4 release qualification

The Windows trial at shell commit `873dd68` was accepted by the user on
2026-09-09. This closes the local visual trial; publication still requires the
release workflow's exact-commit cross-platform product gates.

## Local evidence

- A fresh hidden native-host run on Windows 11 recorded the native loading
  surface at 244 ms, WebView initialization behind that surface at 345 ms, and
  interactive readiness at 5,574 ms. The startup-transition check passed and
  stopped its owned backend and host. This is one observed run, not a benchmark.
- The repository suite passed 548 tests with one conditional skip. Packaged
  guide contracts passed 52 tests. README and release-note checks passed 46.
- Chat Manager `1.3.3` is already published from `b44a31c`; its release workflow
  `34263567655` passed. Its unchanged source passed 86 checks during this review.
- Image Viewer `0.1.0` promotes the accepted `rc.2` implementation, including
  independently rendered annotations. Release run `34311497849` passed actual
  operations on official DSH `0.1.2-rc.1` and `0.1.5-alpha.1` and published npm
  and GitHub assets. The downloaded archive SHA-256 is
  `b5ec2650997bfb2db14854f41c26539ced958c1684b6b4597b4244cea6d25a20`;
  both Portable locks and the runtime installer use its verified integrity.
- A local upgrade fixture replaced `rc.2` with the published `0.1.0` archive.
  The first preparation omitted the matching component receipt and correctly
  failed before backend launch; `portable-errors.jsonl` identified the mismatch.
  After correcting that fixture receipt, the native run reported
  `default-plugins-ready: updated`, Image Viewer `0.1.0`, Chat Manager `1.3.3`,
  and interactive readiness at 5,411 ms. The transition check passed. Release
  builders generate this receipt from the same lock as the archive list.

## Startup performance interpretation

The startup module cache reads sources from the integrity-verified immutable
runtime capsule. A controlled slow-file-read comparison recorded 18,668 ms
versus 6,215 ms for imports and 19,644 ms versus 7,409 ms to interactivity.
The injected delays model slow reads; these figures are not ordinary startup
promises. A later user run imported in 1,017 ms and became interactive in
2,174 ms. Preserve slow samples and diagnostic history rather than assuming
every long start has the same cause.

## Screenshots and package layout

`assets/dsh-workspace-0.6.4.png` is a direct WebView page capture from the local
acceptance run. `assets/windows-navigation-dark.png` is a separate native
navigation capture from the same shell revision. They are not composited.
Off-screen PrintWindow does not capture the WebView compositor reliably and
is not evidence of on-screen frame continuity.

The package root provides `README.txt`; bilingual usage and recovery guides
live under `docs/`. Runtime, user-data and workspace paths remain compatible.
Trial-only provenance and trial instructions are not part of the release
builders. CI checks the actual extracted guides on each platform.

The public release workflow emits the final commit, job results, asset hashes
and GitHub attestations. Those records are authoritative for published assets.
