# CodeQL 权限边界复核 / Trust-boundary review (2026-10-25)

独立核对 main `b0518a1e24d7a40720c449ce4c3eb4b384b4b417` 的实际 Git blob 与调用者后，以下两项按误报处理。没有关闭查询、排除源码或放宽路径、签名与进程归属校验。

| 告警 | 已核对的边界 |
| --- | --- |
| [1563：路径](https://github.com/WSL043/DSH-Portable/security/code-scanning/1563) | 五个来源均为启动进程的本地环境配置或维护者新建验收目录，没有 HTTP、页面或导入字段进入缓存根配置。623 行仅清理受信父目录下由已验证 SHA、进程 PID、时间戳生成的暂存子目录，不删除配置的缓存父目录。 |
| [1564：命令](https://github.com/WSL043/DSH-Portable/security/code-scanning/1564) | 独立升级烟测明确执行操作者选定成品目录下的固定引导器；唯一 CI 调用传同一工作流下载的 `artifacts`，旧 ZIP 来自本仓库 Release。没有 HTTP、Issue 或页面输入选择程序。参数数组且无 shell 是补充约束。 |

This review compares the exact main source blobs and their callers. Both findings concern intentional local operator capabilities, with no untrusted network input crossing the reported boundary: generated cache staging is removed beneath an operator-selected root, and the upgrade smoke deliberately executes its selected build artifact. Queries and source coverage remain enabled.

本记录只判断这两个告警，不代表完整安全审计。官方 1.x Electron/MCP 的上游等待仍见[独立跟进](one-x-mcp-followup-2026-10-23.md)，不作 0.9.7 Native 已修复声明。 This is a finding-specific review, not proof of zero risk; the separate 1.x upstream hold remains.
