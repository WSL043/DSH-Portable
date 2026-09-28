# 1.0.0-alpha.2 原版成品验收 / Original-payload acceptance

2026-09-28。Windows x64、全新数据目录。实际交付源码 `82b7188bb489fb9207d8e1c3882a7a6d05f0f23c`，官方桌面 0.1.7-rc.2。

[最终原生成品验收与打包](https://github.com/WSL043/DSH-Portable/actions/runs/36397955605)使用一次性 Windows runner 的私有桌面，不操作用户前台。验收进程保留真实 Windows 用户环境路径，没有通过重定向整个 APPDATA 隐藏外部写入。

已通过：

- 官方安装器摘要与发布者签名；官方 EXE 签名、ASAR 摘要及版本；不运行安装器，不部署 app-update.yml。
- 原版欢迎页进入、编辑器实际输入、插件实际安装/启用/禁用，状态与插件执行结果一致。
- 整目录搬到中文与空格路径，草稿保留；再次启用和卸载测试插件，通过官方界面与真实依赖记录核对。
- 原生启动器及搬迁后进程正常退出，退出码 0；没有用超时强杀代替退出通过。
- 损坏暂存记录保留现版；切换后残留标记收敛；状态文件原子替换及占用保护；当前/上一/待切换保护；未受管目录和 junction 保留。
- Process Monitor 记录 23 个官方及子进程，未分类外部写入为 0。已分类写入仍包括系统记录、临时文件、IPC、拼写服务、官方协议和外部默认工作区，不代表零痕迹。
- 最终工作台、插件页截图人工检查：输入框和官方控件可见，测试插件卸载后从页面消失。不是暗色、所有 DPI 或跨机器视觉验收。

本轮确实发现并修正了原生库和 Node 编译缓存路径遗漏、插件启用状态验收时序、打包误取 7-Zip shim、依赖链接导致的目录移动方法问题、退出后的短暂目录占用及暂存所有权恢复问题。没有把失败的旧运行作为发布证据。

自动化：每小时从官方桌面 feed 检测，仅对新身份启动原生成品验收。已有不同版本目录时，额外要求随包更新器真实下载、暂存并冷启动升级；全部成功才写入新目录。初次通道为 rc.2，`upgrade.json` 明确记录 no-previous-qualified-channel，**没有两个不同版本升级的通过结论**。

源代码测试最近一次全量 927 项：913 通过、14 跳过、0 失败；最终更新器专项在 Windows PowerShell 5.1 与 CI PowerShell 通过，工作流 actionlint 通过。全量源码测试不代替以上成品证据。

完整限制见 [随包说明](../experiments/official-payload/PACKAGE-README.md)。尚不覆盖旧数据迁移、跨机器账号、真实模型请求、全部第三方插件、物理断电和磁盘耗尽。Alpha.2 公开探索允许这些明确边界，不能据此宣布 1.0 正式版完成。

English: acceptance uses the actual signed official Windows desktop payload and independent native launcher. Source and binary identity are recorded in the release qualification attachment. Input, fixture plugin lifecycle, relocation to a Unicode/space path, draft persistence, normal exit, staged-state recovery and outside-write classification passed. Initial qualification has no previous distinct official version, so no cross-version upgrade is claimed. Known upstream protocol/update UI/workspace differences and formal 1.0 gaps remain explicit.