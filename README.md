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
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-171717?style=flat-square" alt="Windows、macOS 和 Linux">
  <a href="https://github.com/WSL043/DSH-Portable"><img src="https://img.shields.io/github/stars/WSL043/DSH-Portable?style=flat-square&label=Star&color=171717" alt="在 GitHub 上 Star DSH-Portable"></a>
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
改成直接退出。托盘菜单会跟随 DSH 的语言和明暗外观，并可直接打开最近会话或
新建会话。

Windows 启动器和安装界面会跟随系统显示中文或英文；DSH 工作台也可以在
**设置**中切换语言，选择会自动保存。

## 为什么适合便携使用

- **一个文件夹就是完整工作环境**：会话、设置、插件、默认工作区和桌面数据一起移动。
- **换位置继续工作**：复制到另一块硬盘、U 盘或另一台 Windows 电脑，打开后继续使用。
- **备份简单**：退出应用后复制整个文件夹，不用分别寻找配置和插件目录。
- **原生桌面体验**：独立应用窗口、任务栏身份和系统托盘，并记住上次窗口大小与位置。
- **更新不打散数据**：经过测试的更新会保留本地会话、凭据、插件和工作区。
- **在线与离线都能准备**：日常使用轻量便携启动器；受限网络可直接下载完整 ZIP。

## 迁移、备份与同步

1. 从系统托盘选择 **退出 DeepSeek Harness**，等窗口和托盘图标都消失。
2. 复制整个 `DSH-Portable` 文件夹。
3. 在新位置双击 `DeepSeek-Herness.exe`。

启动器会自动修正它管理的旧路径；你主动打开的外部项目仍保留原位置。需要在两台
电脑之间同步时，也同步整个文件夹，并确保两边都已退出，避免同时改写会话文件。

## 其他下载

> [!TIP]
> **国内网络加速**：GitHub 直连下载在国内可能较慢，可直接下载下方社区镜像的
> **Windows 离线版完整 ZIP**（解压后直接使用，免安装）。镜像是社区维护的加速
> 服务，非官方部署；失效时请换用备用路线或 GitHub 原链接，并核对
> [checksums.txt](https://github.com/WSL043/DSH-Portable/releases/latest/download/checksums.txt)。

### 国内镜像下载

| 路线 | 镜像 | 链接 |
| --- | --- | --- |
| 主选 | gh-proxy.com | [下载](https://gh-proxy.com/https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |
| 备用 1 | ghfast.top | [下载](https://ghfast.top/https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |
| 备用 2 | gh.ddlc.top | [下载](https://gh.ddlc.top/https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |

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

### Linux

| 电脑 | 一键启动（推荐） | 完整便携目录 |
| --- | --- | --- |
| 常见 Intel / AMD 电脑（x64） | [下载 AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) | [下载 tar.gz](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz) |
| ARM64 电脑 | [下载 AppImage](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) | [下载 tar.gz](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz) |

给 AppImage 添加一次执行权限后即可启动：

```bash
chmod +x DeepSeek-Herness-linux-x64.AppImage
./DeepSeek-Herness-linux-x64.AppImage
```

AppImage 会把会话、设置、插件和工作区保存在同目录的 `DSH-Portable-data` 文件夹；
迁移或备份时把 AppImage 与这个文件夹一起复制。tar.gz 是完整的 `DSH-Portable`
目录，解压后运行其中的 `DeepSeek-Herness`，整个目录可直接移动。

## 插件管理

Windows 和 Linux 成品都已准备好插件命令。Windows 在 DSH-Portable 文件夹中打开 PowerShell：

```powershell
.\dsh.exe plugin --profile web add <插件>
.\dsh.exe plugin --profile web list --depth 0
.\dsh.exe plugin --profile web update <插件包名>
.\dsh.exe plugin --profile web remove <插件包名>
.\dsh.exe --profile web --dump-config
```

Linux 完整便携目录使用 `./dsh`；AppImage 使用 `./DeepSeek-Herness-linux-<架构>.AppImage dsh`：

```bash
./dsh plugin --profile web add <插件>
./dsh plugin --profile web list --depth 0
./dsh plugin --profile web update <插件包名>
./dsh plugin --profile web remove <插件包名>
./dsh --profile web --dump-config
```

`<插件>` 可以是包名、Git 地址、本地目录或压缩包。插件和设置都保存在便携数据中，
会随整个文件夹迁移。插件变更不会自动打断正在运行的任务；保存工作并手动退出、
重新打开后生效。只安装你信任的插件。

想使用 ChatGPT / Codex 订阅模型，可按独立插件仓库说明安装：
[**WSL043/dsh-codex-subscription**](https://github.com/WSL043/dsh-codex-subscription)。
它不是 DSH-Portable 的内置组件，可以按需安装或移除。

## 更新

不带后缀的版本（例如 `0.2.0`）是稳定正式版；带 `-rc.N` 的版本只用于发布前测试，
会在 GitHub 上明确标为 **Pre-release**，不会作为稳定版推送给普通用户。

每次提示的是 DSH-Portable 的产品版本；更新窗口会单独列出内置官方 DSH 的当前版本、
目标版本和这次是否变化。官方 DSH 发布新版后，会先经过适配和成品测试，再随
DSH-Portable 版本交付，不会绕过外壳直接替换你的工作环境。

DSH-Portable 会在启动时检查更新，并先询问是否安装。一般更新只下载变化的 DSH
应用组件；会话、设置、凭据和工作区都会保留。下载时显示真实下载百分比和已下载大小，
随后依次显示验证、安装与重新打开阶段。若新版不能正常启动，会自动恢复到更新前版本。

Windows 和 Linux 可以从系统托盘手动 **检查更新**，macOS 可以从应用菜单检查。不想接收主动提醒时，
可以在同一菜单里关闭 **启动时检查更新**；手动检查入口仍会保留。发现更新时可以选择
**现在更新**、**稍后** 或 **跳过此版本**。跳过只对当前版本生效，后续新版仍会正常提示；
有任务运行时不会为了更新中断任务。

只有运行环境或启动器出现兼容性变化时才需要完整升级。Windows 会直接下载已验证的完整版本、
保留 `data` 与 `workspace` 并原地完成替换，不再把普通用户带到下载页。官方预览版更新
会先生成候选版本，经过 Windows、macOS 与 Linux x64/ARM64 成品测试后才进入启动器更新通道，不会把
未经验证的官方提交直接装到你的工作环境。

## 便携数据

- `data/dsh-home/`：设置、模型凭据、会话和插件；
- `data/webview2/`：Windows 桌面窗口数据；
- `workspace/`：默认工作区；
- `data/logs/`：本地服务日志。

安装版把相同数据放在 `%LOCALAPPDATA%\DeepSeek-Herness`，卸载应用时不会自动删除。

## 获取帮助

遇到问题可直接[**提交 Bug 报告**](https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml)，
有改进想法可[**提交功能建议**](https://github.com/WSL043/DSH-Portable/issues/new?template=feature-request.yml)。
请勿在 Issue 中粘贴 API Key、登录凭据或私人会话。

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
bash scripts/build-linux.sh x64     # 或 arm64
```

依赖版本、发布内容和成品测试都由仓库固定。下载完整性由启动器处理，普通用户无需
手动比对校验值。

</details>

如果 DSH-Portable 对你有帮助，欢迎在 GitHub 上给它点一个
[**Star**](https://github.com/WSL043/DSH-Portable)。这会帮助更多需要便携 DSH 的用户找到它。

DeepSeek Harness、DeepSeek 名称与标志归 DeepSeek 所有。DSH-Portable 由 WSL043
独立维护，未获 DeepSeek 背书。
