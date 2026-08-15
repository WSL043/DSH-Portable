> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.6`）。DSH-Portable 是独立社区分发项目。

本次更新统一了桌面启动与后台运行体验：启动过程保持一个紧凑的原生加载窗口，
工作台准备完成后再一次切换，不再出现大面积空白和重复加载。Windows 关闭窗口默认
收进系统托盘，任务继续运行；托盘菜单可以重新打开、完全退出或更改关闭行为。

便携目录继续完整保留会话、设置、插件和工作区。启动时检查更新，一般只下载变化的
DSH 应用组件；本次更新需要下载一次完整包，后续兼容更新继续只下载变化的 DSH 应用组件。

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
