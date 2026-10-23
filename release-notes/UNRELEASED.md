# 0.9.5 发布准备 / Release preparation

本轮范围以 [0.9.5 双语更新说明](v0.9.5.json) 为准：Windows Native 离线更新入口、通用窗口接口、窗口行为一致性和简短菜单。窗口外观由用户插件自定义，不内置皮肤或新旧 UI 偏好；见 [接口边界](../docs/window-plugin-boundary.md) 与 [离线更新](../docs/offline-updates.md)。发布状态、最终提交和成品摘要以 GitHub Release 证据为准。

1.x 官方 Electron 线等待官方修复内置 MCP 依赖，再重新验收；不修改官方 ASAR、不用 0.x 的 SDK 修复替它通过资格。见 [1.x MCP 复核](../docs/one-x-mcp-followup-2026-10-23.md)。0.x 已在 0.9.4 使用 SDK 2.3.0。

The [0.9.5 bilingual descriptor](v0.9.5.json) covers Windows Native offline update entry points, generic window capabilities, consistent window actions and shorter menus. Appearance remains a user plugin choice. Final publication, source revision and artifact checksums belong to the GitHub Release evidence.

The official 1.x Electron line remains blocked pending an upstream MCP fix and renewed qualification. Its ASAR is preserved; the 0.x SDK fix does not qualify the official 1.x payload.
