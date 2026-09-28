# Official payload / 官方成品便携化

Target: **1.0.0-alpha.2**, Windows x64, fresh data only. Development work; not yet a release.

本路线替代 alpha.1 的源码覆盖构建。官方 EXE、ASAR 和运行库保持原字节；仅排除 `resources/app-update.yml`，让外置启动器独占程序升级。不得调用官方安装器。稳定版 0.7.x 不受此实验影响。

This route replaces alpha.1 source overlays. Preserve the official executable, ASAR and runtime bytes; exclude only `resources/app-update.yml` so the external launcher owns application updates. Never execute the installer. The stable 0.7.x line is unaffected.

## Release gates / 发布门槛

- Execute the original signed application on disposable Windows, keeping APPDATA/LOCALAPPDATA/USERPROFILE unchanged. Verify actual input, plugin lifecycle, restart, relocation and directory ownership. A minimal Electron fixture does not qualify this product.
- Removing updater configuration must prevent installer downloads and execution, including after a restart. The official manual update entry's error is an explicit alpha limitation, not a working updater.
- Inspect writes outside portable storage, protocol registration and the fixed host port. Record known differences; do not claim zero traces or coexistence without proof.
- Qualify launcher updates for source/hash/signature verification, busy-process exclusion, interrupted extraction, disk exhaustion and recovery. Never equate a listening port with a healthy owned workspace.
- Keep downloads/staging bounded. Program rollback does not reverse user-data migrations. Do not automatically downgrade shared data.
- Publish only after final-artifact acceptance; retain failed evidence. No automatic migration of alpha.1 or stable data.

先验证真实成品的数据边界，再实现启动器；未通过的门槛不得改成“已通过”。不导入旧版数据，不把 alpha.1 的补丁带入新包。已签名文件来自官方，不代表社区便携包获得官方签名或认可。

## Current probe

`qualify.ps1` runs only on a disposable GitHub-hosted Windows runner. It authenticates the reviewed rc.2 installer hash and Windows signature, extracts it without running it, removes the update configuration, and launches the original executable on a hidden desktop with explicit data roots. System profile paths remain unchanged. Evidence includes native process arguments, actual rendered page, data inventory and selected outside-directory checks.

This first gate is **not** full E1–E3 acceptance: all-process file/registry tracing, restart, plugin lifecycle and the long-running updater observation still need their own evidence. Never publish from this probe's green result alone.
