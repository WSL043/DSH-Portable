<p align="center">
  <img src="assets/DSH-Portable.svg" width="96" alt="DeepSeek Harness">
</p>

<h1 align="center">DSH-Portable</h1>

<p align="center">
  把 DeepSeek Harness、会话、设置、插件和工作区带在身边。<br>
  复制整个文件夹，就能放进 U 盘、移动硬盘或另一台电脑继续使用。
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><img src="https://img.shields.io/github/v/release/WSL043/DSH-Portable?display_name=release&style=flat-square&color=171717" alt="最新版本"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-171717?style=flat-square" alt="Windows 和 macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2F855A?style=flat-square" alt="MIT 许可证"></a>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe"><strong>下载 Windows 便携版（推荐）</strong></a>
  &nbsp;·&nbsp;
  <a href="#其他下载">选择其他系统或安装方式</a>
</p>

<p align="center">
  <img src="assets/dsh-interface-zh.png" width="960" alt="DSH-Portable 中运行的中文 DeepSeek Harness 工作台">
</p>

> [!NOTE]
> DeepSeek Harness 目前仍是开发者预览版。DSH-Portable 是独立社区分发项目，
> 不是 DeepSeek 官方桌面应用。

## 三步启动

1. 下载 [**Windows 便携版**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)。
2. 双击运行。它会在旁边准备一个完整的 `DSH-Portable` 文件夹并打开桌面窗口。
3. 按界面提示连接模型。以后直接双击文件夹里的 `DeepSeek-Herness.exe`。

默认点击右上角关闭按钮会收进系统托盘，正在执行的任务继续运行。要完全退出，
右键托盘图标选择 **退出 DeepSeek Harness**；也可以在托盘菜单的 **关闭窗口时**
改成直接退出。

Windows 启动器和安装界面会跟随系统显示中文或英文；DSH 工作台也可以在
**设置**中切换语言，选择会自动保存。

## 为什么适合便携使用

- **一个文件夹就是完整工作环境**：会话、设置、插件、默认工作区和桌面数据一起移动。
- **换位置继续工作**：复制到另一块硬盘、U 盘或另一台 Windows 电脑，打开后继续使用。
- **备份简单**：退出应用后复制整个文件夹，不用分别寻找配置和插件目录。
- **原生桌面体验**：使用独立应用窗口、任务栏身份和系统托盘，不会把浏览器窗口当成应用。
- **更新不打散数据**：经过测试的更新会保留本地会话、凭据、插件和工作区。
- **在线与离线都能准备**：日常使用轻量便携启动器；受限网络可直接下载完整 ZIP。

## 迁移、备份与同步

1. 从系统托盘选择 **退出 DeepSeek Harness**，等窗口和托盘图标都消失。
2. 复制整个 `DSH-Portable` 文件夹。
3. 在新位置双击 `DeepSeek-Herness.exe`。

启动器会自动修正它管理的旧路径；你主动打开的外部项目仍保留原位置。需要在两台
电脑之间同步时，也同步整个文件夹，并确保两边都已退出，避免同时改写会话文件。

## 其他下载

### Windows

| 你想怎么用 | 下载 |
| --- | --- |
| **便携使用（推荐）** | [便携启动器](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe) — 首次运行后得到可移动文件夹 |
| **目标电脑首次准备时无法联网** | [便携完整 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) — 解压后直接使用 |
| **像普通软件一样安装** | [Windows 安装版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe) — 开始菜单、桌面快捷方式和标准卸载 |

### macOS

| 电脑 | 便携 ZIP | 安装镜像 |
| --- | --- | --- |
| Apple Silicon（M1–M4） | [下载 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) | [下载 DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg) |
| Intel Mac | [下载 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) | [下载 DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg) |

macOS 包采用临时签名，没有经过 Apple 公证。首次打开若被阻止，请按住 Control
点按应用，再选择 **打开**。

## 插件管理

Windows 成品已经准备好插件命令。在 DSH-Portable 文件夹中打开 PowerShell：

```powershell
.\dsh.exe plugin --profile web add <插件>
.\dsh.exe plugin --profile web list --depth 0
.\dsh.exe plugin --profile web update <插件包名>
.\dsh.exe plugin --profile web remove <插件包名>
.\dsh.exe --profile web --dump-config
```

`<插件>` 可以是包名、Git 地址、本地目录或压缩包。插件和设置都保存在便携数据中，
会随整个文件夹迁移。插件变更不会自动打断正在运行的任务；保存工作并手动退出、
重新打开后生效。只安装你信任的插件。

想使用 ChatGPT / Codex 订阅模型，可按独立插件仓库说明安装：
[**WSL043/dsh-codex-subscription**](https://github.com/WSL043/dsh-codex-subscription)。
它不是 DSH-Portable 的内置组件，可以按需安装或移除。

## 更新

DSH-Portable 会在启动时检查更新，并先询问是否安装。一般更新只下载变化的 DSH
应用组件；会话、设置、凭据和工作区都会保留。下载完成后会先验证再替换，若新版
不能正常启动，会自动恢复到更新前版本。

只有运行环境或启动器出现兼容性变化时，才会提示下载完整安装包。官方预览版更新
会先生成候选版本，经过 Windows 与 macOS 成品测试后才进入启动器更新通道，不会把
未经验证的官方提交直接装到你的工作环境。

## 便携数据

- `data/dsh-home/`：设置、模型凭据、会话和插件；
- `data/webview2/`：Windows 桌面窗口数据；
- `workspace/`：默认工作区；
- `data/logs/`：本地服务日志。

安装版把相同数据放在 `%LOCALAPPDATA%\DeepSeek-Herness`，卸载应用时不会自动删除。

## 安全

DSH 是具备本地代码执行能力的 Agent 运行环境，请只使用可信模型、插件和项目。
服务只绑定 `127.0.0.1`，便携外壳默认关闭 DSH 遥测。

`data` 目录可能包含 API 凭据和私人会话，请妥善保管。Windows 移动盘优先使用
NTFS；FAT 和 exFAT 无法提供同等级权限保护。

<details>
<summary><strong>从源码构建</strong></summary>

```powershell
./scripts/build-windows.ps1
```

```bash
bash scripts/build-macos.sh arm64   # 或 x64
```

依赖版本、发布内容和成品测试都由仓库固定。下载完整性由启动器处理，普通用户无需
手动比对校验值。

</details>

DeepSeek Harness、DeepSeek 名称与标志归 DeepSeek 所有。DSH-Portable 由 WSL043
独立维护，未获 DeepSeek 背书。
