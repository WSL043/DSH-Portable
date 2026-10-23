# 稳定版（0.x）发布与新内核验收流程

官方出新内核后，按下面顺序走一遍；大部分步骤由定时任务自动完成，人只需要补缺口并发布。

## 1. 新内核出现时先查三件事

1. **补丁锚点**：`scripts/intake-upstream-core.mjs` 的第 5 项检查会用真实官方包验证 `scripts/patch-native-settings-command.mjs` 的锚点。失败说明官方改了页面代码（例如 0.2.1-alpha.2 把卡片标签数组改成逐行排版），修补丁并补测试，用官方新旧两版真实文件各验证一次。
2. **旧会话兼容名单**：`config/historical-descriptor-versions.json` 必须包含该内核版本，否则更新仓库会在 descriptor-v2 迁移检查处把它标为 `blocked`。官方 `session-format-v0-to-v1` 的 `lib/index.js` 与已验收版本字节一致时，直接加入名单。观察机器人的候选 PR（`automation/official-preview`）只是参考，里面的记录要手工带到 main，随后关掉那个 PR。
3. **插件声明**：默认插件的 peer 范围必须列出该内核。图片查看器和会话管理的定时任务会在官方 Release 发布后自动发新版；想提前可手动运行它们的 `upstream-compatibility.yml`。

## 2. 采纳插件并发版

先冻结本次交付的插件、版本和双语说明：

```bash
node scripts/adopt-default-plugins.mjs --write      # 仅在决定采纳已发布且兼容的默认插件时运行
node scripts/set-product-version.mjs x.y.z           # 同步所有版本号
# 编写 release-notes/vx.y.z.json（中英文及致谢），本地 npm test 通过后推送 main
```

最终 main CI 成功后、公开 Release 前，先用同一个发布工作流准备生产签名清单，供最终成品实机验收：

```bash
gh workflow run publish.yml --ref main -f run_id=<最终mainCI运行ID> -f tag=v0.9.5 -f prepare_only=true -f publish_feed=false
```

`prepare_only` 默认 false；设为 true 时仍校验确切 main CI、提交、版本、历史会话门禁及成品摘要，并使用原生产签名器与产品公钥验证。它只上传 Actions artifact `prepared-release-metadata-v0.9.5`（小型 JSON、签名、checksums、资格记录和说明），不创建 tag、Release 或更新源，也不生成正式发布 attestation。将其中原始清单与 `.sig` 同匹配的 CI ZIP 配套，在隔离目录完成真实旧版 → 最终新版更新、健康及回滚验收；不得改清单、重签或覆盖产品源码。保存最终 CI/成品/清单摘要；后续正式发布仍使用同一源码和 CI，回读原始清单与成品摘要一致。目录历史可能随之后的新记录变化，ECDSA 签名也可随机不同，不将索引或签名文件的逐字相同当作成品身份。

上述最终验收通过后再执行下面的正式流程；`prepare_only` 不代替成品验收，也不改变先公开下载、验内核、最后翻更新源的顺序。正式发布的两份 attestation 保持必需。

```bash
scripts/ship-stable.sh x.y.z
```

`ship-stable.sh` 的顺序是**先验内核、后让用户看到新版**：

1. 等 main 上对应提交的构建通过。失败先查原因，不能靠反复重跑掩盖产品失败。仅在确认 GitHub 终态延迟或 npm 新包元数据先于压缩包可用等外部故障、保留原日志并取得恢复证据后，允许一次不改输入的定向复验；npm 下载恢复还须核对完整性摘要。再次失败继续诊断，不扩大重跑或放宽断言。
2. 触发“Publish tested release”，但 `publish_feed=false`：Release 和下载包已发布，应用内更新源**不翻**，已安装的用户还停在上一个版本。
3. 检查**最新五个内核、至少两个 RC 或正式版**的窗口。同一 `requiredShellContract` 下 stable 目录已经提供的内核可沿用验收；其余触发更新仓库的“Sync verified DSH core”，在本次发布提交上验收。窗口内曾被 `blocked` 且从未在任何外壳验收成功的内核记为 `excused`，不会发布，也不阻挡外壳发布。其他 `failed`/`blocked` 会退出，更新源保持不变；仍有 `pending` 时继续等待。
4. 全部通过后再用 `publish_feed=true` 翻更新源。

内核验收失败时：修原因（多半是更新仓库的验收脚本或补丁锚点），再运行 `scripts/ship-stable.sh x.y.z --resume`。只有紧急情况才用 `--skip-gate`（发布并立刻翻更新源）。

更新仓库已有其他内核随后发布时，不要 rerun 旧运行来恢复发布：旧 resolve/selection/qualification-state 快照可能覆盖新记录，使目录或资格状态回退。保留原失败与当前目录。下面的 fresh dispatch 只适用于重验当前 Portable `upstream.lock.json` 锁定的内核（本次为 0.2.1-rc.2），让它重新读取已发布状态；它不是指定任意失败内核的通用恢复命令：

```bash
gh workflow run sync-core.yml --repo WSL043/DSH-Portable-Updates --ref main -f remaining=0 -f accepted_only=false -f rebuild=true
```

回读新运行的 selection、资格状态及五平台目录，确认选中的内核和其他已发布项均正确；该命令不自动证明旧失败已解除。

背景：Portable 的整包更新会整体替换程序；用户在目标外壳还没有兼容内核时升级，可能丢掉自己选的内核（issue #163）。现在内核以 `requiredShellContract` 匹配外壳，接口号相同可沿用已验收内核，不必每发一次外壳就重验；没有接口号的旧版本仍按确切版本与指纹匹配，详见 [shell contract](shell-contract.md)。GitHub 的触发接口偶尔连续返回 HTTP 500，脚本每分钟重试一次。

## 3. 注意

- 验收脚本放在更新仓库（`scripts/verify-default-plugin-ui.mjs`）。界面新增弹窗、改按钮位置的改动，要在同一次发版前同步改它；否则内核验收会失败。
- 新内核只能在**已发布**的稳定版上验收：更新仓库用已发布版本的源码构建，所以补丁、名单和默认插件的改动要随下一个稳定版一起发布。
- 候选（preview）渠道已退役；候选 PR 的更新检查按设计会失败，不要修。
