> 打包官方 DeepSeek Harness 预览版（`@deepseek-ai/dsh 0.1.0-rc.6`）。DSH-Portable 是独立社区分发项目。

## Windows x64（推荐）

[**下载轻量启动器**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)

下载器不到 1 MB。运行一次后，它会把完整环境下载到旁边的 `DSH-Portable`
文件夹并直接启动；以后可以离线使用，也可以连同会话和设置一起移动。

<details>
<summary><strong>Windows 其他版本</strong></summary>

- [离线自解压版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.exe) — 首次使用也不需要联网。
- [离线 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) — 与离线自解压版内容相同。
- [安装版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe) — 开始菜单入口和标准卸载程序。

</details>

<details>
<summary><strong>macOS 下载</strong></summary>

- Apple Silicon（M1–M4）：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)

macOS 包采用临时签名，没有经过 Apple 公证。首次启动可能需要按住 Control
点按应用，再选择 **打开**。

</details>

## 使用方法

1. 下载适合自己系统的一个文件。
2. 运行启动器、解压包或安装应用。
3. 按 DSH 界面提示配置模型。

轻量启动器会自动验证首次下载；普通用户不需要手动处理校验文件。离线完整包
包含官方、未修改的 DSH 运行时、固定版本 Node.js、原生模块和所需许可证。
本项目不包含 Codex 订阅、Zen Free 或其他模型插件。
