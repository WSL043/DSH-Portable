# 默认插件双内核正式发布

两款插件的同一发布包声明并实际验收 DSH 0.1.7-alpha.1 与 0.1.7-rc.2：

| 插件 | 正式版 | 发布及双目标操作验收 |
| --- | --- | --- |
| 图片查看器 | 0.1.3 | https://github.com/WSL043/dsh-image-viewer/actions/runs/36372460536 |
| 会话管理 | 1.5.2 | https://github.com/WSL043/dsh-chat-manager/actions/runs/36372462823 |

图片客户端现有代码已包含两代图标、附件与草稿接口兼容，稳定0.1.2到本次主干没有src变化。会话插件保持官方slot客户端，带入Cordis original代理服务追踪及热重载包装清理修复；不复制官方工作区。

本地图片31项、会话116项测试通过。发布流程实际验证两个内核：图片的composer附件、图库、缩放拖动、备注、下载、Esc焦点、标注回原草稿及安装卸载；会话的危险色、删除取消无请求、确认删除、连续四次插件启停后输入框可编辑。此次纯官方宿主的会话验收不覆盖Portable增强归档搜索/恢复分支，图片验收不替代消息图片入口专项；不宣称全功能视觉覆盖。已回看两个目标的会话菜单截图，红色删除及输入区显示正常。

npm latest与GitHub非预发布版本均已回读。公开tarball的SHA512与npm完整性一致，SHA256已写入upstream.lock.json。证据位于build/plugin-dual-target-release/public-packages.json。Portable默认插件更新/预检6项通过，实际调用Updates default-peers-only对alpha.1及rc.2均返回success。

此变更更新主线下一产品的默认锁，不改写已发布0.7.6的不可变默认插件。自动内核资格仍以发布产品基线为准；rc.2历史会话迁移和整体成品门槛仍独立存在，不能把插件通过当作最新内核已经推送。
