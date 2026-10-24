# Bundled dependency security / 内置依赖安全

2026-10-24: release remains blocked. Main contains Node24.22.1 and same-major application dependency fixes; these are not a new release or a claim that every embedded copy is repaired.

发布仍受阻断。main 已修复分发 Node 与应用安装图中的依赖，前端和包管理器的预打包副本需要独立核验。

| Copy / 副本 | Verified state / 已核状态 | Boundary / 边界 |
| --- | --- | --- |
| Official rc3 web frontend, commit `1f81c047fc48fa190a683e469daa699857e9afe8` | Live shared Zod4.4.3 implementation in `dist/assets/index-BXV-oxvX.js`, SHA256 `0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0` | App npm overrides do not rewrite already bundled frontend code. / npm override 不会重编译该副本。 |
| pnpm11.11.0 | Bundled Undici7.28.0 and distributed6.27.0 retain the old response-stream order. | Updating Node built-in Undici does not replace pnpm internal copies. / 更新 Node 不替换 pnpm 内置副本。 |
| Reviewed official pnpm11.28.5–11.28.8 packages | .5/.6 retain7.29.1+6.29.0; .7/.8 repair6.x to6.29.1 but still inline7.29.1. Registry SHA512 and npm signatures verified. | No reviewed same-major original package fully resolves this risk. / 已审的同主版本原包尚未完全修复。 |

The frontend and pnpm observations are static code and module-registration evidence, not a demonstrated exploit of a user session. The actual application installation graph separately passed bounded Zod/Undici behavior checks and a fresh npm advisory query; neither check inventories code already inlined in these bundles.

上述结论来自实际打包代码及共享模块注册，并非已复现用户会话攻击。应用安装图的实测与公告查询不能覆盖已内联的代码，不能用其绿色结果替代这里的验收。

Before unblocking publication / 解除阻断前：

- Obtain repaired upstream distributions or independently review a reproducible source rebuild; do not treat a version-only or minified-file edit as proof. / 取得修复发行物或独立审阅可复现源码构建。
- Inspect the final frontend and package-manager copies and exercise their actual consumers. Requalify the five supported core/platform packages before restoring automated core publication. / 核对最终副本及实际调用路径，复验支持窗口内的五核和平台交付，再恢复自动内核发布。
- Record evidence in the selected release-readiness file before marking `dependencySecurity.status` as `passed`. Native publication rejects missing, blocked or evidence-free status. / 写入所选发布准备文件的证据后，才可将状态改为通过。

This is separate from the [1.x official Electron/MCP hold](one-x-mcp-followup-2026-10-23.md); 1.x continues to wait for a repaired official desktop distribution.

Sources: [Zod4.6.6 fix](https://github.com/colinhacks/zod/releases/tag/v4.6.6), [Undici advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), [Node24.22.1](https://nodejs.org/en/blog/release/v24.22.1), [pnpm registry](https://registry.npmjs.org/pnpm).
