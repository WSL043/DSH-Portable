<p align="center">
  <img src="assets/DSH-Portable.svg" width="82" alt="DeepSeek Harness">
</p>

<h1 align="center">DSH-Portable</h1>

<p align="center">
  <strong>The portable edition of DeepSeek Harness: take sessions, settings, plugins, and your workspace in one folder.</strong>
</p>

<p align="center">
  <a href="https://wsl043.github.io/DSH-Portable/"><strong>Website</strong></a>
  · <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><strong>Download</strong></a>
  · <a href="#start-in-3-steps">Get started</a>
  · <a href="docs/user-guide.en.md">User guide</a>
  · <a href="#plugins">Plugins</a>
  · <a href="#get-help">Support</a>
  · <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable"><img src="https://img.shields.io/github/stars/WSL043/DSH-Portable?style=flat-square&amp;label=Stars&amp;color=171717&amp;logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><img src="https://img.shields.io/github/v/release/WSL043/DSH-Portable?display_name=tag&label=release&style=flat-square&color=171717" alt="Latest release"></a>
  <a href="https://github.com/WSL043/DSH-Portable/releases"><img src="https://img.shields.io/github/downloads/WSL043/DSH-Portable/total?style=flat-square&label=downloads&color=171717" alt="GitHub downloads"></a>
  <a href="https://github.com/WSL043/DSH-Portable/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/WSL043/DSH-Portable/ci.yml?branch=main&style=flat-square&label=build&color=171717" alt="Cross-platform build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/WSL043/DSH-Portable?style=flat-square&label=license&color=171717" alt="Apache-2.0 license"></a>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe"><strong>Download Windows portable</strong></a>
</p>

<p align="center">
  <img src="assets/portable-layout-en.svg" width="1040" alt="Portable program, data, and workspace kept together">
</p>

> DSH-Portable is an independent community distribution, not an official DeepSeek application and not endorsed by DeepSeek.<br>
> DeepSeek also offers an [official desktop app](https://www.deepseek.com/harness/); each option serves different needs.

## Which should I choose?

| | Official desktop app | DSH-Portable |
| --- | --- | --- |
| Installation and platforms | Installer; Windows and macOS | Portable; Windows, macOS, and Linux, with no installation or PATH changes |
| Update cadence | Follows the official release schedule | Portable and core update separately; choose a core version |
| Moving and maintenance | Standard desktop installation | After fully exiting, copy the whole folder to a USB drive or another computer with the same OS and architecture; data-preserving rollback and recovery tools are included |
| Plugins | Official desktop app | Built-in Plugin Market entry, using DSH plugin management |
| A good fit if… | You want an installed app on one computer | You want to carry it between devices or control updates |

Choose the [official installer](https://www.deepseek.com/harness/) if you want a system installation for one computer; choose DSH-Portable if you want to carry it, use multiple devices, or manage update timing.

## Downloads

For everyday use, choose the stable 0.x (Native) line. The 1.0 development line remains drafts and development builds, outside public Releases and is not an upgrade path.

### Windows

| Choose this when… | Download |
| --- | --- |
| You have internet access and want the folder prepared automatically | [Online portable launcher](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe) (recommended) |
| You prefer to download and extract it yourself | [Standard ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |
| WebView2 is missing and the target cannot download it | [Complete offline ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-complete-offline.zip) |

Not sure? Use the online launcher with internet, or the standard ZIP for manual extraction. Windows 11 includes WebView2, and most Windows 10 PCs already have it; the complete offline ZIP includes it. See the [offline deployment requirements](docs/user-guide.en.md#offline-deployment).

### macOS

[Apple Silicon (arm64)](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [Intel (x64)](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [First launch](docs/user-guide.en.md#macos)

### Linux

| Architecture | AppImage | Complete portable folder |
| --- | --- | --- |
| Intel / AMD (x64) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz) |
| ARM64 | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) | [Download](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz) |

See the [Linux guide](docs/user-guide.en.md#linux) for AppImage launch details, data location, and the complete folder.

## Start in 3 steps

1. Download the [Windows portable launcher](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe).
2. Put it where you want the app to live and run it; it prepares the complete DSH-Portable folder beside it.
3. Connect a model service; next time, run DeepSeek-Herness.exe from that folder.

The close button sends the app to the tray, so tasks continue. To quit, use **File → Exit DeepSeek Harness**; on Windows press Ctrl+Q. The tray menu is an alternate exit path.

## How portability works

- **One folder:** Sessions, settings, plugins, and the default workspace stay together; see the [data guide](docs/user-guide.en.md#portable-data).
- **Move and resume:** Fully exit, then copy the entire folder to a USB drive or a computer with the same OS and architecture; see [migration steps](docs/user-guide.en.md#move-and-back-up).
- **Updates keep data:** Portable and official-core updates are separate, with core version selection; see [updates and repair](docs/user-guide.en.md#updates-and-repair).
- **Recovery when needed:** Checks, targeted repair, support reports, and DSH-Recovery.exe preserve personal data; see the [recovery guide](docs/user-guide.en.md#dsh-recoveryexe).

## Plugins

Open **Settings → Plugins → Plugin Market** to search, install, update, or remove plugins; see the [plugin guide](docs/user-guide.en.md#plugins).

Fresh installs include two removable defaults: [Image Viewer](https://github.com/WSL043/dsh-image-viewer) and [Chat Manager](https://github.com/WSL043/dsh-chat-manager).

In **Plugins → Add plugin**, enter a package name or address—not a terminal command. See the [guide](docs/user-guide.en.md#plugins) for advanced use and default-plugin details.

## Choose your core version

<!-- core-support:start -->
**Choose your core version** · Settings → Updates · Since 0.6.5 stable (first available in 0.6.5-rc.1).

<details>
<summary>View available cores for Portable 0.8.2</summary>

| Platform | Stable channel | Candidate channel |
| --- | --- | --- |
| Windows x64 | — | — |
| macOS arm64 | — | — |
| macOS x64 | — | — |
| Linux x64 | — | — |
| Linux arm64 | — | — |

Synced hourly from qualified catalogs. Older and RC builds depend on in-app compatibility checks; — means no matching version.

</details>

<!-- core-support:end -->

See the [updates and repair guide](docs/user-guide.en.md#updates-and-repair) for core selection, compatibility checks, and rollback.

## Roadmap

- **Stable 0.x (Native):** The current public download; near-term work focuses on polish and stability.
- **1.0 development line:** Portable adaptation of the official desktop product; still development builds and drafts, outside public Releases and not an upgrade path.
- See the [1.0 roadmap](docs/roadmap-toward-1.0.md) and the [official desktop payload experiment](experiments/official-payload/README.md).

## Get help

- [Report a bug](https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml) · [Request an improvement](https://github.com/WSL043/DSH-Portable/issues/new?template=feature-request.yml) · [Join a discussion](https://github.com/WSL043/DSH-Portable/discussions)
- See the [upstream note](https://github.com/deepseek-ai/deepseek-harness/discussions/5202) for network compatibility; do not paste API keys, login credentials, or private conversations into issues.

## Security

DSH can execute local code. Use trusted models, plugins, and projects. Read the [privacy notice](PRIVACY.md), [security policy](SECURITY.md), and [code-signing policy](CODE_SIGNING.md).

## Open source and contributing

This project uses [Apache-2.0](LICENSE) and includes its [component notice](NOTICE.md). Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first.

<details>
<summary><strong>Build from source</strong></summary>

```powershell
./scripts/build-windows.ps1
```

```bash
bash scripts/build-macos.sh arm64   # or x64
bash scripts/build-linux.sh x64     # or arm64
```

Dependencies, release contents, and finished-product tests are pinned by the repository. Releases include checksums.txt; advanced users can verify a GitHub/Sigstore build attestation with gh attestation verify <download> -R WSL043/DSH-Portable.

</details>

If DSH-Portable helps, star the [GitHub repository](https://github.com/WSL043/DSH-Portable) and share it with people who want a portable workspace.

DeepSeek Harness, the DeepSeek name, and its marks belong to DeepSeek. DSH-Portable is independently maintained by WSL043 and is not endorsed by DeepSeek.
