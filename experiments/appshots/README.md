# Appshot experiment / Appshot 实验

Windows native capture prototype using public Windows Graphics Capture and UI Automation APIs. Not a shipped plugin or default feature yet. See [research and acceptance](../../docs/appshots-research-2026-09-12.md) for the integration boundary and remaining work.

这是通过 Windows 原生接口实现的窗口图片和文字采集原型，尚未接入默认产品。实验会创建自己的后台测试窗口，不操作鼠标、不切换用户窗口，也不发送模型请求。实现范围、失败记录和待验收项目见上面的研究记录。

Build and run from the repository root / 在仓库根目录执行：

```powershell
./experiments/appshots/build.ps1
node --test experiments/appshots/capture.test.mjs
./experiments/appshots/accept-windows.ps1 -RunName run-5
```

Artifacts and logs stay in `build/appshots-experiment`. The helper captures only the explicit HWND and matching process ID supplied to it; screenshot and accessibility text are sensitive attachment content, not diagnostics to include in general support logs.

产物和验收证据保存在 `build/appshots-experiment`。图片与应用文字属于用户附件内容，不能混入普通支持日志。
