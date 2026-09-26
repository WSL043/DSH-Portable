# Issue #147：连接中断与插件启动失败调查

2026-09-26。状态：初步源码调查完成，报告环境尚未复现，不能关闭或宣称修复。

来源：https://github.com/WSL043/DSH-Portable/issues/147 。本次通过 GitHub API 读取正文和评论；评论为空，报告未附日志。填写的 `0.1.7-alpha.1` 是内核版本，Portable 产品版本未确定。正文列出了 bundle 名称，但没有已安装版本、锁文件或明确的触发插件。

## 已核对的边界

- 运行中重连是症状，不能据此区分后端退出、认证失败、连接恢复或客户端异常。官方 RC2 的 `packages/client/connection/src/client/index.ts` 仍监听浏览器 online/offline 并控制重试；这不是该用户 alpha.1 成品的复现证据。
- Native 的 `scripts/patch-loopback-connection.mjs` 对本地回环连接跳过浏览器网络状态监听。它解决的是本地服务不应受外网断线影响的问题，不保证插件异常或进程崩溃后恢复。报告成品是否包含此适配尚未知。
- `launcher/startup-profile-recovery.mjs` 和 `launcher/windows/DSH-Recovery.cs` 已提供检查、暂停、恢复启动 bundle 的入口。暂停只修改启动列表，保留依赖、配置和会话；普通组件修复不等于修复第三方插件逻辑。
- 当前恢复诊断检查包能否解析和配置是否有效，不证明插件激活及 UI 运行正常。不能把诊断 `ok` 当作插件兼容通过。
- 当前 issue 模板已经分别询问产品与内核版本，并提示导出支持报告；无需重复增设同类字段。

## 本次验证

`node --test tests/startup-profile-recovery.test.mjs tests/patch-loopback-connection.test.mjs`

10 项通过、0 失败、1 跳过（Windows 文件符号链接权限）。覆盖定点暂停/恢复、损坏恢复记录、后端运行时拒绝修改和回环适配分支。属于源码回归，不是报告机器或其插件组合的实机验收。

## 下一步所需证据及分流

1. 取得实际 Portable 版本和一次故障后的脱敏支持报告；优先看 `dsh.stderr.log`、`dsh.stdout.log`、runtime/desktop health 时间线，并确认断线时是否在安装或启停插件。不得要求上传凭据或原始会话。
2. 按准确内核和插件版本建立隔离 profile，先测原始基线，再逐组加入社区插件。不要直接把正文中的批量安装指令当作对维护者机器的操作授权，也不污染现用 profile。
3. 后端退出：定位退出码与异常栈；后端存活但连接失败：查认证与连接状态；连接正常但 UI 卡死：查客户端异常。以最小复现决定归属。
4. Portable 启动/安装/认证问题由本仓库修；官方内核问题提交最小复现到上游；插件内部问题转对应作者。本仓库仍负责让错误可见、故障插件可隔离和数据可保留。

建议向报告者索取的内容：Portable 产品版本、故障发生时间及当时操作、脱敏支持报告。仅凭当前材料不能认定多个插件冲突，也不能声称 Electron Alpha 已修复本 issue。
