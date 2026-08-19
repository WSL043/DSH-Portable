> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.7`）。DSH-Portable 是独立社区分发项目。

0.2.5 继续使用官方 rc.7，重点修复 Windows 便携版的升级与启动可靠性：

- **轻量便携启动器现在会安全检查并升级已有版本。** 发现新版时先停止当前 DSH，再保留
  `data`、`workspace`、会话、凭据和插件完成事务替换；同版本直接启动。网络或更新通道
  暂时不可用时，也会继续启动本地版本，不把日常使用变成联网必需。
- **完整升级会重建 DSH 自动生成的 profile 模块映射。** 用户 profile、设置、会话、
  profile 内安装的插件和工作区保持不动，避免新旧 runtime 混用后出现
  `ERR_MODULE_NOT_FOUND`。
- **Windows 离线自解压构建不再覆盖已有的非空便携目录。** 这样不会把新程序文件与旧
  profile/runtime 混成半新半旧；升级已有目录请使用轻量便携启动器。
- **原生 WebView2 工作台启动等待从 30 秒提高到 60 秒。** 较慢机器或首次初始化时不再
  过早判定工作台启动失败。
- Windows、macOS、Linux x64 与 ARM64 继续经过同一套 contracts、真实成品构建、更新、
  移动和桌面生命周期测试后才进入发布通道。

普通应用组件更新只替换可更新的 DSH 应用文件并保留用户数据；跨启动器兼容边界时才会
下载一次完整版本并安全原地升级。

## Windows x64（推荐）

[**下载便携版**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)

双击后会在旁边准备可移动的 `DSH-Portable` 文件夹。以后直接运行文件夹中的
`DeepSeek-Herness.exe`。

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

> Packages the official DeepSeek Harness preview (`@deepseek-ai/dsh 0.1.0-rc.7`).
> DSH-Portable is an independent community distribution.

0.2.5 keeps the official rc.7 runtime and focuses on safer, more reliable Windows portable updates and startup:

- **The lightweight portable launcher now checks and upgrades an existing installation safely.** When a
  newer version is available, it stops the current DSH process and performs a transactional full-package
  replacement while preserving `data`, `workspace`, sessions, credentials, and plugins. If the update
  service or network is unavailable, the installed version still starts normally.
- **Full-package upgrades rebuild only DSH's generated profile module fallback.** Profile settings,
  sessions, profile-local plugins, and workspace data remain untouched, avoiding `ERR_MODULE_NOT_FOUND`
  failures caused by mixing a new runtime with stale generated module mappings.
- **The Windows offline self-extractor no longer overwrites a non-empty portable folder.** This prevents
  half-old/half-new installations; use the lightweight portable launcher when upgrading an existing folder.
- **The native WebView2 workspace startup window increases from 30 seconds to 60 seconds**, avoiding
  premature startup failures on slower systems and first-run initialization.
- Windows, macOS, Linux x64, and Linux ARM64 continue through the same contracts, finished-product build,
  update, movable-package, and desktop lifecycle release gates.

Normal component updates replace only the updateable DSH application files and preserve user data. A full
package is downloaded only when the launcher/runtime compatibility boundary requires it.

### Windows x64 (recommended)

[**Download the portable edition**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)

Run it once to create a movable `DSH-Portable` folder beside the launcher. Afterwards, start
`DeepSeek-Herness.exe` inside that folder.

<details>
<summary><strong>Other downloads</strong></summary>

- [Complete Windows portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip)
- [Windows installer](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe)
- Apple Silicon: [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac: [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)
- Linux x64: [AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) · [complete portable folder](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz)
- Linux ARM64: [AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) · [complete portable folder](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz)

</details>

Choose one download for your system. `checksums.txt` is optional and intended only for users who
want independent download verification.
