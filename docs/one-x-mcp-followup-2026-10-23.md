# 1.x MCP 重定向漏洞复核（2026-10-23）

本轮不发布。这里只处理 GHSA-6prh-2h8m-c8cw 的可达性、运行实证和处理路线，不代表完整漏洞审计，也没有证据表明用户机器已遭利用。未读取或迁移用户凭据，未向真实 MCP 服务发请求。

## 当前上游与实际包

2026-10-23 04:50 JST 回读：公开 master 仍为 [`687f282e8625c6b8d11ff58211a90524be2e4317`](https://github.com/deepseek-ai/deepseek-harness/commit/687f282e8625c6b8d11ff58211a90524be2e4317)；[Windows feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml) 和 [macOS ARM feed](https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml) 仍是 0.2.1-rc.2，[macOS Intel feed](https://download.deepseek.com/dsh-desk/feeds/mac-x64/nightly-mac.yml) 是 0.2.1-rc.1。没有把 feed 版本等同各平台已完成本机验证。

复用上一轮已经验证签名、摘要并移入回收站的 Windows 成品，只读其原始 ASAR；没有重新下载、解包、覆盖 SDK 或重打包。`app.asar` SHA-256 仍为 `47874618bf5b3011fcaac10cd4c85f69da333e70d4f99b921207c78d0999512a`，其中 client/core 实际版本均为 2.2.0。

除版本以外，这次还核对了真正的调用代码及 ASAR entry integrity：

| 实际文件 | SHA-256 | 观察 |
| --- | --- | --- |
| `dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js` | `758d8fc473b700b5d351158d06ce9f9e92c16e8b25497b08bb7bd2122a87f5dd` | `streamable-http` 工厂只传 `requestInit.headers`；没有 `fetch`、`redirect` 或 OAuth provider |
| `dsh/node_modules/@modelcontextprotocol/client/dist/index.mjs` | `b5891864a6ebcef27d8d999d662d03d7095368a2c0ff072ac578c2f31b27afa4` | 实际 SDK 接受可选自定义 fetch；默认请求仍交给运行时 fetch |

公开源码的 [transport 工厂](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/mcp/mcp-client/src/transport.ts#L27-L40) 与实物这一点一致。[配置模式](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/mcp/mcp-client/src/index.ts#L73-L132) 未提供 custom fetch 或 redirectPolicy 入口。因此在用户配置中凭空加入这些字段，不能施加已验证的缓解。此判断是针对当前内置 bridge；不概括第三方插件的所有调用方式。

## 实际 SDK 的本地重现

直接用原签名 EXE 的 Electron 44.7.0 / Node 24.21.0 模式导入原 ASAR 内 SDK，没有启动用户桌面、原配置或真实 MCP 插件。两个 HTTP 服务只绑定 `127.0.0.1` 的不同临时端口，所有 API key、session 和请求内容均为测试标记。服务、连接及该自有子进程在结束时关闭。

| 场景 | 直接 initialize / session 建立 | 跨端口 307 目标收到请求 | 结果 |
| --- | --- | --- | --- |
| 与 DSH 工厂相同的 SDK 默认参数 | 成功 | 1 次 POST，带测试自定义头、session id 与完整 tools/call body | 重现公告所述泄漏路径 |
| 加入 `fetch(url, { ...init, redirect: 'error' })` | 成功 | 0 次 | 重定向请求失败，直接连接仍可用 |

默认场景中 `Authorization` 未传给目标，与当前运行时的跨源剥离行为一致；不能将漏洞泛化为所有 Authorization 都会泄漏。前后 ASAR 整体摘要相同。证据为验收交付目录中的 `mcp-followup-loopback.json`；复现脚本 `mcp-followup-loopback.mjs` 仅是验收工具，没有进入产品运行链。

这已实证 SDK 与当前工厂参数组合的运行行为；没有将它写成经过完整 DSH 插件 UI 的端到端验收。未测试 OAuth token 泄漏：当前内置 bridge 不传 authProvider，不能据公告直接断言产品存在已确认可达的 OAuth 凭据泄漏。

## 可行处理

[官方公告](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw) 说明 client 2.0.0 至 2.2.0 受影响，2.3.0 修复；stdio 不受此项影响。[上游修复 #2901](https://github.com/modelcontextprotocol/typescript-sdk/pull/2901/files) 覆盖 HTTP transport 与 OAuth 的请求入口，默认限制重定向目标及方法。不能只在首次 URL 上作一次 HEAD 检查：后续调用、session 重连也会请求，且预检不能约束后来变化的响应。

| 路线 | 当前处理与资格 |
| --- | --- |
| 官方签名成品升级 client 至 2.3.0 或更高修复版本 | 首选。重新核对实际 ASAR、完整性及重定向行为，再走完整资格；不只看 source lockfile 或声明的版本 |
| 上游先在工厂传拒绝重定向的 fetch | 已经在当前 SDK 中验证技术可行；需要上游真实成品或明确标识的派生构建。本轮没有改 ASAR，也没有据此豁免当前版本门槛 |
| 临时使用 stdio，或停用受影响 HTTP 实例 | 操作级隔离，仅适用于用户确实可用的本地 server；不能把未修字节标为发布通过。不静默改写或删除用户 MCP 配置 |
| 配置最终 URL、只用 HTTPS、移除自定义 API 头 | 可以减少部分条件，但不能完整修复；后续重定向仍可带 session 或请求体 |
| 全局 NODE_OPTIONS/fetch 注入、通用代理或防火墙 | 当前没有产品级完整覆盖证据；会扩大启动和网络边界，本轮不引入这类运行时适配 |

迁移验收只能使用合成、无真实凭据且仅指向本机的 MCP 配置，避免旧配置副本在启动后连接真实服务。现有发布检查继续 fail closed，`qualificationAllowed=false`；本轮运行成功或操作级隔离均不改变这一结论。

若确认自己配置的远端曾重定向到非受控主机，再按公告处理相关 API key/session/token；本轮没有发现这类事件，因此未自动修改用户账户或轮换任何凭据。
