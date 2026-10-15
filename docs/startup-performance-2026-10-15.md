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
