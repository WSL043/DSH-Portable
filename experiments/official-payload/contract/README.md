# 官方更新契约哨兵

在 Windows PowerShell 运行：

```powershell
./experiments/official-payload/contract/run-contract-probe.ps1 -AppDir 'C:\path\to\DeepSeek Harness' -Locale zh
```

探针启动所给目录的副本，不改系统安装目录。要求本机 `DeepSeek Harness.exe` 未运行且端口 `19387` 空闲；冲突时不终止进程，并在证据目录写失败报告。报告、请求日志、桩调用日志留在 `WorkRoot` 的父目录；工作副本、专用 updater cache 和 `HKCU\Software\Classes\dsh` 临时更改在 `finally` 清理/还原。

| 断言 | 架构契约 |
| --- | --- |
| `feed-http-accepted`、`installer-downloaded`、`blockmap-404-tolerated` | 契约 1、阶段 1 假 feed 下载流程 |
| `update-dialog-shown`、`install-invoked-installer`、`app-exited-after-install` | 契约 3、更新数据流 2–5 |
| `userdata-redirected`、`protocol-registered-to-app-exe`、`no-preexisting-official-instance` | 契约 4；实验证据中的数据隔离、协议注册与单实例端口 |
| `static-app-update-yml`、`static-asar-manifest`、`static-nsis-updater` | 契约 1–3、4、6 |

报告中的每项 `{id, passed, evidence}` 均由纯函数汇总；缺少证据按失败处理。安装器未下载、界面文案/URL改变、桩参数或 pending 路径变化，分别定位到 feed、官方 UI/CDP、electron-updater 或缓存契约。`directoryOutsideWrites` 只记录缓存目录与协议键，不把它们作为失败条件。CI 成功缓存按官方版本和 SHA-512 精确匹配；新身份才重新跑探针。

静态 ASAR 检查直接验证头部和条目偏移后只读 `package.json` 与 updater 源码；不需要联网安装 `npx @electron/asar`，也不解包或改写官方文件。

离线单测：`node --test tests/official-contract-*.test.mjs`。此测试不联网、不启动官方程序；workflow_dispatch/定时 CI 才执行完整 Windows 哨兵。
