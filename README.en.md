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
  <img src="assets/dsh-workspace-0.6.4.png" width="1040" alt="DeepSeek Harness workspace in DSH-Portable">
</p>

> [!NOTE]
> DSH-Portable is an independent community distribution, not an official DeepSeek desktop app. It packages an adapted and finished-product-tested preview of official DeepSeek Harness.

## Why portable

| One folder | Move and continue | Update without moving data |
| --- | --- | --- |
| Sessions, settings, plugins, desktop data, and the default workspace stay together. | Exit, copy to another drive, USB device, or a computer with the same OS and architecture, and open it again. | Updates replace reproducible app components while keeping sessions, credentials, plugins, and workspace. |

The runtime and plugin tools live inside the product folder, so the destination computer does not need Node.js or pnpm and DSH-Portable never modifies the system `PATH`. Portable still provides a dedicated window, tray, recent sessions, task notifications, remembered placement, and its update flow.

On Windows, enabling **Task notifications** shows a system notification when a background task finishes or needs an answer or approval. Completion notifications let you reply to the originating task. Approval notifications offer Reject and Allow once; simple single-choice questions can be answered directly, while complex questions open the corresponding task. Windows controls notification expansion; the taskbar icon counts completed tasks you have not opened or replied to yet and clears them after you open or reply.

| Where you start | What Portable handles |
| --- | --- |
| **Online** | Download the 76,288-byte (about 74.5 KiB) launcher, place it where you want to keep the product, and run it. It prepares and verifies the complete folder beside itself. |
| **Offline** | The complete ZIP includes official DSH, its runtime, the Plugin Market, and plugin management tools. |
| **Another PC or USB drive (same OS/architecture)** | Copy the folder; Portable repairs the paths it owns on the next launch. |
| **Personal data only** | Export the same migration contents as either a plain package or a password-encrypted private package. |
| **Long-term updates** | DSH-Portable and the official DSH core update independently while preserving `data` and `workspace`. |
| **Something goes wrong** | Use the read-only check, data-preserving repair, and redacted support report built into the product. |

The published 0.6.4 Windows offline ZIP is **56,409,457 bytes (about 53.8 MiB)**, and the Windows bootstrap EXE is **76,288 bytes (about 74.5 KiB)**. The official DSH runtime travels as one verified compact package, is prepared once on each computer, and is reused afterward; sessions, settings, plugins, and workspace remain in the Portable folder. This keeps the complete plugin runtime while reducing the small-file work needed to copy and update it.

### Component boundaries and release cadence

DSH-Portable maintains the desktop shell, portable layout, update, repair, and migration flows. The official DSH is the upstream core pinned and verified for each package. They use separate versions and release cadences: a Portable feature version does not equal an official-core version, and each new version should be judged by its own Release notes.

The chat workspace, model configuration, and general settings follow official DSH. Portable focuses on windows and the tray, its runtime, updates, migration, and recovery; upstream pages receive only the adaptations needed for Portable compatibility.

The Plugin Market and the two default plugins are Portable integration components. The market catalog mainly lists community plugins; a listing is not official endorsement or a security audit. Only the defaults are pinned and covered by Portable finished-product verification. Evaluate other plugins yourself and install them as needed. Compatibility not listed in the relevant Release notes or verification scope is not a Portable promise.

## Start in 3 steps

1. Download the [**Windows portable launcher**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe).
2. Put the launcher where you want to keep the product and run it. It prepares a complete `DSH-Portable` folder beside itself.
3. Connect a model in the interface. Next time, run `DeepSeek-Herness.exe` inside that folder.

The close button sends the app to the system tray by default, so an active task can keep running. To stop everything, use the native **File → Exit DeepSeek Harness** command first; on Windows, press `Ctrl+Q`. The tray's **Exit DeepSeek Harness** command is an alternate path.

## Downloads

### Windows

| Choose this when… | Download |
| --- | --- |
| You want a movable folder prepared automatically | [**Portable launcher**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe) (recommended, 76,288 bytes, about 74.5 KiB) |
| The destination computer is offline, or you need manual extraction | [Complete offline ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |

### macOS

| Mac | Portable ZIP |
| --- | --- |
| Apple Silicon (arm64) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) |
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

The full-folder `DeepSeek-Herness` launcher is a Linux ELF. Some file managers show a generic executable icon; use the AppImage for desktop icons and application-menu integration.

## Move and back up

See the [computer-to-computer migration guide](docs/move-between-computers.en.md) for the complete procedure, data-only packages, and a portability check that does not require a second computer.

1. Use **File → Exit DeepSeek Harness** first; on Windows, press `Ctrl+Q`, or choose the tray's alternate **Exit DeepSeek Harness** command, and wait for the window and tray icon to disappear.
2. Copy the entire `DSH-Portable` folder to a new location with the same OS and architecture.
3. Run `DeepSeek-Herness.exe` from that location.

Managed paths repair themselves after a move; external projects remain where you placed them. Exit on both computers before synchronizing the same folder to avoid concurrent session writes.

Copying the complete folder is supported only between the same operating system and CPU architecture. When changing OS or architecture, download the target platform package and use a data archive to migrate sessions, settings, and plugin configuration. Rebuild native plugin dependencies on the target and move or reconnect external workspaces yourself; cross-OS restore has not yet passed finished-product qualification.

## Plugins

Open **Settings → Plugins → Plugin Market** to search, filter, visit a project, and install, update, disable, or remove community plugins. The market follows the DSH language and theme and never interrupts an active task silently.

Optional provider: [Codex Subscription](https://github.com/WSL043/dsh-codex-subscription) connects a ChatGPT/Codex subscription through the existing Plugin Market or standard DSH command; it is not installed by default.

Fresh installs include only two reviewed, removable defaults, currently on the Stable channel: [Image Viewer](https://github.com/WSL043/dsh-image-viewer) **0.1.0** provides galleries, zoom, pan, download and region notes; [Chat Manager](https://github.com/WSL043/dsh-chat-manager) **1.3.3** provides archive search, restoration and confirmed session deletion. Other community plugins remain opt-in through the Plugin Market or standard DSH commands. Normal upgrades preserve the existing Profile and every installed or removed plugin; removing either default prevents later launches and updates from installing it again.

On Windows, double-click `dsh.exe` or choose **More → DSH Terminal** from the tray. On macOS, open **DSH Terminal** from the application menu. On Linux, open **DSH Terminal** from the tray. Standard DSH commands documented by a plugin can be pasted unchanged in this terminal:

```powershell
dsh plugin --profile web add <plugin>
dsh plugin --profile web list --depth 0
dsh plugin --profile web update <package-name>
dsh plugin --profile web remove <package-name>
dsh --profile web --dump-config
```

The Portable DSH Terminal recognizes `dsh` only inside that window and never changes the system `PATH`. After moving the complete Portable folder within the same OS and architecture, a newly opened DSH Terminal automatically resolves the new location without repairing environment variables.

Plugins that can be mounted safely take effect immediately, while client-only plugins need only a refresh. Updating host code is marked as pending restart. The market never updates, removes, or silently restarts DSH while a task is running. Install only plugins you trust.

## Windows desktop controls

![Windows native navigation](assets/windows-navigation-dark.png)

Native navigation follows the selected theme and provides sidebar and history controls.


Startup uses one native logo, loading indicator, and phase description until the workspace is ready. The loading surface and menus follow your saved light/dark theme. The top-left File, View, and Help menus expose common desktop actions.

| Action | Shortcut |
| --- | --- |
| New session / Settings | `Ctrl+N` / `Ctrl+,` |
| Reload the interface while backend tasks continue | `Ctrl+R` or `F5` |
| Zoom in / out / actual size | `Ctrl++` / `Ctrl+-` / `Ctrl+0` |
| Toggle / leave full screen | `F11` / `Esc` |
| Close window / quit | `Ctrl+W` / `Ctrl+Q` |
| Open File / View / Help | `Alt+F` / `Alt+V` / `Alt+H` |

Leaving full screen restores the previous window bounds and maximized state. Outside full screen, `Esc` remains available to page dialogs. To quit completely, use the File menu's **Exit DeepSeek Harness** command first; the tray exit command is an alternate path. Help provides product and core update checks, the logs folder, and issue reporting.

## Updates and repair

> The screenshot and dedicated Updates settings page below describe the current development build. In the published 0.6.4 release, use Settings → General → Portable.

![Dedicated Updates settings page](assets/portable-updates.png)

- DSH-Portable opens the local workspace first, then checks in the background only when the corresponding startup setting is enabled. Product updates and official DeepSeek Harness core updates are independent, and both **Check for updates at startup** settings are off by default; **Settings → Updates** is the primary update entry: check DSH-Portable or the official DeepSeek Harness core, then install the update in-page after desktop-host confirmation. Their check and install operations are independent but share the Stable/Candidate preference.
- Choose the **Stable** or **Candidate** update channel. Stable is intended for daily use; Candidate carries Alpha, Beta, or RC builds according to their actual maturity, after the matching Portable finished-product gates pass. Switching channels never downgrades the installed version. See the [release-stage policy](docs/release-policy.md).
- The tray provides both manual checks as an alternate entry. Network checking, waiting for a decision, and applying an update are separate states, so the menu does not remain stuck on “Checking”.
- Every prompt names the target—DSH-Portable or DeepSeek Harness—and shows that target's current and next version.
- A normal update downloads only the changed DSH application component and shows the real download percentage. Sessions, settings, credentials, and workspace remain in place.
- When the runtime compatibility boundary changes, DSH-Portable downloads the verified complete package and replaces the app in place while preserving user data.
- Choose Later or **Skip this version**; installation waits for active tasks. Before replacing the core, the new core composes every existing profile and its plugins; an incompatible update leaves the installed version unchanged. A new version commits only after its workspace becomes ready, and a startup failure or timeout restores the previous program automatically while keeping sessions, settings, plugins, and workspace.
- **Settings → Portable** provides checks, repair, and a redacted support report. Startup traces and desktop/backend health samples are grouped by launch in `data/logs/history/`. Retention defaults to the latest 30 runs within 14 days, capped at 32 MiB; each log rotates at 128 KiB. Support reports include redacted launch history and explicitly mark truncation when the export budget is reached; retained local history remains available for further investigation. Attach that report for slow or failed launches instead of sending raw logs that may contain login tokens. Repair keeps user data and rebuilds only reproducible components.

Official DSH versions are discovered from the official npm registry every hour. Each discovered version records immutable package integrity and official source provenance, then must pass finished-product qualification on five targets: Windows x64, macOS arm64, macOS x64, Linux x64, and Linux arm64. The catalog processes the latest missing version first; historical backfill is supported only within a window of at most 20 versions. A failed version never replaces the accepted catalog. A compatible official release can enter the independent core channel without a new DSH-Portable release; publication never directly replaces the working environment, and the two release lines can use different versions and dates.

The [release-writing guide](docs/release-writing.md) documents the evidence required for release notes.

## Folder layout

Start with `README.txt` at the root. Bilingual guides and migration commands live in `docs/`; licenses and component provenance live in `licenses/`. Open `DeepSeek-Herness.exe` for the workspace or `dsh.exe` for a terminal on Windows. Keep `app/`, `launcher/`, `runtime/` and `default-plugins/` in place.

## Portable data

Normal updates preserve `data` and `workspace` in place. To move data into a clean Portable environment, choose **Export migration package** or **Export encrypted private package** under **Settings → Portable → Data and migration**. Both contain the same sessions, settings, plugin configuration, and API credentials; only the private package requires a password to read. Keep an unencrypted package only on a trusted device; it is still an integrity-checked compressed container rather than a text file. Runtimes, caches, logs, and workspace files are deliberately excluded. Import restores plugin dependencies and validates each profile; any failure restores the previous data automatically.

`docs/DATA-MIGRATION.en.txt` in every finished package documents the English inspect and restore commands; `docs/DATA-MIGRATION.zh-CN.txt` provides a separate Chinese guide. Restore imports only missing data by default; explicit replacement first creates a rollback copy under `data/backups/`.

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

The bundled DSH 0.1.2-rc.1 has a known network compatibility limitation: Clash/Mihomo Fake-IP DNS can cause `web_fetch` to return `WEB_BLOCKED_URL`. See the [upstream discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/5202) for progress.

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
