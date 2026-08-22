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
  · <a href="#plugins">Plugins</a>
  · <a href="#get-help">Support</a>
  · <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><img src="https://img.shields.io/github/v/release/WSL043/DSH-Portable?display_name=release&style=flat-square&color=171717" alt="Latest release"></a>
  <a href="https://github.com/WSL043/DSH-Portable/releases"><img src="https://img.shields.io/github/downloads/WSL043/DSH-Portable/total?style=flat-square&label=downloads&color=171717" alt="GitHub downloads"></a>
  <img src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-171717?style=flat-square" alt="Windows, macOS, and Linux">
  <a href="https://github.com/WSL043/DSH-Portable/stargazers"><img src="https://img.shields.io/github/stars/WSL043/DSH-Portable?style=flat-square&label=Star&color=171717" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f855a?style=flat-square" alt="MIT license"></a>
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

It still behaves like a desktop product: dedicated window, system tray, recent sessions, task-completion notifications, remembered window placement, and updates that do not interrupt active work.

## Start in 3 steps

1. Download the [**Windows portable launcher**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe).
2. Run it and choose a location. It prepares a complete `DSH-Portable` folder.
3. Connect a model in the interface. Next time, run `DeepSeek-Herness.exe` inside that folder.

The close button sends the app to the system tray by default, so an active task can keep running. To stop everything, right-click the tray icon and choose **Exit DeepSeek Harness**.

## Downloads

### Windows

| Choose this when… | Download |
| --- | --- |
| You want a movable folder prepared automatically | [**Portable launcher**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe) (recommended, about 55 KB) |
| The destination computer is offline, or you need manual extraction | [Complete offline ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |
| You want a conventional install and uninstall flow | [Windows installer](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe) |

### macOS

| Mac | DMG (recommended) | Portable ZIP |
| --- | --- | --- |
| Apple Silicon (M1–M4) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) |
| Intel | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) |

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

1. Choose **Exit DeepSeek Harness** from the tray and wait for the window and tray icon to disappear.
2. Copy the entire `DSH-Portable` folder.
3. Run `DeepSeek-Herness.exe` on Windows or the corresponding entry point on the new platform.

Managed paths repair themselves after a move; external projects remain where you placed them. Exit on both computers before synchronizing the same folder to avoid concurrent session writes.

## Plugins

Open **Settings → Plugins → Plugin Market** to search, filter, visit a project, and install, update, disable, or remove community plugins. The market follows the DSH language and theme and never interrupts an active task silently.

Fresh installs include the removable [permanent session deletion](https://github.com/WSL043/dsh-native-session-manager) plugin. Permanent deletion always asks for a second confirmation and does not replace recoverable Archive. Normal upgrades do not reinstall a plugin an existing user removed.

`dsh.exe` is the command-line entry point for advanced users, not another desktop launcher:

```powershell
.\dsh.exe plugin --profile web add <plugin>
.\dsh.exe plugin --profile web list --depth 0
.\dsh.exe plugin --profile web update <package-name>
.\dsh.exe plugin --profile web remove <package-name>
.\dsh.exe --profile web --dump-config
```

Plugins that can be mounted safely take effect immediately, while client-only plugins need only a refresh. Updating host code is marked as pending restart. The market never updates, removes, or silently restarts DSH while a task is running. Install only plugins you trust.

## Updates and repair

- DSH-Portable opens the local workspace first, then checks for updates in the background. Automatic update checks are off by default; check manually or enable **Check for updates at startup** from the tray.
- The update window distinguishes the DSH-Portable product version from the bundled official DSH version.
- Every notification names the DSH-Portable product version; the bundled official DSH version and whether it changes are listed separately.
- A normal update downloads only the changed DSH application component and shows the real download percentage. Sessions, settings, credentials, and workspace remain in place.
- When the runtime compatibility boundary changes, DSH-Portable downloads the verified complete package and replaces the app in place while preserving user data.
- Choose Later or **Skip this version**; installation waits for active tasks and a failed update rolls back.
- **Settings → General → Portable** provides checks, repair, and a support report. Repair keeps user data and rebuilds only reproducible components.

An official DSH update never replaces a working environment directly. It reaches the Portable channel only after Windows, macOS, Linux x64, and Linux ARM64 finished-product tests.

## Portable data

| Path | Contents |
| --- | --- |
| `data/dsh-home/` | Settings, model credentials, sessions, and plugins |
| `data/webview2/` | Windows desktop web data |
| `workspace/` | Default workspace |
| `data/logs/` | Local service and launcher logs |

The installed edition keeps the same data under `%LOCALAPPDATA%\DeepSeek-Herness` and does not remove it during uninstall.

## Security

DSH can execute local code, so use trusted models, plugins, and projects. The local service binds only to `127.0.0.1`, and the Portable shell disables DSH telemetry by default. `data` may contain API credentials and private conversations; protect it accordingly and prefer NTFS on removable Windows drives.

## Get help

- [Report a bug](https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml)
- [Request an improvement](https://github.com/WSL043/DSH-Portable/issues/new?template=feature-request.yml)
- [Join a discussion](https://github.com/WSL043/DSH-Portable/discussions)

Do not paste API keys, login credentials, or private conversations into an issue.

## Open source and contributing

DSH-Portable uses the standard [MIT License](LICENSE). You may use, modify, and redistribute it, provided that its copyright and license notice remains intact. The source and every platform package also carry [NOTICE.md](NOTICE.md), which identifies the canonical project and the boundary of third-party components.

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

Dependencies, release contents, and finished-product tests are pinned by the repository. Normal users do not need to compare checksums manually; `checksums.txt` remains available on each Release.

</details>

If DSH-Portable helps you, consider leaving a [**Star**](https://github.com/WSL043/DSH-Portable/stargazers). It helps other people looking for a portable DSH discover the project.

DeepSeek Harness, the DeepSeek name, and its marks belong to DeepSeek. DSH-Portable is independently maintained by WSL043 and is not endorsed by DeepSeek.
