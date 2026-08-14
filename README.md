# DSH-Portable

Run the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
Web interface without installing Node.js. Choose a movable package or a normal
desktop install.

| Download | Use case | Supported CPU |
|---|---|---|
| `DSH-Portable-windows-x64.exe` | Smallest offline Windows download; extract to any folder and move it freely | Windows x64 |
| `DSH-Portable-windows-x64.zip` | Fully movable folder; start with `DeepSeek-Herness.exe` | Windows x64 |
| `DeepSeek-Herness-Setup.exe` | Per-user Start menu/desktop installation | Windows x64 |
| `DSH-Portable-macos-arm64.zip` | Fully movable folder | Apple Silicon |
| `DSH-Portable-macos-x64.zip` | Fully movable folder | Intel Mac |
| `DeepSeek-Herness-macos-arm64.dmg` | Drag-to-Applications install | Apple Silicon |
| `DeepSeek-Herness-macos-x64.dmg` | Drag-to-Applications install | Intel Mac |

The package uses the official, unmodified `@deepseek-ai/dsh` runtime. The only
additional code is the portable lifecycle shell that keeps DSH-owned data next
to the app and provides native launch entries.

> DSH is currently a developer preview. DSH-Portable is independently packaged
> and is not an official DeepSeek desktop release.

## Start

### Which package should I choose?

- Choose the Windows portable EXE for the smallest offline download. It only
  extracts the same movable folder and does not register an installation.
- Choose the ZIP when you prefer a standard archive or cannot run a
  self-extractor. Both Windows portable downloads produce the same folder.
- Choose the Windows setup or macOS DMG for a conventional application. In
  installed mode, app updates do not overwrite local settings or conversations.

### Windows

1. Run `DSH-Portable-windows-x64.exe` and choose a folder, or completely
   extract `DSH-Portable-windows-x64.zip`.
2. Double-click `DeepSeek-Herness.exe`.
3. Use `Stop DeepSeek-Herness.exe` before moving the folder or unplugging a drive.

The launcher has a native window and application icon. It uses Edge or Chrome
as an isolated app window when available.

### macOS

Choose the Apple Silicon (`arm64`) or Intel (`x64`) ZIP, extract it, then open
`DSH-Portable.app`. Because the app is ad-hoc signed rather than notarized,
macOS can require Control-click → **Open** on first launch. Use
`Stop DSH-Portable.command` before moving the folder or unplugging a drive.

For the DMG, drag both `DeepSeek-Herness.app` and
`Stop DeepSeek-Herness.app` to Applications. Installed data is kept in
`~/Library/Application Support/DeepSeek-Herness`.

## What moves with the folder

```text
DSH-Portable/
├─ DeepSeek-Herness.exe or DSH-Portable.app
├─ app/                     official DSH npm runtime
├─ runtime/node/            pinned Node.js runtime
├─ data/
│  ├─ dsh-home/             profiles, settings, credentials, and sessions
│  ├─ browser/              isolated browser profile
│  ├─ logs/                 runtime logs
│  └─ runtime/              process and relocation state
└─ workspace/               default portable workspace
```

Every durable DSH path above is resolved from the launcher's current folder.
The launcher does not install a service, create a startup task, write an
installation path to the registry, or silently fall back to another model.
When the whole folder moves, owned workspace references and session headers are
migrated on the next start. External projects remain at their original paths.

The `data` folder can contain API credentials and private conversations. Treat
the package like a password-bearing device. Stop it and safely eject removable
storage before unplugging it. NTFS is recommended on Windows because FAT/exFAT
cannot provide the same ACL-based sandbox boundary. Browser secrets can also be
bound to the original operating-system account and may require sign-in again on
another computer.

DSH binds only to `127.0.0.1`; the portable shell disables telemetry. DSH's own
workspace permissions and approval behavior remain unchanged.

## Integrity and provenance

Each release includes a `.sha256` file. The build pins and verifies:

- `@deepseek-ai/dsh@0.1.0-rc.6`;
- official DSH source commit `47f943859bef60e4160492346772ded9b24f765a`;
- Node.js `24.19.0` separately for Windows x64, macOS arm64, and macOS x64;
- the official DSH fish mark used to derive the native `.ico` and `.icns`.

Licenses, third-party notices, and exact component versions are included under
`licenses/` in every package.

## Official updates

This repository is an independent distribution project, not a GitHub Fork.
An automated daily monitor checks the official master commit and npm tags. It
opens an update review when either changes; the pin is updated only after the
official diff is reviewed and all three operating-system smoke jobs pass. This
avoids silently importing a preview change that breaks portability or data.

## Build verification

CI runs source contracts, builds the native entries, starts the packaged DSH
server, verifies its loopback Web response, stops it, moves the complete folder,
and starts it again on:

- `windows-latest` (x64);
- `macos-15` (Apple Silicon);
- `macos-15-intel` (x64).

Local Windows build:

```powershell
./scripts/build-windows.ps1
# Portable self-extractor and installer too (requires Inno Setup 6):
./scripts/build-windows.ps1 -BuildInstaller
```

Local macOS build:

```bash
bash scripts/build-macos.sh arm64   # or x64
```

Each macOS build creates both the movable ZIP and the installable DMG.

DeepSeek Harness and DeepSeek are projects and marks of DeepSeek. DSH-Portable
is maintained independently by WSL043 and is not endorsed by DeepSeek.
