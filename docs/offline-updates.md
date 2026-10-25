# 离线更新

[English download steps](#download-files-english)

从 0.9.5 起，Windows Native 在既有更新流程上提供本地文件入口，适用于 0.x Portable 和内核。1.x 官方 Electron 纯便携线不使用这套 Native 桥，其发布仍等待官方成品修复内置 MCP 依赖；本次更新不修改官方 ASAR，也不解除该阻断。详见 [1.x MCP 复核与处理边界](one-x-mcp-followup-2026-10-23.md)。

## 准备

在联网电脑上准备原始清单、原始签名和对应 ZIP，复制到同一个目录：

| 更新内容 | 清单与附件 |
| --- | --- |
| 完整 Windows Portable（可跨运行时边界） | `portable-manifest.json`、`portable-manifest.json.sig`、清单 `payloads.windowsX64.filename` 指定的 ZIP |
| Portable 组件 | 对应平台的 `portable-update-*.json`、同名 `.sig`、清单 URL 中的 ZIP 文件名 |
| 内核 | 对应平台的 `dsh-core-update-*.json`、同名 `.sig`、清单 URL 中的 ZIP 文件名 |

## 文件从哪里下载

先在联网电脑上打开对应的 Release，展开 **Assets**：

- [Portable 更新附件（update-channel-stable）](https://github.com/WSL043/DSH-Portable/releases/tag/update-channel-stable)：完整 Windows Portable 清单、签名，以及各平台的 Portable 组件更新附件。
- [内核更新附件（update-channel-core-stable）](https://github.com/WSL043/DSH-Portable-Updates/releases/tag/update-channel-core-stable)：已经打包为 Portable 组件的内核更新附件。

按下面的步骤取文件：

1. **完整 Windows Portable**：从 Portable 更新通道下载原始 `portable-manifest.json` 和 `portable-manifest.json.sig`。再打开清单，按 `payloads.windowsX64` 中的下载地址获取 ZIP，并保持 `payloads.windowsX64.filename` 指定的文件名。**JSON 与签名在更新通道，ZIP 可以在清单指向的产品版本 Release；不要只在同一个 Release 内找 ZIP。**
2. **Portable 组件**：下载当前平台的 `portable-update-<平台>.json` 及同名 `.json.sig`，再按清单 `component.urls` 中的地址获取指定 ZIP。
3. **内核组件**：选择同一平台、同一版本的 `dsh-core-update-<平台>-<版本>.json`、同名 `.json.sig` 和清单 `component.urls` 指定的 ZIP。也可使用当前版本的 `dsh-core-update-<平台>.json` 与其签名；ZIP 仍以该 JSON 为准。不要混用其他版本的签名或 ZIP。

平台名包括 `windows-x64`、`macos-arm64`、`macos-x64`、`linux-x64`、`linux-arm64`。以上三件文件放在同一目录，再复制到目标电脑；选择 JSON 开始更新。下载附件本身，不要把 GitHub 网页另存为 JSON。

这里的“内核更新附件”来自 **DSH-Portable-Updates**。DeepSeek 官方 Harness Release 的原始源码或安装包不是 Portable 内核组件，不能替代。

下载区的 **Windows 完整离线 ZIP** 额外包含 WebView2，用于初次部署。更新已有安装时，应按所选清单获取 ZIP；不要把初装整包与更新组件混为一谈。

签名附件以已发布更新通道为准，不能假设每个历史 Release 都有签名。不要编辑 JSON、重命名 ZIP 或自己生成签名；不要把组件包当作完整包。完整离线 ZIP 额外附带 WebView2；它与更新组件 ZIP 用途不同。离线模型仍须另行准备。

清单始终用启动器内置的公钥验证，包内的公钥不受信任。安装前校验实际 ZIP 的长度与 SHA-256，安装复制过程中再次校验。缺附件、错误签名、错误平台或不兼容包会停止，不回退到网络下载。

## 操作

新版 Windows Native 的**帮助**菜单固定提供「从文件更新 Portable」与「从文件更新内核」，不依赖内核随带的页面版本。新版设置 → 更新也在两个区域提供「从文件更新」；切换到随带旧版设置页的已验收内核后，可继续使用 Native 帮助菜单。选择 JSON 后两者共用原有版本确认、进度、预检、健康检查与恢复流程。页面只有在宿主明确声明 `openUpdateFromFile: true` 时才显示入口；旧宿主不显示。

命令行沿用现有命令（以下在 Portable 根目录执行）：

```powershell
.\runtime\node\node.exe .\launcher\runtime-entry.mjs portable-cli.mjs check-update --scope engine --input D:\Updates\dsh-core-update-windows-x64.json --json
.\runtime\node\node.exe .\launcher\runtime-entry.mjs portable-cli.mjs update --scope engine --input D:\Updates\dsh-core-update-windows-x64.json --no-browser --json
```

组件形式的 Portable 更新把 `--scope engine` 换成 `--scope product`，并选择对应清单。通过既有 `runtime-entry.mjs` 进入，紧凑运行时会先准备并定位 app；不要跳过它直接执行 `portable-cli.mjs update`。`--input` 不能与 `--update-manifest` 混用。适用性仍由原有平台、Node、布局与外壳契约规则判断，不能用离线导入绕过资格验证。

完整 Portable 包由 Windows FullUpdater 执行，不由 Node 另做一套整包事务；CLI 检查只返回委托信息，不代表已经安装。**0.9.6 及更早版本请下载本次 Release 的新版 Windows 引导器来升级。** 完整清单从 0.9.7 起使用 schema 2，旧更新器会在停进程和改动文件前拒绝，并提示下载最新版引导器，避免其旧保留名单误处理独立环境。Portable 组件和内核清单仍为 schema 1。新版引导器支持：

```powershell
.\DSH-Portable-windows-x64.exe --manifest-file D:\Updates\portable-manifest.json --destination D:\Apps\DSH-Portable
```

目标是完整的现有安装时，会原地更新并保留 `data`、`workspace`、`environments` 和 `installed-mode.json`；安装前仍需退出任务与其他环境。自定义数据根目录应放在程序目录之外。失败时沿用原来的回滚机制。备份重要数据仍可使用既有迁移导出。

离线更新指更新器不下载清单或 ZIP；模型服务、用户插件以及下次正常启动的自动检查仍遵循各自设置。它不构成整机断网保证。

## Download files (English)

Use a connected computer first. Open the release and expand **Assets**:

- [Portable update files](https://github.com/WSL043/DSH-Portable/releases/tag/update-channel-stable).
- [Portable core update files](https://github.com/WSL043/DSH-Portable-Updates/releases/tag/update-channel-core-stable).

For a full Windows Portable update, download `portable-manifest.json` and `portable-manifest.json.sig` from the Portable update channel. Get the ZIP from the download address in `payloads.windowsX64` and keep its `filename`. The JSON and signature are on the update channel; the ZIP may be on the product version release named by the manifest.

For a Portable component, get the platform's `portable-update-<platform>.json`, its `.json.sig`, and the ZIP at `component.urls`. For a core component, get `dsh-core-update-<platform>-<version>.json`, its `.json.sig`, and the ZIP named by that JSON. Keep the platform and version the same. The current-version JSON alias is also usable with its own signature and named ZIP.

For a full upgrade from 0.9.6 or earlier, run the new Windows bootstrap from the target release, using `--manifest-file` for offline files. Full manifests now use schema 2 so legacy updaters refuse before changing files; Portable component and core manifests remain schema 1. Named environments are preserved by the new updater.

Keep all three original files together. Copy them to the target computer and select the JSON. Do not edit the JSON, rename the ZIP, or mix signatures from different versions. Raw official Harness releases are not Portable core components.

The Windows complete offline ZIP includes WebView2 for first-time deployment. Update components serve an existing installation. Offline models must be prepared separately.
