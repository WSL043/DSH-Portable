> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.8`）。DSH-Portable 是独立社区分发项目。

0.2.6 完成了官方 rc.8 的桌面适配，并修复启动关键路径：

- **工作台先打开，更新检查随后在后台进行。** 网络慢或更新服务暂时不可用时，不再延迟本地 DSH 启动；关闭“启动时检查更新”后不会发起自动检查，托盘中的手动入口仍可使用。
- **官方 rc.8 不再额外打开 Edge、Chrome 或默认浏览器。** Windows 使用 WebView2，macOS 使用 WKWebView，Linux 使用原生桌面壳；系统浏览器只处理用户主动打开的外部链接。
- **内置官方 DSH 升级到 rc.8。** 包含推理内容回传、多查询 Web Search、图片输入保护、文件打开错误提示、引用交互、动态 UI 与 Codex 子任务可靠性修复。
- **上游更新候选现在固定到 npm 版本对应的官方 Git tag。** 官方 `master` 后续变化不会被误写成已审核发行源码；候选仍需通过全部平台成品测试才会进入稳定更新通道。
- **Windows、macOS、Linux x64 与 ARM64 使用同一版本与数据保留契约。** 从 0.2.5 升级到 0.2.6 时，Windows 会自动下载一次完整版本；macOS 与 Linux 会提示下载一次完整新版，因为 rc.8 改变了桌面启动契约。会话、设置、凭据、插件与工作区继续保留。以后的兼容更新仍只下载变化的应用组件；macOS 与 Linux 会安排在下次启动前安装，避免打断任务。

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

0.2.6 adapts the official rc.8 release and fixes the desktop startup path:

- **The local workspace opens before update checking begins in the background.** A slow network or unavailable update service no longer delays local DSH startup. Disabling startup checks performs no automatic check; the manual tray command remains available.
- **Official rc.8 no longer opens Edge, Chrome, or the default browser beside the desktop app.** Windows uses WebView2, macOS uses WKWebView, and Linux uses its native desktop shell. The system browser is reserved for external links the user chooses to open.
- **The bundled official DSH moves to rc.8**, including reasoning delivery, multi-query Web Search, image-input safeguards, file-open feedback, references, dynamic UI, and Codex subtask reliability fixes.
- **Upstream candidates are pinned to the official Git tag matching the npm version.** Later `master` changes cannot be recorded as reviewed release source. Every candidate still has to pass the complete cross-platform product gate.
- **Windows, macOS, Linux x64, and Linux ARM64 share one version and data-preservation contract.** From 0.2.5 to 0.2.6, Windows downloads one complete package automatically; macOS and Linux request one complete download because rc.8 changes the desktop startup contract. Sessions, settings, credentials, plugins, and workspace remain in place. Later compatible updates return to the smaller component path, with macOS and Linux installing before the next launch so running work is not interrupted.

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
