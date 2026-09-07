# 0.6.1 性能修复验收 / Performance repair evidence

## 发布撤回 / Release withdrawn

2026-09-07，0.6.1 已撤回为草稿，公开最新正式版恢复为 0.6.0。此前 main `211b45f` 的 34 项流水线和本机冒烟通过，仍不足以证明 #89 的启动超时、运行后卡顿及无法关闭已解决。发布判断有误；本文件中的测试结果保留为各项改动的证据，不作为该 issue 已修复或可重新发布的结论。

Release 0.6.1 was withdrawn to draft on 2026-09-07; the public latest stable release is 0.6.0. Passing the 34-job main run at `211b45f` and local smoke checks did not establish a fix for issue #89. The release decision was premature. The results below remain evidence for individual changes, not proof that the reported symptoms are resolved or that republication is approved.

附件中的后续成功记录是新的启动（`portRetry=0`），没有 `port-conflict-retry` 记录。当前代码仅对明确的端口占用错误换端口重试，因此不能把这些记录描述为超时后自动恢复。后续验收需分别对齐启动超时、长时间运行卡顿和关闭操作的实机日志与行为，保留未复现状态，不用故障注入代替原症状的复现。

The successful starts following the timeouts are separate launches (`portRetry=0`), with no `port-conflict-retry` entry. They do not establish automatic timeout recovery. Further qualification must correlate real startup, sustained operation and close behavior with their logs; fault injection does not replace reproduction of the reported symptoms.

撤回后新增的清理修复：启动失败路径曾忽略强制终止错误并删除进程记录，可能在后台仍存活时换端口重试。现统一使用核验所有权的停止流程；失败保留记录与原始错误，只有清理成功后才允许端口冲突重试，并记录清理开始、失败和完成。相同回归 fixture 在 `211b45f` 上确认“终止失败仍重试”，在修复后通过。本轮 Windows 11 `10.0.26200` 全量测试为 467/467；反馈系统是 Windows 10 `10.0.19045`，尚未完成原环境复测。

The follow-up fixes a failed-start path that swallowed forced-termination errors and deleted process state, allowing a port-conflict retry while a backend might remain alive. Cleanup now uses the ownership-checked stop path, retains state and both errors on failure, and only retries a port conflict after cleanup succeeds. The same fixture reproduces retry-after-failed-termination at `211b45f` and passes after the fix. The follow-up suite passes 467/467 on Windows 11 `10.0.26200`; the reported Windows 10 `10.0.19045` environment remains unverified.

## 范围与结论 / Scope and conclusion

2026-09-07，基于 main `30be1e6286b6bea91cfd9b374c10e2c66b934bc4` 处理 [issue #89](https://github.com/WSL043/DSH-Portable/issues/89)。本批修复 Portable 桌面桥、托盘资源、启动等待、路径别名迁移和 capsule 维护入口，并增加实机可验证的健康日志。下面记录本机结果及基础修复的跨平台结果；最终发布必须由成功的 main 成品流水线提供准确提交和下载校验值，不能把测试通过解释为反馈者环境中的全部卡顿或超时已解决。

This change addresses the Portable desktop bridge, tray resources, startup polling, path-alias relocation and capsule maintenance entry for issue #89, with correlated runtime health evidence. This document records local results and the baseline cross-platform run. Publication requires a successful main product run bound to its exact commit and download checksums. The affected environment's timeout remains independently unverified.

## 已确认问题 / Confirmed defects

- 会话列表与事件流每次变更均发布完整原生状态；原生端重复重建菜单、更新窗口外观。新实现以 100 ms 窗口合并事件、跳过相同投影，保留最终完成状态和待处理交互；卸载时取消排队回调。
- 托盘 `Items.Clear()` 不执行旧项释放。新实现先分离重复使用的命令，再释放生成菜单和子菜单；仅在语言或主题变化时更新窗口外观。
- 启动每次轮询都通过 PowerShell/CIM 检查进程。新实现先核验身份，再轻量检查存活，就绪前再次核验；停止和进程清理仍使用各自的所有权检查。
- 启动与支持报告为读取日志尾部加载整个文件。新实现按位置最多读取请求的尾部字节。
- 维护路由直接执行 CLI，可能缺少 capsule 运行时路径。现在统一经过 runtime entry；子进程环境明确携带选定运行时根目录。
- 已有配置目录但没有 `package.json` 时，默认插件刷新直接抛错，阻断启动和升级预检。现在跳过未声明的默认插件并保留目录文件。
- Windows 进程命令行的短路径未被双向规范化，导致已有后台未被认出、重复启动并留下占用目录的孤儿进程。现按实际路径参数解析别名，并避免把同一目录的路径别名当成迁移。启动失败清理也重新核验进程所有权。
- 路径写法切换时记录已有 workspace 别名，不移动运行中后台的会话；随后真正移动目录时迁移两种写法的会话和存储引用，保留外部项目路径。
- 后台和原生 UI 线程缺少独立心跳证据。现用 Node worker 与原生线程池分别观察心跳，记录延迟、恢复、CPU 和内存；启动及退出记录关联 startupId/PID。14 个日志尾部均纳入支持报告，按序列化体积限制单项大小，避免日志增长导致报告导出失败。

The bridge now coalesces and deduplicates session projections, disposes generated native menus, avoids repeated window styling, reduces startup process inspection and bounds log reads. Maintenance resolves the capsule through its runtime entry, with an explicit selected runtime root for child processes.

## 验证 / Validation

| 检查 / Check | 结果 / Result |
| --- | --- |
| `node --test tests/*.test.mjs` | Windows: 461 passed, 0 failed, 0 skipped |
| Baseline remote full product CI | 34 jobs passed before the additional health instrumentation; final main run is required again before publication |
| 相同事件风暴 / Unchanged event burst | Baseline: 4001 messages; candidate: 1 initial message |
| 完成与释放 / Completion and disposal | Final completion delivered; disposed bridge cancels queued publication |
| 慢启动模拟 / Slow startup simulation | 50+ liveness polls, 2 identity checks; dead or changed-identity processes rejected |
| 大日志 / Large log | 128 MiB fixture; bounded tail and launch offset/truncation checks passed |
| Windows build | Offline ZIP, bootstrap and update artifacts built successfully |
| Native tray | Published 0.6.0 fails disposal check; candidate passes 1000 rebuilds with persistent commands retained |
| Capsule maintenance | 14 diagnosis checks passed through real CLI; Unicode report path passed |
| 启动 / First lifecycle startup | 4.698 s (20 s budget) |
| 移动后启动 / Startup after move | 4.896 s (12 s budget) |
| 显式退出 / Explicit exit | 3.396 s / 3.455 s before/after move (15 s budget) |
| 关闭即退出 / Close to exit | 0.339 s / 0.348 s before/after move (15 s budget) |
| 无插件清单目录 / Profile without manifest | Finished-product lifecycle passed and existing marker file retained |
| 双向路径识别 / Bidirectional aliases | Reverse-direction contract and product smoke fail before the fix; final product reuses the original PID/port, skips migration and exits the original backend |
| 别名后移动 / Relocation after alias use | Regression fails before the follow-up fix; both workspace spellings and their sessions migrate, external paths remain unchanged |
| Running 0.6.0 → 0.6.1 | Official published ZIP, full-package upgrade, 4 preservation markers, updated desktop readiness and backend smoke passed without intervention |
| Node heartbeat | Real child process: asynchronous wait, 8-second synchronous block, delayed heartbeat and recovery; normal natural process exit |
| Native UI stall | Packaged desktop: injected 8-second UI block, delayed/recovered samples in exported report; backend answered an unauthenticated HTTP request with 401 before the UI block ended; clean exit |
| Full support logs | All 14 logs exceed 64 KiB; export remains under 512 KiB, preserves recent markers and redacts credentials |

启动数字来自现有桌面生命周期冒烟脚本。测试机器已构建并使用过运行时，不是全新 Windows 或清空系统缓存后的冷启动性能承诺；没有进行同机旧版本启动时间对比，因此不宣称启动提速百分比。

Startup numbers come from the existing desktop lifecycle smoke on a build machine. They are not a clean-machine or flushed-OS-cache cold-start guarantee. No paired old-version startup benchmark was performed, so no startup speedup percentage is claimed.

Locally qualified Windows offline ZIP SHA-256: `f84b504a6a348317f9124ac094264f6e922809e367e24906328ddecb951ce8b5`.

Local Windows shell fingerprint (matches local source and compiled package): `21a9aeda3021b30b84833329304bc735590a7700e395db5836c73c48a16a79f0`.

Baseline code commit: `8e2acb42cea83fc1afeb04e98f9e12af46cf0d41`. [Full product run 34084111700](https://github.com/WSL043/DSH-Portable/actions/runs/34084111700) completed successfully before health instrumentation, including both Windows native lifecycle lanes, running published-version upgrade, macOS relocation/plugin checks, and Linux AppImage/plugin/component-update checks. The final release's generated qualification and checksums are authoritative for the later main build; these local hashes are not interchangeable with CI downloads.

Health logs use the same startup ID and their actual process IDs. Node's main thread sends a heartbeat every second; an independent worker samples every two seconds. The native watchdog also samples every two seconds, with at most one pending UI callback. Healthy samples are written every 30 seconds, heartbeat delays of at least five seconds and recovery are recorded sooner. Each health file rotates at 128 KiB with one previous file. CPU percentage covers the last internal sampling interval (100% is one busy CPU core), and the Node heap value is explicitly the last main-thread sample, not fresh data while blocked. No prompts, tokens, process arguments or stack dumps are added to these health records.

Failure injections validate observability, not the reporter's original root cause. The HTTP probe intentionally avoids replaying DSH's one-time login URL; a 401 confirms the backend's authentication handler remained responsive during the native UI block, not that a second authenticated session was created.

Upgrade test corrections: initialize a usable old-version profile for the running-host scenario; wait for the updater process to exit with ignored stdio, since the relaunched desktop can inherit redirected pipes. Earlier runs requiring intervention are excluded from acceptance.

The first full remote run and an unchanged-artifact diagnostic run reproduced a directory-lock failure. Diagnostics identified the initial 0.6.0 backend still running on port 3080 while later desktop starts used port 3081. The initial process used a short Windows path; the old desktop used its long alias. The predecessor fixture now consistently uses canonical paths, and a separate candidate product smoke explicitly verifies short-path start, long-path reuse of the same PID, non-migration and complete shutdown. This is a reproduced ownership defect, not a timeout increase or an unexplained retry.

复现命令 / Reproduction commands (use an isolated extracted product root):

```powershell
node --test tests/*.test.mjs
./scripts/build-windows.ps1 -OutputDir <artifacts> -CacheDir <build-cache>
./scripts/smoke-windows-native-tray.ps1 -Root <isolated-product-root>
./scripts/smoke-windows-desktop-move.ps1 -Root <isolated-product-root>
node scripts/smoke-capsule-maintenance.mjs <isolated-product-root>
node scripts/smoke-windows-path-alias.mjs <isolated-product-root>
node scripts/smoke-windows-runtime-health.mjs <isolated-product-root>
node scripts/smoke-windows-version-upgrade.mjs <published-0.6.0-zip> <artifacts> --running-host
```

## 仍需验收 / Remaining qualification

- 反馈附件只证明曾在 `official-dsh-import-begin` 后等待 60 秒超时，另一次约 12 秒完成。未包含当时的 CPU、事件循环或线程栈，因此不能证明“冷启动竞争”，也不能证明该超时已根治。
- 本次托盘压力测试证明重复事件与资源释放缺陷已修正，不等于长期真实工作负载内存稳定性证明。
- 最终发布由 main 全套成品流水线和发布校验控制；反馈者环境中的特定超时仍需复测。
- [Issue #88](https://github.com/WSL043/DSH-Portable/issues/88) 是独立的上游采纳队列，不是此性能缺陷的修复证明，继续按既有采纳矩阵处理。

The supplied report proves an import-stage timeout, but contains no CPU, event-loop or stack evidence establishing its cause. Stress tests establish bounded bridge work and resource disposal, not long-duration real-workload stability. Final publication is controlled by the full main product workflow; affected-machine retesting remains open. Issue #88 remains a separate upstream intake review.
