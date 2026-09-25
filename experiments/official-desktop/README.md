# Official desktop boundary prototype

## RC.2 development line — 2026-09-26

The same fail-closed adapter now accepts official commit `477b4f420553e8a52c2fbccc464d7561b239c443` with an explicit `rc2` profile. In an isolated checkout of that exact commit, copy `apps/desktop/src/main.ts`, `apps/desktop/src/update-coordinator.ts`, and `apps/desktop/scripts/dev.ts` into a new flat input directory, then run:

```powershell
node experiments/official-desktop/prepare-development.mjs <inputs> <new-output> rc2
node experiments/official-desktop/verify-development.mjs <new-output>
```

The generated `main.ts`, `update-coordinator.ts`, `portable-development.ts`, and `dev.ts` can be applied only to that disposable upstream checkout (`dev.ts` belongs in `apps/desktop/scripts`, the others in `apps/desktop/src`). Full source and desktop builds passed on Windows. With the official Electron 44 runtime, the adapted real development host launched on a separate Windows desktop, rendered Welcome, and retained a synthetic localStorage marker after its isolated data directory moved. Signed packaged launch, offline tasks, account credentials and plugin operations remain open. The signed official installer was inspected separately and was not modified. Evidence and updater ownership limits: [rc.2 probe](../../docs/official-desktop-rc2-probe.md).

`launch-hidden-windows.ps1` runs a disposable executable on a private Windows desktop, starts it suspended, assigns it to a job, and terminates that job after a bounded interval. It requires `DSH_PORTABLE_DEVELOPMENT_ROOT`, `APPDATA`, and `LOCALAPPDATA` to point inside one isolated root. Use a unique local CDP port and `probe-welcome.mjs <port> readiness|set-marker|get-marker` while the process runs; the probe also requires `DSH_OFFICIAL_DESKTOP_APP_ROOT` and only accepts that checkout's exact Welcome URL. Never point these probes at an existing Portable or Desktop profile. The helper does not exercise graceful application shutdown.

## Alpha.2 development adapter — 2026-09-18

`prepare-development.mjs` now generates source overlays for the reviewed official commit `ddefc45fbc7f8e46dd73185e68295696d1297887`. It checks the exact SHA-256 of both upstream inputs before writing and refuses a nonempty output directory. This is a development implementation, not a downloadable or qualified desktop edition.

- Before Electron readiness, the adapted main entry requires an absolute `DSH_PORTABLE_DEVELOPMENT_ROOT`; DSH home, Electron user/session data, logs and crash dumps derive from that separate root. It never defaults to a user's production DSH home.
- The development coordinator cannot check the official installer feed. The mandatory-update policy also receives no configuration. This does not introduce a replacement updater; development builds are updated manually.
- The official source files and signed release bundles remain untouched. Only an explicitly prepared unsigned development checkout should consume the generated overlays.

Place the exact official `apps/desktop/src/main.ts` and `update-coordinator.ts` in a reviewed input directory, then run:

```powershell
node experiments/official-desktop/prepare-development.mjs build/desktop-alpha2-adapter-inputs build/desktop-alpha2-development-overlay
node experiments/official-desktop/verify-development.mjs build/desktop-alpha2-development-overlay
node --test tests/official-desktop-development.test.mjs
```

The overlay contains three TypeScript source files and `provenance.json`. To continue native qualification, copy only those source files into `apps/desktop/src` of an isolated checkout of the pinned commit, build using upstream's pinned dependencies, and launch with a dedicated development root. Never point this prototype at an existing Portable `data` directory.

Verified: generated TypeScript parses; the actual adapted update coordinator rejects check/download/install without making update I/O calls; path configuration derives from each supplied root and rejects late initialization. Pending: full upstream build, actual official desktop startup, early module-import path audit, directory relocation, credentials, plugins, process shutdown, and cross-machine behavior. These source tests do not qualify Electron adoption or change the production Portable shell.

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
