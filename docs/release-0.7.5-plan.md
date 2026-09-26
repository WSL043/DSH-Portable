# 0.7.5 Native 正式基线

2026-09-26。版本字段已切到 `0.7.5`，用于对正式锁进行构建与验收；尚未发布、没有发布标签。Electron `1.0.0-alpha.1` 是独立的新目录试用版，不作为本版升级验收。

## 范围与状态

| 项目 | 本次处理 | 发布前证据 |
| --- | --- | --- |
| 现有用户基线 | 保持 DSH `0.1.7-alpha.1`、会话插件 `1.5.1`、图片插件 `0.1.2`，不用 RC 候选插件混装 | 最终组合的新装、从 0.7.4 升级、默认插件操作与完整平台 CI |
| 窗口模式 #148 | 视图菜单分别展示最大化/还原和 F11 全屏；使用现有系统最大化和窗口状态保存 | 新增原生验收检查工作区域、最大化→F11→Esc→还原；多屏/DPI视觉仍待验收 |
| 插件可靠性 | 累积的实际运行状态提示、重启后确认、失败恢复及官方事务交接进入本基线 | 两款默认插件实际更新、启停、卸载、重装和重启后输入可用 |
| 故障恢复 | 独立 Recovery 检查、暂停及恢复启动插件；不以包可解析宣称插件运行正常 | 失效社区插件隔离后可启动、原配置及会话保留 |
| CI | 修正 Electron 测试夹具对 macOS 临时目录别名的误用；保持目录链接保护 | macOS 两架构运行现有全部契约；不得引用 Windows 测试替代 |
| 历史会话 | **阻断**：公开 0.7.4 所含精确 alpha.1 也拒绝 descriptor v2 | 官方精确依赖闭包可读取真实历史数据并继续执行后才能解除 |

## 本轮上游核对

- DSH 最新发布仍为 `dsh-v0.1.7-rc.2`，master 为 `477b4f420553e8a52c2fbccc464d7561b239c443`。插件安装中断恢复、快捷键、归档筛选、模型切换等官方能力已有，但现有历史数据阻断尚未解决；保留 RC2 隔离，不复制这些核心功能到 Portable。
- Codex 的 `rust-v0.157.0` 发布说明包含后台服务恢复选择、暂时性上传失败重试、代理/网络策略一致性与未发送草稿恢复。这些是 CLI/App Server 的公开能力，不能当成 Codex 桌面源码证据。Portable 可借鉴可解释恢复和有界重试；聊天草稿、模型和联网工具行为仍由 DSH/对应插件管理。本批不增加新的聊天补丁或通用重试层。
- Codex 订阅插件 `v2.2.0` 已发布可选短时额度等待；不属于 Portable 默认插件，不捆绑、不替用户启用。接入优先复用官方插件页。

来源：[DSH RC2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)、[Codex 0.157.0](https://github.com/openai/codex/releases/tag/rust-v0.157.0)、[订阅插件 2.2.0](https://github.com/WSL043/dsh-codex-subscription/releases/tag/v2.2.0)。

## 历史格式诊断证据

下载公开 `v0.7.4/DSH-Portable-windows-x64-offline.zip`，与发布 checksums 校验一致：`67af5ca6be78b1bda990c2121c7431d6a9f841fe4aacb021fb6e4226165962db`。在独立目录解包；运行时胶囊摘要 `b7633b3e8ca8fe0000af3292904ba58b2c8149ab28dd1cf7b62eecf1683df1d2`。CLI 与 session-format-catalog 均为 `0.1.7-alpha.1`，避免 npm 范围解析到 RC 子包造成漂移。

使用该包的 `createSessionFormatCatalogWithChildren([])`、`recovery: strict`、`validation: current`，输入 version 0 的合成格式夹具：空会话与 descriptor v3 均成功转换到格式 4；仅将 descriptor 改为 v2 后抛出 `subagent/descriptor 0 uses unsupported descriptor version 2`。三种输入对象均未被修改。最初使用不带历史子会话事实的默认 catalog，三个夹具都被其前置条件拒绝；改用官方提供的显式空子列表 API 后才取得上述有效对照。

本实验是针对已发布包的确定性拒绝复现，不是真实历史会话全验收，也不说明全部普通会话不可用。详细本地输出：`build/native075-baseline/format-result.json`。`stable-release-readiness.json` 保持 blocked，不通过更换产品版本绕开数据兼容要求。

## 剩余工作

### 2026-09-27 执行清单

- [x] Portable 诊断区分历史 descriptor-v2 不兼容与插件预检失败，保留回滚结果；提交 `7dc6a33`，35 项定向测试通过。
- [x] 隔离旧版 writer 依赖并锁定版本；真实 Session/descriptor/事件打包器生成的测试父子会话通过实验读取对照。见 [实验记录](../experiments/descriptor-v2/README.md)。这不是用户历史数据或完整旧宿主验收。
- [x] 恢复的子会话通过实际 AgentLoop 与本地确定性适配器继续执行，模型请求保留父子工具结果；官方 JSONL 保存重开、未结束回合日志恢复及再次继续通过。原始历史文件哈希不变；不是断电测试。候选构建仅对精确 alpha.1 摘要应用只读迁移，产物记录补丁输出摘要，发布证据必须绑定该标识；三平台构建加入同一验收。见 `experiments/descriptor-v2/continuation-probe.mjs` 与 `scripts/verify-historical-session.mjs`。最终成品资格仍在下项。
- [x] CI `36261569614` Windows 2025 默认插件检查未展开工作区，失败截图显示真实工作区折叠；共享脚本 `9f29751` 增加官方行展开操作，CI 已更新引用。本机隔离公开 0.7.4 包完成亮暗原生操作复验，报告 `build/native075-baseline/workspace-expansion-acceptance.log`；图片回填、草稿、归档/恢复、确认删除、失效归档清理、启停插件与输入均通过，检查了亮色归档页与暗色输入截图。此项只关闭驱动修复，本次 0.7.5 精确产物仍待验收。
- [x] 同次 CI Windows 2025 注入卡顿的 HTTP 时序断言失败后补齐时间诊断，不放宽原断言。本机 HTTP 21ms 完成，早于卡顿结束约 2.77s。复用相同原 CI 产物的定向运行 `36262912793` 在 Windows 2022/2025 完整通过；2025 探测 70ms，早于注入卡顿结束约 3.64s。原失败未稳定复现，保留为时序观察项，不宣称产品根因已修复；最终成品继续保留该检查。
- [ ] 最终提交的跨平台成品 CI、升级/回滚、两款默认插件操作，以及 Windows 亮暗原生视觉验收。未完成前不发布。

本轮没有修改用户安装或历史会话文件。诊断改善、实验读取成功和产品资格分别记录，不互相替代。

本轮隐藏 Windows 原生窗口检查已复现并修复最大化客户区越界 7 像素：自绘标题栏保留系统缩放边框，但 `WM_NCCALCSIZE` 在最大化时必须将客户区限制在目标屏幕工作区。修复后客户区为 `(0,0,2560,1440)`，与测试桌面工作区一致；最大化→F11→Esc 回到最大化→还原原尺寸通过。检查使用公开 0.7.4 的独立解包副本、独立运行时缓存以及本轮源码编译的窗口程序；不是完整 0.7.5 成品验收。私有桌面没有 Explorer 任务栏，因此真实任务栏、多屏、DPI 和最终包视觉仍待验证。证据：`build/native075-baseline/window-result.json`。

市场新增审查见 [2026-09-26 intake](market-upstream-review-2026-09-26.md)。不以更新参考版本号代替逐项契约比对。

原长期任务仍由维护清单承接：WebView2 旧缓存使用保护、pnpm 清理后断网重建、旧版本更新资产引用回收、更新/导入中断恢复、跨机凭据及 Electron 迁移。本版不会将这些未完成项写成已实现，也不等待所有长期研究才能逐批提交可验证修复。正式发布前需解除数据阻断，并取得最终提交的完整成品结果。
