# Next release maintenance acceptance

The pending product version remains 0.6.4. This checklist is implementation and
qualification work, not authorization to call an unresolved fault fixed or to
publish an unqualified release.

## Implemented changes

- Startup sampling sends bounded module checkpoints to the independent health
  worker at most four times per second. A permanently blocked main thread can
  leave checkpoints and heartbeat-delay evidence without a final V8 profile.
  The last checkpoint is not necessarily the blocking operation. A recovered
  profile and OS tracing remain necessary for deeper attribution.
- Startup history records runtime reuse and the actual Portable, Node, DSH and
  default-plugin versions. Support reports summarize each retained run before
  allocating the bounded log-tail budget. Rotated streams are ordered by event
  time; malformed, missing-time and truncated evidence is explicitly marked.
  An absent exit record means `not-recorded`, not a crash. History remains
  bounded to 30 runs/14 days/32 MiB and support history to 100 KiB.
- `report-startup-performance.mjs` separates new-runtime preparation, reused
  runtime and unknown runs. It reports observed counts, missing measurements,
  median, nearest-rank P95 and maximum. These are diagnostic samples, not
  reboot-cold benchmarks; failed runs are retained in the counts.
- Explicit engine catalogs validate shell, product and Node compatibility even
  for the installed DSH version. Same-version incompatible manifests are no
  longer exposed as selectable installation targets. Automatic checks continue
  to suppress unchanged engine versions. Existing channel-save ordering,
  localized unavailability explanations and rollback gates remain required.
- Default-plugin intake checks canonical npm tags without replacing reviewed
  pins. It verifies pinned integrity, ignores deprecated tagged releases and
  never downgrades to an older `latest` tag. A newer candidate requests
  compatibility review. The existing six-hour intake workflow saves its report.
- Package footprint snapshots are uploaded separately on all five targets and
  compared with a retained successful main build. Existing size budgets remain
  blocking. Missing initial/expired baselines are reported explicitly; growth
  is not silently treated as zero. `--baseline` also supports local comparison.
- All builders copy the same top-level launcher modules used by the shell
  fingerprint. This replaces duplicated file lists that could omit a new
  runtime dependency. Platform-native sources and development files are not
  included by this rule.
- Existing upstream request helpers now restrict GitHub credentials to HTTPS
  GitHub hosts instead of sending them with anonymous npm metadata requests.

## Fixed acceptance requirements

The Windows native CI matrix now includes the shipped market category test at
580/1200/580 pixels, with expand/collapse, exception capture and retained support
evidence. Existing gates cover saved themes, startup transitions, graceful exit,
directory relocation, data migration and update recovery. Product update and
plugin lifecycle checks run against packaged artifacts across five targets.
The independent official-core publisher remains responsible for qualifying each
core on matching product artifacts before exposing it in a public channel.

Local acceptance uses an isolated ZIP extracted under a path containing Chinese
characters and spaces. Every shipped launcher module must match source bytes.
Launches use hidden native interfaces without desktop input automation, and
owned backend processes must be absent before launch and after shutdown. Keep
raw logs and support reports, including failed runs, outside the source tree.

## Performance decision and remaining investigation

The earlier precomputed dependency-table experiment is not promoted into the
source build. Its small and variable ordinary-start benefit does not yet justify
an additional upstream patch and its invalidation/compatibility requirements.
The existing source resolver remains intact. Lossless level-19 capsule
compression from the previous audit is retained.

The previously captured intermittent 14-second import is still an open technical
finding. New checkpoints, actual version snapshots and separated timing summaries
improve the next capture; passing normal starts must not close this finding.
Do not weaken performance limits, discard slow samples or add automatic retries
to make release evidence appear green. Final CI run IDs, artifact hashes and
local observations belong in the acceptance evidence for the exact commit.

## Initial local qualification, 2026-09-08

The full source suite passed 536 tests with one existing conditional skip.
Actionlint passed. A new Windows build from the locked official source packages
produced a 56,388,005-byte ZIP; the previous qualified base was 58,969,705 bytes.
Every extracted launcher module matched the source bytes. The first isolated
native launch used an absent runtime cache: loading document 384 ms, runtime
preparation 4,158 ms, official import 1,266 ms and interactive readiness 7,791 ms.
The backend exited with code zero and the owned-process checks were empty
before startup and after shutdown. Its 43,686-byte support report contained
version snapshots, a final profile, independent checkpoints and complete run
summary evidence. These local observations do not replace final CI qualification
and did not reproduce or resolve the historical long import.
