# 离线更新

从 0.9.5 起，Windows Native 在既有更新流程上提供本地文件入口，适用于 0.x Portable 和内核。1.x 官方 Electron 纯便携线不使用这套 Native 桥，其发布仍等待官方成品修复内置 MCP 依赖；本次更新不修改官方 ASAR，也不解除该阻断。详见 [1.x MCP 复核与处理边界](one-x-mcp-followup-2026-10-23.md)。

## 准备

在联网电脑上准备原始清单、原始签名和对应 ZIP，复制到同一个目录：

| 更新内容 | 清单与附件 |
| --- | --- |
| 完整 Windows Portable（可跨运行时边界） | `portable-manifest.json`、`portable-manifest.json.sig`、清单 `payloads.windowsX64.filename` 指定的 ZIP |
| Portable 组件 | 对应平台的 `portable-update-*.json`、同名 `.sig`、清单 URL 中的 ZIP 文件名 |
| 内核 | 对应平台的 `dsh-core-update-*.json`、同名 `.sig`、清单 URL 中的 ZIP 文件名 |

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

完整 Portable 包由现有 Windows FullUpdater 执行，不由 Node 另做一套整包事务；CLI 检查只返回委托信息，不代表已经安装。新版引导器也支持：

```powershell
.\DSH-Portable-windows-x64.exe --manifest-file D:\Updates\portable-manifest.json --destination D:\Apps\DSH-Portable
```

目标是完整的现有安装时，会原地更新并保留 `data`、`workspace`；安装前仍需退出任务与其他环境。失败时沿用原来的回滚机制。备份重要数据仍可使用既有迁移导出。

离线更新指更新器不下载清单或 ZIP；模型服务、用户插件以及下次正常启动的自动检查仍遵循各自设置。它不构成整机断网保证。
