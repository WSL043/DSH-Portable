# DeepSeek Harness Windows Portable

Unofficial community packaging of the **official, unmodified DeepSeek Harness
Web profile** for Windows x64. Download one ZIP, extract the whole folder, then
double-click `DeepSeek Harness.cmd`.

This repository does not fork the DSH interface or agent runtime. The release
contains only:

- `@deepseek-ai/dsh@0.1.0-rc.6` and its official runtime dependencies;
- Node.js `24.19.0` for Windows x64;
- a small open-source launcher that keeps DSH-owned state beside the app.

No Codex, OpenCode Zen, GenericAgent, Yanxu, or other third-party DSH plugin is
bundled. DeepSeek Harness itself is built from official plugins because its
upstream architecture is "everything is a plugin."

> DeepSeek Harness is currently a developer preview with possible breaking
> changes. This package is not an official DeepSeek release or installer.

## Use

1. Download the ZIP from Releases and verify the adjacent `.sha256` file.
2. Extract the **entire** folder. Do not run it inside the ZIP viewer.
3. Double-click `DeepSeek Harness.cmd`.
4. Configure an official model connection in the DSH settings page.
5. Double-click `Stop DeepSeek Harness.cmd` before unplugging a USB drive or
   moving the folder.

Windows Edge is used as an isolated app window when available. Its browser
profile is also stored inside the portable folder. Chrome is the second choice;
the system default browser is only a last-resort fallback.

## Portable data contract

All DSH-owned durable state is rooted here:

```text
DSH-Portable-0.1.0-rc.6-community.1/
├─ app/                     official DSH npm runtime
├─ runtime/node/            bundled Node.js
├─ launcher/                portable lifecycle wrapper
├─ data/
│  ├─ dsh-home/             profiles, settings, credentials, sessions, storage
│  ├─ browser/              isolated Edge/Chrome profile
│  ├─ logs/                 host logs
│  └─ runtime/              PID/port and relocation metadata
└─ workspace/               default portable workspace
```

The launcher resolves these paths from its own current directory on every
start; it does not save an installation path, write the registry, create a
startup task, or install a resident service. When the folder moves, it migrates
the official workspace index and session headers that point to the package's
own `workspace` directory.

External workspaces deliberately remain external. If a session targets
`C:\Projects\example`, moving this package cannot move or rewrite that project.

The portable folder contains API credentials and session content after use.
Treat it like a password-bearing device. Stop DSH, close its app window, and
eject USB storage safely before removal.

For removable storage, NTFS is recommended. DSH's official Windows process
sandbox uses an ACL capability probe; exFAT/FAT media do not provide the same
ACL boundary and DSH may report that sandbox rung as unavailable. The package
still remains movable, but portability must not be confused with an equivalent
sandbox on every filesystem.

Moving between Windows PCs preserves the browser-profile files, but Chromium
may encrypt some cookies or saved secrets with the original Windows account.
Those entries can require signing in again on another machine. DSH-owned files
under `data/dsh-home/` still travel with the package.

## Lifecycle

- `DeepSeek Harness.cmd`: start or reopen the existing host.
- `Stop DeepSeek Harness.cmd`: stop only the verified DSH process owned by this
  folder. It first invokes DSH's own bounded shutdown path over an authenticated
  local named pipe, then force-stops only if official disposal exceeds the
  grace period. A stale/recycled PID is never killed.
- `DSH Status.cmd`: show the loopback URL, PID, and current state.

The host binds only to `127.0.0.1`. Telemetry is explicitly disabled by the
portable launcher. DSH's normal workspace permission and approval behavior is
otherwise unchanged.

## Provenance

The build is pinned by [`upstream.lock.json`](upstream.lock.json):

- source: <https://github.com/deepseek-ai/deepseek-harness>
- reviewed source commit: `47f943859bef60e4160492346772ded9b24f765a`
- DSH npm package: `@deepseek-ai/dsh@0.1.0-rc.6`
- Node.js: `24.19.0` Windows x64

The build verifies the Node archive SHA-256 and npm package integrity before
creating a release. Upstream DSH is MIT licensed; the release retains its
license and third-party notices. Node's license is retained separately.

## Build and verify

On Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-portable.ps1
```

The script creates a versioned ZIP and matching `.sha256` under `artifacts/`.
It downloads only the pinned Node archive and the pinned upstream third-party
notice, verifies both, runs `npm ci` against the committed lockfile, and checks
that the installed DSH package matches the pinned version and integrity.

Run source contracts with Node 24:

```powershell
node --test tests/*.test.mjs
```

## Upgrade policy

DSH preview releases are not upgraded in place. Each upstream revision gets a
new reviewed Portable release. Stop the old copy, extract the new release into
a separate folder, and copy the old `data/` and `workspace/` directories after
reviewing the release notes. Keep the old folder until the new version starts
and displays the retained sessions.

## Attribution and trademarks

DeepSeek Harness and DeepSeek are projects and marks of DeepSeek. This
community packaging is maintained by WSL043 and is not endorsed by DeepSeek.
See [`LICENSE`](LICENSE) for the launcher and the retained upstream notices in
the release's `licenses/` directory.
