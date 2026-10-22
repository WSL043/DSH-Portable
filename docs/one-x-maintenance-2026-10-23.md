# 1.x 基线维护与验收（2026-10-23）

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

E2E 实际捕获进程写入，意外写入列表为空；另记录官方自身创建 `Documents/deepseek-harness/default-workspace`、父目录及一条 Windows Notifications 注册表记录。默认工作区和用户另选工作区仍可位于根外，不能只说“用户主动选择才有外写”。当前门槛审计 Portable 组件并禁止已知全局数据根泄漏，其他官方自身写入宽泛记录不作失败判定；后续收窄为逐项审核的允许清单，不能宣称全应用零外写。

PR 安全扫描随后发现共享 CLI 的环境路径和测试 executable 选择缺少显式边界。本轮继续收紧：CLI 输入/输出限定当前工作区、拒绝路径逃逸和现存链接、版本/报告 kind 只接受规定形状；summary 留在证据目录，由 workflow 写 GitHub 文件命令。测试环境只从固定系统路径允许项选择 PowerShell；原生 cache pointer 写入前增加规范化、单叶名称和分隔符包含校验。修正后 56 个定向检查通过，新增实际越界/链接拒绝覆盖；静态扫描以最终 PR 运行结果为准，不用单测替代。

最终原生补验绑定产品源码 `44c0c25affe1ae27480972a3733af4d8dc372557`，复用同一搬迁后根，已同步最终 Payload/apply-update。冷启动仍保留原草稿/深色、设置显示 0.2.1-rc.2、正常关闭后 Launcher exit 0，协议全树恢复，进程归零。Launcher SHA-256 `0c1ea49b0241b664bdc583ced9ed3c0dcb874b47243276df7be3815d7a5fccc9`，官方 EXE/ASAR 摘要保持原值。最终共享 CLI 也对该实际 ASAR 完成 collect=0 / authorize=1：保留 blocked 证据，拒绝发布。该本地证据使用 `local-final` 身份，不冒充 Actions 运行。

安全扫描收敛到 `b50e0a5fc6bf7b7dd82149cbefccf95734197a32`：Actions、C#、JavaScript/TypeScript、Python 四项分析结果均为 0，PR head open alerts 回读为空。没有添加 suppression 或改安全门槛；JavaScript 路径守卫使用单独的正向前缀分支支配每次文件访问，避免复合条件无法被分析器识别。本地实物采证的共享 CLI SHA-256 `48fb15af67cead45efbffa6aec52709b9ac4425da98281b53a03b02185c3579a` 与该提交一致。

main 完整矩阵另发现两项测试夹具差异：macOS 临时根 `/var` 与 `/private/var` 别名未统一，Windows PowerShell 5.1 按 ANSI 误读无 BOM 的 UTF-8 中文路径。分别仅将测试临时根 realpath、显式 UTF-8 读取夹具修正，未放宽生产路径守卫。把已有 ASAR/报告测试加入三平台安全 job，并将实际 C# 路径/更新锁测试接入既有 Windows job；无需新增框架或工作流，PR 即可提前覆盖这些差异。

## 安全阻断与后续工作

[GHSA-6prh-2h8m-c8cw / CVE-2026-111769](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw) 影响 MCP client `>=2.0.0 <2.3.0`。旧 0.2.0-rc.2 实物为 2.0.0，新 0.2.1-rc.2 实物为 2.2.0，均命中，ASAR 清单完整性已验证。DSH 存在 StreamableHTTP 与自定义 headers 路径，stdio 不受此公告影响；未声称本机遭利用。官方签名不消除该依赖债，当前发布资格为 **blocked**。

接下来优先等待官方修复的签名成品并重跑；随后补真实旧 Native 数据迁移、跨机账号、断网/磁盘不足/中断恢复、官方插件入口和第三方兼容。崩溃遗留 partial/目标冲突仍保守拒绝覆盖；自动恢复和多实例未作承诺。物理断电、付费模型请求和 macOS 均无本轮证据。

临时 D 盘构建/验收根已整体移入回收站：1,403,652,692 B、7,947 文件。原路径消失，精确 `$I/$R` 记录、完整目录元数据指纹匹配；从回收站再次读取安装包 SHA-512、ASAR 与最终 Launcher SHA-256 均保持原值。采用删除前可否决的原生回收操作，不存在永久删除 fallback；先以小夹具验证否决保全与回收恢复边界。自有工具已另行回收，测试 feed 已停止，保留小型日志/JSON/截图；原便携版及其数据未列为清理目标。同盘回收保留物理占用，不宣称立即释放这 1.307 GiB 空间，也未清空回收站。
