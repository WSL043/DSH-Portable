# 官方成品便携化 / Official payload portable layer

Windows x64 的 1.x 开发线，当前启动器标识仍为 `1.0.0-alpha.5`，与 0.x Native 稳定版分开维护。2026-10-28 本轮仅维护和验收，不创建 Release、草稿、标签或更新通道。进度、实物身份和未完成项见 [本轮记录](../../docs/one-x-maintenance-2026-10-23.md)。

## 当前实现

- 官方 EXE、ASAR、运行库保持安装包字节；唯一允许改写的是 `resources/app-update.yml` 更新配置。
- 默认打包不带 Portable 插件、市场、ASAR adapter 或更新桥。已经公开的旧 alpha.5 曾携带两款默认关闭的插件；它与当前开发代码不能混称为同一交付物。
- 原生启动器设置 `DSH_HOME=data/dsh-home`、`DSH_AGENTS_HOME=data/agents`、Electron userData 和原生扩展缓存，并临时管理 `dsh://` 协议，退出还原注册表。
- 完整包携带已展开的官方桌面；Bootstrap 轻量包从已验收目录选择版本，验证安装包大小、SHA-512、Authenticode 发布者后展开。
- 更新由外置 PowerShell 引擎下载、验证和暂存；启动器和引擎用 activation lock 排除启动/切换竞态。提交后清理失败只记录延后，不撤销已成功的更新。
- 离线文件更新、同版本修复、上一程序回退和中断恢复共用原引擎；外置启动器按住 Shift 或 `--maintenance` 打开入口，随包保存已验收索引快照。数据/schema 不随程序回退，固定修复备份槽不叠加。操作见 [运维说明](../../docs/pure-portable-operations.md#离线更新修复和程序回退)。
- 当前与上一版受保护；更旧目录必须有匹配的完整树摘要收据才允许自动清理。旧收据、未知目录、用户新增或修改的文件保留。

## 验收与发布边界

手动打包默认只生成 Actions 产物；`publish_draft=false`。桌面通道手动运行默认 `publish_channel=false`，线上工作流目前仍为 `disabled_manually`。不要仅为追赶上游而启用或发布。具体操作见 [通道运维](../../docs/pure-portable-operations.md)。

真实验收使用官方签名成品，覆盖页面输入、插件生命周期、正常退出、搬迁、跨版本更新及文件/注册表边界；源码单测、同版本检查、端口可达都不能代替这些结果。测试结果按场景和成品摘要报告。

安全检查直接读取实际 `app.asar` 内全部 MCP client/core 清单，验证其 entry integrity 并绑定整份 ASAR 摘要。`--report-only` 只保留证据；发布另须验证 `qualificationAllowed === true` 及同次运行、源码、候选和包的绑定。该检查只覆盖指定公告，不是全面安全证明。

当前官方 Windows `0.2.1-rc.3` 实物 MCP client/core 为 `2.2.0`，命中 [GHSA-6prh-2h8m-c8cw](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw)，发布资格阻断。保留官方字节，等待官方修复成品后重新验收。

旧 Native 历史/设置/工作区的显式迁入、独立 Linux 到 Windows 2022/2025 的两轮实际桌面验收，以及下载/更新中断恢复见 [数据与恢复记录](../../docs/one-x-data-recovery-2026-10-23.md)。默认不迁凭据、浏览器登录或旧插件 profile；真实跨机账号登录、模型请求、任意第三方插件、物理断电和实际填满磁盘仍无本轮证据。保留旧程序不保证新版数据能降级。

官方默认 `Documents/deepseek-harness/default-workspace` 及用户另选工作区仍可在便携根外；当前写入审计不等于全应用零外写保证。

The current development line preserves official payload bytes except `app-update.yml`, ships no default Portable plugins, and keeps all managed homes under the portable root. Manual workflows qualify artifacts by default; publication is opt-in and independently security-gated. The signed Windows 0.2.1-rc.3 payload contains affected MCP 2.2.0, so it remains blocked from publication. Source tests and runtime acceptance do not establish full 1.0 or comprehensive security qualification.
