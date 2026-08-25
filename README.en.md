<p align="center">
  <img src="assets/DSH-Portable.svg" width="82" alt="DeepSeek Harness">
</p>

<h1 align="center">DSH-Portable</h1>

<p align="center">
  <strong>Take your entire DeepSeek Harness workspace with you.</strong><br>
  Sessions, settings, plugins, and workspace stay together. Copy one folder and continue working.
</p>

<p align="center">
  <a href="https://wsl043.github.io/DSH-Portable/"><strong>Website</strong></a>
  · <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><strong>Download</strong></a>
  · <a href="#start-in-3-steps">Get started</a>
  · <a href="docs/move-between-computers.en.md">Move</a>
  · <a href="#plugins">Plugins</a>
  · <a href="#get-help">Support</a>
  · <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><img src="https://img.shields.io/github/v/release/WSL043/DSH-Portable?display_name=tag&label=release&style=flat-square&color=171717" alt="Latest release"></a>
  <a href="https://github.com/WSL043/DSH-Portable/releases"><img src="https://img.shields.io/github/downloads/WSL043/DSH-Portable/total?style=flat-square&label=downloads&color=171717" alt="GitHub downloads"></a>
  <a href="https://github.com/WSL043/DSH-Portable/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/WSL043/DSH-Portable/ci.yml?branch=main&style=flat-square&label=build&color=171717" alt="Cross-platform build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/WSL043/DSH-Portable?style=flat-square&label=license&color=171717" alt="Apache-2.0 license"></a>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe"><strong>Download Windows portable (recommended)</strong></a>
</p>

<p align="center">
  <img src="assets/dsh-interface-en.png" width="1040" alt="DeepSeek Harness workspace in DSH-Portable">
</p>

> [!NOTE]
> DSH-Portable is an independent community distribution, not an official DeepSeek desktop app. It packages an adapted and finished-product-tested preview of official DeepSeek Harness.

## Why portable

| One folder | Move and continue | Update without moving data |
| --- | --- | --- |
| Sessions, settings, plugins, desktop data, and the default workspace stay together. | Exit, copy to another drive, USB device, or computer, and open it again. | Updates replace reproducible app components while keeping sessions, credentials, plugins, and workspace. |

This is not a renamed browser shortcut sold as a “no-install build.” Its runtime and plugin tools live inside the product folder, so the destination computer does not need Node.js or pnpm and DSH-Portable never modifies the system `PATH`. The dedicated window, tray, recent sessions, task notifications, remembered placement, and update experience remain intact.

| Where you start | What Portable handles |
| --- | --- |
| **Online** | Download the roughly 55 KB launcher, place it where you want to keep the product, and run it. It prepares and verifies the complete folder beside itself. |
| **Offline** | The complete ZIP includes official DSH, its runtime, the Plugin Market, and plugin management tools. |
| **Another PC or USB drive** | Copy the folder; Portable repairs the paths it owns on the next launch. |
| **Personal data only** | Export the same migration contents as either a plain package or a password-encrypted private package. |
| **Long-term updates** | DSH-Portable and the official DSH core update independently while preserving `data` and `workspace`. |
| **Something goes wrong** | Use the read-only check, data-preserving repair, and redacted support report built into the product. |

Starting with 0.4.15, the complete Windows package contains about **15% fewer files** and **14% fewer filesystem items** than the previous build. Release gates now prevent accidental regressions in file count, directory count, and extracted size. The target is the work Windows performs while extracting, copying, moving, or deleting—not merely a smaller number beside the download.

## Start in 3 steps

1. Download the [**Windows portable launcher**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe).
2. Put the launcher where you want to keep the product and run it. It prepares a complete `DSH-Portable` folder beside itself.
3. Connect a model in the interface. Next time, run `DeepSeek-Herness.exe` inside that folder.

The close button sends the app to the system tray by default, so an active task can keep running. To stop everything, right-click the tray icon and choose **Exit DeepSeek Harness**.

## Downloads

### Windows

| Choose this when… | Download |
| --- | --- |
| You want a movable folder prepared automatically | [**Portable launcher**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe) (recommended, about 55 KB) |
| The destination computer is offline, or you need manual extraction | [Complete offline ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |

### macOS

| Mac | Portable ZIP |
| --- | --- |
| Apple Silicon (M1–M4) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) |
| Intel | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) |

macOS packages are ad-hoc signed and not notarized by Apple. If first launch is blocked, Control-click the app and choose **Open**.

### Linux

| Computer | AppImage (recommended) | Complete portable folder |
| --- | --- | --- |
| Intel / AMD (x64) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz) |
| ARM64 | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz) |

```bash
chmod +x DeepSeek-Herness-linux-x64.AppImage
./DeepSeek-Herness-linux-x64.AppImage
```

The AppImage keeps sessions, settings, plugins, and workspace in the sibling `DSH-Portable-data` folder. Move or back up both together.

## Move and back up

See the [computer-to-computer migration guide](docs/move-between-computers.en.md) for the complete procedure, data-only packages, and a portability check that does not require a second computer.

1. Choose **Exit DeepSeek Harness** from the tray and wait for the window and tray icon to disappear.
2. Copy the entire `DSH-Portable` folder.
3. Run `DeepSeek-Herness.exe` on Windows or the corresponding entry point on the new platform.

Managed paths repair themselves after a move; external projects remain where you placed them. Exit on both computers before synchronizing the same folder to avoid concurrent session writes.

## Plugins

Open **Settings → Plugins → Plugin Market** to search, filter, visit a project, and install, update, disable, or remove community plugins. The market follows the DSH language and theme and never interrupts an active task silently.

Fresh installs include the removable [permanent session deletion](https://github.com/WSL043/dsh-native-session-manager) plugin. Permanent deletion always asks for a second confirmation and does not replace recoverable Archive. Normal upgrades do not reinstall a plugin an existing user removed.

On Windows, double-click `dsh.exe` or choose **More → DSH Terminal** from the tray. On macOS, open **DSH Terminal** from the application menu. On Linux, open **DSH Terminal** from the tray. Official commands published by third-party plugins can be pasted unchanged in this terminal:

```powershell
dsh plugin --profile web add <plugin>
dsh plugin --profile web list --depth 0
dsh plugin --profile web update <package-name>
dsh plugin --profile web remove <package-name>
dsh --profile web --dump-config
```

The Portable DSH Terminal recognizes `dsh` only inside that window and never changes the system `PATH`. After moving the complete Portable folder, a newly opened DSH Terminal automatically resolves the new location without repairing environment variables.

DSH-Portable focuses on a movable, offline-ready, repairable distribution and no longer publishes a conventional installer. If a conventional installer is the priority, use the full-featured [DeepSeek Harness Desktop (Electron)](https://github.com/anywhere-labs/deepseek-harness-desktop) or the smaller [DeepSeek Harness Desktop (Tauri)](https://github.com/dsh-tauri-desk/deepseek-harness-desktop).

Plugins that can be mounted safely take effect immediately, while client-only plugins need only a refresh. Updating host code is marked as pending restart. The market never updates, removes, or silently restarts DSH while a task is running. Install only plugins you trust.

## Updates and repair

- DSH-Portable opens the local workspace first, then checks in the background. Product updates and official DeepSeek Harness core updates are independent, and **Check for updates at startup** is off by default for both; enable or run either one from **Settings → General → Portable**.
- The tray also exposes both manual checks. Network checking, waiting for a decision, and applying an update are separate states, so the menu does not remain stuck on “Checking”.
- Every prompt names the target—DSH-Portable or DeepSeek Harness—and shows that target's current and next version.
- A normal update downloads only the changed DSH application component and shows the real download percentage. Sessions, settings, credentials, and workspace remain in place.
- When the runtime compatibility boundary changes, DSH-Portable downloads the verified complete package and replaces the app in place while preserving user data.
- Choose Later or **Skip this version**; installation waits for active tasks and a failed update rolls back.
- **Settings → General → Portable** provides checks, repair, and a support report. Repair keeps user data and rebuilds only reproducible components.

An official DSH update does not need to wait for a DSH-Portable feature release, but it never replaces a working environment directly. Finished-product tests on Windows, macOS, Linux x64, and Linux ARM64 must all pass before the independent core channel is published.

## Portable data

Normal updates preserve `data` and `workspace` in place. To move data into a clean Portable environment, choose **Export migration package** or **Export encrypted private package** under **Settings → General → Portable → Data and migration**. Both contain the same sessions, settings, plugin configuration, and API credentials; only the private package requires a password to read. Keep an unencrypted package only on a trusted device. Runtimes, caches, logs, and workspace files are deliberately excluded.

`DATA-MIGRATION.txt` in every finished package documents the inspect and restore commands. Restore imports only missing data by default; explicit replacement first creates a rollback copy under `data/backups/`. **Plugin sync** in the plugin market is only for moving a plugin list and plugin configuration between devices. It is not a full-product backup.

| Path | Contents |
| --- | --- |
| `data/dsh-home/` | Settings, model credentials, sessions, and plugins |
| `data/webview2/` | Windows desktop web data |
| `workspace/` | Default workspace |
| `data/logs/` | Local service and launcher logs |

## Security

DSH can execute local code, so use trusted models, plugins, and projects. The local service binds only to `127.0.0.1`, and the Portable shell disables DSH telemetry by default. `data` may contain API credentials and private conversations; protect it accordingly and prefer NTFS on removable Windows drives.

Read the full [privacy notice](PRIVACY.md), [security policy](SECURITY.md), and [code-signing policy](CODE_SIGNING.md). Current Windows releases are unsigned while the open-source signing application with SignPath Foundation is in progress.

## Get help

- [Report a bug](https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml)
- [Request an improvement](https://github.com/WSL043/DSH-Portable/issues/new?template=feature-request.yml)
- [Join a discussion](https://github.com/WSL043/DSH-Portable/discussions)
- [Project introduction in the official DSH community](https://github.com/deepseek-ai/deepseek-harness/discussions/4505)
- [Listed in Awesome DeepSeek Harness](https://github.com/0xsline/awesome-deepseek-harness)

Do not paste API keys, login credentials, or private conversations into an issue.

## Open source and contributing

DSH-Portable uses the standard [Apache-2.0 License](LICENSE). You may use, modify, and redistribute it, provided that the license, copyright, and change notices remain intact. The source and every platform package also carry [NOTICE.md](NOTICE.md), which identifies the canonical project and the boundary of third-party components.

Fixes and improvements are welcome as pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md) first so a contribution does not duplicate a capability already provided by official DSH.

<details>
<summary><strong>Build from source</strong></summary>

```powershell
./scripts/build-windows.ps1
```

```bash
bash scripts/build-macos.sh arm64   # or x64
bash scripts/build-linux.sh x64     # or arm64
```

Dependencies, release contents, and finished-product tests are pinned by the repository. Normal users do not need to compare checksums manually; `checksums.txt` remains available on each Release. New builds also receive a GitHub/Sigstore attestation bound to their source commit and qualification workflow; advanced users can verify one with `gh attestation verify <download> -R WSL043/DSH-Portable`.

</details>

If DSH-Portable helps you, consider leaving a [**Star**](https://github.com/WSL043/DSH-Portable/stargazers). It helps other people looking for a portable DSH discover the project.

DeepSeek Harness, the DeepSeek name, and its marks belong to DeepSeek. DSH-Portable is independently maintained by WSL043 and is not endorsed by DeepSeek.
