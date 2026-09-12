# Appshot experiment / Appshot 实验

Windows experimental plugin using public Windows Graphics Capture and UI Automation APIs. Locally installed and checked on Portable 0.6.8 / DSH 0.1.5-rc.2; not part of a published release or the default plugin set. See [research and acceptance](../../docs/appshots-research-2026-09-12.md).

这是 Windows 实验插件，已接入本地 Portable 0.6.8 / DSH 0.1.5-rc.2，尚未纳入发布包。左右 Ctrl 同时按下时锁定前台窗口，松开后显示预览；确认后将图片、可读文字添加到当前草稿，不会自动发送。待处理快照仅保存在内存，两分钟后清除。输入区的 Appshot 按钮也可打开预览。用户此次明确要求启用该快捷键，卸载插件并重启即可停用。

附件适配使用隔离的内核兼容接口，检查图片能力与大小限制；尚不能承诺其他内核版本。验收使用后台测试窗口及独立无头浏览器，不发送模型请求。真实物理按键、任意应用、多屏 DPI 场景仍需用户试用，不能用状态机测试替代。

Build and run from the repository root / 在仓库根目录执行：

```powershell
./experiments/appshots/build.ps1
node --test experiments/appshots/capture.test.mjs
./experiments/appshots/accept-windows.ps1 -RunName run-5
node --test experiments/appshots/plugin.test.mjs
./experiments/appshots/build-plugin.ps1
```

Artifacts and logs stay in `build/appshots-experiment`. The helper captures only the explicit HWND and matching process ID supplied to it; screenshot and accessibility text are sensitive attachment content, not diagnostics to include in general support logs.

产物和验收证据保存在 `build/appshots-experiment`。图片与应用文字属于用户附件内容，不能混入普通支持日志。
