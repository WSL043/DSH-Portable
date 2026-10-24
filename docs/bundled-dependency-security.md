# Bundled dependency security / 内置依赖安全

## 2026-10-25 packaged Native dependency gate

The production candidate [40131741031](https://github.com/WSL043/DSH-Portable/actions/runs/40131741031) passed all 39 product jobs. Its Windows artifact SHA256 is `5ee28b8cb339d7d593a1984360dab20df475cb49192e29574ef66233db8bfacb`. The complete 0.9.7 / rc.3 / Node24.22.1 package was then exercised in a normal native WebView on an isolated desktop, with no product source overlay.

- The page's actual module-loader seed and `modules.import('zod')` returned the same Zod4.6.7 object. An eight-element proxy array rejected `max(1)` with zero element reads; a valid one-element array passed. No page runtime exception was recorded. Its shared chunk SHA256 remains `731802fc2ffafa6c8964f6b84ab07e37067cf9ceb238e7c5dc67e9fe5ef5459e`.
- The shipped pnpm11.11.0 rebuild contains inline Undici7.30.1 and distributed6.29.1. Its source patch, resolved lock, actual pnpm/worker hashes and retained offline recovery archive match the CI receipt. The real rebuilt CLI passed the normal registry consumer and handled the malformed response with exit1, zero uncaught errors and zero Node-global-fetch calls. Production archive SHA256: `120106e2f1ba9354736bc2d78dac204a0ce33a21af9d0faaf4cac541206b775d`.
- Cold startup, native File > New session, the top new-session icon, Settings, both offline file pickers and native Exit were exercised. Stop completed in 2313ms, backend and WebView exited, and no runtime lease remained. A fresh isolated official CLI profile installed and enabled Chat Manager1.5.18 without peer exemptions.

This passes the selected Native product's bundled-dependency gate. The supported core window must still be prepared/requalified before its catalogs and automatic intake are restored; publication and signed-feed readback are separate final gates.

## 2026-10-25 reproducible source-build qualification

Earlier feasibility evidence: a frozen official rc.3 source build with Zod4.6.7 succeeded in [40123555423](https://github.com/WSL043/DSH-Portable/actions/runs/40123555423). The actual rebuilt frontend shared chunk has SHA256 `731802fc2ffafa6c8964f6b84ab07e37067cf9ceb238e7c5dc67e9fe5ef5459e`; the production consumer result is recorded above.

A complete pnpm11.11.0 source rebuild succeeded in [40124398269](https://github.com/WSL043/DSH-Portable/actions/runs/40124398269): actual inline Undici7.30.1, distributed6.29.1, normal registry query exit0, malformed-response exit1 with zero uncaught errors and zero global-fetch calls. The first rebuild still contained7.28.0 because range overrides did not replace `catalog:` references; the reviewed patch now pins the catalog as well. Failed runs retain their original outcomes.

`patches/pnpm-11.11.0-security.patch` is bound to official source `8e1e4c0aaece387dfda16377b2ba31f7a1a2602c`, SHA256 `b4fc0cef06712e0445775244822fd34eb7bb14f1c600ce463e36620254427405`, resolved lock `8e16d360375de55f7388864d4db3068e5c6736c76e78015ef98b809679cf0ab7`. Production builds apply that immutable patch and use frozen installation; they do not re-resolve dependencies or edit minified output. The original registry integrity identifies the build bootstrap, while the rebuilt distribution carries its own source receipt and actual archive digest.

当前仅说明源码重建可行及其真实消费者结果；不能把这两次探针的产物当作最终0.9.7成品。完整成品、离线恢复、内核窗口和发布回读仍须完成；发布准备状态不提前改成通过。

## Historical affected distributions (2026-10-24)

At this audit snapshot, release remained blocked. Main contains Node24.22.1 and same-major application dependency fixes; these are not a new release or a claim that every embedded copy is repaired.

该审计快照仍受阻断。main 已修复分发 Node 与应用安装图中的依赖，前端和包管理器的预打包副本需要独立核验。

| Copy / 副本 | Verified state / 已核状态 | Boundary / 边界 |
| --- | --- | --- |
| Official rc3 web frontend, commit `1f81c047fc48fa190a683e469daa699857e9afe8` | Live shared Zod4.4.3 implementation in `dist/assets/index-BXV-oxvX.js`, SHA256 `0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0` | App npm overrides do not rewrite already bundled frontend code. / npm override 不会重编译该副本。 |
| pnpm11.11.0 | Bundled Undici7.28.0 and distributed6.27.0 retain the old response-stream order. | Updating Node built-in Undici does not replace pnpm internal copies. / 更新 Node 不替换 pnpm 内置副本。 |
| Reviewed official pnpm11.28.5–11.28.8 packages | .5/.6 retain7.29.1+6.29.0; .7/.8 repair6.x to6.29.1 but still inline7.29.1. Registry SHA512 and npm signatures verified. | No reviewed same-major original package fully resolves this risk. / 已审的同主版本原包尚未完全修复。 |

The frontend observation is static code and shared-module registration evidence. In isolated loopback registry probes, pnpm11.11.0 and11.28.8 on Node24.22.1 both used their bundled fetch implementation (`globalThis.fetch` calls:0). Normal queries succeeded; six content encodings with a truncated declared body caused an unhandled `ResponseContentLengthMismatchError` and child exit1. No real registry or user session was involved.

前端结论来自打包代码与共享模块注册。pnpm 两个版本已在 Node24.22.1 下用隔离本地 registry 实测：普通查询成功；六层编码加声明长度不足的短响应触发未捕获错误，子进程退出1；没有调用 Node 的全局 fetch，也没有访问真实 registry 或用户会话。因此更新 Node 不能修复 pnpm 的这条实际路径。

The application installation graph separately passed bounded Zod/Undici checks and a fresh npm advisory query. These checks do not inventory code already inlined in bundles. / 应用安装图的绿色结果不能替代内联副本的验收。

Before unblocking publication / 解除阻断前：

- Obtain repaired upstream distributions or independently review a reproducible source rebuild; do not treat a version-only or minified-file edit as proof. / 取得修复发行物或独立审阅可复现源码构建。
- Inspect the final frontend and package-manager copies and exercise their actual consumers. Requalify the five supported core/platform packages before restoring automated core publication. / 核对最终副本及实际调用路径，复验支持窗口内的五核和平台交付，再恢复自动内核发布。
- Record evidence in the selected release-readiness file before marking `dependencySecurity.status` as `passed`. Native publication rejects missing, blocked or evidence-free status. / 写入所选发布准备文件的证据后，才可将状态改为通过。

This is separate from the [1.x official Electron/MCP hold](one-x-mcp-followup-2026-10-23.md); 1.x continues to wait for a repaired official desktop distribution.

Sources: [Zod4.6.6 fix](https://github.com/colinhacks/zod/releases/tag/v4.6.6), [Undici advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), [Node24.22.1](https://nodejs.org/en/blog/release/v24.22.1), [pnpm registry](https://registry.npmjs.org/pnpm).
