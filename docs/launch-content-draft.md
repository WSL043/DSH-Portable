# 推广素材草案（尚未对外发布）

## 定位

给想使用 DeepSeek Harness、但不想配置运行环境或通过命令安装插件的用户，一个开箱可用、方便移动和备份的桌面工作环境。

标题：**DSH-Portable：自带插件市场的 DeepSeek Harness 便携桌面版**

短介绍：下载后连接自己的模型服务即可开始。运行环境随包提供，插件在设置中搜索并点击安装；会话、设置与默认工作区集中保存，便于在同平台电脑间移动。支持 Windows、macOS 和 Linux，独立社区维护。

English: **DSH-Portable: DeepSeek Harness with a bundled runtime and visual plugin market.** Connect your model service, install plugins from Settings, and keep sessions and your default workspace together for same-platform moves and backup. Independently maintained for Windows, macOS, and Linux.

官网：https://wsl043.github.io/DSH-Portable/

## 截图展示

按用户最新决定，不制作演示视频。官网使用已有暗色实机截图，点击可放大，并明确区分截图与网页中的快捷键示意。后续替换截图需保留版本及来源，使用测试会话，不展示私人内容。

## 衡量

运行 `node scripts/snapshot-repository-traffic.mjs`，将 GitHub 聚合数据保存在本地 `.artifacts/traffic/`。需要已登录且有流量读取权限的 GitHub CLI；不添加客户端遥测。

每周同一时间手动保存，比较来源、访问日期和同一资源的下载增量。14 天窗口重叠，不相加；来源访客可能重复。旧版本下载不能直接解释为新增用户，克隆可能来自 CI。Star 只作辅助指标，不从这些数据计算安装转化率或留存。官网访问和下载按钮点击目前没有单独测量，不把 GitHub 的官网引荐数当官网总访问量。

优先检查：新首屏是否让用户快速找到下载和插件市场；真实演示上线后是否出现新的社区引荐。没有效果再调整素材和渠道，不以增加功能数量替代验证。
