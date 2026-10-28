# 1.x 基线维护与验收（2026-10-23）

## 2026-10-28 续：效率与代码精简

0.x 胶囊安装前校验复用本地附件的有界流式 SHA-256，不再整体读入压缩包；字节数、摘要和安装前拒绝顺序保留。删除未调用的 ResetOperationUi。1.x 每轮进程等待复用一次 CIM 快照，激活锁后与解包写入者检查仍重新查询；打包复用既有安装包身份匹配，歧义候选继续拒绝。自动健康回退保留失败程序及附加文件，后续仍由完整树收据门槛决定清理。

128 MiB 合成文件两轮摘要完全一致，旧读取持有约 128 MiB Buffer；新实现不保留整包 Buffer。独立进程观测内存增量约 130 MiB 对比约 17 MiB；这不是整体启动或更新速度结论。本批定向实执行覆盖损坏拒绝、旧/新官方默认清单、真实 Windows 进程快照与编译后回退。完整依赖和成品矩阵结果以本批精确提交的 CI 为准；本机缺依赖及测试工具环境失败保留日志，不算通过。

The bounded streaming digest avoids retaining a complete capsule in memory without skipping integrity checks. Process snapshots are shared only within one polling round; activation still rechecks. Failed health targets are preserved for receipt-based cleanup. The synthetic memory comparison does not establish faster startup, and alpha compatibility preparation is not full candidate acceptance.

## 2026-10-28 上游 alpha 接口核对

官方已发布 [0.2.2-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2)（源码 f3803c96974ad4a94195fb97e5c637e9c2a3afe3）和 [0.2.1-rc.4](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.4)。alpha 将默认组合包清单从 app-boot 移至 [dsh-official-bundles](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-alpha.2/packages/util/official-bundles/src/index.ts)；Portable 的插件事务和旧会话导入预检共用按导出能力选择的解析器，旧内核仍复用原导出，不猜版本、不吞加载错误。最低 Node.js 24.9，当前固定 24.22.1 满足。此项是兼容准备，尚不表示整套 alpha 已通过产品验收；不改公开候选或现有内核锁。

本次只读核对时，[Windows 官方 nightly feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml) 仍是 0.2.1-rc.3；GitHub/npm alpha 不等于已交付的新桌面成品。alpha 与 rc.4 的官方 MCP 清单仍固定 client 2.2.0，处于 [GHSA-6prh-2h8m-c8cw](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw) 影响范围，不能据发布名称解除 1.x 安全阻断，也不覆盖官方 SDK。

Alpha compatibility preparation follows the official export owner by capability and retains legacy app-boot support. It does not promote the alpha runtime, qualify a new desktop payload, or remove the upstream MCP security hold. Full candidate qualification must bind the immutable source and built artifact on an isolated review branch.

## 2026-10-28 续：离线维护与恢复

Native 产品版本保持 0.9.7，1.x 不发布、不改公开目录、不启用桌面通道。本批代码见 [PR #220](https://github.com/WSL043/DSH-Portable/pull/220)。

1.x 外部维护入口复用原引擎和状态文件，补齐本地安装包首装/更新、同版本官方程序修复、保留版本回退和中断恢复。恢复不重复提交已准备的动作；解包进程仍存活时保留暂存；整个根只允许新增一组修复保全槽。程序回退不恢复共享数据或官方 schema。默认不安装插件；不安全的种子超时/回收失败会阻止启动并保留恢复材料。官方 EXE、ASAR 与运行库不改，仅允许改写 app-update.yml。

0.x 修正自定义状态根的健康/停止/结果路径，并在共享内核更新前检查全部已初始化环境；胶囊缓存根、摘要目录或 ready 标记被重定向时拒绝运行与清理。删除未调用的种子合并死代码，未增加第二套更新或回退框架。

- [Native 完整矩阵 40562916251](https://github.com/WSL043/DSH-Portable/actions/runs/40562916251)：3162039，39/39；此后 0.x 产品文件未变。
- [完整包与 Bootstrap 40570073639](https://github.com/WSL043/DSH-Portable/actions/runs/40570073639)：e163acd，完整包、联网轻量包、本地签名安装包首装均通过；首启/二启实际渲染、健康退出、协议恢复，搬迁后官方 CLI 配置检查通过。目录底包 0.2.0-rc.2，不冒充 rc.3；draft-release 实际跳过。
- [最终签名 rc.3 E2E 40582818629](https://github.com/WSL043/DSH-Portable/actions/runs/40582818629)：3637f39，14/14、overallPassed=true。0.1.7-rc.2 → 0.2.1-rc.3、实际本地修复、保留版本手动回退及崩溃回退通过；原生窗口、健康状态、协议恢复、路径核验的受管进程归零均有证据。安装包、数据 marker、保全树和收据前后摘要一致。最终 rc.3 ASAR SHA-256 为 04b32e3a872826ba15cfb2081c6a929a8d4ecaa65e09a2543e5a6b30e2eff1f0。

本地文件模式的网络证据只覆盖配置索引与启动器 feed 请求不增加，未作物理断网或全系统网络阻断。写入门槛覆盖官方 EXE 及观察到的子链，不保证独立 Root/控制器直接执行的维护引擎全部被跟踪，不能宣称全应用零外写。

前序报告保留失败原文：已识别的 Windows 功能使用状态和目录索引分页记录原先未分类。规则只按系统 PowerShell 精确映像/值路径/类型，以及本包提取器精确映像/同卷伪名/分页标记识别；保留行、父链和 PID 代际。依据为 [WNF 原作者名称表](https://github.com/ionescu007/wnfun/blob/5e7ae991ee8a9557c63c841d67b57cd1e36c617d/script_python/WellKnownWnfNames.py#L1008) 与 [MemProcFS 原作者目录索引解析](https://github.com/ufrisk/MemProcFS/blob/b3dee6a22f935e56cd54bc207ec0a0552e5d6bf3/vmm/modules/m_fc_ntfs.c#L634-L651)，未恢复任意卷根 $ 前缀豁免。最终云端再次观察到 WNF 分类，但没有再次观察到 $Directory；后者的真实正例来自前序失败记录与解析回归。

采证流式去重保留原始计数、类别差异与上下文，13 项真实解析回归通过。10 万重复写入合成数据约 19.3s → 6.3s，存储对象 100000 → 64；单关键词 Hashtable 对照六轮约减少 14% 耗时，输出/计数/上下文一致。这些微基准不代表整体验收提速：最终实际解析 7,465,765 行用了约 23 分钟，仍是采证成本，不作为产品启动性能结论。

最新签名 rc.3 的 MCP client/core 仍为 2.2.0，已知公告继续阻断 1.x 发布；等待官方修复成品，不在 Portable 覆盖其 SDK 或业务实现。验收后临时产物按精确清单移入回收站，小型证据与失败日志保留。

## 2026-10-23 原始记录


本轮不发布：不创建 Release、草稿、标签，不改公开更新源，不启用停用中的桌面通道。0.9.4 Native 产品版本和稳定内核锁保持原值。下列源码、成品、运行和安全结果分别记录，不能互相替代。

## 之前做到哪里

1.x 已有公开 alpha.5；当前开发路线已删除旧 ASAR/desktop adapter，默认不预装 Portable 插件或市场。旧包曾自带两个默认关闭的插件，不代表当前打包行为。

- [10-15 纯包运行 38724557359](https://github.com/WSL043/DSH-Portable/actions/runs/38724557359)：plugin-free 完整包和轻量包真实启动/搬迁成功，官方底包 0.2.0-rc.2。alpha.99 是测试标识，当前不存在对应草稿或标签。
- [10-19 通道运行 39184674245](https://github.com/WSL043/DSH-Portable/actions/runs/39184674245)：契约与实际 0.1.7-rc.2 → 0.2.1-rc.2 更新均通过；最终发布失败，因为用新启动器重建了旧版同名资产，不可变摘要保护正确拒绝。
- 桌面通道工作流实际为 `disabled_manually`；过去“每小时自动跟进”“等待首次 runner 验证”的运维文字均已过时。检查时无 open PR，旧 #169 属 Native intake，不是纯桌面资格。

## 上游基线与实物

有限源码审查基线为 [687f282e8625c6b8d11ff58211a90524be2e4317](https://github.com/deepseek-ai/deepseek-harness/commit/687f282e8625c6b8d11ff58211a90524be2e4317)。相对旧基线相隔 5,884 提交，本次实际复审 37 个 Portable 边界相关文件，不能声称全仓库审计。监控范围扩展到审核过的 home-paths、app-boot、插件管理/市场、连接/UI/API、webserver、MCP 共享包及锁文件。

| 平台 | 官方 nightly | 本轮验证 |
| --- | --- | --- |
| [Windows x64 feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml) | 0.2.1-rc.2 | 完整安装包 SHA-512、大小、有效 Authenticode，实际展开和桌面启动 |
| [macOS ARM feed](https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml) | 0.2.1-rc.2 | feed/资产元数据；未作 macOS 实机验收 |
| [macOS Intel feed](https://download.deepseek.com/dsh-desk/feeds/mac-x64/nightly-mac.yml) | 0.2.1-rc.1 | feed/资产元数据；未作 macOS 实机验收 |

三个 stable/latest feed 当时返回 404，不能把 nightly 当稳定桌面。Windows 安装包 289,385,456 B，SHA-512 为 `39POl5osl9PKMqrPXQA52dh/bCV0Z02vOV9cTjOJDHE6gsJwp5bv7lfgB3mVWAKspX7a/w1iTi+8Listdhq45g==`；官方 ASAR 182,794,869 B，SHA-256 为 `47874618bf5b3011fcaac10cd4c85f69da333e70d4f99b921207c78d0999512a`。

该成品内嵌 build SHA `332895e0f7c9d4dbfb29729f5eb367fa263ff986`，公开仓库 API 无法映射；不据此断言签名异常，也不把 master 的行为自动认作成品事实。动态后端端口已另经实机确认，旧版 19387 冲突保护暂保留。

## 本轮改动

| 问题 | 处理与边界 |
| --- | --- |
| 新版 agents home 独立于 DSH_HOME，可能继承用户全局路径 | 子进程显式设置 `data/agents`；实际编译启动器的子进程测试验证环境覆盖，原生桌面验证外部 marker 保留 |
| 数据路径或祖先被 junction/文件重定向，可能部分创建后才失败 | C# 对全部数据目标与祖先先预检，再创建；拒绝重定向、文件阻塞和不可判明的权限错误 |
| 更新准备期间另一启动器启动，或 current.json 已被其他动作改变 | 引擎切换与启动监督共享 activation lock；提交前复核原 current.json 身份，拒绝覆盖并发状态 |
| 仅凭版本目录名清理，或清理异常撤销成功切换 | 收据记录完整树摘要；只清理完全匹配的受管旧树，未知/改动/旧收据保留；提交后清理失败记 deferred |
| 读共享句柄允许摘要读取却不允许删除，导致先删掉部分旧文件 | 删除前对全部文件统一取得独占读预检，已有占用时完整保留，释放占用后仍能重试；不承诺抵抗预检后并发改动或所有删除 ACL 故障 |
| 第二个更新引擎抢不到锁仍覆盖状态 | 只有持 update.lock 者能写最终状态和清理自己的暂存 |
| chunked 索引无 Content-Length，先完整读完再限体积 | 逐块读取并在上限立即拒绝；真实 HTTP 测试验证提前终止 |
| 旧历史版本同名启动器被新字节重造 | 仅生成本次候选副本；同名不同摘要仍拒绝，不覆盖历史资产 |
| 手动验收顺带写草稿、通道或 issue | `publish_draft` / `publish_channel` 默认 false；外部写入入口另验安全报告 |
| 签名/运行成功被误当作安全许可 | 只读检查实际 ASAR 清单和完整性；共享 CLI 绑定报告/成品/候选/源码/运行/包，发布严格检查布尔资格 |
| 写入探针只关注 addon cache | E2E 增加全局 `.agents`、`.dsh`、默认 Electron profile 的禁止写入判断；不声称完整零写入审计 |

保留官方 EXE、ASAR 和运行库，只重写允许的 `app-update.yml`；未引入 SDK 覆盖或默认插件适配。

## 验收记录

源码全套：1,223 项，1,209 通过、14 条件跳过、0 失败。新增测试集中在实际编译 C#、真实 Windows 文件/锁/子进程、真实 HTTP 和 ASAR，不为每条实现细节另堆测试。

独立复审实证了读共享占用造成的部分删除；追加最小预检后，同一真实文件测试证明占用时两文件都保留、关闭句柄后再次成功清理，更新边界 4/4 通过。没有增加 GC 事务或放宽完整树资格。

本机唯一一份新官方成品放在 D 盘隔离目录，私有桌面三轮真实 UI：欢迎/稍后配置、输入未发送草稿、插件与设置页、正常关闭、整根搬迁后草稿保留、深色主题后再冷启动。三轮 Launcher exit 0；每轮完整 `HKCU\Software\Classes\dsh` 值与类型快照恢复；外部 agents marker 摘要/mtime 不变，旧根未重建，官方进程最终归零。未登录、填密钥或调用模型。

本机首次工具继承 Low integrity，无法创建 D 盘锁，属于验收控制器环境：逐字节相同的工具复制到正常继承的 D 盘后实际 token RID 从 4096 到 8192，未修改用户或原程序 ACL。另一次观察器空窗口枚举失败已保留日志，实际程序正常；不隐藏失败记录。全局目录/应用树首份元数据采样在首次启动后，只证明之后稳定；本机未做完整 Procmon 审计。

最初三轮本机 UI 的 Payload.psm1 早于最终 HTTP 限界修正，不冒充精确最终引擎验收。第一批实现的线上运行分别绑定以下源码：

- [真实跨版本 E2E 39802825055](https://github.com/WSL043/DSH-Portable/actions/runs/39802825055)，源码 `d83fb329c9c86b4ee82854d9510331ec5c814c52`，0.1.7-rc.2 → 0.2.1-rc.2，`overallPassed=true`，12/12 通过。实际点击更新/安装重启、应用切换、健康清除、协议恢复与崩溃回退均有证据。
- [完整包/Bootstrap 39802832641](https://github.com/WSL043/DSH-Portable/actions/runs/39802832641)，同一源码，`alpha=99`、`smoke=all`、`publish_draft=false`，preflight/package 成功，完整包和轻量包首启/二启/搬迁及配置检查全部通过，draft-release 跳过。两根实际 MCP 2.0.0 的安全报告与 provenance 均 blocked，运行成功没有授予发布资格。

E2E 实际捕获进程写入，意外写入列表为空；另记录官方自身创建 `Documents/deepseek-harness/default-workspace`、父目录及一条 Windows Notifications 注册表记录。默认工作区和用户另选工作区仍可位于根外，不能只说“用户主动选择才有外写”。当前写入门槛覆盖官方 EXE 及实际观察到的子进程链，禁止其中的已知全局数据根泄漏；不代表完整审计独立 Root 或控制器直接执行的修复、回退引擎。其他官方自身写入记录不作失败判定，不能宣称全应用零外写。

PR 安全扫描随后发现共享 CLI 的环境路径和测试 executable 选择缺少显式边界。本轮继续收紧：CLI 输入/输出限定当前工作区、拒绝路径逃逸和现存链接、版本/报告 kind 只接受规定形状；summary 留在证据目录，由 workflow 写 GitHub 文件命令。测试环境只从固定系统路径允许项选择 PowerShell；原生 cache pointer 写入前增加规范化、单叶名称和分隔符包含校验。修正后 56 个定向检查通过，新增实际越界/链接拒绝覆盖；静态扫描以最终 PR 运行结果为准，不用单测替代。

最终原生补验绑定产品源码 `44c0c25affe1ae27480972a3733af4d8dc372557`，复用同一搬迁后根，已同步最终 Payload/apply-update。冷启动仍保留原草稿/深色、设置显示 0.2.1-rc.2、正常关闭后 Launcher exit 0，协议全树恢复，进程归零。Launcher SHA-256 `0c1ea49b0241b664bdc583ced9ed3c0dcb874b47243276df7be3815d7a5fccc9`，官方 EXE/ASAR 摘要保持原值。最终共享 CLI 也对该实际 ASAR 完成 collect=0 / authorize=1：保留 blocked 证据，拒绝发布。该本地证据使用 `local-final` 身份，不冒充 Actions 运行。

安全扫描收敛到 `b50e0a5fc6bf7b7dd82149cbefccf95734197a32`：Actions、C#、JavaScript/TypeScript、Python 四项分析结果均为 0，PR head open alerts 回读为空。没有添加 suppression 或改安全门槛；JavaScript 路径守卫使用单独的正向前缀分支支配每次文件访问，避免复合条件无法被分析器识别。本地实物采证的共享 CLI SHA-256 `48fb15af67cead45efbffa6aec52709b9ac4425da98281b53a03b02185c3579a` 与该提交一致。

main 完整矩阵另发现两项测试夹具差异：macOS 临时根 `/var` 与 `/private/var` 别名未统一，Windows PowerShell 5.1 按 ANSI 误读无 BOM 的 UTF-8 中文路径。分别仅将测试临时根 realpath、显式 UTF-8 读取夹具修正，未放宽生产路径守卫。把已有 ASAR/报告测试加入三平台安全 job，并将实际 C# 路径/更新锁测试接入既有 Windows job；无需新增框架或工作流，PR 即可提前覆盖这些差异。

## 安全阻断与后续工作

[GHSA-6prh-2h8m-c8cw / CVE-2026-111769](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw) 影响 MCP client `>=2.0.0 <2.3.0`。旧 0.2.0-rc.2 实物为 2.0.0，新 0.2.1-rc.2 实物为 2.2.0，均命中，ASAR 清单完整性已验证。DSH 存在 StreamableHTTP 与自定义 headers 路径，stdio 不受此公告影响；未声称本机遭利用。官方签名不消除该依赖债，当前发布资格为 **blocked**。

后续 [数据和恢复维护](one-x-data-recovery-2026-10-23.md) 已补显式旧 Native 迁入、独立 Linux→Windows 2022/2025 实际 UI 与下载/更新进程中断验收，并修复干净机器协议根残留；[MCP 复核](one-x-mcp-followup-2026-10-23.md) 实证重定向风险及缓解边界。仍需官方修复的签名成品、真实跨机账号、官方插件入口和第三方兼容验收。未知 partial/目标冲突保全，不承诺自动恢复或多实例；物理断电、实际磁盘耗尽、付费模型请求和 macOS 桌面仍无本轮证据。

临时 D 盘构建/验收根已整体移入回收站：1,403,652,692 B、7,947 文件。原路径消失，精确 `$I/$R` 记录、完整目录元数据指纹匹配；从回收站再次读取安装包 SHA-512、ASAR 与最终 Launcher SHA-256 均保持原值。采用删除前可否决的原生回收操作，不存在永久删除 fallback；先以小夹具验证否决保全与回收恢复边界。自有工具已另行回收，测试 feed 已停止，保留小型日志/JSON/截图；原便携版及其数据未列为清理目标。同盘回收保留物理占用，不宣称立即释放这 1.307 GiB 空间，也未清空回收站。
