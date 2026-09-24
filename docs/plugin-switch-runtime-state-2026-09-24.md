# 插件开关与实际运行状态 · 2026-09-24

官方插件页的开关表示插件是否列在 profile 的 `dsh.profile.bundles` 中。用户的 `cordis.patch.yml` 仍可独立插入或停用同一插件，因此开关位置不能单独作为运行状态证据。Portable 在官方插件卡片的现有扩展槽中读取 `/dsh-market/installed`，仅在两者不一致时标出“关闭后仍在运行”“开启但未运行”或“停用待生效”。请求失败时清除旧判断，不覆盖官方开关，也不改写用户的自定义配置。

验收使用隔离的 Windows Portable 成品和独立数据、运行缓存。只将本次构建的市场客户端放入该隔离缓存，配置两种不一致情形：会话插件在 bundle 中但被 profile 补丁停用；图片插件不在 bundle 中但由补丁加载。后端 `/dsh-market/installed` 分别报告 `bundle=true / activation=disabled` 和 `bundle=false / activation=live`。真实 DSH 插件页在暗色、亮色下都显示对应提示；在页面切换图片插件开关，提示随状态消失、恢复；切换会话插件开关也同步刷新。返回新会话后输入区仍存在，页面错误日志为空。

验证：插件市场类型检查和构建通过；仓库测试 845 项中 831 通过、14 项因环境条件跳过、0 失败。以上是隔离浏览器及成品后端的验收，**不是**新发布包的原生 WebView2 验收，也不证明所有用户自装插件的切换路径。已停止隔离宿主；原实验安装中的自定义 Qwen、搜索及截图配置未改动。

正式候选仍受 [`preview-release-readiness.json`](../preview-release-readiness.json) 的历史会话迁移门槛阻止：当前锁定的 DSH `0.1.7-rc.1` 对已发布过的 descriptor v2 会话仍无通过证据。该门槛不能由此插件页验收代替。
