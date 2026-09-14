# Official desktop boundary prototype

Experimental engineering fixtures only. Nothing here is installed into Portable or enabled in product builds. Requires Node 24.19 and, for the native substrate probe, Electron 44.0.0 Windows x64. No visible window or foreground input is used.

## Observed results — 2026-09-14

- Executed upstream `home-paths`, `paths` and `update-coordinator` modules from reviewed commit `c291e7961a515f6d7af9304e7fd1d257929aef26`, stripping TypeScript with Node. Electron and update I/O were test doubles; this is not an actual update installation.
- DSH_HOME places the desktop plugin profile and pnpm store beneath the supplied directory.
- In a simulated packaged process with `app-update.yml`, check and explicit install remain enabled despite DSH_HOME and PORTABLE_EXECUTABLE_DIR. `autoDownload=false` and `autoInstallOnAppQuit=false` do not disable explicit installation. Without that configuration the coordinator returns idle and rejects install.
- Ran a real Electron 44 hidden BrowserWindow with `--user-data-dir` and the `dsh-app` scheme. Exited, moved synthetic directory A to B, relaunched: localStorage retained its synthetic value. Reported userData, sessionData, logs and crashDumps all moved beneath B.
- The scheme rejected Cookie creation with `EXCLUDE_NONCOOKIEABLE_SCHEME`. The first probe failed on that operation; the subsequent probe recorded it as a separate limitation instead of changing protocol privileges. Cookie migration has NOT passed. This does not demonstrate a DSH defect, since its authentication need not use this cookie path.

The native probe is a minimal Electron application, NOT the official desktop application. It does not prove complete filesystem containment, cross-machine credentials, DSH sessions, plugin activation, signed artifact preservation, or performance. Browser encrypted state may require a separate cross-machine test. No official desktop adoption gate is marked fully qualified.

## Decision

An external portable data-directory argument is promising. Updater ownership remains a concrete integration gap: seek an explicit upstream runtime switch/portable mode before wrapping a signed production payload. Do not delete update configuration from an official bundle or infer that an unsigned development build proves production behavior. Retain the existing product shell for now.

## Reproduction

The reviewed source inputs in `build/official-desktop-research/` are downloaded directly from the immutable GitHub commit above, with `/` replaced by `__` in local filenames:

- `packages/util/home-paths/src/index.ts`
- `apps/desktop/src/paths.ts`
- `apps/desktop/src/update-coordinator.ts`
- `commit.txt` containing the reviewed SHA

Run `node --experimental-vm-modules experiments/official-desktop/probe-source.mjs`. Output: `build/official-desktop-probe/source.json`. Only execute reviewed source inputs; VM host doubles are a test mechanism, not a security sandbox.

Download the official Electron `v44.0.0` Windows x64 ZIP and `SHASUMS256.txt`; verify the archive against the exact filename's checksum before extracting into `build/official-desktop-probe/runtime/`. Tested ZIP SHA256: `e61aa3bcea8152bc0730abd015e47c032d778a0ef10e2a1c78ba3c4ea47942f9`.

Run `node experiments/official-desktop/run-probe.mjs`. Each run uses a new synthetic directory and writes `first.json`, `moved.json`, `result.json`. LocalStorage loss fails the run; cookie support and path containment are explicitly reported rather than being mistaken for passing qualification. Downloaded runtime and ZIP can be removed after process exit; retain JSON evidence and checksums.
