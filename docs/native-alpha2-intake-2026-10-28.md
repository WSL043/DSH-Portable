# 0.x Native：DSH 0.2.2-alpha.2 候选接入

核对日期：2026-10-28。候选状态与逐项证据见 [PR #222](https://github.com/WSL043/DSH-Portable/pull/222)；本页不代替绑定具体提交和成品摘要的资格记录。

## 产品边界

- **1.x 官方成品便携线**：保持官方 EXE、ASAR 和运行库字节，只允许既定 `resources/app-update.yml` 配置差异；不预装 Portable 插件、市场或页面桥，不修改内核。见[纯便携架构](pure-portable-architecture.md)。
- **0.x Native 稳定线**：稳定来源、默认插件和公开更新通道独立保留。
- **本候选**：仅审核 Native 的 [0.2.2-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2)，固定官方源码 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`。上游 Alpha 版本号不表示 Portable 1.x。Node 最低 24.9，当前固定 24.22.1。

## 已实现的适配

官方默认组合包的新导出归属由实际能力识别，旧内核继续复用 app-boot；不猜版本、不吞加载错误。历史格式适配只登记精确 Alpha2 源码和生成 lib 身份，未知版本/字段/不成对模型路由仍拒绝。真实继续探针按官方能力补注册独立 native executor，保留模型请求、中断及继续断言。

插件管理完整公开契约存在时保留官方管理器和更新确认；不再注入重复更新按钮。官方 Discover 仍是可选能力，按 profile 的实际启用状态选择入口；未启用或未知时保留现有发现与确认安装。Portable 只保留其外层诊断、显式修复和分组等已有能力，不另建一套官方会话或插件管理器。独立会话/图片插件候选不因此进入 1.x。

Preview 仅采用真实已发布的 image 0.1.17 / chat 1.5.19，核对 registry 归档、来源声明与固定 pnpm 锁；不改第三方 peer。稳定 pins/module/store 保持分离。对应运行字节与旧稳定版本相同，不将元数据声明当作新内核实物验收。

源码 client 复用既有锁和构建，规范化后的源摘要检查漏重建。平台可选依赖按生产闭包保留。体积以同口径 rc.3 成品比较：Windows/Linux app 增长约 9.31 MB，来自已核对的官方功能、依赖与素材；只调整 preview 的实测绝对预算，stable baseline、5% 相对限制和 1.15 guard 不变。

## MCP 安全边界

官方 Alpha2 源码/锁/npm 清单仍使用 client 2.2.0；当前官方 Windows feed 仍是已实物核验的 rc.3，签名 ASAR 中 client/core 均为 2.2.0。没有 Alpha2 签名桌面包的实物安全证明，1.x 继续受 [GHSA-6prh-2h8m-c8cw](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw) 阻断，等官方修复。

Native 继承既有 2.3.0 override。新增门槛检查实际安装树内的根目录、嵌套、alias 与 vendor MCP 清单：与生成锁精确匹配，客户端复用已有公告判定，受影响或未知版本拒绝；缺锁副本和越界链接拒绝。清单路径、版本及 SHA256 写入现有 staging receipt。Core 版本留证，不将客户端公告误套到 core。本门槛没有改 SDK 实现，也不是全面无漏洞证明。

## 最终资格

`37fd430e2e338202e2966d077038da96466de526` 的[完整实际验收](https://github.com/WSL043/DSH-Portable/actions/runs/40666325544)已通过 39/39，包括五平台构建与更新、两组 Windows 原生界面/生命周期、官方插件更新/卸载/重装、离线包与跨版本升级。测试先固定真实滚动和字体测量，再严格核对市场折叠；升级默认插件由目标包的既有 defaultsForProduct 验证，不误用稳定列表。

[精简机器可读证据](core-alpha2-historical-result-2026-10-28.json)记录各平台 job、实际 MCP 清单摘要、源码构建输入和历史 writer/继续结果。现有构建流程本已执行完整 writer 与继续探针，本次直接留存其真实结果，没有另建一套流程。Preview readiness 更新为当前精确源码与 npm 摘要，不再引用旧 0.1.7-rc.1。

上述 Node/历史探针使用本地确定性 adapter；不冒充真实模型请求、物理断电或实体第二台机器验收。1.x 安全阻断独立保留。本次只合入维护，不改稳定来源、公开通道或发布版本。
