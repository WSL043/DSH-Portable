# rc.2 精确历史迁移适配

官方 npm `@deepseek-ai/dsh-session-format-v0-to-v1@0.1.7-rc.2` 的 `lib/index.js` 与已审查的 alpha.1 文件相同：SHA256 `1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1`。补丁仍要求这个输入摘要和固定输出摘要，仅新增 rc.2 精确版本，不放行后续未知版本。

在独立安装的官方 rc.2 上执行 `patch-historical-descriptor.mjs` 及 `verify-historical-session.mjs`，结果通过。后者同时验证补丁 manifest、历史 writer 版本、父子会话及消息身份、原始文件摘要、官方 AgentLoop 继续执行、持久化重开和中断日志恢复。结果记录 `compatibilityPatch.dshVersion=0.1.7-rc.2`。本地原始记录：`build/rc2-migration-review/historical-result.json`。

源码资格基于官方提交 `477b4f420553e8a52c2fbccc464d7561b239c443`；npm 主包完整性为 `sha512-SQFhriLvza8GnFApnC5/32AgpcyKxrWnYXhvwDOLJdgWpkCX2EexyR9c8kCkMITJXnFLEN3Qb2CEh0W36vkLyw==`。本地 npm 验证不替代 Updates 从官方源码构建后的精确摘要检查、五平台产物检查及最终频道回读。

新增发布身份测试拒绝把 alpha.1 补丁身份用作 rc.2 证据。相关 8 项测试通过。物理断电未验证；这一记录不表示完整产品或内核频道已发布。
