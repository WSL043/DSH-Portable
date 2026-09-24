# 官方 DSH 0.1.7-rc.2 接入记录

检查时间：2026-09-25。官方发布标签为 [`dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)，审查源码提交 `477b4f420553e8a52c2fbccc464d7561b239c443`。这里记录隔离候选的成品验收，不表示已经向用户发布。

## 已完成

- 独立的 `qualification/rc2-office` 候选锁定官方 npm 包的精确完整性摘要，并锁定与 rc.2 匹配的会话管理、图片查看预览包；离线默认插件存储与这两个不可变包一致。`main` 的稳定锁和公开内核通道未改动。
- 对官方 Office 解析依赖保留经核对的 `fflate@0.8.3` 覆盖。官方 rc.2 的 `@deepseek-ai/libreoffice-kit@0.1.1` 仍引入 `fflate@0.8.2`；实际构建失败后才补齐该约束。
- 官方 rc.2 的设置页已改用共享 store 的 `actions.open/openSection`。Portable 的设置入口改接官方动作，并在官方 onboarding 关闭设置弹层后由原生生命周期验收重新打开。没有复制官方设置状态。
- 仅按五个平台实际构建结果调整候选体积预算；稳定版预算不变。Windows 候选 ZIP 和解压体积相对上一成功基线分别减少约 27.6 MB、142 MB，不能把单个基础运行库预算增长误报为整个产品变大。
- [精确候选提交 `da9cb4a` 的完整成品 CI](https://github.com/WSL043/DSH-Portable/actions/runs/36067985239) **39/39 通过**：Windows 2022/2025 原生生命周期、完整离线包、插件页操作、组件更新、既有版本升级、macOS 双架构和 Linux 双架构均通过。该结果证明此候选包在受控场景可运行，不证明历史会话迁移安全。

## 发布阻断

官方 rc.2 的已发布包仍不能读取一类旧版 subagent `descriptor v2` 会话；见[上游讨论](https://github.com/deepseek-ai/deepseek-harness/discussions/7576)。当前官方 `master` 与 rc.2 同一提交，v0→v1 的[外层校验](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-format-v0-to-v1/src/validation.ts#L984-L998)和[载荷校验](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-format-v0-to-v1/src/payload-validation.ts#L3916-L3934)都只接受 v3。讨论中的双门修复尚在个人 fork，不能算官方已发布能力。Portable 没有这段迁移的扩展点；预改用户会话文件会绕过官方校验，不能作为发布捷径。

候选的 `preview-release-readiness.json` 明确写为 `blocked`，并绑定以上精确源码提交和 npm 完整性。稳定版也有独立的同类闸门，防止改用正式版号绕过检查。先前自动发现已隔离这份不可变包；工作流成功和默认插件验收均不能替代真实历史会话读取。

当前原生插件页验收覆盖默认图片插件的取消卸载、卸载、重新安装与启用，也覆盖重启后输入框可用；尚未在这份最终组合上逐项证明两款默认插件的实际更新与停用。下一次官方发布只有在精确包的 descriptor-v2 旧会话读取、后续会话继续执行、两款默认插件的安装/更新/启停/卸载/重启状态，以及跨平台完整 CI 全部通过后，才允许更新正式锁和发布产品。不要从本候选分支直接生成公开下载包。
