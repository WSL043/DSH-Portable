> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.6`）。DSH-Portable 是独立社区分发项目。

0.2.3 修正 Windows 托盘的基础交互：

- 左键单击托盘图标会直接打开 DeepSeek Harness；右键才显示任务菜单，点击菜单外会按
  Windows 原生行为关闭菜单。
- “打开 DeepSeek Harness”固定在一级菜单首项；最近 3 个会话仍直接可达，其余会话进入
  “更多”，菜单最多两层。
- “启动时检查更新”会在点击后立即显示开关结果，重启后继续使用用户选择。
- 网页式右键菜单和浏览器状态栏不再出现在桌面窗口中。
- 导出会话等文件下载由桌面壳接管，真实进度与完成状态直接显示在 DSH 原有导出窗口中。
- 托盘继续跟随 DSH 的中文/英文与明暗外观；本次内置官方 DSH 仍为 `0.1.0-rc.6`。
- 插件命令异常中断后留下的失效锁会被安全回收，不再永久阻止后续插件安装或更新。

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

0.2.3 corrects the fundamental Windows tray interactions:

- Left-clicking the tray icon opens DeepSeek Harness directly. Right-clicking opens the task menu,
  and clicking elsewhere dismisses it through the native Windows menu behavior.
- **Open DeepSeek Harness** is the first top-level command. The three most recent sessions remain
  directly accessible, remaining sessions are under More, and the menu is never deeper than two levels.
- **Check for updates at startup** now reflects a click immediately and keeps the choice after restart.
- Web-style context menus and the browser status bar no longer appear in the desktop window.
- Session exports and other downloads are owned by the desktop shell, with native progress and
  completion state shown directly in DSH's existing export dialog.
- The tray continues to follow DSH language and light/dark appearance. The bundled official DSH
  remains `0.1.0-rc.6` in this release.
- Stale plugin-command locks left by an interrupted process are safely recovered instead of blocking
  future plugin installs or updates.

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
