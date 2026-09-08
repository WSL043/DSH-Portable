# Portable maintenance audit — 2026-09-08

## Scope and findings

Reviewed the pending startup diagnostics and loading UI fixes, market category layout, capsule creation/extraction and pruning policy, update/rollback and default-plugin contracts, process lifetime, and diagnostic retention/export. Repository tests cover the broader product behavior; focused Windows acceptance covers the changed packaged paths. This is not proof that every deployment is defect-free.

- **Capsule creation:** each source file was read twice, once for its digest and again for its payload. Besides redundant I/O, changing files between reads could invalidate the capsule. The packer now hashes and spools each file once, then streams the header and spool into the compressor. `writeFile` handles complete writes, and the spool is removed on both success and failure.
- **Lossless size reduction:** use one shared default Zstandard level (19) for full Windows packages and core updates. Level 10 produced 23,588,053 bytes in the isolated codec experiment; level 19 produced 20,998,555 bytes. The actual rebuilt streamed capsule is 20,998,551 bytes. All 8,492 payload files and the complete decompressed container are byte-identical to the baseline diagnostic payload. No runtime functionality, plugins, licenses or logging were removed.
- **Build/runtime tradeoff:** isolated compression took about 1.29 seconds at level 10 and 16.40 seconds at level 19; decompression took approximately 93 and 97 ms. This moves work to packaging, not app initialization. These are local samples, not a statistically established startup speedup.
- **Full ZIP:** the same clean diagnostic shell/payload comparison went from 58,980,983 to 56,385,676 bytes (about 4.4%). This is a local Windows diagnostic artifact, not a newly qualified release.
- **Startup diagnostics:** include bounded stack summaries and module timings in existing retained health history. Failed imports now mark their profile `startup-failed`, not `startup-complete`. A real 14.17-second startup was previously captured; it remains unresolved. Permanent stalls may still require OS tracing.
- **Loading UI:** remove the visible timer and replace stepped reduced-motion rotation with continuous slow rotation. Preserve explicit light/dark preference and phase timing in logs.
- **Market layout:** invalidate collapsed category budgets when the available width changes; ignore zero-width measurement and avoid clipping an expanded list during remeasurement. The shipped client bundle was rebuilt. A Windows product test verifies expand/collapse at 580, 1200 and 580 pixels.
- **Test maintenance:** remove redundant market toggles, debug snapshots and fixed catalog waiting. Cleanup now still runs if evidence collection or CLI stop fails.

## Verification and boundaries

The full repository suite passed with one pre-existing conditional skip; focused tests additionally exercise failed-import profiling and failed-compression cleanup. An extracted diagnostic ZIP started with a nonexistent runtime-cache directory, recorded a 1,211 ms import, became interactive in 8,440 ms including first-run preparation, and left no owned processes after stop. The run overlapped repository tests and is functional evidence, not a performance comparison. Packaged market resize/expand/collapse checks passed without unhandled client exceptions. The existing theme acceptance separately passed all four light/dark/system scenarios.

The fixed dependency-table optimization from the earlier diagnostic experiments is not promoted into the source build by this commit: it needs packaging/update invalidation qualification. The lossless compression comparison deliberately holds that diagnostic payload constant. Normal startup improvements do not establish a fix for the intermittent long import.

Existing pruning already removes reviewed source-only files and foreign native binaries. No further blanket file deletion or broad launcher rewrite was justified by this audit. Full product release and cross-platform qualification of this commit remain separate steps. The independent core-update automation was already deployed and verified in DSH-Portable-Updates.
