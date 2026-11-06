# 未发布维护与最近交付 / Unreleased maintenance and recent delivery

## 未发布维护 / Unreleased maintenance

- 修复共享启动日志被占用时 Node 的准备完成事件可能从每次启动历史中丢失的问题，保留原有日志大小与路径保护。

- Preserve per-start runtime readiness events when the shared startup log is busy, retaining existing log size and path protections.

- 插件安装、更新和发现沿用官方 DSH；新环境不再自动加入社区索引。现有插件与索引保留，需要时可按 README 手动添加。

- Plugin installation, updates and discovery use official DSH. New environments no longer add a community index automatically. Existing plugins and indexes are preserved; the README provides an optional manual index.

- Windows 运行中的任务栏和托盘图标按系统任务栏配色使用黑色或白色实心鲸鱼，不再依赖白色图标的细轮廓；保持透明、无底座；静态 EXE 图标也统一为无轮廓的黑色官方标志。起动画面的标志单独跟随 DSH 页面配色；系统配色变更时更新窗口与托盘图标。感谢 [crazyrainman 的反馈](https://github.com/WSL043/DSH-Portable/discussions/39#discussioncomment-19370243)。

- Running Windows taskbar and tray icons use a solid black or white whale for the system taskbar theme, with a transparent background and no pedestal. Static EXE icons use the solid black official mark without an outline. The loading logo follows the DSH page theme independently. Windows theme changes refresh the window and tray icons. Thanks to [crazyrainman for the report](https://github.com/WSL043/DSH-Portable/discussions/39#discussioncomment-19370243).

- 修复工作区顶部扩展槽声明归属错误导致会话列表整体不显示的问题；兼容修复已打包的旧适配，不改会话数据或插件。更新提示与独立环境入口的异步显隐保持相同 Hook 顺序。

- Fix the misplaced workspace-header slot declaration that hid the conversation list, including already packed adapters, without changing sessions or plugins. Keep hook order stable when update and environment controls appear asynchronously.

- Portable 菜单、托盘、更新和维护页面跟随官方 DSH 语言设置，增加日语、西班牙语、法语、德语、俄语和巴西葡萄牙语；复用官方语言变更通知，不增加独立语言偏好。Web 与 Windows 文案共用一份辞书，移除从页面 DOM 猜测语言的分支。

- Portable menus, tray, updates and maintenance follow the official DSH language preference, adding Japanese, Spanish, French, German, Russian and Brazilian Portuguese. Web and Windows copy share one dictionary; language changes use the official event instead of reading the page DOM or adding a separate preference.

- 修复 Windows 自有 WebView2 进程结束后仍使用旧 PID 快照误报超时的问题；安全终止请求后补一次有界检查，继续核对进程归属，不扩大终止范围。数据导入验收在原生阶段失败时直接报告真实阶段。

- Recheck the owned WebView2 process tree after a bounded shutdown request instead of reporting a timeout from stale PIDs. Ownership checks and termination scope stay unchanged. Native import checks now report an early native failure at its actual stage.

- 新版本不再默认安装 Image Viewer 和 Chat Manager；已有安装、配置与启停状态保持不变，可按需通过官方插件管理安装。

- New packages no longer install Image Viewer or Chat Manager by default. Existing installations, configuration and enablement states are preserved; both remain available through the official plugin manager.

- 修复原生更新完成提示读取 CLI 多行输出时漏掉插件暂停警告；保留原有预检、插件数据和恢复行为。本项进入 main 后不另行发布版本，也不改写已公开的 0.9.8 成品。

- 待发布 main 将默认内核从 DSH 0.2.1-rc.3 校正为已独立验收的 0.2.1-rc.4；现有 Node/MCP/Zod/pnpm 安全策略不变；默认插件调整见上文。[RC4 记录](../docs/core-rc4-historical-result-2026-10-29.json)仅证明既有可选内核的迁移和五平台资格；新默认组合须以对应提交的最终 33 项成品 CI、General 页和实际 RC4 运行时本机验收为准，历史记录不能替代。本项不改写已发布 0.9.8 的 RC3 默认组合，不另行发布或修改版本号。

The unreleased main default moves from DSH 0.2.1-rc.3 to the separately qualified 0.2.1-rc.4. The existing Node/MCP/Zod/pnpm security policy stays unchanged; the default-plugin change is described above. The RC4 core record is background migration evidence; the default combination requires its own final 33-job product CI and local General-page/actual-runtime checks. Published 0.9.8 still defaults to RC3; this maintenance does not publish or bump a version.

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
