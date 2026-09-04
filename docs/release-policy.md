# 发布阶段 / Release stages

DSH-Portable 从新版本开始遵循通用预发布阶段：

- **Alpha** 用于持续开发；功能可能尚未完成、存在明显不稳定，或在部分系统无法启动。
- **Beta** 只用于主要功能已经可用、可以进入真实用户测试的构建。
- **RC** 只用于已经基本达到正式发布标准、仅等待最终验证的构建。
- **稳定版**是面向一般用户推荐和支持的版本。

GitHub Release 只表示用户可以下载这个构建，不表示一次开发任务已经完成，也不表示预发布版本已经稳定。历史版本名称早于本规则，不能作为以后命名的先例。阶段提升必须产生新构建和新的成品级证据，不能因为一个开发任务结束就把 Alpha 改称 Beta 或 RC。

## English

DSH-Portable uses conventional prerelease stages for all new releases:

- **Alpha** is for active development. Features may be incomplete, visibly unstable, or fail to start on some systems.
- **Beta** begins when the main product flows work and the build is ready for real-world testing.
- **RC** is reserved for a build that already meets the expected release standard and needs only final verification.
- A **stable release** is the supported build recommended for general users.

A GitHub Release means that a build is available for users to download. It does not mean that a development task is complete or that a prerelease is stable.

Historical version names predate this policy and are not precedent for future releases. Promotion requires a new build and fresh product-level evidence; an Alpha is never renamed to Beta or RC merely because an implementation task ended.
