<p align="center">
  <img src="assets/DSH-Portable.svg" width="82" alt="DeepSeek Harness">
</p>

<h1 align="center">DSH-Portable</h1>

<p align="center">
  <strong>把整个 DeepSeek Harness 工作环境带走。</strong><br>
  会话、设置、插件和工作区放在一起，复制一个文件夹就能继续工作。
</p>

<p align="center">
  <a href="https://wsl043.github.io/DSH-Portable/"><strong>官网</strong></a>
  · <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><strong>下载</strong></a>
  · <a href="#三步启动">开始使用</a>
  · <a href="docs/move-between-computers.md">迁移</a>
  · <a href="#插件">插件</a>
  · <a href="#获取帮助">帮助</a>
  · <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest"><img src="https://img.shields.io/github/v/release/WSL043/DSH-Portable?display_name=tag&label=%E7%89%88%E6%9C%AC&style=flat-square&color=171717" alt="最新版本"></a>
  <a href="https://github.com/WSL043/DSH-Portable/releases"><img src="https://img.shields.io/github/downloads/WSL043/DSH-Portable/total?style=flat-square&label=%E4%B8%8B%E8%BD%BD&color=171717" alt="GitHub 下载量"></a>
  <a href="https://github.com/WSL043/DSH-Portable/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/WSL043/DSH-Portable/ci.yml?branch=main&style=flat-square&label=%E6%9E%84%E5%BB%BA&color=171717" alt="跨平台构建状态"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/WSL043/DSH-Portable?style=flat-square&label=%E8%AE%B8%E5%8F%AF&color=171717" alt="Apache-2.0 许可证"></a>
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe"><strong>下载 Windows 便携版（推荐）</strong></a>
</p>

<p align="center">
  <img src="assets/dsh-interface-zh.png" width="1040" alt="DSH-Portable 中文桌面工作台">
</p>

> [!NOTE]
> DSH-Portable 是独立社区发行版，不是 DeepSeek 官方桌面应用。它内置经过适配和成品测试的官方 DeepSeek Harness 预览版本。

## 为什么是 Portable

| 一个文件夹 | 换位置继续 | 更新不动数据 |
| --- | --- | --- |
| 会话、设置、插件、桌面数据和默认工作区放在一起。 | 退出后复制到另一块硬盘、U 盘或电脑，重新打开即可。 | 更新替换可再生的程序组件，保留你的会话、凭据、插件和工作区。 |

它不是把网页快捷方式改名为“免安装版”。运行环境和插件工具都在自己的目录内，不要求目标电脑预装 Node.js 或 pnpm，也不修改系统 `PATH`；独立窗口、系统托盘、最近会话、任务完成通知、窗口位置恢复和更新流程仍然完整保留。

| 从哪里开始 | Portable 为你处理什么 |
| --- | --- |
| **联网使用** | 下载约 60 KB 的启动器，把它放到希望保存的位置后运行；它会在旁边自动准备并校验完整工作目录。 |
| **离线使用** | 完整 ZIP 自带官方 DSH、运行环境、插件市场和插件管理工具。 |
| **换电脑或 U 盘** | 复制文件夹即可；启动时修正由 Portable 管理的旧路径。 |
| **只迁移个人数据** | 导出同一份迁移内容，可选择普通包或密码加密的私密包。 |
| **长期更新** | DSH-Portable 与官方 DSH 内核分开更新，均保留 `data` 和 `workspace`。 |
| **出现异常** | 内置只读检查、保留数据的精准修复和脱敏支持报告。 |

0.5 系列的 Windows 离线包约 **58 MB**，外层只需解压约 **44 个文件**。官方 DSH 运行环境以一个经过校验的紧凑包随产品携带，首次启动在本机准备一次，之后直接复用；会话、设置、插件和工作区仍留在 Portable 文件夹中。这样既保留完整插件能力，也把下载解压、复制 Portable 文件夹和日常更新需要处理的小文件降到最低。发布门会同时限制压缩包体积、落地体积、文件数量和启动性能，防止后续版本悄悄反弹。

## 三步启动

1. 下载 [**Windows 便携启动器**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)。
2. 把启动器放到希望保存的位置并双击运行，它会在旁边准备一个完整的 `DSH-Portable` 文件夹。
3. 在界面中连接模型。以后直接运行文件夹里的 `DeepSeek-Herness.exe`。

右上角关闭按钮默认把应用收进系统托盘，运行中的任务会继续。需要完全退出时，右键托盘图标并选择 **退出 DeepSeek Harness**。

## 下载

### Windows

| 适合你，如果… | 下载 |
| --- | --- |
| 想要可移动、自动准备的工作文件夹 | [**便携启动器**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)（推荐，约 60 KB） |
| 目标电脑无法联网，或需要手动解压 | [完整离线 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) |

### macOS

| 电脑 | 便携 ZIP |
| --- | --- |
| Apple Silicon（M1–M4） | [下载](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) |
| Intel Mac | [下载](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) |

macOS 包采用临时签名，尚未经过 Apple 公证。首次打开若被阻止，请按住 Control 点按应用，再选择 **打开**。

### Linux

| 电脑 | AppImage（推荐） | 完整便携目录 |
| --- | --- | --- |
| Intel / AMD（x64） | [下载](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-x64.AppImage) | [下载](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-x64.tar.gz) |
| ARM64 | [下载](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-linux-arm64.AppImage) | [下载](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-linux-arm64.tar.gz) |

```bash
chmod +x DeepSeek-Herness-linux-x64.AppImage
./DeepSeek-Herness-linux-x64.AppImage
```

AppImage 的会话、设置、插件和工作区保存在旁边的 `DSH-Portable-data` 文件夹；移动或备份时把两者一起复制。

## 移动与备份

完整步骤、数据包迁移和无需第二台电脑的验证方法见[跨电脑迁移指南](docs/move-between-computers.md)。

1. 从托盘选择 **退出 DeepSeek Harness**，等窗口和托盘图标消失。
2. 复制整个 `DSH-Portable` 文件夹。
3. 在新位置运行 `DeepSeek-Herness.exe`（Windows）或对应平台入口。

启动器会修正它管理的旧路径；你主动打开的外部项目仍保留原位置。两台电脑同步同一目录前，请先在两边完全退出，避免同时写入会话文件。

## 插件

打开 **设置 → 插件 → 插件市场**，可以搜索、筛选、查看项目主页，并安装、更新、停用或卸载社区插件。市场跟随 DSH 的中文/英文和明暗外观，不会为了安装插件静默中断正在运行的任务。

全新安装离线包含可停用或卸载的 [DSH Chat Manager](https://github.com/WSL043/dsh-chat-manager) 和 [DSH Image Viewer](https://github.com/WSL043/dsh-image-viewer)。前者提供归档管理和二次确认的永久删除会话，后者提供原生图片查看；两者之后都按普通插件更新。普通升级不会重新安装用户已经移除的默认插件。

Windows 可双击 `dsh.exe`，或从托盘的 **更多 → DSH 终端** 打开；macOS 可从应用菜单打开 **DSH 终端**；Linux 可从托盘打开 **DSH 终端**。在这个专用终端里，第三方插件提供的官方命令可以原样粘贴：

```powershell
dsh plugin --profile web add <插件>
dsh plugin --profile web list --depth 0
dsh plugin --profile web update <插件包名>
dsh plugin --profile web remove <插件包名>
dsh --profile web --dump-config
```

便携版的 DSH 终端只在当前窗口临时识别 `dsh`，不会修改系统 `PATH`。移动整个 Portable 文件夹后，新开的 DSH 终端会自动使用新位置，不需要修复环境变量。

能安全热加载的插件会立即生效，纯界面插件只需刷新；已经载入宿主代码的插件更新会标记为待重启。市场不会在任务运行时更新、卸载或偷偷重启 DSH。只安装你信任的插件。

## 更新与修复

- DSH-Portable 会先打开本地工作台，再在后台检查更新。产品更新与官方 DeepSeek Harness 内核更新各自独立，“启动时检查更新”均默认关闭；可在**设置 → 通用设置 → 便携版**分别开启或手动检查。
- 托盘菜单也提供两种手动检查；检查完成、等待选择和实际更新是不同状态，不会一直停在“正在检查”。
- 更新提示会明确写出正在更新 DSH-Portable 还是 DeepSeek Harness，并显示对应的当前版本和目标版本。
- 一般更新只下载变化的 DSH 应用组件，并显示真实下载百分比；会话、设置、凭据和工作区全部保留。
- 运行环境兼容性变化时，会直接下载经过验证的完整版本并原地更新，仍然保留用户数据。
- 可以选择稍后或**跳过此版本**；安装前确认没有任务运行，失败时恢复更新前版本。
- **设置 → 通用设置 → 便携版** 提供检查、修复和支持报告。修复保留用户数据，只重建可再生组件。

官方 DSH 更新不必等待 DSH-Portable 功能版本，但也不会直接替换正在使用的工作环境。新版会先经过 Windows、macOS、Linux x64/ARM64 的完整成品测试；全部通过后才进入独立内核通道，失败则不发布。

## 便携数据

正常更新会原地保留 `data` 和 `workspace`。需要迁入新的 Portable 环境时，可在**设置 → 通用设置 → 便携版 → 数据与迁移**选择「导出迁移包」或「导出加密私密包」。两者内容相同，都包含会话、设置、插件配置和 API 凭据；只有后者需要密码才能读取。未加密包只应保存在信任的设备上。运行时、缓存、日志和工作区文件不会被塞进迁移包。

成品根目录的 `DATA-MIGRATION.zh-CN.txt` 提供中文检查和恢复命令；`DATA-MIGRATION.en.txt` 提供独立英文说明。恢复默认只补入缺失数据；明确选择覆盖时，先在 `data/backups/` 生成回滚副本。

| 路径 | 内容 |
| --- | --- |
| `data/dsh-home/` | 设置、模型凭据、会话和插件 |
| `data/webview2/` | Windows 桌面窗口数据 |
| `workspace/` | 默认工作区 |
| `data/logs/` | 本地服务与启动日志 |


## 安全

DSH 具备本地代码执行能力，请只使用可信模型、插件和项目。本地服务只绑定 `127.0.0.1`，便携外壳默认关闭 DSH 遥测。`data` 可能包含 API 凭据和私人会话；请妥善保管，Windows 移动盘优先使用 NTFS。

查看完整的[隐私说明](PRIVACY.md)、[安全策略](SECURITY.md)和[代码签名策略](CODE_SIGNING.md)。当前 Windows Release 尚未签名；SignPath Foundation 的开源签名申请正在进行中。

## 获取帮助

- [提交 Bug 报告](https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml)
- [提出功能建议](https://github.com/WSL043/DSH-Portable/issues/new?template=feature-request.yml)
- [参与讨论](https://github.com/WSL043/DSH-Portable/discussions)

请勿在 Issue 中粘贴 API Key、登录凭据或私人会话。

## 开源与贡献

DSH-Portable 使用标准 [Apache-2.0 许可证](LICENSE)。你可以使用、修改和再分发，但需要保留许可证、版权与变更声明。源码和每个平台的成品还会携带 [NOTICE.md](NOTICE.md)，明确标出本项目的规范来源与第三方组件边界。

修复和改进欢迎直接提交 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，避免重复实现官方 DSH 已有的能力。

<details>
<summary><strong>从源码构建</strong></summary>

```powershell
./scripts/build-windows.ps1
```

```bash
bash scripts/build-macos.sh arm64   # 或 x64
bash scripts/build-linux.sh x64     # 或 arm64
```

依赖、发布内容和成品测试均由仓库固定。普通用户无需手动比较校验值；需要时可从 Release 下载 `checksums.txt`。新构建还会生成绑定源码提交和验收工作流的 GitHub/Sigstore 证明，高级用户可运行 `gh attestation verify <下载文件> -R WSL043/DSH-Portable` 验证来源。

</details>

如果 DSH-Portable 对你有帮助，欢迎点一个 [**Star**](https://github.com/WSL043/DSH-Portable/stargazers)。它会帮助更多需要便携 DSH 的用户找到这个项目。

DeepSeek Harness、DeepSeek 名称与标志归 DeepSeek 所有。DSH-Portable 由 WSL043 独立维护，未获 DeepSeek 背书。
