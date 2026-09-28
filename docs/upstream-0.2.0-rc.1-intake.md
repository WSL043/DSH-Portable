# 官方 DSH 0.2.0-rc.1 接入记录

核对日期：2026-09-29。官方标签为 [dsh-v0.2.0-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1)，指向源码提交 [4878cdabd87d4041bdaff61d04c966883b9fd07a](https://github.com/deepseek-ai/deepseek-harness/commit/4878cdabd87d4041bdaff61d04c966883b9fd07a)。

## 来源与依赖

- upstream.lock.json 记录 tag→commit 与 npm 包 integrity：sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng==；[npm 元数据](https://registry.npmjs.org/@deepseek-ai%2fdsh/0.2.0-rc.1)没有 gitHead，与 alpha.1、rc.2 相同，故摘要固定包字节但不声称 npm 提供了源码证明。
- 锁文件用 npm 11.17.0 全新解析；原位更新触发 npm Link.matches 异常，故在隔离目录重建。最终 lock 解析 723 个节点，不含 rc.2 包路径。
- @deepseek-ai/libreoffice-kit 固定为 0.1.1，并以 override 保留 fflate 0.8.3；koffi 安装脚本白名单为 3.1.1。官方 release package family 共 318 个包。
- 自动化任务 Schedule bundle 在官方依赖闭包中，但默认 Web profile 不加载，Portable 默认插件档案也不启用它。

## 历史会话迁移

- rc.1 与 rc.2 的 validation.ts blob 均为 762ed963f73c7159f5309176cc69b11db25ac634，payload-validation.ts blob 均为 5b19f7cc6668d8e9bfc1c75806d3898132eb94ee；npm 内 lib/index.js 输入 SHA-256 同为 1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1。
- 精确补丁身份为 1b3b…90b1 → 18a9dbd15694de23a89a9db8787f336e9da1ddf70a32f2ecd9c2918011c833d6，并绑定 0.2.0-rc.1；实现见 [patch-historical-descriptor.mjs](../scripts/patch-historical-descriptor.mjs) 与 [verify-historical-session.mjs](../scripts/verify-historical-session.mjs)。
- 独立 staged app 实跑记录中，历史读取、AgentLoop 继续、持久化保存后重开、中断日志恢复、原始文件不变均通过。此结果不是最终成品验收；产品成品仍需完整 CI，物理断电恢复未验证。

## 插件页与默认插件

- rc.1 刷新动作改用精确 aria-label=t("refresh") 锚点；保留 rc.2 的 title: t("refresh") 旧锚点。锚点缺失、多重或歧义时失败，不放宽匹配；见 [patch-native-settings-command.mjs](../scripts/patch-native-settings-command.mjs)。
- **已发布**：默认图片查看器 [0.1.4](https://github.com/WSL043/dsh-image-viewer/releases/tag/v0.1.4) 与会话管理 [1.5.3](https://github.com/WSL043/dsh-chat-manager/releases/tag/v1.5.3) 均已发布为 npm `latest`，且声明兼容 alpha.1、rc.2、0.2.0-rc.1。图片查看器三内核官方验收及发布工作流 [CI run 36463863431](https://github.com/WSL043/dsh-image-viewer/actions/runs/36463863431) 成功；会话管理发布工作流 [CI run 36463858247](https://github.com/WSL043/dsh-chat-manager/actions/runs/36463858247) 成功。这里不表示 Portable 0.8.0 已发布。
