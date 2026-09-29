# Official payload / 官方成品便携化

**1.0.0-alpha.4 · Windows x64 · 纯便携模式为默认 / pure portable mode is the default.**

官方桌面成品零改动（仅按架构约定改写 `resources/app-update.yml`）；纯模式不调用、不打包旧 ASAR adapter、desktop adapter、更新桥、默认插件或市场文件。仓库中的旧适配路线保留到阶段 3 统一删除，不再作为默认或交付路线。稳定版 Native 线不受影响。纯便携实现仍处于阶段 2 开发状态，不能据此宣称架构已验收。

The official desktop payload remains byte-for-byte unchanged except the permitted `resources/app-update.yml` rewrite. Pure packaging does not invoke or ship the legacy ASAR/desktop adapters, update bridge, default plugins or marketplace. Those legacy files remain only until their planned Phase 3 removal; they are no longer the default or delivery path. The stable Native line is separate. Phase 2 remains under development and is not yet architecture acceptance.

## 自动交付 / Automated delivery

默认启用两款普通插件：会话管理和 Portable 插件市场，不再默认携带图片查看器。从官方「插件」页的工具栏打开市场，沿用稳定版的图文浏览和截图预览；点击安装进入官方安装窗口，管理进入官方插件详情。市场不另设侧栏入口。首次离线初始化之后不重置用户选择。

官方当前未提供工具栏扩展点，因此适配器与稳定版一样，仅在插件管理客户端增加一个工具栏 slot，把官方的打开安装窗口、填写安装来源和刷新回调交给市场插件。安装、启停和卸载仍由官方管理器负责。主进程和插件管理客户端两处修改前后摘要均写入 provenance；上游定位片段变化时停止交付。

Two ordinary plugins are enabled initially: session management and the Portable market. The market provides discovery and previews; official services own installation and activation. Offline initialization runs once and never resets user choices. The image viewer is no longer included by default.

每小时检查官方桌面更新源；身份没有变化时不启动 Windows 验收。新候选必须通过官方安装包摘要、发布者签名、原版输入框、插件安装启停、搬迁后草稿与卸载、进程退出、文件和注册表写入审计。已有不同版本通道时，还要从上一已验收版本通过随包更新器真正升级。全部通过后仅更新小型身份目录；程序仍直接从官方下载。

The hourly workflow skips Windows when the official identity is unchanged. Candidates require installer hash and publisher verification, real input and plugin lifecycle tests, relocation, normal exit and write tracing. When a distinct previous qualified version exists, it additionally exercises the shipped updater across those two official versions. Only successful runs promote the small catalog; official binaries are downloaded directly from the official CDN.

官方更新界面调用便携传输层，下载、验证并暂存新程序。用户确认后，官方协调器关闭任务和宿主，便携启动器等待退出后切换程序并重启。当前、上一版、待切换版受保护；更旧的受管程序可以回收，不删除外部工作区或未知文件。异常暂存不会阻止当前程序启动；程序保留不代表数据格式能够降级。新版使用独立 v2 目录，避免向 alpha.2 推送不兼容的适配程序。

The official update coordinator uses portable download and staging, then shuts down tasks and the host before handing restart to the launcher. Current, previous and staged programs are protected; older owned programs can be collected. External workspaces and unrecognized files are preserved. Invalid staging preserves the current program; retained binaries do not guarantee data downgrade compatibility. A separate v2 catalog protects alpha.2 from incompatible payloads.

## 验收边界 / Qualification boundaries

验收运行于一次性的 GitHub Windows runner 私有桌面，保留真实 APPDATA/LOCALAPPDATA/USERPROFILE，使用实际官方成品。证据随 CI 上传，发布包的 qualification.json 绑定源码提交、验收运行和二进制摘要。不得用模拟 Electron、端口可达或源码单测代替成品验收。

Acceptance uses the actual official artifact on a private desktop of a disposable GitHub Windows runner, with native Windows profile directories unchanged. Release qualification records bind the source commit, CI run and binary digest. A mock Electron, listening port or source test alone is insufficient.

Alpha 不宣称达到 1.0 正式版标准：跨机器账号、旧数据迁移、模型真实请求、所有第三方插件、物理断电和磁盘耗尽仍需专项证据。同版本检查不能证明两个不同版本升级。具体通过项以成功运行的 qualification.json 为准。固定端口与外部工作区限制见随包说明。

Alpha is not full 1.0 qualification. Cross-machine login, legacy migration, real model requests, all third-party plugins, physical power loss and disk exhaustion require separate evidence. A same-version check does not prove a distinct-version upgrade. Consult qualification.json for passed scenarios and package instructions for fixed-port and external-workspace limitations.
