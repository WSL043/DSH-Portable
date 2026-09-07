# 0.6.2 repair qualification / 修复验收

0.6.1 remains withdrawn. Version 0.6.2 includes the repairs in PR #91 and the completed market review in PR #92. A higher version is required because installed 0.6.1 updaters ignore a replacement with the same version. Both 0.6.0 and 0.6.1 detect the repaired shell as requiring a full-package update.

0.6.1 保持撤回。0.6.2 包含 PR #91 的后续修复和 PR #92 完成的市场采纳审阅；递增版本使曾安装撤回包的用户也能收到修复。0.6.0 和 0.6.1 均已验证会提示更新完整包。

## Completed evidence / 已完成验证

| Check | Evidence |
| --- | --- |
| Confirmed performance defects | [Historical repair evidence](performance-0.6.1.md): unchanged event burst reduced from 4001 projections to one, old tray disposal failure reproduced and repaired, process identity queries reduced, bounded log reads, path-alias ownership and maintenance entry repaired |
| Failed-start cleanup | Regression fails before repair; cleanup failure retains process state and original/cleanup errors, and prevents retry |
| Windows inspection failure | Query errors propagate instead of meaning absence; process state survives inspection failure; bounded redacted error causes enter the report |
| Market updates and reporting | Exact target requirements checked before npm update; incompatible versions rejected before mutation; render failures isolated and sanitized events persisted in support reports |
| Windows 11 finished product | Hidden native restart changes backend boot ID; a submitted market diagnostic appears in the JSON support report without the fixture secret; injected UI stall/recovery, responsive backend and clean exit pass |
| Cross-platform finished product | [Run 34100016493](https://github.com/WSL043/DSH-Portable/actions/runs/34100016493): all 34 jobs passed, including Windows 2022/2025, macOS x64/arm64 and Linux x64/arm64 native checks |
| Windows close behavior in that run | Native close-to-exit: 0.508/0.509 seconds on Windows 2022 and 0.634/0.668 seconds on Windows 2025; stall diagnostics, report correlation and restart pass |
| Local contracts | 480 tests passed before the final bounded error-cause addition; its 13 targeted diagnostic/query/cleanup tests passed afterward. Version/release-note/update-core checks pass after advancing to 0.6.2 |

The final release must use a successful complete main build of its exact commit. Its generated qualification and checksums identify the actual distributed packages; earlier branch or local packages are supporting evidence, not substitutes. Windows and macOS CI preserve support-report artifacts for investigation. Local Windows checks use process/control interfaces and hidden native hosts without desktop input automation.

最终发布使用对应提交的完整 main 成品流水线，发布证明和 SHA-256 对应实际下载包。上述历史分支、本机结果是补充证据。Windows 与 macOS CI 保留支持报告，本机使用后台接口和隐藏原生宿主，不控制用户鼠标或窗口。

## Evidence boundary / 证据边界

Issue #89's original report records a 60-second DSH import timeout. It lacks the contemporaneous CPU/thread evidence needed to establish its unique cause; successful later launches were separate launches, not demonstrated automatic recovery. The original Windows 10 machine is unavailable. GitHub Windows runners and local Windows 11 provide repeatable product verification, not a claim that a Windows Server runner is Windows 10.

Regression fixtures prove the confirmed defects above, and failure injection proves diagnostic coverage. They do not prove the historical timeout's unique root cause or an unlimited-duration workload's stability. A recurrence should be investigated using the new correlated startup, native/backend heartbeat, cleanup and error-cause records.

#89 原始附件中的 60 秒导入超时缺少同期 CPU/线程证据，无法据此认定唯一根因。已有回归证明已确认缺陷得到修复，故障注入证明日志能捕获和关联异常；两者均不冒充原始超时的独立复现。缺少原机器由 GitHub CI 加本机 Win11 补充验证，保留系统差异这一事实。若再次发生，应使用新增的启动、双端心跳、清理和底层错误链继续定位。
