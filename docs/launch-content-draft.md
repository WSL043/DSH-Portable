# 推广素材草案（尚未对外发布）

## 定位

给想使用 DeepSeek Harness、但不想配置运行环境或通过命令安装插件的用户，一个开箱可用、方便移动和备份的桌面工作环境。

标题：**DSH-Portable：自带插件市场的 DeepSeek Harness 便携桌面版**

短介绍：下载后连接自己的模型服务即可开始。运行环境随包提供，插件在设置中搜索并点击安装；会话、设置与默认工作区集中保存，便于在同平台电脑间移动。支持 Windows、macOS 和 Linux，独立社区维护。

English: **DSH-Portable: DeepSeek Harness with a bundled runtime and visual plugin market.** Connect your model service, install plugins from Settings, and keep sessions and your default workspace together for same-platform moves and backup. Independently maintained for Windows, macOS, and Linux.

官网：https://wsl043.github.io/DSH-Portable/

## 40 秒真实演示拍摄单

| 时间 | 画面 | 说明 |
| --- | --- | --- |
| 0–8 秒 | 从后台不存在的状态启动最终验收包 | 显示真实启动过程；若剪辑，注明省略时长，不把加速片段当启动测速。 |
| 8–18 秒 | 设置中搜索插件、打开详情、点击安装 | 展示界面操作；使用可移除测试插件与隔离 Profile。 |
| 18–27 秒 | 打开测试图片、缩放并添加备注；展示归档搜索 | 两个默认插件的实际效果。 |
| 27–36 秒 | 完全退出后移动测试目录，再次打开测试会话 | 同平台目录移动，不能冒充跨系统迁移或第二台机器实测。 |
| 36–40 秒 | 官网下载入口 | 一处下载链接；可轻量邀请 Star，不遮挡下载。 |

素材必须来自最终验收包，不使用设计稿代替实机。仅使用合成图片和测试会话；此文件是脚本，视频尚未录制。先完成稳定版验收，再更新已有官方社区介绍；其他社区帖按其规则分别准备，得到发布授权后再发。

## 衡量

运行 `node scripts/snapshot-repository-traffic.mjs`，将 GitHub 聚合数据保存在本地 `.artifacts/traffic/`。需要已登录且有流量读取权限的 GitHub CLI；不添加客户端遥测。

每周同一时间手动保存，比较来源、访问日期和同一资源的下载增量。14 天窗口重叠，不相加；来源访客可能重复。旧版本下载不能直接解释为新增用户，克隆可能来自 CI。Star 只作辅助指标，不从这些数据计算安装转化率或留存。官网访问和下载按钮点击目前没有单独测量，不把 GitHub 的官网引荐数当官网总访问量。

优先检查：新首屏是否让用户快速找到下载和插件市场；真实演示上线后是否出现新的社区引荐。没有效果再调整素材和渠道，不以增加功能数量替代验证。
