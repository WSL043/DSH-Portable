# 发布阶段 / Release stages

DSH-Portable 从新版本开始遵循通用预发布阶段：

- **Alpha** 用于持续开发；功能可能尚未完成、存在明显不稳定，或在部分系统无法启动。
- **Beta** 只用于主要功能已经可用、可以进入真实用户测试的构建。
- **RC** 只用于已经基本达到正式发布标准、仅等待最终验证的构建。
- **稳定版**是面向一般用户推荐和支持的版本。

GitHub Release 只表示用户可以下载这个构建，不表示一次开发任务已经完成，也不表示预发布版本已经稳定。历史版本名称早于本规则，不能作为以后命名的先例。阶段提升必须产生新构建和新的成品级证据，不能因为一个开发任务结束就把 Alpha 改称 Beta 或 RC。

## 核心、Market 与 Portable 的独立策略

官方 DSH 核心、dsh-market 和 DSH-Portable 是三个独立的发布对象：

- **核心（官方 DSH）**：定期检查只验证官方可安装包、完整性和对应提交。通过 Windows、macOS、Linux 的成品验收后，核心可以独立进入自己的更新通道；核心上游有新版本不会触发 Portable 发布。
- **Market**：上游检查只把新版本放入人工审查 inbox。只有适用于 Portable 的改动才会在失败测试、兼容性检查和人工审查后移植到随附的 Market；Market 上游版本不会自动合并，也不会自动发布 Portable。
- **Portable**：Portable 自己决定版本号和计划发布节奏。已接受的核心或 Market 修复通常累积到下一次计划中的 Portable 发布；上游检查、验收 PR 或合并都不会启动 Portable 发布。修复不会自动改变版本号，版本变更必须由人工在发布时决定。

如果出现阻断性的安全、安装或数据损坏修复，可以在计划之外手动发版。该例外仍需要人工决定、完整验收和明确的版本变更；任何修复都不会自行合并、发布或生成新的 Portable 版本。

## English

DSH-Portable uses conventional prerelease stages for all new releases:

- **Alpha** is for active development. Features may be incomplete, visibly unstable, or fail to start on some systems.
- **Beta** begins when the main product flows work and the build is ready for real-world testing.
- **RC** is reserved for a build that already meets the expected release standard and needs only final verification.
- A **stable release** is the supported build recommended for general users.

A GitHub Release means that a build is available for users to download. It does not mean that a development task is complete or that a prerelease is stable.

Historical version names predate this policy and are not precedent for future releases. Promotion requires a new build and fresh product-level evidence; an Alpha is never renamed to Beta or RC merely because an implementation task ended.

## Independent core, Market, and Portable policies

The official DSH core, dsh-market, and DSH-Portable are three independent release objects:

- **Core (official DSH)**: scheduled checks verify the installable package, its integrity, and its corresponding commit. After the Windows, macOS, and Linux product gates pass, the core may enter its own update channel; an upstream core release does not trigger a Portable release.
- **Market**: upstream checks add releases to a manual review inbox. Only changes that apply to Portable are ported into the bundled Market after a failing test, compatibility checks, and human review. A Market upstream release is never merged or published automatically and never publishes Portable automatically.
- **Portable**: Portable owns its version and planned release cadence. Accepted core or Market fixes normally accumulate for the next planned Portable release; an upstream check, acceptance pull request, or merge never starts a Portable release. A fix never changes the version automatically; a human chooses version changes during release preparation.

An urgent security, installation, or data-corruption fix may justify a manual out-of-band release. The exception still requires a human decision, complete qualification, and an explicit version change; no fix automatically merges, publishes, or creates a new Portable version.
