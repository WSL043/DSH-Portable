> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.7`）。DSH-Portable 是独立社区分发项目。

0.2.4 同步官方 rc.7，并继续保持便携数据与桌面体验：

- 设置页现在可显示插件注册的设置卡；Job Panel 可呈现 Codex、Claude Code 等外部 Agent
  启动的子任务。
- MCP、ACP 与嵌套 PTC 工具返回的图片可保留在对话上下文中。
- 修复大段历史记录分页可能导致的栈溢出，以及达到最大 Token 后会话无法继续的问题。
- 改善最小模式下持续 Bash 调用的延迟；问题卡片可折叠，并保留尚未提交的答案草稿。
- DeepSeek 模型增加 `low` 推理强度选项；原 Code 模式统一更名为 PTC 模式。
- Portable 已适配官方新版终端运行时；Windows、macOS、Linux x64 与 ARM64 继续使用同一套
  完整发布门。
- “启动时检查更新”仍可在应用菜单中关闭；关闭后不会自动提醒，仍可随时手动检查。

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

> Packages the official DeepSeek Harness preview (`@deepseek-ai/dsh 0.1.0-rc.7`).
> DSH-Portable is an independent community distribution.

0.2.4 updates the bundled official runtime to rc.7 while preserving portable data and desktop behavior:

- Settings can now show plugin-registered cards, and the Job Panel can surface subagent tasks launched
  by external tools such as Codex and Claude Code.
- Images returned through MCP, ACP, and nested PTC tools remain available in conversation context.
- Large-history pagination no longer risks a stack overflow, and sessions remain usable after
  max-token truncation.
- Persistent Bash work in minimal mode has lower latency. Question cards can collapse without losing
  unsubmitted answer drafts.
- DeepSeek models gain a `low` reasoning-effort option, and Code mode is now named PTC mode.
- The Portable packages support the updated terminal runtime across Windows, macOS, Linux x64, and
  Linux ARM64 through the same release gate.
- **Check for updates at startup** remains optional. Turn it off to suppress automatic prompts while
  keeping manual update checks available.

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
