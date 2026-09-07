# 待发布 / Unreleased

以下累积改动归入 0.6.2（0.6.1 已撤回），双语版本说明见 [v0.6.2.json](v0.6.2.json)，本机与基础修复验收见 [性能修复证据](../docs/performance-0.6.1.md)。最终发布状态、提交和成品校验值以 GitHub Release 的发布证据为准。

## 用户变化候选

- 合并密集会话事件并去除相同托盘状态的重复发送；释放重建后的旧菜单资源，减少流式任务期间的桌面开销。
- 减少启动等待的 Windows 进程查询，限制日志读取字节数，修正 capsule 维护命令的运行时解析。
- 增加关联启动 ID/PID 的后台与原生窗口健康日志；实机阻塞注入验证延迟、恢复、后台响应和支持报告，修正大日志导致导出失败的问题。
- Issue #89 的用户环境导入超时与长期卡顿仍需复测；当前本机结果不构成该环境已修复的证明。

- 将随附 pnpm 从 11.7.0 更新到 11.11.0，修复该依赖已公开的安装路径与环境处理漏洞。
- 改善插件更新目标锁定、已是当前版本的处理，以及页面刷新后的待重启状态。
- 修正包含原生模块的插件卸载后的重启提示，并提供更明确的 pnpm 启动失败和本地依赖丢失说明。
- 修复市场截图缓存刷新，并为市场 UI 添加浏览器翻译保护。
- 兼容现有 WebDAV 备份下载接口的 HTTPS 重定向，限制跳转次数并防止跨站携带认证信息。
- 将更新通道名称统一为候选版（Alpha / Beta / RC），纠正迁移指南中 GUI 与 CLI 冲突处理的区别。

## 维护变化

- 上游版本自动发现和验证，合并与 Portable 发版由维护者决定。
- 相同的待审查提案不反复提交和触发成品验证；市场 issue 保留人工说明，无新信息时不重复修改。
- Release 说明支持独立的已知限制、升级说明；0.6.0 的历史 Alpha 迁移提示不再出现在所有未来 Alpha 中。

## English

These accumulated changes belong to 0.6.2 (0.6.1 was withdrawn). See its [bilingual descriptor](v0.6.2.json) and [local and baseline performance evidence](../docs/performance-0.6.1.md). The GitHub Release qualification records the authoritative publication state, commit and download checksums.

- Coalesce streamed session events, suppress duplicate tray projections, and dispose retired native menu resources.
- Reduce Windows startup process inspection, bound log reads, and resolve capsule runtime paths for maintenance commands.
- Correlate backend and native-window health logs by startup/PID; verify delay, recovery, backend responses and exported reports with real-product stall injection, and prevent large logs from breaking export.
- The import timeout and long-running lag in issue #89 still require verification in the affected environment; local acceptance does not prove that environment is fixed.

- Update bundled pnpm from 11.7.0 to 11.11.0 for its published installation-path and environment-handling security fixes.
- Improve exact plugin-update targeting, already-current results, and restart notices after a page refresh.
- Keep restart guidance for removed native addons and clarify package-manager launch failures and missing local dependencies.
- Refresh cached market screenshots with catalog changes and protect the market UI from browser translation mutations.
- Support bounded HTTPS redirects in the existing WebDAV backup download route, without forwarding credentials across origins.
- Name the candidate channel consistently and distinguish GUI import replacement from CLI missing-only restore.
- Keep upstream discovery and validation automated, with manual merging and publishing, duplicate-proposal suppression, and preserved human issue notes.

Validation results belong to the pull request and final release evidence. This file is not a claim that all platforms have already passed or that a new release has shipped.
