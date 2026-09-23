# 版本支持与保留周期 / Version lifecycle

Portable 和官方 DSH 内核分别发布、分别验收。版本选择器只展示已经通过相应平台和当前壳兼容性验证的版本；从列表移除旧版本不等于删除用户安装或数据。

## Portable

- 当前最新稳定版是推荐版本。最近三个仍符合最低兼容门槛的稳定版进入稳定通道选择器。较旧版本转为历史版本，不再作为新内核、插件和操作系统组合的日常验收基线。
- 候选通道展示最近两个合格预发布版，并保留最新合格稳定版作为回退入口。已知异常版本始终由 `product-release-policy.json` 排除。
- 维护资源优先投向最新稳定版和当前候选版；上一个稳定版接受必要的安全、数据和升级路径修复。更早的安装先使用完整产品包升级到受支持的壳，再选择兼容内核。不能把“列表里没有”解释成“强制卸载”。
- 历史 GitHub Release 的用户下载、校验值和发布说明保留；不靠删除旧版用户下载来缩小新 ZIP，也不改写已经发布的不可变构建。

## DSH 内核

- 内核版本列表仍由独立的 Core Updates 通道生成，只有与本机 Portable 壳、Node、运行时布局和目标平台精确匹配且验收合格的版本才能选择。不能按版本号简单地宣称所有旧内核可用。
- 为了可回退，当前版本以及最近的兼容已验收版本应保留在选择器中。对更早版本停止补做全平台适配前，先确认从旧 Portable 安装升级壳的路径。升级不能迁移或回退用户数据格式时，应明确要求备份并停止宣称无损降级。
- Core Updates 已有限量索引与未引用资产清理；Portable 产品通道目前只限量索引，旧的版本化更新 ZIP 尚未自动清理。清理前必须读取稳定和候选两个通道的所有平台索引，保留两者引用的资产，并给正在更新的客户端留足宽限期。清理仅针对机器更新通道，不针对用户下载或本地 `data/`。

新 ZIP 只包含当前构建，因此缩短版本选择列表不会明显降低单个 ZIP 的体积。它能减少兼容组合、选择器噪声以及将来经过安全清理后的远端更新资产占用；本地瘦身仍取决于运行时、WebView2 和缓存的独立策略。

## English

Portable and the official DSH core have separate release and qualification lifecycles. The stable product picker retains the three most recent eligible stable releases. The candidate picker retains two eligible previews plus the newest stable release. Older installs and user data are never removed by picker retirement. Historical user-facing Releases remain available.

Core choices require exact platform, shell, Node and runtime compatibility. Keep a verified rollback path, and upgrade an old Portable shell before relying on a newer core. Product update-channel asset pruning remains a separate task: both channel indexes, every platform and in-flight update grace periods must be checked before any unreferenced versioned asset is removed. Reducing picker history does not shrink a newly built ZIP.
