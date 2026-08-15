<p align="center">
  <img src="assets/DSH-Portable.svg" width="96" alt="DeepSeek Harness">
</p>

<h1 align="center">DSH-Portable</h1>

<p align="center">
  不用配置 Node.js，也能运行官方 DeepSeek Harness。<br>
  首次下载更小，运行数据留在本地，完成后的文件夹可以随处移动。
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
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe"><strong>下载 Windows x64 版</strong></a>
  &nbsp;·&nbsp;
  <a href="#其他下载">其他下载</a>
</p>

<p align="center">
  <img src="assets/dsh-interface.png" width="960" alt="DSH-Portable 中运行的官方 DeepSeek Harness 界面">
</p>

> [!NOTE]
> DeepSeek Harness 目前仍是开发者预览版。DSH-Portable 是独立社区分发项目，
> 不是 DeepSeek 官方桌面应用。

## 三步启动

1. 下载体积很小的 [**Windows 启动器**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)。
2. 运行一次。启动器会把固定版本的完整运行环境下载到旁边的
   `DSH-Portable` 文件夹，自动检查下载是否完整，然后打开 DSH。
3. 按 DSH 界面提示配置模型。以后直接使用完成后的文件夹，不会重复下载运行环境。

不需要安装 Node.js，不会注册系统服务，也不会创建开机启动项。要移动到其他目录
或 U 盘时，先停止 DSH，再复制整个 `DSH-Portable` 文件夹。

## 这个版本有什么不同

| | DSH-Portable 的实现 |
| --- | --- |
| **首次下载更小** | 推荐的 Windows 文件只是轻量启动器，完整运行环境只在首次使用时下载一次。 |
| **真正可移动** | 会话、设置、浏览器数据、工作区、运行环境和启动器都在同一个文件夹内。 |
| **保留离线方案** | 目标电脑无法在首次启动时联网，可以改用包含全部内容的离线完整包。 |
| **固定版本并真实测试** | 每次发布都会固定 DSH 与 Node 版本，并在 CI 中实际启动、停止、移动、重启、安装和卸载成品。 |
| **不修改 DSH** | 运行时来自官方 `@deepseek-ai/dsh`；不会预装第三方模型渠道或插件。 |

## 其他下载

<details>
<summary><strong>Windows：离线完整包、ZIP 或安装版</strong></summary>

- [离线自解压版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.exe) — 已包含 Node.js 和 DSH，首次使用也不用下载。
- [离线 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip) — 与离线自解压版内容相同，使用普通压缩包。
- [Windows 安装版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe) — 写入开始菜单并提供标准卸载程序；用户数据单独保留。

</details>

<details>
<summary><strong>macOS：Apple Silicon 或 Intel</strong></summary>

- Apple Silicon（M1–M4）：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)

macOS 包采用临时签名，没有经过 Apple 公证。首次打开若被阻止，请按住 Control
点按应用，再选择 **打开**。

</details>

## 便携数据

便携文件夹会把数据保存在这些固定位置：

- `data/dsh-home/`：DSH 设置、模型凭据和会话；
- `data/browser/`：独立浏览器资料；
- `workspace/`：默认工作区；
- `data/logs/`：本地服务日志。

移动整个文件夹后，启动器会在下次启动时迁移自己管理的路径；外部项目仍保留原路径。

## 插件管理

Windows 成品自带 DSH 所需的 Node.js 与固定版本 pnpm，不需要安装系统 Node.js、
pnpm，也不会修改系统 PATH。在 DSH-Portable 文件夹中打开 PowerShell，使用通用
`dsh.exe` 入口管理任意 DSH 插件：

```powershell
.\dsh.exe plugin --profile web add <插件>
.\dsh.exe plugin --profile web list --depth 0
.\dsh.exe plugin --profile web update <插件包名>
.\dsh.exe plugin --profile web remove <插件包名>
.\dsh.exe --profile web --dump-config
```

`<插件>` 可以是 pnpm 支持的包名、Git 地址、本地目录或压缩包。安装版使用相同
命令，插件和配置写入独立的用户数据目录；卸载或更新应用不会删除它们。插件变更
不会自动重启正在运行的 DSH，请先保存任务，再手动停止并重新启动。只安装你信任
的插件，因为插件可以在本机执行代码。

## 更新

DSH-Portable 会在启动时检查更新，并先询问是否安装。一般更新只下载已经变化的
DSH 应用组件，不会重复下载 Node.js、启动器或整套离线包；会话、设置、凭据和工作区
都会原地保留。下载完成后会先验证文件，再替换应用；若新版不能正常启动，
会自动恢复到更新前的版本。

只有 Node.js 或便携外壳等兼容性变化时，才会提示下载完整安装包。可以选择
“稍后”，启动器不会静默切换版本。DSH-Portable 不是 GitHub Fork；发布任务会
跟踪 [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
和 npm 包，并只向用户提供通过对应系统成品测试的版本。

## 安全

DSH 是具备本地代码执行能力的 Agent 运行环境，请只使用可信模型、插件和项目。
服务只绑定 `127.0.0.1`，便携外壳默认关闭 DSH 遥测。

`data` 目录可能包含 API 凭据和私人会话，请像保管带密码的移动硬盘一样保管整个
文件夹。Windows 移动盘优先使用 NTFS；FAT 和 exFAT 无法提供同等级权限保护。

<details>
<summary><strong>从源码构建</strong></summary>

```powershell
./scripts/build-windows.ps1
./scripts/build-windows.ps1 -BuildInstaller
```

```bash
bash scripts/build-macos.sh arm64   # 或 x64
```

依赖锁定、组件声明、成品测试和发布清单都保存在本仓库。下载完整性由启动器自动
处理，普通用户不需要手动复制或比对一长串校验值。

</details>

DeepSeek Harness、DeepSeek 名称与标志归 DeepSeek 所有。DSH-Portable 由 WSL043
独立维护，未获 DeepSeek 背书。
