# Startup performance, 2026-10-15

Warm start to "host ready" on a fast development PC, medians of 4-7 interleaved runs through the CLI path
(`runtime-entry.mjs portable-cli.mjs start --no-browser`), 0.8.17 package:

| Build | host ready |
| --- | --- |
| 0.8.17 as shipped | 4.4-4.9 s |
| no PowerShell identity query for the host we spawned | 3.2-3.5 s |
| plus learned startup module pack | 2.5 s (very stable) |

What changed (shell code only; the official core import, about 1.5-2.4 s, is not ours):

- `launcher/portable-cli.mjs` `waitForHost`: a host this process just spawned is trusted while its child handle is
  alive, so the two synchronous PowerShell/CIM process queries (200-300 ms each here, seconds on weak PCs) are skipped.
  Reused hosts are still verified by command line.
- `launcher/startup-source-cache.mjs`: the first start after an install or core update still reads and inflates the
  capsule (about 0.5 s) but then writes `data/cache/startup-modules-<capsule sha>.pack` with just the modules that
  start loaded (about 900 modules, 2.3 MB packed). Later starts hash and inflate only that pack (a few ms). A missing,
  stale or tampered pack falls back to the capsule; modules not in the pack load from disk. Packs of other runtimes are
  deleted.

Measured and rejected: `NODE_COMPILE_CACHE` (no gain), turning the old full-capsule source cache off (neutral).

Open items, unmeasured estimates from startup traces: startup profiler and hooks about 100 ms (make opt-in), profile
resolver recreating 515 junctions on every start up to 118 ms, native host launching the CLI only after the window is
shown about 110 ms, plugin-compatibility fingerprint 30 ms. Weak disks and antivirus scanning were not reproduced;
`data/logs/startup-latest.jsonl` from such a machine shows where its time goes.

## Native host: starting the CLI from the constructor was tried and reverted

Starting the preparation process before the window existed saved about 100 ms on a warm start (measured with the real
executable, hidden window), but on a 2-core CI runner during the first start (runtime extraction of about 35,000 files)
the extraction starved window and WebView2 construction: WebView2 started 30 s late and the first start took 77 s
instead of finishing inside the 60 s smoke budget, which failed core qualification. Keep WebView2 initialisation
before the CLI, as RunLauncherAsync does. The same trace shows what to watch for with any parallelism change: first
start under load, not the warm start.

## Why slow PCs amplify some steps more than others

Amplified: process creation (antivirus scans every new executable and script host), many small file operations
(unpacking about 9,400 runtime files, creating about 500 plugin links, reading manifests), CPU-bound work (hashing and
inflating the capsule), anything done synchronously before the window can paint. Not amplified: the network and our
fixed delays. Already handled by earlier work: a wider libuv pool for runtime preparation (set by the native host and
cleared before the core starts), batched directory and file creation, a native loading surface shown immediately.

Left alone on purpose: the startup profiler and module hooks (about 100 ms, but they feed the stalled-plugin recovery),
clearing plugin links when the app closes (it keeps a copied folder from duplicating the runtime through junctions),
the plugin-compatibility check (it skips quickly unless community plugins are installed).

## Slow-PC emulation, 2026-10-16

`scripts/measure-startup-slow.ps1 -PackageRoot <scratch package> -Kind cold|warm` runs the CLI start with a Windows job-object hard CPU cap
(0.6 of one core by default) next to an uncapped run and prints per-phase times. Antivirus scanning stays as this PC has it; disk speed is
not throttled.

0.9.0, CLI path, same PC (ms):

| | normal | slow (0.6 core) |
| --- | --- | --- |
| first start total | 9,100 | 18,100 |
| capsule extraction | 3,600 | 9,800 (about 7 s is writing 8,700 files: per-file cost, not bytes) |
| profile resolver (515 junctions, first start only) | 2,400 | 2,500 (kernel-bound, not amplified) |
| default plugin seeding (first start) | 900 | 1,700 |
| official core import | 2,100 | 3,700 |
| warm start total | 1,950 | 3,400 (our part about 0.45 s; official core import about 2.9 s) |

Findings: the official LibreOffice kit (182 MB) costs only about 1.5 s of the slow first start. A V8 compile cache (`module.enableCompileCache`,
persisted on graceful exit) gives nothing even on the slow profile; the warm start is dominated by executing the official core's module
graph, which is not ours. Remaining shell-side headroom on a warm start is at most about 0.2 s.

Because slow PCs spend long on a few steps, the native loading surface now explains them: after 3 s of unpacking it says the unpack happens
once and later starts are much faster, and after 8 s on any later step it shows the elapsed seconds and that slower PCs need longer. Verified
with UI Automation text reads on the emulated slow PC (hint appeared at 4.4 s in the unpack stage and at 8 s in the start stage, and went
away when the workspace opened).

### First-start changes, 2026-10-16 (measured on the emulated slow PC, 0.6 core, cold start, medians)

- Dependency closure walk (`createPackageLocator`, `packagedDshDependencyClosure`): shared directory listings, overlapped manifest reads,
  identical result (same 515 packages, same targets). Profile-resolver step 2.4 s -> about 1.0 s; first start 18.4 s -> 16.6 s (fast PC
  9.2 s -> 7.8 s). What is left of that step is the first read of the freshly extracted manifests, paid by whoever reads them first.
- Extraction writes: a 32-wide async queue took 7.5 s for 9,446 files on the slow profile, plain synchronous writes in 40 ms slices 3.5 s,
  while a fast PC needs 2.5 s either way (two worker threads: 4.6 s slow, 2.5 s fast, but copying 350 MB to share it is not worth it).
  Extraction now measures how fast the PC just hashed the capsule and writes synchronously below 600 MB/s (fast PCs run at well over
  1,000 MB/s; the emulated slow PC reaches only about 380 under sustained load). `DSH_PORTABLE_EXTRACT_MODE=sync|parallel` forces a mode. Forced
  sync on the slow profile: first start 18.4 s -> about 12-13 s. Caveat: the emulation (job-object hard cap) barely slows a short burst,
  so the automatic decision itself was exercised only through the forced modes, not end to end on a really slow CPU.

### Extraction: duplicates become hard links, 2026-10-16

The engine (core) update capsules of 0.2.1-alpha.3/4 hold 35,730 files / 550 MB (the bundled rc.2 capsule 9,446 files / 340 MB). 25,798 of them
(72 %, 184 MB) are byte-identical copies of 9,932 contents: a nested `zod` copied under every `@deepseek-ai/dsh-*` package (49 times) and the like.
Between alpha.3 and alpha.4, 35,351 of 35,730 files are identical (only 379 files, 10.5 MB, differ), 296 of the changed ones just `package.json`.

Extraction now writes each distinct content once and hard-links the other copies (the header already carries a sha256 per entry), falling
back to a plain write where links are unavailable (FAT/exFAT, restricted volumes). Measured on the alpha.4 engine capsule: a link is about
2.3x cheaper than a write (about 4,500 vs 1,800 per second), extraction 13.5-14.0 s -> 9.5-11.8 s (noisy PC), and the extracted runtime
needs 184 MB less disk. Parallel versus single-threaded links made no difference. Not done: linking unchanged files from the previous runtime
cache on update (alpha.3 -> alpha.4 would link 35,351 files and write 379); it would save about 3 s more but needs a stored index of the old cache.
Also not done: removing the duplicates at build time by hoisting (junctions change how nested packages resolve their own dependencies).
