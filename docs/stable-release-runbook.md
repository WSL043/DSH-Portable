# 稳定版（0.x）发布与新内核验收流程

官方出新内核后，按下面顺序走一遍；大部分步骤由定时任务自动完成，人只需要补缺口并发布。

## 1. 新内核出现时先查三件事

1. **补丁锚点**：`scripts/intake-upstream-core.mjs` 的第 5 项检查会用真实官方包验证 `scripts/patch-native-settings-command.mjs` 的锚点。失败说明官方改了页面代码（例如 0.2.1-alpha.2 把卡片标签数组改成逐行排版），修补丁并补测试，用官方新旧两版真实文件各验证一次。
2. **旧会话兼容名单**：`config/historical-descriptor-versions.json` 必须包含该内核版本，否则更新仓库会在 descriptor-v2 迁移检查处把它标为 `blocked`。官方 `session-format-v0-to-v1` 的 `lib/index.js` 与已验收版本字节一致时，直接加入名单。观察机器人的候选 PR（`automation/official-preview`）只是参考，里面的记录要手工带到 main，随后关掉那个 PR。
3. **插件声明**：默认插件的 peer 范围必须列出该内核。图片查看器和会话管理的定时任务会在官方 Release 发布后自动发新版；想提前可手动运行它们的 `upstream-compatibility.yml`。

## 2. 采纳插件并发版

```bash
node scripts/adopt-default-plugins.mjs --write      # 采纳已发布且声明兼容的默认插件
node scripts/set-product-version.mjs x.y.z           # 同步所有版本号
# 编写 release-notes/vx.y.z.json（中英文），本地 npm test 通过后推送 main
scripts/ship-stable.sh x.y.z
```

`ship-stable.sh` 会等待 main 上对应提交的构建通过，触发“Publish tested release”，等 GitHub Release 出现，再触发更新仓库的“Sync verified DSH core”，最后打印各内核的验收状态。GitHub 的触发接口偶尔连续返回 HTTP 500，脚本每分钟重试一次。

## 3. 注意

- 新内核只能在**已发布**的稳定版上验收：更新仓库用已发布版本的源码构建，所以补丁、名单和默认插件的改动要随下一个稳定版一起发布。
- 候选（preview）渠道已退役；候选 PR 的更新检查按设计会失败，不要修。
