> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh {{DSH_VERSION}}`）。DSH-Portable 是独立社区分发项目。

{{RELEASE_INTRO_ZH}}

- **设置中新增实时插件市场。** 可搜索、分类、排序与分页浏览千余个社区插件；相同仓库只显示一次，每项都能打开自己的项目页面。
- **插件详情使用真实图片。** 市场优先显示作者策展截图，没有时从项目说明中提取；图片按需加载，不拖慢工作台启动。
- **语言和外观跟随 DSH。** 中文/英文、明暗主题与工作台保持一致。
- **插件操作留在当前便携环境。** 安装、更新、停用和卸载使用 Portable 内置运行环境与 `web` 配置；市场不能自行重启桌面端，运行中的任务不会被静默打断。
- **全新安装默认提供会话删除。** “已安装”中包含可停用、可卸载的永久删除扩展；每次删除都要二次确认，归档功能继续保留。普通升级不会重新安装用户已经移除的扩展。
- **任务完成通知可关闭。** Windows 托盘可开关系统通知；单个任务通知可直接返回对应会话，多个同时完成时只显示一条汇总。
- **退出后目录立即可移动。** Windows 会等自身的 WebView2 进程释放便携目录后才完成退出；若释放失败会给出明确错误，而不是留下后台占用。

内置官方 DSH 为 `{{DSH_VERSION}}`。{{VERIFICATION_SCOPE_ZH}}

桌面端会先打开本地工作区。自动检查更新默认关闭；Windows 与 macOS 都可以在设置或托盘中按需开启“启动时检查更新”，也可以随时手动检查或对单个版本选择“跳过此版本”。每次提示都会明确区分 DSH-Portable 产品版本与内置官方 DSH 版本；兼容边界不变时只下载变化的 DSH 应用组件，界面显示真实下载百分比。需要完整升级时会下载经过校验的完整版本并原地替换应用文件，会话、设置、凭据、插件与工作区继续保留。

{{CHANNEL_UPGRADE_NOTICE_ZH}}

默认 JSONL 会话可以直接升级。若你曾自行启用 DSH 的可选持久 SQLite 后端，rc.8 的数据库格式与旧版不兼容；请先备份并等待上游提供迁移方案，不要删除旧数据库。

## Windows x64（推荐）

[**下载便携版**](https://github.com/WSL043/DSH-Portable/releases/latest/download/{{WINDOWS_PRIMARY_FILENAME}})

{{WINDOWS_PRIMARY_GUIDE_ZH}}

<details>
<summary><strong>其他下载</strong></summary>

- [Windows 单文件离线版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.exe) — 选择位置后自动准备便携文件夹
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

> Packages the official DeepSeek Harness preview (`@deepseek-ai/dsh {{DSH_VERSION}}`). DSH-Portable is an independent community distribution.

{{RELEASE_INTRO_EN}}

- **DSH Settings now includes a live Plugin Market.** Search, categories, sorting, and pagination cover a thousand-plus community catalog. The same repository appears once and every entry links to its own project page.
- **Plugin details use real images.** The market prefers author-curated screenshots and can extract images from project documentation, loading them only when needed so workspace startup remains light.
- **Language and appearance follow DSH.** Chinese/English and light/dark presentation stay aligned with the workspace.
- **Plugin operations remain inside the current portable environment.** Install, update, disable, and uninstall use the bundled runtime and `web` profile. The market cannot restart the desktop shell, so an active task is never interrupted silently.
- **Fresh installs include session deletion.** The removable extension appears in **Installed**, keeps Archive available, and requires a second confirmation before permanent deletion. An ordinary upgrade never reinstalls an extension that an existing user removed.
- **Task-completion notifications are optional.** The Windows tray can turn them off; one completed task opens its session, while simultaneous completions produce one summary.
- **The portable folder is movable as soon as exit completes.** Windows waits for its owned WebView2 processes to release the directory and reports a clear failure instead of leaving a hidden lock.

The bundled official DSH is `{{DSH_VERSION}}`. {{VERIFICATION_SCOPE_EN}}

The desktop opens the local workspace first. Automatic update checks are off by default; on Windows and macOS, you can opt in from Settings or the tray, check manually at any time, or choose **Skip this version** for one release. Every notification names the DSH-Portable product version separately from the bundled official DSH version. When the compatibility boundary is unchanged, it downloads only the changed DSH application component and shows the real download percentage. When a complete upgrade is required, it downloads the verified complete package and replaces application files in place while sessions, settings, credentials, plugins, and workspace remain in place.

{{CHANNEL_UPGRADE_NOTICE_EN}}

Default JSONL sessions can be upgraded normally. If you explicitly enabled DSH's optional durable SQLite backend, rc.8 uses an incompatible database format. Back up the old database and wait for an upstream migration path instead of deleting it.

### Windows x64 (recommended)

[**Download the portable edition**](https://github.com/WSL043/DSH-Portable/releases/latest/download/{{WINDOWS_PRIMARY_FILENAME}})

{{WINDOWS_PRIMARY_GUIDE_EN}}

<details>
<summary><strong>Other downloads</strong></summary>

- [Single-file Windows offline package](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.exe) — choose a location and it prepares the portable folder
- [Complete Windows portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip)
- [Windows installer](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe)
- Apple Silicon: [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac: [portable ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)
- Linux x64: [AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) · [complete portable folder](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz)
- Linux ARM64: [AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) · [complete portable folder](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz)

</details>

Choose one download for your system. `checksums.txt` is optional and intended only for users who want independent download verification.
