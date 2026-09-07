# 待发布 / Unreleased

这些改动尚未包含在 v0.6.0 已发布的下载文件中。下一版本目标为 0.6.1，双语描述与跨平台成品验收已完成，正式发布和反馈环境复测仍待完成。验收记录见 [性能修复证据](../docs/performance-0.6.1.md)。

## 用户变化候选

- 合并密集会话事件并去除相同托盘状态的重复发送；释放重建后的旧菜单资源，减少流式任务期间的桌面开销。
- 减少启动等待的 Windows 进程查询，限制日志读取字节数，修正 capsule 维护命令的运行时解析。
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

These changes are not included in the published v0.6.0 downloads. The next version targets 0.6.1; its bilingual descriptor and cross-platform product qualification are complete, with publication and affected-machine retesting pending. See the [performance repair evidence](../docs/performance-0.6.1.md).

- Coalesce streamed session events, suppress duplicate tray projections, and dispose retired native menu resources.
- Reduce Windows startup process inspection, bound log reads, and resolve capsule runtime paths for maintenance commands.
- The import timeout and long-running lag in issue #89 still require verification in the affected environment; local acceptance does not prove that environment is fixed.

- Update bundled pnpm from 11.7.0 to 11.11.0 for its published installation-path and environment-handling security fixes.
- Improve exact plugin-update targeting, already-current results, and restart notices after a page refresh.
- Keep restart guidance for removed native addons and clarify package-manager launch failures and missing local dependencies.
- Refresh cached market screenshots with catalog changes and protect the market UI from browser translation mutations.
- Support bounded HTTPS redirects in the existing WebDAV backup download route, without forwarding credentials across origins.
- Name the candidate channel consistently and distinguish GUI import replacement from CLI missing-only restore.
- Keep upstream discovery and validation automated, with manual merging and publishing, duplicate-proposal suppression, and preserved human issue notes.

Validation results belong to the pull request and final release evidence. This file is not a claim that all platforms have already passed or that a new release has shipped.
