# 官方源码增量核查（2026-09-28）

核查快照：官方 `master` 为 `21638c56315ae6a2b552d6091945d3144c9af32e`，覆盖 9 月 27 日 00:00 UTC 之后的提交。npm `latest`、`next` 和 GitHub 最新发布仍为 `0.1.7-rc.2`；源码活动不等于已有新的可安装包。本记录不推进产品锁，不将未发布源码当作已交付能力。

## 本次发现与接入决定

| 官方变化 | 实际范围 | Portable 处理 |
| --- | --- | --- |
| [插件页交互 #5233](https://github.com/deepseek-ai/deepseek-harness/commit/a8fc0b3f16bee57cb7fc9481456094771c245c10) | 官方 UI/store 的首载骨架、刷新失败提示和状态反馈 | 后续兼容内核优先直接复用，不复制另一套插件状态机。当前锁定包尚不包含此提交。 |
| [registry 键盘焦点](https://github.com/deepseek-ai/deepseek-harness/commit/69b55fb53b562c7eee17ef2caadc407b9762fd9b)、[输入焦点颜色](https://github.com/deepseek-ai/deepseek-harness/commit/142b65524155c5959fd5698497ee5db92ac6b1ef) | UI 键盘行为和共享样式，不是安装/卸载后端接口变更 | 下一核心组合的插件页验收覆盖这些交互；不据此改动现有安装协议。 |
| [PTY 提示符尾部宽限](https://github.com/deepseek-ai/deepseek-harness/commit/76a2b7a7991f8db272c09a0d18ee4174456dfb10) | 终端等待行为；配置默认值为零，保持原行为 | 属于官方终端能力，随经过资格验证的内核接入；不是 Portable 会话格式修复。 |
| [plugin-manager Git 环境隔离](https://github.com/deepseek-ai/deepseek-harness/commit/09ecc4f423e3bf0522df4f2fc06bb88b41fa4153) | 测试清理宿主 Git 环境变量；上游说明明确产品行为未变 | 不把测试通过宣传为用户 Git 安装问题已修复，不移植成未经验证的产品补丁。 |

## 历史会话门槛仍然有效

当前 master 的 [外层事件校验](https://github.com/deepseek-ai/deepseek-harness/blob/21638c56315ae6a2b552d6091945d3144c9af32e/packages/session/session-format-v0-to-v1/src/validation.ts#L198-L205) 对 v0 历史事件拒绝非 v3 descriptor；[载荷校验](https://github.com/deepseek-ai/deepseek-harness/blob/21638c56315ae6a2b552d6091945d3144c9af32e/packages/session/session-format-v0-to-v1/src/payload-validation.ts#L955-L963) 也只接受版本 3。两个文件在本次时间窗没有新提交。不能退掉当前 alpha.1 的精确摘要绑定兼容处理，也不能认为 rc.2 已具备历史 v2 迁移能力。

## 依赖 PR 重复创建已修复

[#149](https://github.com/WSL043/DSH-Portable/pull/149) 暴露稳定依赖接入遗漏：预览监测读取了 `rejected-official-candidates.json`，普通 `latest` 接入却没有读取，导致同一被隔离 rc.2 再次成为 PR。

`4c32c1d` 让普通接入同样校验隔离版本和不可变完整性。匹配时不改锁、不创建 PR、不启动产品构建；完整性漂移报错；更新的未隔离版本仍可评估。27 项上游测试与37项工作流/打包合同测试通过。[真实线上运行 36336796416](https://github.com/WSL043/DSH-Portable/actions/runs/36336796416) 返回 `blocked:true, changed:false`，没有重开 PR。#149 已关闭，自动化分支已删除。

默认插件监测还发现图片 `0.1.3-beta.3`、会话 `1.5.2-beta.5`；两者均为预发布候选，未替换本次稳定交付已验收的 `0.1.2`、`1.5.1`。

原始响应、提交文件摘要和精确验证源码保存在 `build/native-076-qualification/upstream-latest`。桌面端自动报告的旧基线是 9 月 14 日，不能把其463个累计文件变化当成这几小时新增内容。

## 官方桌面从 rc.2 到 master 的单独增量

[精确比较](https://github.com/deepseek-ai/deepseek-harness/compare/477b4f420553e8a52c2fbccc464d7561b239c443...21638c56315ae6a2b552d6091945d3144c9af32e) 为155个提交。API变更文件列表有300条上限，因此对关键路径另按两端不可变提交直接比较 blob，而不把截断列表当完整审计。

- 官方新增 Desktop-only 的产品分析链路。Host RPC 为 `productAnalytics/enabled`、`productAnalytics/report`，已有认证流新增 `productAnalytics/watchPolicy`；账号层 `getDeviceIdentity()` 读取已有设备/用户标识和系统版本，不创建新设备身份或返回凭据。当前 desktop bundle 默认开启收集，没有用户可见开关。事件包含部分会话、模型、插件、登录和更新元数据，事件定义不含对话正文、API key或令牌；插件安装地址另有脱敏。
- 主进程新增 `DSH_CLIENT_VERSION` 传入与遥测回调；安装更新前新增最多1秒的本地遥测等待。没有在已审 updater 文件中发现更新算法替换。
- `paths.ts`、`host-process.ts`、`dev.ts`、`desktop-build-paths.mjs`、`desktop-auto-update-environment.mjs` 和 `apps/desktop-host/src/index.ts` 的两端 blob 相同。rc.2 覆盖层固定的 `main.ts`、`update-coordinator.ts` 已改变，旧覆盖层不能直接用于 master。

接入决定：本次 Native 0.7.6 不加载这套新 desktop profile，因此不为它新增依赖或遥测。Electron 后续适配时，产品分析应有清楚、可关闭的选择，不直接继承无界面开关的默认收集；分析失败不得影响启动、登录和更新。这是后续接入条件，不是声称该实现已交付。保留官方账号和核心能力，重新验证变更的覆盖锚点；不以旧 rc.2 成品测试替代新组合验收。

源码证据：[desktop bundle](https://github.com/deepseek-ai/deepseek-harness/blob/21638c56315ae6a2b552d6091945d3144c9af32e/packages/bundle/web-app/cordis.patch.yml)、[事件定义](https://github.com/deepseek-ai/deepseek-harness/blob/21638c56315ae6a2b552d6091945d3144c9af32e/packages/client/product-analytics/src/events.ts)、[Desktop main](https://github.com/deepseek-ai/deepseek-harness/blob/21638c56315ae6a2b552d6091945d3144c9af32e/apps/desktop/src/main.ts)。本地完整记录为 `upstream-latest/desktop-rc2-delta/summary.md`，只证明源码核查，没有宣称运行过这个新桌面版本。
