# 1.x 旧数据、跨机与异常恢复验收

本轮维护，不发布、不创建草稿或标签、不启用桌面通道。延续 [基线记录](one-x-maintenance-2026-10-23.md)，MCP 实包复现与处理路线见 [安全复核](one-x-mcp-followup-2026-10-23.md)。

## 显式离线迁入

`experiments/official-payload/import-native-data.mjs` 复用现有 Native 数据包、路径校验、历史日志重定位和导入恢复代码，不添加格式或依赖。从本仓库 checkout 用 Node 24 或更高版本执行；纯包不增加 Node、插件或适配器。

完全退出旧 Native 与目标桌面后，用旧 Native 现有导出功能产生独立数据包；命令行等价示例：

```powershell
& '<Native>/runtime/node/node.exe' '<Native>/launcher/portable-cli.mjs' backup-data --output 'D:/transfer/Native.dshdata' --categories settings,sessions,workspace
Set-Location 'D:/transfer'
node '<checkout>/experiments/official-payload/import-native-data.mjs' 'Native.dshdata' 'DSH-Portable'
```

先切到专用迁移工作目录，归档与目标根均须在该目录下；路径逃逸拒绝。目标为全新解压、尚无使用数据的 1.x 根。`data` 可不存在或只有空目录；已有文件、junction/符号链接均拒绝。来源包只读，先复制自有暂存快照，再用同一快照校验、恢复和记录摘要。只含 Native 窗口/启动器偏好的包拒绝，收据数量只计算真正提交的文件。

提交内容为 `data/dsh-home`、`data/workspace` 和 `data/launcher/native-import.json`。会话目录 key、已知各代普通/Zstd 日志的 cwd、嵌套 storage JSON 中精确相等的工作区路径由现有逻辑重定位；历史事件与后续压缩帧不作全局替换。涉及历史/工作区却缺少 `portableWorkspace` 元数据的旧包要求重新导出。

不迁入旧 `profiles/web`、插件依赖、`.credentials.yaml`、浏览器登录状态和 Native 窗口设置。这里只按既有类别排除凭据文件，不承诺会话/自定义 settings 不含用户写入的敏感文本；归档与暂存按原数据保护。验收只用合成数据，无真实密钥、账号或远端 MCP。

旧 `settings.yaml` 由官方 importer 读取并改名为 `settings.yaml.imported`，按可用 section 写入新 desktop profile。未知 section 可能仅告警，不承诺全部旧 UI/插件设置继承。

准备成功后，以一次目录 rename 暴露整份新 `data`。最终预检仅用 `rmdir` 移除空目录；并发写入或启动造成失败，不递归删除已有数据。中断前暂存不成为 live data，旧暂存保留。验收后将输出 JSON 所列精确暂存目录移入回收站；原导出包按用户备份策略保留。

本路线验证最终目标路径上的导出/导入。之后再移动根目录，不会使官方工作区绝对路径自动变为相对路径；需从保留归档重迁入新空目标或在官方界面重选工作区，不声称启动器自动重定位所有官方数据。

## 验收与边界

- 本机复用唯一一份 0.2.1-rc.2 官方成品。合成源采用发布过的 V0 双帧 Zstd 会话、中文用户/助手消息、workspace unit v2 和旧 settings；另放假凭据、旧 web profile/browser marker，验证排除。
- 实际桌面必须显示旧工作区、标题和两条消息，完成官方 V0→V4 读取；冷启动后重验。settings 只断言实际接收 section，不以进程启动替代数据可用。
- 跨机由独立 Linux runner 导出小归档，Windows 2022/2025 runner 下载后实际运行官方桌面。证据绑定归档摘要、源/目标 OS、home、hostname、成品与 source commit；改 USERPROFILE 或本机换目录不算跨机。
- 两项集成测试覆盖普通/Zstd 历史、后续帧原样、嵌套 storage、中文工作区、默认排除、源保全、已用目标/junction/损坏包/缺元数据/无用户数据拒绝，接入已有三平台 Data transfer safety。

首次独立 Windows 2022/2025 运行均在首轮完整 UI 通过后发现协议恢复缺陷：干净机器退出后残留官方首次写入的根默认 `URL:dsh` 与空 `URL Protocol`。本机预存协议根掩盖了此差异。修正仅保存/恢复这两项已知值的存在性、原值和类型，沿用 command 恢复并只剪除本轮新建空键；保留未知值/子键与原有空祖先，不做整树递归删除。须以修正后的独立运行重验，不能放宽全树对比。

## 异常恢复

已复现并修复：引擎发现既有 `.partial` 后拒绝继续，但 `finally` 仍可能删掉它。现在只清理本轮明确创建的暂存，未知目录与完整候选冲突保留。

网络重试沿 `InnerException` 识别有限暂态 `WebExceptionStatus`，避免只依赖英文消息。摘要、版本、路径、发布者等永久错误优先拒绝，unknown 不扩为重试。实际断连链与非英文消息类型化情景分别验证，不声称本机发生过系统语言故障。

Windows 故障注入覆盖关闭的 loopback 端口、断流后 Range 续传、错误摘要、错误 Content-Range、取消，以及解压中、候选移动后提交前、提交后分别强制终止。提交前旧 current/程序/草稿保全；提交后新版、previous、pendingHealth 保留；退出后锁释放。

遗留冲突不会自动覆盖或删除。验收先明确保全并移出冲突目录，再重试成功，没有新增自动修复事务层。另以真实共享句柄拒绝 current 原子替换，以及解包边界写失败，验证状态保全。Native 现有 ENOSPC/EIO 导入回滚也继续通过。

网络小夹具仍受真实签名门拒绝，强制终止用小型编译替身，不冒充官方包更新。写失败注入只代表同类 API 故障；未填满系统盘、未物理断电。

## 最终结果

验收完成后在此补入精确提交、运行编号和清理记录。MCP 2.2.0 仍使发布资格 blocked，迁移和恢复成功不豁免安全门槛。
