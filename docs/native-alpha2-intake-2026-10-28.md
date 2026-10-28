# 0.x Native：DSH 0.2.2-alpha.2 候选接入

本页只记录 0.x Native 源包候选和独立插件接口，不代表 Portable 1.x 官方成品便携线。1.x 保持官方 EXE/ASAR/运行库字节，不预装插件或市场；其状态见 [纯便携架构](pure-portable-architecture.md)。

官方已发布 [0.2.2-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2)（源码 f3803c96974ad4a94195fb97e5c637e9c2a3afe3）和 [0.2.1-rc.4](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.4)。alpha 将默认组合包清单从 app-boot 移至 [dsh-official-bundles](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-alpha.2/packages/util/official-bundles/src/index.ts)；Portable 的插件事务和旧会话导入预检共用按导出能力选择的解析器，旧内核仍复用原导出，不猜版本、不吞加载错误。最低 Node.js 24.9，当前固定 24.22.1 满足。本次在 [PR #222](https://github.com/WSL043/DSH-Portable/pull/222) 的隔离候选分支更新 preview 锁；稳定锁和公开通道不改。源码与真实 npm 字节核验不等于整套 alpha 产品验收，成品资格单独绑定候选提交。

本次只读核对时，[Windows 官方 nightly feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml) 仍是 0.2.1-rc.3；GitHub/npm alpha 不等于已交付的新桌面成品。alpha 与 rc.4 的官方 MCP 清单仍固定 client 2.2.0，处于 [GHSA-6prh-2h8m-c8cw](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw) 影响范围，不能据发布名称解除 1.x 安全阻断，也不覆盖官方 SDK。 0.x Native 已有 override 将实际安装的 MCP client/core 锁到修复版 2.3.0，preview staging 继承它；配置继承不能代替新 Alpha 成品的依赖安全验收。1.x 使用官方签名 ASAR，不应用这组 override，仍等官方修复。

Alpha compatibility preparation follows the official export owner by capability and retains legacy app-boot support. It does not promote the alpha runtime, qualify a new desktop payload, or remove the upstream MCP security hold. Full candidate qualification must bind the immutable source and built artifact on an isolated review branch.

候选同时复用官方公开插件槽位与版本更新能力，完整能力存在时原样保留官方管理器，不再注入旧更新按钮/额外刷新；部分公开契约缺失时明确拒绝。官方实验市场属于可选组合包；Portable 既有首次引导策略可启用它并保留后续关闭选择，此次不新增强开。按当前 profile 的既有启用检测切换高级/市场入口，未知、关闭或失败保留原发现与确认安装，避免把槽位声明误当市场已可用；正常已装插件更新由官方负责，Portable 保留分组总开关、诊断和显式修复保全。

新版历史读取仅登记精确 0.2.2-alpha.2 的源码与生成 lib 身份，不扩大到相邻 alpha；真实原库拒绝 v2，经既有补丁后接受合法 one-shot/continuable v2，仍拒绝未知版本、字段和不成对模型路由，输入不变。完整旧 writer/继续验收仍是独立门槛，不能由本次 schema 单测代替。候选核验修正摘要别名误差和 review 锁与 main 冻结 SHA 的测试耦合，main 固定来源保护不变。

市场默认 client.js 以现有锁和工具实际重建；既有规范化步骤记录 LF 一致的源输入摘要，测试只读检查漏重建，压缩参数名和重复执行保持幂等。不新增打包流程或策略文件。

Public plugin slots preserve the official manager and regular update UI. The existing profile activation check controls the Advanced/Discover fallback; unknown or inactive optional-market state keeps discovery and the existing confirmation/install path. Exact migration identities and the existing full historical-writer qualification remain separate gates. The rebuilt client is checked against its normalized source inputs without changing release channels.

**默认插件声明门槛已解除，完整 alpha 交付仍待验收：** 发布者新增 [image 0.1.17](https://registry.npmjs.org/dsh-image-viewer/0.1.17) 和 [chat 1.5.19](https://registry.npmjs.org/dsh-chat-manager/1.5.19)，明确声明支持 0.2.2-alpha.2 与 Cordis 4.0.6-alpha.1。候选只更新 preview pins、PREVIEW_DEFAULT_PLUGINS 和 preview store；真实 registry 归档摘要、来源声明的摘要/仓库/提交绑定及固定 pnpm 锁刷新已核验，未改写发布包或豁免 peer。两个包的运行字节分别与 0.1.16、1.5.18 相同，但旧候选 beta 与新正式版之间不能据此视为小改动。候选完整界面、官方更新确认、卸载/重装和历史 writer 继续仍须独立实物验收，尚不允许晋级或发布。

Published image 0.1.17 and chat 1.5.19 now declare alpha.2 compatibility. The candidate adopts their real verified archives only in its preview pins/module/store. This removes the declaration hold, not the complete UI, historical-writer or product qualification gates. No peer exemption or republished package bypasses them.

## 实际候选门槛

0511814 的真实继续会话探针已走过模型请求与中断继续断言；此前缺少官方拆出的 native executor 只在探针中按能力补注册，未改官方实现。候选仍未通过整套成品验收：Windows/Linux 受旧 candidate 绝对体积预算阻断，macOS 实际文件更新失败且原 workflow 未保留细因。

已用同口径 rc.3 成功成品逐包比较：Windows/Linux app 约增加 9.31 MB，主要为官方功能、依赖闭包和详情素材。Office、语音、sharp、pnpm 无增长，没有混入异平台原生包。仅据该实际差异修订 preview 的五个数值，stable 预算、baseline、5% 相对限制和 1.15 guard 不变；不是以体积门槛通过代替运行资格。macOS 下一轮只新增现有脱敏 update-smoke-evidence.json 的失败留证，更新命令及断言不变。

完整 writer、实物更新、安全及发布 readiness 继续独立核验。没有修改公开通道或发布版本。
