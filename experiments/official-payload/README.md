# Official payload / 官方成品便携化

**1.0.0-alpha.2 · Windows x64 · 全新目录 / fresh directory.**

本路线替代 alpha.1 的源码覆盖构建。官方 EXE、ASAR 和运行库保持原字节；仅排除 `resources/app-update.yml`，由外置原生启动器独占整套桌面更新。不得运行安装器，不把旧 WebView 或 alpha.1 补丁带入新包。稳定版 0.7.x 不受影响。使用限制见 [随包说明](PACKAGE-README.md)。

This replaces alpha.1 source overlays. Official executable, ASAR and runtime bytes stay unchanged; only installer updater configuration is omitted. An external native launcher owns whole-desktop updates. Stable 0.7.x remains separate. See [package instructions and limitations](PACKAGE-README.md).

## 自动交付 / Automated delivery

每小时检查官方桌面更新源；身份没有变化时不启动 Windows 验收。新候选必须通过官方安装包摘要、发布者签名、原版输入框、插件安装启停、搬迁后草稿与卸载、进程退出、文件和注册表写入审计。已有不同版本通道时，还要从上一已验收版本通过随包更新器真正升级。全部通过后仅更新小型身份目录；程序仍直接从官方下载。

The hourly workflow skips Windows when the official identity is unchanged. Candidates require installer hash and publisher verification, real input and plugin lifecycle tests, relocation, normal exit and write tracing. When a distinct previous qualified version exists, it additionally exercises the shipped updater across those two official versions. Only successful runs promote the small catalog; official binaries are downloaded directly from the official CDN.

启动器启动时后台检查目录，验证、暂存新程序，下次完全退出再启动时切换。当前、上一版、待切换版受保护；更旧的受管程序可以回收，不删除外部工作区或未知文件。异常暂存不会阻止当前程序启动；程序保留不代表数据格式能够降级。

The launcher prepares updates in the background and activates only on a cold launch. Current, previous and staged programs are protected; older owned programs can be collected. External workspaces and unrecognized files are preserved. Invalid staging preserves the current program; retained binaries do not guarantee data downgrade compatibility.

## 验收边界 / Qualification boundaries

验收运行于一次性的 GitHub Windows runner 私有桌面，保留真实 APPDATA/LOCALAPPDATA/USERPROFILE，使用实际官方成品。证据随 CI 上传，发布包的 qualification.json 绑定源码提交、验收运行和二进制摘要。不得用模拟 Electron、端口可达或源码单测代替成品验收。

Acceptance uses the actual official artifact on a private desktop of a disposable GitHub Windows runner, with native Windows profile directories unchanged. Release qualification records bind the source commit, CI run and binary digest. A mock Electron, listening port or source test alone is insufficient.

Alpha 不宣称达到 1.0 正式版标准：跨机器账号、旧数据迁移、模型真实请求、所有第三方插件、物理断电和磁盘耗尽仍需专项证据。首次目录只有 rc.2，尚不能宣称真实的两个不同版本升级已经通过。官方应用内更新入口报更新源错误；dsh:// 注册、固定端口和外部工作区仍沿用官方行为，详见随包说明。

Alpha is not full 1.0 qualification. Cross-machine login, legacy migration, real model requests, all third-party plugins, physical power loss and disk exhaustion require separate evidence. Initial rc.2 catalog qualification does not prove a distinct-version upgrade. The in-app update entry reports a missing source; protocol registration, fixed port and external workspace behavior remain upstream-owned.