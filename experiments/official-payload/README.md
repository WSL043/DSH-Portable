# Official payload / 官方成品便携化

**1.0.0-alpha.3 · Windows x64 · 全新目录 / fresh directory.**

2026-09-28：按用户决定，1.0 Alpha 改为开发构建与 Release 草稿，不在公开 Releases 列表展示。后续工作流默认只生成草稿。Development alpha artifacts are retained as drafts, not public releases.

官方 EXE 和运行库保持原字节；ASAR 主进程增加有限的协议入口与更新传输适配，记录修改前后摘要。目标是保持官方操作体验与便携边界，不复制官方界面或任务关闭逻辑。每次官方成品变化重新验证，适配位置变化时停止投递。稳定版 0.7.x 不受影响。使用限制见 [随包说明](PACKAGE-README.md)。

Official executable and runtime bytes stay unchanged. A narrow ASAR adapter connects protocol entry and update transport while retaining the official UI and task shutdown coordinator. Original and adapted hashes are recorded; changed upstream contracts stop delivery. Stable 0.7.x remains separate. See [package instructions and limitations](PACKAGE-README.md).

## 自动交付 / Automated delivery

每小时检查官方桌面更新源；身份没有变化时不启动 Windows 验收。新候选必须通过官方安装包摘要、发布者签名、原版输入框、插件安装启停、搬迁后草稿与卸载、进程退出、文件和注册表写入审计。已有不同版本通道时，还要从上一已验收版本通过随包更新器真正升级。全部通过后仅更新小型身份目录；程序仍直接从官方下载。

The hourly workflow skips Windows when the official identity is unchanged. Candidates require installer hash and publisher verification, real input and plugin lifecycle tests, relocation, normal exit and write tracing. When a distinct previous qualified version exists, it additionally exercises the shipped updater across those two official versions. Only successful runs promote the small catalog; official binaries are downloaded directly from the official CDN.

官方更新界面调用便携传输层，下载、验证并暂存新程序。用户确认后，官方协调器关闭任务和宿主，便携启动器等待退出后切换程序并重启。当前、上一版、待切换版受保护；更旧的受管程序可以回收，不删除外部工作区或未知文件。异常暂存不会阻止当前程序启动；程序保留不代表数据格式能够降级。新版使用独立 v2 目录，避免向 alpha.2 推送不兼容的适配程序。

The official update coordinator uses portable download and staging, then shuts down tasks and the host before handing restart to the launcher. Current, previous and staged programs are protected; older owned programs can be collected. External workspaces and unrecognized files are preserved. Invalid staging preserves the current program; retained binaries do not guarantee data downgrade compatibility. A separate v2 catalog protects alpha.2 from incompatible payloads.

## 验收边界 / Qualification boundaries

验收运行于一次性的 GitHub Windows runner 私有桌面，保留真实 APPDATA/LOCALAPPDATA/USERPROFILE，使用实际官方成品。证据随 CI 上传，发布包的 qualification.json 绑定源码提交、验收运行和二进制摘要。不得用模拟 Electron、端口可达或源码单测代替成品验收。

Acceptance uses the actual official artifact on a private desktop of a disposable GitHub Windows runner, with native Windows profile directories unchanged. Release qualification records bind the source commit, CI run and binary digest. A mock Electron, listening port or source test alone is insufficient.

Alpha 不宣称达到 1.0 正式版标准：跨机器账号、旧数据迁移、模型真实请求、所有第三方插件、物理断电和磁盘耗尽仍需专项证据。同版本检查不能证明两个不同版本升级。具体通过项以成功运行的 qualification.json 为准。固定端口与外部工作区限制见随包说明。

Alpha is not full 1.0 qualification. Cross-machine login, legacy migration, real model requests, all third-party plugins, physical power loss and disk exhaustion require separate evidence. A same-version check does not prove a distinct-version upgrade. Consult qualification.json for passed scenarios and package instructions for fixed-port and external-workspace limitations.
