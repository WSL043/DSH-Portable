# Startup and independent core update qualification

## Confirmed defects and changes

- Exact local package acceptance caught a transient theme mismatch after a previous light launch. The official client initialized its preference to `system` before asynchronous durable settings arrived. The bootstrap now carries the host's accepted preference into the client's initial snapshot. Native chrome also reapplies the WebView preference when only the preference changes, even if the resolved color stays the same. Theme acceptance samples through two seconds after interactive readiness.
- Local rebuilding exposed development `node_modules` being copied into the bundled bridge and market. All three builders now share staging that excludes development dependencies. The unchanged package footprint limit caught the defect and passes with the filtered build.

- Windows `UISettings.AnimationsEnabled` returned `False` on the affected Win11 host. The loading page used `animation:none` for reduced motion. The old executable failed the real WebView transform-change assertion. The new native candidate passed dark/light/dark/system checks with reduced motion alternately enabled and disabled. Reduced motion uses discrete, slower progress; the other mode retains continuous rotation.
- The settings UI could request a core catalog before the channel POST finished. Settings writes now need ordered confirmation, stale-response rejection and visible request failures. Incompatible catalog entries retain explanatory metadata but expose no installation URL.
- Update checks, catalogs and notification choices no longer take the start/stop lock or migrate user state. Feed checks and defer/ignore choices use a separate per-feed cache lock. Four old-CLI regressions failed on the launch lock; the revised dispatch passes. A delayed-feed test also verifies that the launch lock stays free and a concurrent defer choice survives.
- The core candidate publisher selected old Portable prerelease shells instead of the current qualified stable shell. Its dependency fingerprint omitted shell source changes. Both channels now target a qualified main build, with independently selected stable/candidate source locks and exact base artifacts for acceptance.
- Same-version core catalog deduplication previously preferred the historical manifest over the newly built one. Current manifests now win, and retained history must match all required Portable, shell, runtime and Node compatibility fields.
- Official `0.1.3-alpha.2` resolves to `82a5fd61a7cf5c293cec4bdff68f455398d685e9`. Its official source uses `pnpm@11.7.0` and selects 251 DSH packages, 9 vendor packages and 1 landlock entry. The old 242-package candidate count was stale. Source intake now derives these inputs from the pinned commit.
- Default plugins remain `dsh-image-viewer@0.1.0-beta.9` and `dsh-chat-manager@1.3.1`, the newest respective published versions checked on 2026-09-08. Their compatibility with the new core requires runtime qualification, not just version comparison. Failed bundled-plugin installs now retain bounded, redacted installer output.

## Slow startup remains unresolved

The actual installed 0.6.3 launch `e65c568f5e0f4520a4e246114a137cc1` recorded a 15,292 ms official import and became interactive at 16,845 ms. Import CPU was 1,156 ms user plus 1,031 ms system. Worker samples stayed near 2 seconds and reported approximately 8.8 GB free memory while the main-thread heartbeat was delayed. These measurements do not establish memory pressure, antivirus activity or disk I/O as the cause.

The isolated loading-theme run `edbec745d2eb455d838a25eaf89ae8ec` also recorded a 12,045 ms import. Its overall 18,134 ms interactive time includes the deliberate 5-second theme-observation hold and must not be used as an unmodified startup benchmark.

A subsequent no-backend launch with system tracing, `c7178d99195942b185ec9d5a070446cb`, recorded a 2,178 ms import and 3,464 ms interactive time. This normal run does not explain or disprove the earlier long waits. The installed user's process was not stopped or replaced for these checks.

## Release qualification boundary

Source tests, local development candidates, main CI artifacts and public channel artifacts are separate evidence. Core publication must apply the built component to the exact matching baseline, start it, preserve existing default-plugin dependencies, verify plugin management and exercise failure rollback on all five targets. Product publication requires its complete main workflow and final Win11 artifact acceptance. Record their run IDs and artifact hashes when those checks complete; this document is not a claim that pending checks passed.
