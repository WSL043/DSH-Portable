# 全新路线试用 / Fresh architecture preview

**Windows x64 · 仅全新目录 · 不覆盖 0.7.x 或 alpha.1，也不导入旧 data。** 这是探索阶段的 Alpha，不是 1.0 正式版，不会替代稳定版 Latest。

## 这次改变了什么

- 使用官方 **DeepSeek Harness 0.1.7-rc.2 桌面成品**。官方 EXE、app.asar 和运行库保持原字节；已移除 alpha.1 的源码覆盖构建。
- 外置原生启动器负责数据路径和整套桌面更新。下载官方原始安装包，检查摘要与发布者签名，仅解包、不运行安装器。官方安装器更新配置不部署。
- 启动时后台检查已验收目录，准备新版本，下次完全退出再启动时切换。保留当前、上一及待切换程序，清理更旧的受管程序；不会擅自降级用户数据。
- 官方更新源每小时自动检查；新候选必须通过 Windows 成品验收后才进入便携更新目录，不会因上游一发布就无条件推送。
- DSH home、Electron 状态、受管 pnpm/原生库/Node 缓存归入 data；搬迁修复只处理已识别的依赖路径，不改写官方会话格式。

## 先了解这些限制

- **官方应用内“检查更新”会显示更新源错误。** Alpha.2 的更新由外部 Portable 启动器负责。
- **工作区文件仍在外部，包括官方“文档/deepseek-harness/default-workspace”。** 移动 Portable 不会自动搬走项目文件，也不重写旧会话里的绝对路径。
- 官方会注册 dsh://，可能覆盖安装版关联；协议打开或直接运行内部官方 EXE 会绕过启动器。实验环境试用，不与安装版混用。固定端口 19387 冲突时会提示先退出另一份桌面。
- 社区启动器未签名；官方文件签名不代表 DeepSeek 认可整个社区发行包。Windows 系统记录、临时文件、拼写词典等仍可能位于便携目录之外。
- 跨机器登录、旧数据迁移、真实模型请求、所有第三方插件、物理断电和磁盘耗尽不属于本 Alpha 的完整通过承诺。data 可能包含明文凭据，请勿公开分享。

## 验收与下载

下载 ZIP，完整解压，运行 **DeepSeek Harness Portable.exe**。校验值见 checksums.txt；来源与成品证据见 provenance.json 和 qualification.json。

在一次性 Windows 原生环境的私有桌面上操作真实官方成品，覆盖输入、插件安装/启用/禁用、搬迁后草稿保留与启用/卸载、正常退出、损坏暂存保留现版、切换后中断标记恢复及外部写入审计。证据链接见 qualification.json。首个通道仅含 rc.2，尚不声称两个不同官方版本的升级已实测通过；以后每次跨版本晋级必须通过这一检查。

---

**Windows x64 experimental preview. Use a fresh folder; do not overwrite stable/alpha.1 or import their data.**

This release replaces source overlays with the unchanged official 0.1.7-rc.2 desktop payload and a small external native launcher. The launcher owns portable application data and whole-desktop updates, authenticates official downloads, extracts rather than runs the installer, and activates prepared updates on a cold launch. Qualified versions are promoted by automated Windows acceptance; stable 0.7.x updates remain separate.

Known differences: the official in-app update command reports a missing source; workspaces remain external; dsh:// registration can override an installed edition and bypass the wrapper; port 19387 is shared. Windows may retain system traces. The community launcher is unsigned. Cross-machine login, legacy migration, real model calls, all third-party plugins and full power-loss/disk-exhaustion recovery are not claimed. Do not share credential-bearing data.

See the attached qualification record for tested source/binary identity and native input, plugin lifecycle, relocation and failure-recovery evidence. Distinct-version upgrade qualification becomes mandatory when the channel gains its next official version.