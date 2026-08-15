<p align="center">
  <img src="assets/DSH-Portable.svg" width="96" alt="DeepSeek Harness">
</p>

<h1 align="center">DSH-Portable</h1>

<p align="center">
  Run the official DeepSeek Harness without setting up Node.js.<br>
  Start small, keep everything local, and move the finished folder anywhere.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><img src="https://img.shields.io/github/v/release/WSL043/DSH-Portable?display_name=release&style=flat-square&color=171717" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-171717?style=flat-square" alt="Windows and macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2F855A?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe"><strong>Download for Windows x64</strong></a>
  &nbsp;·&nbsp;
  <a href="#other-downloads">Other downloads</a>
</p>

<p align="center">
  <img src="assets/dsh-interface.png" width="960" alt="DSH-Portable running the official DeepSeek Harness interface">
</p>

> [!NOTE]
> DeepSeek Harness is currently a developer preview. DSH-Portable is an independent
> community distribution, not an official DeepSeek desktop application.

## Start in 3 steps

1. Download the small [**Windows launcher**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe).
2. Run it once. It downloads the pinned runtime into a `DSH-Portable` folder next
   to the launcher, verifies the download automatically, and opens DSH.
3. Configure a model in the DSH interface. Future launches work from the completed
   folder without downloading the runtime again.

No Node.js setup, system service, or startup task is required. To move the app or
put it on a USB drive, stop DSH first and copy the entire `DSH-Portable` folder.

## What makes this distribution different

| | DSH-Portable behavior |
| --- | --- |
| **Small first download** | The recommended Windows file is a lightweight bootstrap. The larger runtime is downloaded only once. |
| **Native desktop window** | DSH runs inside its own app window. Normal startup does not open Edge or Chrome, and the taskbar keeps the DSH-Portable identity. |
| **Actually portable** | Sessions, settings, desktop web data, workspace, runtime, and launchers stay under one movable folder. |
| **Offline option** | A complete self-extracting package is available when the target machine cannot download on first launch. |
| **Pinned and tested** | Each release fixes the DSH and Node versions, then starts, stops, moves, restarts, installs, and uninstalls the built packages in CI. |
| **Unmodified DSH** | The runtime is the official `@deepseek-ai/dsh` package. Third-party providers and plugins are not bundled. |

## Other downloads

<details>
<summary><strong>Windows: offline package, ZIP, or installed app</strong></summary>

- [Offline self-extractor](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.exe) — includes Node.js and DSH; no first-run download.
- [Offline ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) — the same movable folder in a standard archive.
- [Windows installer](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe) — Start menu shortcut and a normal uninstaller; user data is kept separately.

</details>

<details>
<summary><strong>macOS: Apple Silicon or Intel</strong></summary>

- Apple Silicon (M1–M4): [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac: [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)

The macOS builds are ad-hoc signed rather than Apple-notarized. On first launch,
Control-click the app and choose **Open** if macOS blocks it.

</details>

## Portable data

The portable folder keeps its state in predictable locations:

- `data/dsh-home/` — DSH settings, provider credentials, and sessions;
- `data/webview2/` — Web data for the native Windows desktop window;
- `workspace/` — the default working directory;
- `data/logs/` — local service logs.

After the folder is moved, the launcher migrates paths it owns on the next start.
External projects keep their original paths.

## Plugin management

The Windows packages include the Node.js runtime and a fixed pnpm version required
by DSH. You do not need a system Node.js or pnpm installation, and DSH-Portable does
not change the system PATH. Open PowerShell in the DSH-Portable folder and use the
generic command entry for any DSH plugin:

```powershell
.\dsh.exe plugin --profile web add <plugin>
.\dsh.exe plugin --profile web list --depth 0
.\dsh.exe plugin --profile web update <package-name>
.\dsh.exe plugin --profile web remove <package-name>
.\dsh.exe --profile web --dump-config
```

`<plugin>` can be any package, Git URL, local directory, or archive accepted by
pnpm. The installed edition uses the same commands while keeping plugins and
configuration in its external user-data directory. Plugin changes never restart a
running DSH process: save your task, stop DSH, and start it again when convenient.
Install only plugins you trust because a plugin can execute code on this computer.

## Updates

DSH-Portable checks for updates when it starts and asks before installing one.
A normal update downloads only the changed DSH application component instead of
downloading Node.js, the launcher, or the complete offline package again.
Sessions, settings, credentials, and workspace remain in place. The download is
verified before the application is replaced; if the new version cannot start,
the launcher restores the previous version.

When a Node.js or portable-shell compatibility boundary changes, DSH-Portable
offers the complete package instead. You can choose **Later**, and versions are
never switched silently. DSH-Portable is not a GitHub fork: its release process
watches the official [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness)
and npm package, then publishes only packages that pass the corresponding
Windows or macOS product checks.

## Security

DSH is an agent runtime with local code-execution capability. Use trusted models,
plugins, and projects only. The service binds to `127.0.0.1`, and the portable
shell disables DSH telemetry by default.

The `data` directory can contain API credentials and private conversations. Treat
the whole portable folder like a password-protected drive. NTFS is preferred for
Windows removable media; FAT and exFAT do not provide equivalent permissions.

<details>
<summary><strong>Build from source</strong></summary>

```powershell
./scripts/build-windows.ps1
./scripts/build-windows.ps1 -BuildInstaller
```

```bash
bash scripts/build-macos.sh arm64   # or x64
```

The dependency lock, component notices, package tests, and release manifest live
in this repository. Download verification is automatic; beginners do not need to
copy or compare checksum strings manually.

</details>

DeepSeek Harness and the DeepSeek name and mark belong to DeepSeek. DSH-Portable
is maintained independently by WSL043 and is not endorsed by DeepSeek.
