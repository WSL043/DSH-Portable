> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.8`）。DSH-Portable 是独立社区分发项目。

0.3.0-rc.1 是 Portable 扩展市场的公开测试版：

- **设置 → 插件新增“便携扩展”。** 首批只提供两个经过版本固定的可选扩展：ChatGPT / Codex 订阅，以及实验性的永久删除会话。两者都默认不安装。
- **扩展变更不会打断正在运行的任务。** 用户确认后只排到下次正常启动；安装包会校验大小与 SHA-256，随后组合配置并等待桌面 Host 健康检查。
- **失败会恢复原配置。** Portable 会保存 profile 快照、重建依赖并再次验证配置；恢复没有完成时会保留证据并暂停启动，不会带着未知配置继续运行。
- **永久删除仍是显式实验能力。** 安装前会单独披露不可撤销的本地会话删除权限；移除插件不会自动删除插件曾创建的数据。
- **Windows、macOS、Linux x64 与 ARM64 使用同一成品测试门。** 这次桌面壳能力变化需要从 0.2.6 完整升级一次；会话、设置、凭据、现有插件与工作区继续保留。

内置官方 DSH 仍为 `0.1.0-rc.8`（提交 `141eb6f`），本次没有用未发布的上游源码替换已验证运行时。

桌面端会先打开本地工作区，再在后台启动时检查更新。Windows 与 macOS 都可以在设置或托盘中关闭“启动时检查更新”，也可以对单个版本选择“跳过此版本”。每次提示都会明确区分 DSH-Portable 产品版本与内置官方 DSH 版本；兼容边界不变时只下载变化的 DSH 应用组件，界面显示真实下载百分比。需要完整升级时会下载经过校验的完整版本并原地替换应用文件，会话、设置、凭据、插件与工作区继续保留。

默认 JSONL 会话可以直接升级。若你曾自行启用 DSH 的可选持久 SQLite 后端，rc.8 的数据库格式与旧版不兼容；请先备份并等待上游提供迁移方案，不要删除旧数据库。

## Windows x64（推荐）

[**下载便携版**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)

双击后会在旁边准备可移动的 `DSH-Portable` 文件夹。以后直接运行文件夹中的 `DeepSeek-Herness.exe`。

<details>
<summary><strong>其他下载</strong></summary>

- [Windows 便携完整 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip)
- [Windows 安装版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe)
- Apple Silicon：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)
- Linux x64：[AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) · [完整便携目录](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz)
- Linux ARM64：[AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) · [完整便携目录](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz)

</details>

普通用户只需选择与系统对应的一个下载。`checksums.txt` 仅供需要独立校验下载的用户。

---

## English

> Packages the official DeepSeek Harness preview (`@deepseek-ai/dsh 0.1.0-rc.8`). DSH-Portable is an independent community distribution.

0.3.0-rc.1 is the public test candidate for Portable Extensions:

- **Settings → Plugins gains Portable extensions.** The initial catalog contains only two pinned, optional entries: ChatGPT / Codex subscriptions and experimental permanent session deletion. Neither is installed by default.
- **Extension changes never interrupt a running task.** A confirmed change waits for the next normal start. The product verifies artifact size and SHA-256, composes the profile, and waits for the Portable Host health gate.
- **Failures restore the previous profile.** Portable keeps a profile snapshot, rebuilds dependencies, and validates the restored configuration. If recovery cannot complete, it preserves the evidence and pauses startup instead of loading an unknown profile.
- **Permanent deletion remains explicitly experimental.** Its irreversible local-session capability is disclosed separately before installation. Removing the extension does not automatically delete data the extension created.
- **Windows, macOS, Linux x64, and Linux ARM64 share the same finished-product gate.** This desktop-shell change requires one complete upgrade from 0.2.6; sessions, settings, credentials, existing plugins, and workspace remain in place.

The bundled official DSH remains `0.1.0-rc.8` at commit `141eb6f`; this candidate does not replace the tested runtime with unpublished upstream source.

The desktop opens the local workspace first, then checks for updates in the background at startup. On Windows and macOS, you can turn off updates at startup from Settings or the tray, or choose **Skip this version** for one release. Every notification names the DSH-Portable product version separately from the bundled official DSH version. When the compatibility boundary is unchanged, it downloads only the changed DSH application component and shows the real download percentage. When a complete upgrade is required, it downloads the verified complete package and replaces application files in place while sessions, settings, credentials, plugins, and workspace remain in place.

Default JSONL sessions can be upgraded normally. If you explicitly enabled DSH's optional durable SQLite backend, rc.8 uses an incompatible database format. Back up the old database and wait for an upstream migration path instead of deleting it.

### Windows x64 (recommended)

[**Download the portable edition**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)

Run it once to create a movable `DSH-Portable` folder beside the launcher. Afterwards, start `DeepSeek-Herness.exe` inside that folder.

<details>
<summary><strong>Other downloads</strong></summary>

- [Complete Windows portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip)
- [Windows installer](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe)
- Apple Silicon: [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac: [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)
- Linux x64: [AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) · [complete portable folder](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz)
- Linux ARM64: [AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) · [complete portable folder](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz)

</details>

Choose one download for your system. `checksums.txt` is optional and intended only for users who want independent download verification.
