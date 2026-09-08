# Startup loading and diagnostic history

## Startup sampling acceptance, 2026-09-08

The host now starts an in-process V8 sampling session before importing DSH. No debug port is opened. Sampling requests a 10 ms interval and ends when startup returns/fails, or after a 60-second timer can run. Runtime-health history stores the eight highest-weight grouped stacks (six frames each), omitted-stack count, module resolve/load counts and cumulative durations, and up to eight module operations taking at least 20 ms. Filenames omit local parent directories and URL queries. These are statistical observations, not exact CPU accounting. Synchronous stalls flush on recovery; a permanently blocked/killed process may not produce a final profile and still needs OS tracing. The module timer measures loader operations, not subsequent module evaluation or every filesystem call.

Entry import duration and exported Alpha CLI startup are now separately marked. Legacy self-executing entry imports still include startup by their upstream design. Profiler failures are logged and do not prevent launch. Summaries use the existing bounded history/support-export policy; a truncated support report does not replace the retained local history.

Win11 local acceptance used a disposable 0.6.4 CI ZIP with the two diagnostic launcher files replaced, not a newly qualified release artifact. All starts had no existing backend. The initial empty-cache run took 7,887 ms to become interactive (4,104 ms extraction; 1,214 ms import). A subsequent real run reproduced a 14,174 ms import, startup ID `a4561175577a4f7d9e5078ddbe9ec5be`, with 1,420 samples. Its leading stacks included synchronous file open/read during module loading, fallback manifest repair and initial client bundle reads. Heartbeats were delayed over nine seconds while sampled CPU usage was 9–12%. No individual measured module operation exceeded 20 ms. This narrows the investigation to cumulative synchronous filesystem paths, but does not prove a storage/filter-driver cause or a fix.

After adding grouped-stack and cumulative-module totals, a final real launch imported in 1,151 ms and became interactive in 2,224 ms. A separate controlled 12-second synchronous wait was attributed to its injected function; a 250 ms module-loader delay was attributed to its fixture filename. All 20 targeted diagnostic, host, retention and report checks passed. The support JSON includes the real slow-run profile. The user's installed application was untouched; test processes were stopped. The intermittent delay remains unresolved and no release was published for this diagnostic change.

Windows startup now reads the standard saved `ui-theme.preference` before creating the window. The desktop bridge persists the resolved preference for custom settings providers. Explicit light/dark preferences also control WebView's preferred color scheme; system mode remains automatic. A local loading document provides progress before the backend URL exists. Temporary startup colors remain until the theme bridge reports the official interface state.

Startup and health records share a startup ID and are retained in `data/logs/history/<startupId>/`. Retention is 30 runs within 14 days, bounded to 32 MiB, with each stream rotating at 128 KiB. Compatibility latest/previous files remain. Support export fairly allocates its 100 KiB history budget across retained runs, prioritizes startup records, and lists truncated streams. Export redaction and the overall 512 KiB cap remain enforced.

## Windows 11 verification, 2026-09-07

- 484 repository tests passed.
- A disposable packaged product, with the current launcher compiled into it, passed hidden WebView/CDP acceptance for dark, light, dark again, and system mode. The user's installed application was not restarted or changed.
- The four loading documents were ready at 577, 522, 502 and 500 ms. Sampled backgrounds remained in the selected light/dark scheme through navigation into the official interface. The test deliberately held navigation for five seconds to capture the loading screen; its interactive timings must not be reported as normal startup benchmarks.
- The fourth launch still retained the first launch's startup and health records.
- A prior acceptance failure caught the official interface briefly applying a white default background during dark startup. The test now checks transition colors, beyond the final theme.

## Remaining backend investigation

The first run in the final four-mode check reproduced an 18,791 ms official import, independently of the five-second UI test hold. CPU usage during import was 1,922 ms user and 2,875 ms system; the separate health worker recorded main-thread heartbeat delay rising to 15,701 ms. Startup ID: `a29df81d4cba4823a865b4bcbc299c82`.

Earlier isolated CPU profiles took 2.5–2.8 seconds and did not reproduce the original long delay. They showed module loading and synchronous filesystem work. A compile-cache comparison showed no measurable improvement and was not shipped. These observations do not yet establish the cause of the intermittent long import. Loading feedback and retention fixes must not be described as a proven backend speedup or a resolution of that remaining delay.

## Follow-up fixes and measurements

- The stalled-resource CI test exposed a navigation ownership bug: cancellation of the old loading document could fail the new workspace navigation. Completion and DOM events now require the active workspace navigation ID. The unchanged Windows 11 fault-injection test passed in 5.329 seconds after correction.
- Startup profiles identified `dsh-client-modules` newline counting as a CPU hotspot. A narrowly checked build patch replaces Unicode character iteration with native `indexOf` scanning; LF counts and source-map offsets remain identical, including Unicode and CRLF cases. Self time in the same profiling fixture changed from 268.570 to 21.573 ms. Overall profiled import remained 2.6–2.7 seconds because filesystem timings varied; this is a measured reduction in one operation, not a claim that the intermittent long import is fixed.
- Sequential capsule writes saved only about 4% in a four-run experiment and were not adopted. The existing concurrent extraction behavior remains.

## Elevated tracing and resolver follow-up

On 2026-09-07, an elevated Windows Performance Recorder collected a GeneralProfile ETW trace while three isolated, non-elevated native launches ran. Workspaces became interactive in 3.356, 3.577 and 3.523 seconds; the latter two also collected diagnostic-only V8 and filesystem profiles. The intermittent long import did not recur. The raw trace stays local because it contains system-wide diagnostic data; it is not part of support-report export.

The managed fallback repair now creates each distinct package parent directory once, retaining per-link validation and repair. Six interleaved Windows runs against the actual 483-package runtime closure reduced recursive directory creation calls from 483 to 26. Baseline durations were 153.9, 156.6 and 165.9 ms; optimized durations were 172.7, 109.0 and 117.1 ms. Medians were 156.6 and 117.1 ms; every run passed a complete fallback inspection. This is a local resolver improvement, not a measured reduction of the intermittent long import.

The independent runtime-health worker also records its actual `sampleIntervalMs`, `systemFreeMemoryBytes` and `systemTotalMemoryBytes`. These describe conditions at sampling time and help distinguish delayed worker scheduling from a delayed main heartbeat; they do not by themselves establish a memory-related cause.

The 27 portable-contract tests and the blocking/recovery health test passed. A disposable CI-built Windows product with these two launcher modules updated passed the unchanged stalled-resource/continuous-DOM native acceptance in 3.351 seconds. This is local acceptance of updated launcher modules, not a claim that the previous CI artifact already contained them. The user's installed process remained untouched.

## Release qualification caught a status/start race

Run 34141391203 at commit 29a0a6e failed macOS Intel native acceptance before backend startup. The retained support report records `LAUNCH_IN_PROGRESS` at 2026-09-07T16:11:59.131Z, and the native stack and screenshot show the startup failure alert. The smoke test polls CLI status while the native host starts; status previously acquired the same exclusive launch lock despite being read-only. The CLI now returns the status snapshot before lock acquisition and directory initialization. Start/stop/update locking remains unchanged. The stopped/starting/running regression cases all fail on the old CLI and pass on the fix; the start-lock exclusion case passes on both. This is a separate demonstrated race, not proof of the historical long-import cause. The failed candidate was not published.
