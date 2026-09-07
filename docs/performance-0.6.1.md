# 0.6.1 性能修复验收 / Performance repair evidence

## 范围与结论 / Scope and conclusion

2026-09-07，基于 main `30be1e6286b6bea91cfd9b374c10e2c66b934bc4` 处理 [issue #89](https://github.com/WSL043/DSH-Portable/issues/89)。本批修复 Portable 桌面桥、托盘资源、启动等待、路径别名迁移和 capsule 维护入口。本机 Windows 和远程跨平台成品验收通过；尚未发布，不能把这些结果解释为反馈者环境中的全部卡顿或超时已解决。

This change addresses the Portable desktop bridge, tray resources, startup polling, path-alias relocation and capsule maintenance entry for issue #89. Local Windows and remote cross-platform product checks pass. Publication and qualification in the affected environment remain pending.

## 已确认问题 / Confirmed defects

- 会话列表与事件流每次变更均发布完整原生状态；原生端重复重建菜单、更新窗口外观。新实现以 100 ms 窗口合并事件、跳过相同投影，保留最终完成状态和待处理交互；卸载时取消排队回调。
- 托盘 `Items.Clear()` 不执行旧项释放。新实现先分离重复使用的命令，再释放生成菜单和子菜单；仅在语言或主题变化时更新窗口外观。
- 启动每次轮询都通过 PowerShell/CIM 检查进程。新实现先核验身份，再轻量检查存活，就绪前再次核验；停止和进程清理仍使用各自的所有权检查。
- 启动与支持报告为读取日志尾部加载整个文件。新实现按位置最多读取请求的尾部字节。
- 维护路由直接执行 CLI，可能缺少 capsule 运行时路径。现在统一经过 runtime entry；子进程环境明确携带选定运行时根目录。
- 已有配置目录但没有 `package.json` 时，默认插件刷新直接抛错，阻断启动和升级预检。现在跳过未声明的默认插件并保留目录文件。
- Windows 进程命令行的短路径未被双向规范化，导致已有后台未被认出、重复启动并留下占用目录的孤儿进程。现按实际路径参数解析别名，并避免把同一目录的路径别名当成迁移。启动失败清理也重新核验进程所有权。
- 路径写法切换时记录已有 workspace 别名，不移动运行中后台的会话；随后真正移动目录时迁移两种写法的会话和存储引用，保留外部项目路径。

The bridge now coalesces and deduplicates session projections, disposes generated native menus, avoids repeated window styling, reduces startup process inspection and bounds log reads. Maintenance resolves the capsule through its runtime entry, with an explicit selected runtime root for child processes.

## 验证 / Validation

| 检查 / Check | 结果 / Result |
| --- | --- |
| `node --test tests/*.test.mjs` | Windows: 459 passed, 0 failed, 0 skipped |
| Remote full product CI | 34 jobs passed, 0 failed; Windows, macOS x64/arm64 and Linux x64/arm64 |
| 相同事件风暴 / Unchanged event burst | Baseline: 4001 messages; candidate: 1 initial message |
| 完成与释放 / Completion and disposal | Final completion delivered; disposed bridge cancels queued publication |
| 慢启动模拟 / Slow startup simulation | 50+ liveness polls, 2 identity checks; dead or changed-identity processes rejected |
| 大日志 / Large log | 128 MiB fixture; bounded tail and launch offset/truncation checks passed |
| Windows build | Offline ZIP, bootstrap and update artifacts built successfully |
| Native tray | Published 0.6.0 fails disposal check; candidate passes 1000 rebuilds with persistent commands retained |
| Capsule maintenance | 14 diagnosis checks passed through real CLI; Unicode report path passed |
| 启动 / First lifecycle startup | 5.225 s (20 s budget) |
| 移动后启动 / Startup after move | 4.963 s (12 s budget) |
| 显式退出 / Explicit exit | 3.553 s / 3.481 s before/after move (15 s budget) |
| 关闭即退出 / Close to exit | 0.327 s / 0.346 s before/after move (15 s budget) |
| 无插件清单目录 / Profile without manifest | Finished-product lifecycle passed and existing marker file retained |
| 双向路径识别 / Bidirectional aliases | Reverse-direction contract and product smoke fail before the fix; final product reuses the original PID/port, skips migration and exits the original backend |
| 别名后移动 / Relocation after alias use | Regression fails before the follow-up fix; both workspace spellings and their sessions migrate, external paths remain unchanged |
| Running 0.6.0 → 0.6.1 | Official published ZIP, full-package upgrade, 4 preservation markers, updated desktop readiness and backend smoke passed without intervention |

启动数字来自现有桌面生命周期冒烟脚本。测试机器已构建并使用过运行时，不是全新 Windows 或清空系统缓存后的冷启动性能承诺；没有进行同机旧版本启动时间对比，因此不宣称启动提速百分比。

Startup numbers come from the existing desktop lifecycle smoke on a build machine. They are not a clean-machine or flushed-OS-cache cold-start guarantee. No paired old-version startup benchmark was performed, so no startup speedup percentage is claimed.

Final Windows offline ZIP SHA-256: `56525c8b18730443abe4755fddbe449367f4a0976091a13ec6376760d3cf02fe`.

Final Windows shell fingerprint (matches source and compiled package): `cbd8b7553935aaafc0c066a2074d91faf7c4de0a0f8db5d5c0471b2ee0ea4301`.

Qualified code commit: `8e2acb42cea83fc1afeb04e98f9e12af46cf0d41`. [Full product run 34084111700](https://github.com/WSL043/DSH-Portable/actions/runs/34084111700) completed successfully, including both Windows native lifecycle lanes, running published-version upgrade, macOS relocation/plugin checks, and Linux AppImage/plugin/component-update checks. Subsequent evidence and release-description edits do not change the qualified product code.

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
node scripts/smoke-windows-version-upgrade.mjs <published-0.6.0-zip> <artifacts> --running-host
```

## 仍需验收 / Remaining qualification

- 反馈附件只证明曾在 `official-dsh-import-begin` 后等待 60 秒超时，另一次约 12 秒完成。未包含当时的 CPU、事件循环或线程栈，因此不能证明“冷启动竞争”，也不能证明该超时已根治。
- 本次托盘压力测试证明重复事件与资源释放缺陷已修正，不等于长期真实工作负载内存稳定性证明。
- macOS/Linux 成品和远程 CI 已通过；反馈者环境复测与正式发布仍未完成。
- [Issue #88](https://github.com/WSL043/DSH-Portable/issues/88) 是独立的上游采纳队列，不是此性能缺陷的修复证明，继续按既有采纳矩阵处理。

The supplied report proves an import-stage timeout, but contains no CPU, event-loop or stack evidence establishing its cause. Stress tests establish bounded bridge work and resource disposal, not long-duration real-workload stability. Cross-platform product qualification passes; affected-machine retesting remains open. Issue #88 remains a separate upstream intake review. No issue closure, merge or publication is implied.
