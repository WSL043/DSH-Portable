# 未发布维护与最近交付 / Unreleased maintenance and recent delivery

## 未发布维护 / Unreleased maintenance

- 修复原生更新完成提示读取 CLI 多行输出时漏掉插件暂停警告；保留原有预检、插件数据和恢复行为。本项进入 main 后不另行发布版本，也不改写已公开的 0.9.8 成品。

- 待发布 main 将默认内核从 DSH 0.2.1-rc.3 校正为已独立验收的 0.2.1-rc.4；Image Viewer 0.1.17、Chat Manager 1.5.19 及现有 Node/MCP/Zod/pnpm 安全策略不变。[RC4 记录](../docs/core-rc4-historical-result-2026-10-29.json)仅证明既有可选内核的迁移和五平台资格；新默认组合须以对应提交的最终 33 项成品 CI、General 页和实际 RC4 运行时本机验收为准，历史记录不能替代。本项不改写已发布 0.9.8 的 RC3 默认组合，不另行发布或修改版本号。

The unreleased main default moves from DSH 0.2.1-rc.3 to the separately qualified 0.2.1-rc.4. Image Viewer 0.1.17, Chat Manager 1.5.19 and the existing Node/MCP/Zod/pnpm security policy stay unchanged. The RC4 core record is background migration evidence; the default combination requires its own final 33-job product CI and local General-page/actual-runtime checks. Published 0.9.8 still defaults to RC3; this maintenance does not publish or bump a version.

- 更新边界：内核可单独更新；Portable 整包更新可能切换到随包内核。启动时仅会尝试恢复此前选择、较随包版本更新且已通过新外壳验收的内核，仍需联网并可能恢复失败。严格“只升级 Portable 并保留当前内核”尚未实现。

- Core updates are independent; a full Portable update may switch to its bundled core. Startup only attempts to restore a previously selected newer core qualified for the new shell; it needs network access and may fail. Updating only Portable while guaranteeing the current core is retained is not implemented.

- 备用构建裁剪遇到未知第三方入口布局时，保留该包运行文件并记录入口信息；不再因可选体积优化阻断打包。已知布局中的活跃 Node 导出仍禁止删除。

- Optional alternate-build pruning retains runtime files and records unfamiliar dependency layouts instead of blocking packaging. Known layouts still refuse to remove active Node exports.

- 插件常规安装、启停和配置复用官方管理；侧栏“更多”仅保留“诊断与恢复”，不再常驻第二套高级管理。诊断区分无独立入口的能力组件与未在当前 Profile 启用的真实插件，不自动启用或卸载。配置恢复的逐包重试保留原有加载顺序，全部失败回退后明确提示未完成。

- Routine plugin installation, enablement and configuration use the official manager. Sidebar More keeps only Diagnostics and recovery. Activation diagnostics distinguish capability dependencies from real bundles not selected in the current profile, without enabling or removing packages automatically. Per-package recovery preserves the selected layer order, and a fully rolled-back restore is reported as incomplete.

## 最近交付：0.9.8 / Published 0.9.8

[0.9.8](https://github.com/WSL043/DSH-Portable/releases/tag/v0.9.8) 的成品固定为 main `f5db6400ff27257df8831d7e2d6110f2cef697d1`；[最终完整 CI 39/39](https://github.com/WSL043/DSH-Portable/actions/runs/40732334843)、Security 和 CodeQL 均成功。原生产签名整包已完成真实 0.9.7 → 0.9.8 升级，以及待验证修复、启动失败回退和正常恢复提交验收。公开 Windows ZIP 的大小及 SHA256 与实测成品一致。

具体范围与致谢见[双语说明](v0.9.8.json)。默认组合保持 DSH 0.2.1-rc.3、Image Viewer 0.1.17、Chat Manager 1.5.19：

- 高 DPI 导航、菜单与窗口布局；最大化关闭到托盘后的隐藏和恢复。
- 自动下载并校验同版离线更新文件、取消下载与明确缺失提示；更新检查复用、缓存故障提示，以及整包升级中断恢复与待验证状态。
- rc.3 插件更新入口、合法 YAML 更新预检，以及日志路径和并发写入。
- 大文件流式校验和已发布默认插件的兼容性更新。

可选内核独立经过[发布门禁](../docs/stable-release-runbook.md)；准备工件不等于公开可用，应用内版本目录以实际发布的签名清单为准。旧 Portable 能否独立更新内核，还受接口、Node、布局及默认插件兼容边界约束，见[外壳接口](../docs/shell-contract.md)。

The published 0.9.8 artifacts remain bound to `f5db640`, its successful 39-job qualification and production-signed upgrade/recovery acceptance. The default core and plugins are unchanged. Optional cores follow their own qualification and signed catalogs; prepared artifacts alone are not published delivery. The native multiline-warning correction above is unreleased maintenance and does not replace existing release assets.

独立插件的大版本候选继续单独验收。Portable 1.x 保持官方原始载荷边界及上游 MCP 发布阻断，不修改官方 EXE/ASAR。长期事项保留在[维护路线图](../docs/maintenance-roadmap.md)。
