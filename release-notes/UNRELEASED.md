# 未发布 / Unreleased

## 0.9.8 维护候选 / Maintenance candidate

0.9.8 已进入准备阶段，尚未发布，也未更新公开下载或应用内更新源。具体范围与致谢见[双语说明](v0.9.8.json)。默认组合为 DSH 0.2.1-rc.3、Image Viewer 0.1.17、Chat Manager 1.5.19。

- 高 DPI 导航、菜单与窗口布局；最大化关闭到托盘后的隐藏和恢复。
- 自动下载并校验同版离线更新文件、取消下载与明确缺失提示；更新检查复用、缓存故障提示，以及整包升级中断恢复与待验证状态。
- rc.3 插件更新入口、合法 YAML 更新预检，以及日志路径和并发写入。
- 大文件流式校验和已发布默认插件的兼容性更新。

原行为基线为 main `cf569846`，其[完整 CI 39/39](https://github.com/WSL043/DSH-Portable/actions/runs/40698251595)、Security 和 CodeQL 均成功；它仍使用 0.9.7 版本号，不能替代新 0.9.8 成品的资格。0.9.8 须通过自身最终提交的完整 CI、原生产签名整包验收及[内核窗口](../docs/stable-release-runbook.md)，再按发布授权交付。

0.9.8 is being prepared and is not published. Public downloads and update feeds are unchanged. See the [bilingual notes and acknowledgements](v0.9.8.json). The default set remains DSH 0.2.1-rc.3, Image Viewer 0.1.17 and Chat Manager 1.5.19.

The maintenance candidate covers DPI-aware desktop layout and tray restoration, automatic verified offline-file preparation and cancellation, shared update checks and interrupted-upgrade recovery, rc.3 plugin updates and valid YAML preflight, guarded diagnostics and streaming file verification. The successful `cf569846` [39-job baseline](https://github.com/WSL043/DSH-Portable/actions/runs/40698251595) still identifies 0.9.7; 0.9.8 requires its own final-commit qualification, production-signed upgrade acceptance, core-window checks and publication authorization.

Native Alpha2 qualification and the independent plugin major-version candidates remain separate work. Portable 1.x keeps the official payload boundary and its upstream MCP publication hold. Longer-term work stays in the [maintenance roadmap](../docs/maintenance-roadmap.md).
