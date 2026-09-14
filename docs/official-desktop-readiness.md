# 官方桌面适配准备 / Official desktop readiness

2026-09-14。工程决策与源码证据，不是成品兼容声明。

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
