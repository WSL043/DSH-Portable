# 官方桌面适配准备 / Official desktop readiness

2026-09-14。工程决策与源码证据，不是成品兼容声明。

## 2026-09-25：产品路线决定

**路线目标：Windows/macOS 的下一代 Portable 以官方 Electron Desktop 为底座，不重写官方界面；现有 Native 宿主继续承担正式版和 Linux 交付，直到替代验收通过。** Portable 的产品边界是可搬迁的数据与运行环境、断网启动、可靠更新和故障恢复。Electron 通道将按官方整套桌面与绑定内核更新，Native 通道保留独立内核选择；两种更新模型不能混称为同一能力。

官方 RC2 发行物与同代 Native 候选的实际体积、Windows 重压缩与解包试验，以及 Electron 可选通道的瘦身边界见[体积审计](official-electron-footprint.md)。

执行顺序和停线条件：

1. **先保证已有用户能升级和恢复。** 对官方已发布的下一份不可变内核包，先用真实旧版 `descriptor v2` 会话证明读取和继续运行，再验两款默认插件的安装、实际更新、启停、卸载与重启，最后跑完整跨平台成品 CI。任一项失败，保留当前稳定锁，不推内核通道或正式版。当前 rc.2 的具体阻断见[接入记录](upstream-0.1.7-rc.2-intake.md)。
2. **将可靠性问题与架构迁移分开处理。** [#147](https://github.com/WSL043/DSH-Portable/issues/147) 的“运行中重连”与“安装一批插件后无法启动”按两个故障入口复现；用具体产品/内核版本、脱敏支持报告和隔离插件 profile 定位。发布修复前验证故障插件能暂停并恢复、用户会话和配置不被清除。现有报告不足以归因于 Portable、官方内核或某一个插件，不据此改写宿主。
3. **现在并行推进官方 Electron 开发线。** 以官方 `0.1.7-rc.2` Nightly 发行物为第一个实物样本，核对下载摘要、签名、安装器与更新器行为；在专用空目录验证搬迁、离线冷启动、账号状态、插件、退出恢复和目录外写入。和同机 Native 成品实测首次可用时间、后续启动、内存及压缩/展开体积。不得接入现有用户 profile。官方 Windows Nightly feed 已列出该版本，稳定 feed 当日返回 404；Nightly 存在不等于正式发行或适合二次分发。首轮实物与源码编译结果见[rc.2 验证记录](official-desktop-rc2-probe.md)。
4. **按证据晋级为可选版，再决定默认切换。** 如果官方原样发行物允许便携层掌握数据位置且只有一个更新所有者，签名仍有效，Windows/macOS 的实机迁移、离线和故障恢复通过，就发布独立的 Electron 试验版；完成旧数据升级与回退验收后才考虑替换默认宿主。Linux 仍由当前产品交付；缺少 Linux 官方桌面包时，不撤掉现有 Linux 宿主。若必须暗改签名覆盖文件、与官方自更新争抢、或无法安全搬迁账号数据，就暂停产品晋级并解决上游接口缺口，不把开发原型伪装成可发布成品。

内核迁移和用户故障修复决定现有产品何时发布；Electron 开发线立即并行，但不借开发线绕过正式版门槛。上游已经提供的通用功能按成品验收逐项接管，验证后才删除 Portable 补丁。

## 2026-09-17：0.7.0 Beta 与 Electron 开发线

本轮核对官方 `dsh-v0.1.6-alpha.2`，提交
`ddefc45fbc7f8e46dd73185e68295696d1297887`。`apps/desktop/package.json`
仍依赖 Electron `^44.0.0` 与 electron-updater。没有独立 WebView2 不代表没有
浏览器引擎，也不能据此断言完整包更小。

0.7.0 Beta 保留现有桌面宿主。官方 Electron 便携化使用独立实验目录、独立数据、
明确的开发版本名称；不覆盖用户的 Native 安装，不共用正在运行的 profile。
推进到可分发开发包前，必须完成下面既有门禁中的真实官方宿主启动、更新归属、
数据移动、插件接口与退出恢复。现有 Electron 隐藏窗口探针不是这个开发包。

默认插件按能力退出，而不是按上游版本号一次性移除：

| 能力 | 接管边界 | 移除前验证 |
| --- | --- | --- |
| 插件安装、启停、卸载 | alpha.2 官方 Plugin Manager | 市场发现入口可达，安装状态同步，卸载无残留入口，旧内核仍可管理 |
| 会话归档与恢复 | 已有官方归档能力优先 | 原插件入口迁移、关闭不重开、已有归档与删除确认行为 |
| 图片浏览 | 官方预览覆盖的常规能力逐步退让 | 标注、备注回填等差异功能未被覆盖时保留；用户可独立卸载 |

目录图描述用户拥有的数据与程序边界，不将每次上游内部目录改动都暴露给用户。
未来目录调整必须通过移动、升级、回滚和旧数据导入验收，不能只改 README。

本轮[官方源码事实](official-desktop-alpha2-facts.md)与[桌面产品调查](desktop-landscape-2026-09-17.md)
分别保留来源和未验证项。竞品已有独立运行时更新、便携 Node 等实现，不能把这些
当作独占优势，也没有证据证明官方桌面推出后它们必然失效。Portable 应持续证明
整个环境的迁移、首次断网启动、失败恢复，以及旧数据升级，而不是只比较桌面外观。

后续 Electron 开发包先固定一个官方提交，明确区分整套桌面更新与独立内核更新。
将全部写入路径、更新所有者和插件桥接列成可执行验收项，再决定是否推广为默认。
若需要修改官方签名内容，开发包应明确为社区构建，不能沿用官方签名身份。

## 当前决策

保留当前 Native/WebView 桌面与受验证的独立内核更新。先验证“原样官方桌面发行物 + 外部便携管理层”，不先 Fork Electron，也不让两套桌面同时操作同一插件 profile。没有验收证据前不更换默认桌面、不发布新兼容声明。

源码基线见 `official-desktop-baseline.json`。官方 `apps/desktop` 与 `apps/desktop-host` 已存在；Electron 和内核精确绑定，不能把官方整套版本选择描述为内核独立更新。当前 Portable 使用官方源码基线并附加适配，不是官方签名成品的逐字节再分发。

## 已知接入障碍与验收条件

| 边界 | 已知事实 | 原型必须证明的条件 |
| --- | --- | --- |
| 数据归属 | `src/paths.ts` 支持 DSH_HOME 下的 desktop/profile/pnpm 路径；不足以证明全部 Electron 状态便携 | 在隔离目录 A 启动、退出、移动到 B，再启动；会话、设置、插件、凭据可用；记录 Electron userData、缓存、日志及目录外写入，不把路径设定当实测 |
| 插件服务 | `desktop-host/config/desktop.cordis.patch.yml` 禁用 webserver；现有 bridge 与 market 依赖 webServer | 以宿主提供的结构化接口连接市场与维护能力；验证两默认插件；不为旧桥接额外开放一个无必要的 HTTP 服务 |
| 更新归属 | 官方 updater 以整套桌面包更新 | 原样发行物支持禁用或协调自更新；只有一个更新所有者；失败恢复不修改用户数据 |
| 版本选择 | 桌面与内核绑定 | 官方整套版本选择与 Native 独立内核选择分别建模；禁止混装；降级另验数据格式兼容 |
| 签名 | 源码有硬件签名及公证流程，私钥不属于 Portable | 取得真实发行物，记录哈希和签名验证结果；启动/迁移后不修改签名覆盖内容；我们的启动器不宣称获得官方签名 |
| 启动与体积 | 官方预展开运行时；Portable 有压缩运行时和 WebView2 路径 | 同机同版本、独立空目录对比首次可用时间、后续启动、峰值内存、ZIP 和展开占用；不以编译成功代替体验验收 |
| 恢复 | 官方有独立错误界面；插件变更失败不自动回滚 | 终止宿主、破坏可再生依赖后仍能进入修复；保留配置和会话；异常退出与物理断电证据分开 |

原型顺序：先审计路径和更新控制接口，再构建隔离官方桌面验证宿主通信，最后才接入便携管理能力。缺少可用发行物时可做源码原型，但签名复用仍标记未验证。任何一项不满足不切换默认实现。

## 可吸收工作与停止条件

第一阶段原型结果见 [隔离探针记录](../experiments/official-desktop/README.md)：实际 Electron 44 隐藏窗口跨目录保留 localStorage，四类查询到的 Electron 状态路径可随参数迁移；官方更新模块仍保留显式安装入口。当前不具备直接替换为原样官方桌面成品的验收证据，下一阶段需明确生产包的更新所有权控制。Cookie、跨机器凭据及完整 DSH 启动没有通过此探针验收。

1. 对照官方启动准备的复用条件与我们的 runtime readiness；只消除实际重复工作，使用同目录状态的 A/B 测量。
2. 对照官方 immutable runtime 裁剪规则；保留未知运行资产和许可证，不裁剪用户插件；成品验收失败即撤销该裁剪。
3. 对照宿主通信的背压、有界分块；只有测出当前传输瓶颈才替换协议，不增加并存的第三套桥接。
4. 对现有构建补丁逐项记录上游替代条件。上游已满足且成品回归通过才能删除，不能仅凭文本匹配不到就跳过补丁。

## 自动审查

现有 Dependency intake 的六小时计划增加独立只读任务，运行 `node scripts/check-official-desktop.mjs`。比较人工审查基线与当时 master 的不可变提交树，保留 desktop、desktop-host、desktop 前缀包的变化及最近十个 GitHub Release 附件清单。失败显式报错，不创建例行 Issue、不自动改审查基线、不安装上游代码、不触发产品发布。

范围限制：这不是整个依赖图的监控；其他共享包、外部 CDN、真实签名和接口语义仍需审查。基线只在人工读过差异后推进。重复报告同一尚未审查差异是保留待办，不代表已经吸收。

## 产品表达准备

定位为“可搬走、可选版本、可恢复的 DSH 工作环境”。后续发布素材优先展示目录迁移、版本选择、断网启动和修复恢复的实际结果。不要宣称官方认可、签名继承、任意版本安全降级或竞品即将失效。先记录来源与下载数据，不能用访问量推断安装用户或 Star 转化。

## English decision summary

Keep the qualified native desktop and independent core channel. Evaluate an unmodified official desktop payload behind Portable's environment management before considering a fork. Gate adoption on complete path ownership, a single updater, plugin integration, signature preservation, measured startup/footprint and recovery. Source review is not artifact qualification. No automatic shell replacement or release is introduced.

## Primary source evidence

All source references use the reviewed commit `c291e7961a515f6d7af9304e7fd1d257929aef26`:

- [Desktop architecture and limitations](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/apps/desktop/README.zh.md)
- [Profile paths](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/apps/desktop/src/paths.ts)
- [Host composition](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/apps/desktop-host/config/desktop.cordis.patch.yml)
- [Updater](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/apps/desktop/src/update-coordinator.ts)
- [Signing](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/apps/desktop/scripts/windows-sign.mjs)
