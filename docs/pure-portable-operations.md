# 纯便携版通道运维

2026-10-28 更新。适用于 `experiments/official-payload/` 当前开发代码；旧 alpha 保留各自日期。当前范围见 [1.x 路线](roadmap-toward-1.0.md#2026-10-28-维护批次)，历史证据见 [10-23 维护记录](one-x-maintenance-2026-10-23.md)。

## 先验收，发布另行授权

当前 `official-desktop-channel.yml` 在线状态为 **disabled_manually**。本轮不启用、不发布、不修改公开索引。手动运行的两个发布开关默认均为 false；计划任务的原发布路径仍存在，不能把手动默认安全等同允许重新启用定时任务。

仅验收的示例（先提交并推送待验分支，`<branch>` 替换为实际分支）：

```powershell
gh workflow run official-pure-alpha.yml --ref <branch> -f alpha=99 -f smoke=all -f publish_draft=false
gh workflow run official-pure-e2e.yml --ref <branch> -f candidate_version=0.2.1-rc.3
gh workflow run official-pure-e2e.yml --ref <branch> -f scenario=data-transfer -f candidate_version=0.2.1-rc.3
```

第一条使用生产目录中已接纳的版本，生成完整包与 Bootstrap 包并实际冒烟，不创建 alpha.99 草稿或标签；不表示最新 nightly 已被接纳。第二条由受控旧候选 `candidate.json` 的 `0.1.7-rc.2` 升级至官方 feed 当前版本；参数只断言新版身份，不改写生产目录。feed 版本改变后应先核实身份再调整断言。

`candidate.json` 的旧版本是跨版本 E2E 输入，不是过时的生产版本锁，不能随源码基线刷新一起覆盖。

第三条验证独立 Linux 源归档到 Windows 桌面的迁移：2022 使用明文、2025 使用加密密码文件，各做两轮真实 UI，不创建发布。离线入口、默认排除与故障注入边界见 [数据和恢复验收](one-x-data-recovery-2026-10-23.md)。

## 门槛和证据

1. 下载前核对官方候选来源；下载后验证完整大小、SHA-512、有效 Authenticode 与 DeepSeek 发布者，安全展开 NSIS。
2. 更新契约哨兵用真实官方界面验证 updater 交接；完整 E2E 验证旧到新、搬迁、插件操作、退出及写入边界。完整包与轻量包还须各自启动和搬迁。
3. 从实际冒烟根的 ASAR 收集安全报告。最新签名 Windows `0.2.1-rc.3` 的 MCP client/core 仍为 2.2.0，三份相关清单完整性通过，但命中 GHSA-6prh-2h8m-c8cw；运行成功仍为 security blocked。
4. 发布入口先验证共享 CLI 的报告绑定：同一 repository/run/attempt/source/candidate、实际 ASAR 大小/摘要、原报告与复核报告摘要、包摘要以及严格布尔资格。`--report-only` 返回 0 不授予发布资格。
5. 历史版本的启动器资产不可重建覆盖。只生成本次候选的副本；已有同名不同摘要资产必须拒绝，禁止用 mutable 模式绕过。

检查安全债的只读命令：

```powershell
node scripts/check-official-payload-security.mjs '<portable-root>/app/<version>/resources/app.asar' --output security.json
```

已知受影响、未知版本、缺清单、完整性错误均非零退出。诊断时可加 `--report-only` 保留 JSON，报告仍为 blocked。此工具只覆盖报告所列公告，不替代其他发布验收。

## 程序、数据与清理

完整包包含官方 `app/<version>/`；轻量包无应用版本目录和 `current.json`，解压后上限 40 MiB，首次联网安装。默认不播种 Portable 插件；可选种子实现保留供显式配置使用。

应用状态位于 `data/dsh-home`、`data/agents`、`data/electron` 和 `data/cache/native-addons`。官方默认 `Documents/deepseek-harness/default-workspace` 及用户另选工作区仍可位于根外。官方 updater 的专用缓存和运行期间临时 `HKCU\Software\Classes\dsh` 注册是已知根外边界；退出须核对注册表恢复。当前 E2E 对全局 `.dsh`、`.agents` 和默认 Electron profile 的写入作失败判定；其他官方自身写入记录但未全部收窄为允许清单，不能把该门槛描述为全应用零外写证明。

旧官方包有固定端口 19387；本轮新成品实测使用动态端口。启动器仍保留跨旧版本的冲突保护，不结束外来进程。动态端口也不等于任意多实例已经验收。

更新成功后，仅完整树摘要与收据匹配的更旧程序允许自动清理；当前/上一版本、旧格式收据、未知或改动目录保留。锁定、路径异常或清理失败记录 deferred，不能回滚已提交更新。崩溃遗留的 `.partial` 和目标冲突仍拒绝覆盖，保留日志并人工核实。

本地构建和验收临时副本完成后移回收站并验证可恢复记录；失败运行只保留日志。不要复用没有回收记录的旧清理 helper，不对原便携目录运行清理。CI 使用一次性 runner。

## 旧 Native 数据迁入

使用 Node 24 和当前源码维护入口；先切换到专用迁移工作目录，将 Native `.dshdata`、已解压的新 1.x 根和可选密码文件放在其中。目标 data 必须为空，原包和凭据保留。

```powershell
node '<checkout>/experiments/official-payload/import-native-data.mjs' ./legacy.dshdata ./desktop --password-file ./native-password.txt
```

明文包省略最后两个参数。密码只从本地普通文件读取，最多 4096 字节，不写入参数正文、日志或收据；只迁入支持的设置、历史和工作区，默认排除凭据、插件和浏览器状态。这是数据迁移维护入口，不是 1.x 离线程序更新界面。

## 故障处理

下载遇 408/429/500/502/503/504 沿既有四次、2/4/8 秒预算重试；取消与身份校验失败仍立即停止。健康回退先检查上一版 EXE/ASAR；缺失时保留 current 与两份程序，不先删新版本。先保留失败运行的 JSON、日志和精确成品摘要，区分安装包身份、契约、运行、写入和安全门槛。不得通过关闭验签、修改官方 ASAR、放宽安全布尔值、覆盖旧资产或伪造 runner 环境来取得绿色状态。

需要冻结或撤回公开通道时，先回读并备份当前索引/资产，明确目标身份和用户影响，另行授权后操作。本文不再提供脱离当前索引和不可变规则的直接发布命令。
