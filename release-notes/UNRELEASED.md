# 待发布 / Unreleased

这些改动尚未包含在 v0.6.0 已发布的下载文件中。维护者决定下一版本号与发布时间，成品验收通过后再写入对应版本的双语 JSON。

## 用户变化候选

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

These changes are not included in the published v0.6.0 downloads. The maintainer chooses the next version and release date; a versioned bilingual JSON descriptor is prepared after product qualification.

- Update bundled pnpm from 11.7.0 to 11.11.0 for its published installation-path and environment-handling security fixes.
- Improve exact plugin-update targeting, already-current results, and restart notices after a page refresh.
- Keep restart guidance for removed native addons and clarify package-manager launch failures and missing local dependencies.
- Refresh cached market screenshots with catalog changes and protect the market UI from browser translation mutations.
- Support bounded HTTPS redirects in the existing WebDAV backup download route, without forwarding credentials across origins.
- Name the candidate channel consistently and distinguish GUI import replacement from CLI missing-only restore.
- Keep upstream discovery and validation automated, with manual merging and publishing, duplicate-proposal suppression, and preserved human issue notes.

Validation results belong to the pull request and final release evidence. This file is not a claim that all platforms have already passed or that a new release has shipped.
