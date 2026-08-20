> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.8`）。DSH-Portable 是独立社区分发项目。

0.4.0-rc.1 是插件市场预发布版，不会推送给稳定版用户：

- **设置中新增实时插件市场。** 可搜索、分类、排序与分页浏览社区插件，不再由 Portable 手工维护插件卡片。
- **插件详情使用真实图片。** 市场优先显示作者策展截图，没有时从项目说明中提取；打开详情时才加载图片。
- **语言和外观跟随 DSH。** 中文/英文、明暗主题与工作台保持一致。
- **插件操作留在当前便携环境。** 安装、更新、停用和卸载使用 Portable 内置运行环境与 `web` 配置；市场不能自行重启桌面端，运行中的任务不会被静默打断。
- **不预装业务插件。** 用户只从实时目录中选择自己需要的第三方插件。
- **保留 0.3.0 的首次启动修复。** 慢速电脑在工作台 DOM 已可用时即可显示，不会因页面资源迟迟未结束而误报 60 秒启动失败。

内置官方 DSH 仍为 `0.1.0-rc.8`（提交 `141eb6f`），本次没有用未发布的上游源码替换已验证运行时；候选成品会经过 Windows、macOS、Linux x64 与 ARM64 验收。

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

0.4.0-rc.1 is the Plugin Market preview and is not offered to stable users:

- **DSH Settings now includes a live Plugin Market.** Search, categories, sorting, and pagination come from the community catalog instead of hand-maintained Portable cards.
- **Plugin details use real images.** The market prefers author-curated screenshots and can extract images from project documentation, loading them only when details are opened.
- **Language and appearance follow DSH.** Chinese/English and light/dark presentation stay aligned with the workspace.
- **Plugin operations remain inside the current portable environment.** Install, update, disable, and uninstall use the bundled runtime and `web` profile. The market cannot restart the desktop shell, so an active task is never interrupted silently.
- **No task-specific plugin is preinstalled.** Users choose their own third-party plugins from the live catalog.
- **The 0.3.0 first-start repair remains included.** Slow PCs show the workspace when its DOM is ready instead of reporting a false 60-second timeout while resources are still finishing.

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
