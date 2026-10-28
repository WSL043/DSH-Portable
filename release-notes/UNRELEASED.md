# 未发布维护与最近交付 / Unreleased maintenance and recent delivery

## 未发布维护 / Unreleased maintenance

- 修复原生更新完成提示读取 CLI 多行输出时漏掉插件暂停警告；保留原有预检、插件数据和恢复行为。本项进入 main 后不另行发布版本，也不改写已公开的 0.9.8 成品。

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
