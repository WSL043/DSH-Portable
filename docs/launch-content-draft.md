# 对外介绍与推广入口

## 统一定位

DSH-Portable 是面向希望直接使用 DeepSeek Harness 的用户的独立社区桌面发行版。

一句话：**免配运行环境、在界面安装插件，把 DSH 工作环境一起带走。**

四个宣传重点，按顺序展开：

1. **免配环境**：运行环境随包提供，连接自己的模型服务即可开始。
2. **界面装插件**：融入上游 [dsh-market](https://github.com/dsh-market/dsh-market)，常规安装不用敲命令。
3. **工作环境随行**：完整退出后在同系统同架构电脑间复制完整目录。外部项目单独迁移；AppImage 同时携带旁边的数据目录。
4. **独立更新**：Portable 桌面和官方内核分别管理，内核选择受兼容性约束；正常更新保留数据。

不是官方客户端，不包含免费模型额度，不承诺同一程序目录跨系统运行，也不把市场收录当作对所有插件的验证。

English: **DeepSeek Harness with a bundled runtime, visual plugin installation, and a movable workspace.** Portable and compatible official kernels update separately. Independently maintained for Windows, macOS, and Linux; complete-folder moves require the same OS and architecture.

## 两篇可复用图文

内容源：`docs/promotion/guides.json`。网站构建同时生成正式网页和 `build/promotion/*.md`，避免官网与社区稿件分别维护。

- 入门：https://wsl043.github.io/DSH-Portable/guides/get-started.html
- 迁移：https://wsl043.github.io/DSH-Portable/guides/move-workspace.html

图片使用仓库的真实界面截图，标明版本差异。官网烟雾、水面和倾斜效果只用于视觉展示，不当作运行中的 DSH 演示。

## Star 入口

README 顶部使用 Star 数量徽章；底部和官网链接到仓库首页，引导使用 GitHub 原生 Star 按钮。

README 图片不能执行点赞请求；GitHub 的 Star API 需要用户身份与授权。普通第三方 Star 徽章也只是仓库链接，不能代访客直接点赞。不要请求访客粘贴令牌、不要把跳转标记为点赞成功。

## 当前生态入口（2026-09-10 核对）

| 入口 | 当前状态 | 后续动作 |
| --- | --- | --- |
| 0xsline/awesome-deepseek-harness | Portable 已收录，描述包含运行环境、插件市场、数据保留 | 保留，不重复投稿 |
| Zhiyuan-Fan/Awesome-DeepSeek-Harness-Plugins | Portable 已收录，已有官网链接 | 保留，不重复投稿 |
| Dominic789654/awesome-deepseek-harness | 已收录，但描述错误暗示 Windows/macOS 之间直接移动，遗漏 Linux | [更正请求 #438](https://github.com/Dominic789654/awesome-deepseek-harness/issues/438)，等待维护者处理 |
| awesome-dsh-plugin/awesome-dsh-plugin | 两个默认插件均有 YAML 数据条目 | [图片查看器移除过时 Beta 标签 #4756](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4756)，投稿门检查已通过；目录构建因其他三个条目缺少可推导日期而失败，已在 PR 记录日志，待上游处理。Portable 本身不符合该目录的可安装插件要求 |
| DeepSeek Harness 上游社区 | 已有维护者发布的介绍帖 [#5060](https://github.com/deepseek-ai/deepseek-harness/discussions/5060) | 在原帖同步四个重点和使用指南，不重复开帖 |

## 首轮渠道实验

按已观察到的来源决定优先级，不要求维护者凭感觉挑选两个社区。2026-09-10 查询 GitHub 引荐统计：GitHub 197 次访问 / 74 位独立访客，Bing 67 / 35，官网 56 / 16，Google 17 / 14。各来源访客可能重叠；这些是仓库引荐统计，不代表平台总体潜力、官网访问量或安装转化。

1. 优先 GitHub：维护现有上游介绍帖与已收录目录，跟进上述更正请求；不重复投稿。
2. 其次搜索：两篇指南已上线，待站长所有权验证后提交 sitemap，并依据实际查询词改进页面。
3. 外部社区作为后续小规模实验：先核对受众和自荐规则，再准备对应稿件。账号与发布授权确认前不代发，也不把尚未投放记为完成。

- 第一篇面向新用户，重点是开始使用的路径。
- 第二篇面向已有会话和插件的用户，重点是迁移边界和实际操作。
- 两个社区的首次发布至少错开 7 天，避免难以分辨变化来源。正文说明作者是维护者，先给可用步骤，再放下载链接。
- 阅读社区当前自荐规则后使用合适分区；不批量复制评论、不重复顶帖。
- 每篇保留来源网址、发布时间、阅读量、相关访问引荐、实际反馈，以及相同安装包下载计数的变化。公开稿件中不把下载计数称为使用人数。

UTM 示例：`?utm_source=community_name&utm_medium=community&utm_campaign=portable_202609`。当前没有官网访问/点击统计服务，UTM 仅是来源标记，单独加上它不能生成渠道转化报告。

## 复盘

1. 发布前运行 `node scripts/snapshot-repository-traffic.mjs` 保存 GitHub 基线。
2. 发布 7 天后再次保存，运行 `node scripts/compare-repository-traffic.mjs <旧快照> <新快照>`。
3. 看来源、问题反馈和同一资源下载增量；Star 是辅助指标。克隆可能来自 CI，下载包含重复请求。14 天访客窗口有重叠且可能滞后，不相减推算新增用户或安装转化率。
4. 出现新用户的同类问题时先改文档或产品；有效渠道再追加案例，无效渠道先调整受众与文案。

## 搜索收录

官网提供可直接抓取的中英文首页、两篇静态 HTML 指南、canonical、社交预览元数据和 sitemap。

Google Search Console 使用 URL 前缀属性 `https://wsl043.github.io/DSH-Portable/`，不要把共享的 github.io 当作自己的域名。Bing 也可验证这个 URL 前缀。

待账号与公开 HTML 验证标签提供后，添加验证文件或 meta 标签，完成所有权确认，并提交 `https://wsl043.github.io/DSH-Portable/sitemap.xml`。再对新版首页和指南请求索引；只有平台确认后才记为“已提交”。

项目目录中的 `/DSH-Portable/robots.txt` 不是整个域名根目录的 robots.txt，不能把它当作搜索引擎一定会读取的站点地图发现入口。Search Console/Bing 的所有权验证与提交仍需完成。

参考：[Google 站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[请求重新抓取](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)、[Bing 添加和验证站点](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b)。

## 本轮验收记录

- 2026-09-10：官网提交 `c273597` 的 [Website 工作流](https://github.com/WSL043/DSH-Portable/actions/runs/34421221212) 成功；线上中英文首页、两篇指南和 sitemap 均返回 HTTP 200，中文首页已显示新的 GitHub 跳转文案。
- 新流量快照已保存到本地 `.artifacts/traffic/2026-09-10T00-31-18.557Z.json`。距首轮调整不足一天，不据此判断推广成效。
- 生态 PR #4756 与更正 issue #438 仍开放，尚未合并或解决。搜索平台所有权验证、实际社区投放和转化分析仍未完成。
