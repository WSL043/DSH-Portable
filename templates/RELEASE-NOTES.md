> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.6`）。DSH-Portable 是独立社区分发项目。

0.2.1 把更新信息和桌面托盘收成一套更清楚的产品体验：

- 更新窗口分别显示 **DSH-Portable** 与 **内置官方 DSH** 的当前和目标版本；本次内置
  官方 DSH 仍为 `0.1.0-rc.6`。
- 下载显示真实百分比与已下载大小，并继续显示验证、安装和重新打开阶段。
- Windows 托盘跟随 DSH 的中文/英文与明暗外观；最近会话、新会话、更多操作和退出采用
  一致的层级，仍通过官方会话接口打开内容。
- 关闭启动时检查更新后不再主动提醒，手动检查保留；运行中的任务不会被自动更新中断。

普通更新只替换 DSH 应用组件并保留用户数据。

从旧版升级时，如果启动器兼容边界变化，会下载一次完整版本并原地更新；`data`、
`workspace`、会话、凭据和插件都会保留。Windows、macOS、Linux x64 与 ARM64 成品仍由
同一发布门验证。

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

> Packages the official DeepSeek Harness preview (`@deepseek-ai/dsh 0.1.0-rc.6`).
> DSH-Portable is an independent community distribution.

0.2.1 makes updates and the desktop tray feel like one coherent product:

- The update window separates the **DSH-Portable** version from the **bundled official DSH** version.
  The bundled official DSH remains `0.1.0-rc.6` in this release.
- Downloads show the real percentage and transferred size, followed by verification, installation,
  and reopen stages.
- The Windows tray follows the DSH language and light/dark appearance. Recent sessions, New Session,
  More, and Exit use a consistent hierarchy while session actions still use the official runtime API.
- Disabling startup checks suppresses automatic prompts while manual checks stay available. Running
  tasks are never interrupted automatically.

If an older launcher crosses a compatibility boundary, it downloads one complete package and updates
in place while preserving `data`, `workspace`, sessions, credentials, and plugins. Finished products
for Windows, macOS, Linux x64, and Linux ARM64 continue through the same release gate.

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
