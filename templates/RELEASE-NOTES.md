> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.6`）。DSH-Portable 是独立社区分发项目。

本次更新会在 Windows 和 macOS 记住桌面窗口的大小与位置；重新打开时恢复上次布局，
显示器变化后则自动回到安全的可见位置。Windows 托盘继续跟随 DSH 的语言和明暗外观，
显示最近会话，并可直接打开会话或新建会话。关闭窗口默认收进系统托盘，任务继续运行。

便携目录继续完整保留会话、设置、插件和工作区。启动时检查更新，一般只下载变化的
DSH 应用组件；本次更新需要下载一次完整包，后续兼容更新继续只下载变化的 DSH 应用组件。
推荐下载器无法联网时会打开实际发布的离线 ZIP；普通下载列表不再混入机器更新文件。

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

</details>

普通用户只需选择与系统对应的一个下载。`checksums.txt` 仅供需要独立校验下载的用户。

---

## English

> Packages the official DeepSeek Harness preview (`@deepseek-ai/dsh 0.1.0-rc.6`).
> DSH-Portable is an independent community distribution.

This release remembers the native window size and position on Windows and macOS. It restores the
last workspace layout on launch and falls back to a safe visible position after display changes.
The Windows tray continues to follow the DSH language and appearance, list recent sessions, and
open a session or start a new one directly. Closing the window sends the app to the tray by default.

Portable sessions, settings, plugins, and workspace remain in the same folder. Startup update checks
normally download only the changed DSH application component. This release requires one complete
package download; later compatible updates return to component-only downloads.
If the recommended downloader cannot connect, its offline option now opens the published ZIP.
Machine update files no longer appear in the normal download list.

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

</details>

Choose one download for your system. `checksums.txt` is optional and intended only for users who
want independent download verification.
