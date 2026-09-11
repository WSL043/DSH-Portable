# 0.6.7 发布验收

- 发布源码：`8b29b9717599f26f805a7978a2d76b4f93a7b6ab`，内置 DSH `0.1.5-rc.2`。
- [成品验收](https://github.com/WSL043/DSH-Portable/actions/runs/34578038745)：35 项一次通过，无重跑。包含 Windows 2022/2025 原生生命周期、八方向缩放命中、完整离线包双运行时路径、更新回滚、插件、macOS 与 Linux 成品验证。
- Windows 2022 缩放证据：`build/release-0.6.7-windows-2022/resize-border.txt`。通过原生窗口消息检查，不使用前台鼠标输入，不等同于人工拖动验收。
- 外部插件版本变化检测通过针对性测试和服务端构建；检测版本号变化，不宣称修复订阅插件历史 `undefined.get` 错误，也不涵盖相同版本号下修改文件。
- [发布工作流](https://github.com/WSL043/DSH-Portable/actions/runs/34580228552)成功，发布复用验收产物。Windows 标准 ZIP 58,610,416 字节，完整离线 ZIP 341,783,522 字节。
- 稳定和候选通道的五个平台 Portable 索引已逐一读取，首项均为 0.6.7。
- [新 Portable 基线的内核重新验证](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/34580346648)已触发，记录时尚未确认完成。
