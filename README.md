<p align="center">
  <img src="assets/DSH-Portable.svg" width="96" alt="DeepSeek Harness">
</p>

<h1 align="center">DSH-Portable</h1>

<p align="center">
  无需安装 Node.js，下载一个文件即可启动官方 DeepSeek Harness。<br>
  One-click, self-contained DeepSeek Harness packages for Windows and macOS.
</p>

<p align="center">
  <a href="https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe"><strong>下载 Windows x64 便携版（推荐）</strong></a>
  &nbsp;·&nbsp;
  <a href="#其他下载--other-downloads">其他下载</a>
</p>

<p align="center">
  <img src="assets/dsh-interface.png" width="960" alt="DSH-Portable running the official DeepSeek Harness interface">
</p>

## 三步启动 / Start in 3 steps

1. 下载 [**Windows x64 便携版**](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.exe)。普通 Windows 电脑选这个就可以。
2. 运行下载的文件并选择解压目录，然后双击文件夹里的 `DeepSeek-Herness.exe`。
3. 要移动整个文件夹或拔出 U 盘前，先运行 `Stop DeepSeek-Herness.exe`。

不需要 Node.js，也不会注册系统服务或开机启动项。首次打开后，按 DSH
界面提示配置模型即可。

> [!NOTE]
> DeepSeek Harness 目前仍是开发者预览版。DSH-Portable 只负责打包和便携运行，
> 不是 DeepSeek 官方桌面版，也不会修改官方 DSH 运行时。

## 你会得到什么

- 官方、未修改的 `@deepseek-ai/dsh` Web 界面和完整运行环境；
- Windows 原生启动器，以及可随文件夹一起移动的设置、会话和工作区；
- 仅绑定本机 `127.0.0.1` 的服务，便携外壳默认关闭遥测；
- 不预装 Codex、Zen Free 或其他第三方模型插件。

## 其他下载 / Other downloads

<details>
<summary><strong>Windows：安装版或普通 ZIP</strong></summary>

- [Windows 安装版](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-Setup.exe)：写入开始菜单，提供标准卸载入口；用户数据不会随卸载删除。
- [Windows 便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64.zip)：内容与推荐便携版相同，适合不能运行自解压文件的环境。

</details>

<details>
<summary><strong>macOS：Apple Silicon 或 Intel</strong></summary>

- Apple Silicon（M1/M2/M3/M4）：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-arm64.zip) · [安装 DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-arm64.dmg)
- Intel Mac：[便携 ZIP](https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-macos-x64.zip) · [安装 DMG](https://github.com/WSL043/DSH-Portable/releases/latest/download/DeepSeek-Herness-macos-x64.dmg)

不知道自己的型号？打开 Apple 菜单 → **关于本机**：看到 Apple M 系列就选
Apple Silicon，看到 Intel 就选 Intel。macOS 包采用临时签名而非 Apple 公证，
首次打开可能需要按住 Control 点按应用，再选择 **打开**。

</details>

## 便携数据与安全

便携版把 DSH 自己的数据保存在程序文件夹内：

- `data/dsh-home/`：设置、模型凭据和会话；
- `data/browser/`：独立浏览器资料；
- `workspace/`：默认工作区；
- `data/logs/`：本地日志。

移动整个文件夹后，DSH-Portable 会在下次启动时更新自己管理的路径；外部项目仍
保留原路径。

> [!IMPORTANT]
> `data` 可能包含 API 凭据和私人会话，请像保管带密码的 U 盘一样保管整个目录。
> Windows 移动盘优先使用 NTFS；FAT/exFAT 无法提供同等级的权限边界。

## 更新与来源

本仓库是独立分发项目，不是 GitHub Fork。每日任务会检查
[DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
和 npm 版本；发现更新后先创建审查事项，只有官方差异经过检查且 Windows、
Apple Silicon、Intel 三组真实包冒烟测试通过后才会更新固定版本。

<details>
<summary><strong>高级：完整性、固定版本与本地构建</strong></summary>

Release 只提供一份集中校验文件
[SHA256SUMS.txt](https://github.com/WSL043/DSH-Portable/releases/latest/download/SHA256SUMS.txt)，
不再为每个下载重复展示校验码。

当前包固定并验证：

- `@deepseek-ai/dsh@0.1.0-rc.6`；
- 官方 DSH 源码提交 `47f943859bef60e4160492346772ded9b24f765a`；
- Node.js `24.19.0`（Windows x64、macOS arm64、macOS x64）；
- 官方 DSH fish mark 派生的原生 `.ico` 和 `.icns`。

每个包内的 `licenses/` 都包含许可证、第三方声明和精确组件版本。

```powershell
./scripts/build-windows.ps1
./scripts/build-windows.ps1 -BuildInstaller
```

```bash
bash scripts/build-macos.sh arm64   # or x64
```

CI 会实际启动打包后的 DSH、检查本机页面、停止进程、移动完整文件夹并再次启动；
macOS DMG 还会完成挂载、安装、启动、停止和移除验证。

</details>

DeepSeek Harness 和 DeepSeek 的名称与标志归 DeepSeek 所有。DSH-Portable 由
WSL043 独立维护，未获 DeepSeek 背书。
