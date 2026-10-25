# 0.9.7 最终成品验收（2026-10-25）

[0.9.7](https://github.com/WSL043/DSH-Portable/releases/tag/v0.9.7) 已发布。成品固定 main `004020599d07d6c6148582cbed32746c6472e42d`，不是随后补写文档的 main。

## 产品与本地交付

- [精确成品构建40176307660](https://github.com/WSL043/DSH-Portable/actions/runs/40176307660) **39/39 成功**。Node 24.22.1，默认内核0.2.1-rc.3，默认插件 Image Viewer0.1.16、Chat Manager1.5.18。
- 原始生产签名清单与同一 Windows ZIP 实际完成 FullUpdater 整包事务；Native摘要与 CI 附件一致。保留 data、workspace、environments 和 installed-mode.json；隐藏健康检查前后窗口位置文件逐字一致。
- 实际0.9.5旧更新器先拒绝 schema2，尚未停止进程或改动保护数据。0.9.6及更早用户请使用0.9.7新版引导器；离线三件套获取与操作见[指南](offline-updates.md)。
- 本地现有包已升级为同一成品：凭据与 profile清单逐字不变，自定义设置、插件和保护目录身份保留；实际 Native为 Medium，正常内核启动、停止和 Native退出通过。
- EPERM的本地原因是包根目录可继承 Low标签，纠正受管根标签时没有放宽 DACL。产品另修停止/状态命令不必要的新建租约，并兼容旧记录；不是修改官方模型或 MCP业务。

## Windows实际操作

- 普通原生栏及页面接管两种模式各三轮最大化/最小化还原，尺寸不累积增长；透明缩放模式的页面占满客户区，没有四像素内缩。
- 可见托盘菜单实际操作打开、最近会话、更多中的另一会话、新会话、恢复窗口栏；恢复后的最后状态立即为 menuVisible:true，同文档再次隐藏被拒。
- 侧栏折叠后的顶部新会话图标、Ctrl+N、全屏往返、File菜单快捷键绘制及真实目录选择器通过。设置两处从文件更新都打开系统选择器并正常取消。
- 全部本机操作在专用私有桌面，无桌面切换或全局鼠标键盘输入，控制台子进程强制 CREATE_NO_WINDOW。私有桌面第一次托盘回调偶有未观察到 popup；保留原记录，仅在零 popup、零点击时补一次回调，后续每个可见菜单项均独立核验。

## 五版本内核更新包

更新流水线固定 `091c9ce2bad3b66aea6bddc9209a0a97af4b426e`，所有包都配对上述已发布 Native源码；准备完成后复用原 ZIP晋升，没有重建替换。

| 内核 | 五平台准备 | 正式晋升 |
| --- | --- | --- |
| 0.2.1-rc.3 | [40178235613](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40178235613) | [40179845026](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40179845026) |
| 0.2.1-rc.2 | [40178238668](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40178238668) | [40180376663](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40180376663) |
| 0.2.1-rc.1 | [40178241942](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40178241942) | [40180678265](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40180678265) |
| 0.2.1-alpha.5 | [40178244986](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40178244986) | [40180907094](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40180907094) |
| 0.2.1-alpha.4 | [40178247733](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40178247733) | [40181295347](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/40181295347) |

五平台为 Windows x64、macOS arm64/x64、Linux arm64/x64，共25个包。逐项读回25份版本清单、5份目录和5份默认别名的生产签名；ZIP公开摘要、各平台 schema/fingerprint、Node24.22.1与Portable0.9.7要求一致。目录包含完整五版本，默认别名仍指向rc.3，未被后续回填的旧版覆盖。全部读回后才恢复原有 sync-core自动跟进。

窗口按最新五个、至少两个RC/正式版维护；新上游版本须先通过接口、数据与全平台资格。接口破坏或安全门槛不满足时继续阻断，不能承诺旧外壳无条件适配未来内核。

## 真实离线升级与会话

同一D盘程序目录临时移存原保护数据，另建无外部API凭据的数据，不降级原数据。公开原始JSON、签名与ZIP先实际安装rc.2，由官方headless写入真实v4会话；随后在实际Native中打开旧消息，经帮助菜单、系统文件选择器、确认卡片和进度完成rc.3更新。

升级后原始zstd日志修改时间仍早于更新确认，旧消息在真实界面可读；投影缓存随Web profile加载发生的重建不当作原始历史损坏。rc.3官方CLI以同一session ID续接到第2回合，新旧消息均实际落盘并在Native页面显示，Node和Native摘要不变。无外部模型调用，模型阶段按预期返回MISSING_CREDENTIAL；没有把它写成模型答复成功。结束后原保护目录863条快照的内容、链接和文件身份完全恢复。

## 发布读回与限制

- [产品发布40179645714](https://github.com/WSL043/DSH-Portable/actions/runs/40179645714)及[更新通道40183177372](https://github.com/WSL043/DSH-Portable/actions/runs/40183177372)成功。公开10项checksums与附件摘要一致，Windows更新ZIP与实际验收文件同SHA256。
- stable/candidate完整清单签名、schema2和Windows载荷核对通过；两通道五平台当前组件/目录20份签名均通过。本地现有包实际查询得到Portable当前/最新均0.9.7，内核当前/最新均rc.3。
- macOS/Linux为真实hosted CI，不是本机硬件；没有外推混合DPI、多显示器、实体第二机器或物理断电。旧数据与受控异常恢复的独立探针边界仍见构建门槛与历史记录。
- 内置依赖见[安全记录](bundled-dependency-security.md)，CodeQL逐项判断见[复核](security-review-2026-10-25.md)。1.x官方Electron/MCP仍[等待官方修复](one-x-mcp-followup-2026-10-23.md)，不解封、不发布，不作零漏洞保证。
- 临时产物按精确目标移回收站并验证`$I/$R`、文件摘要与链接，保留日志、摘要和关键截图；用户原便携包、共享缓存和仍被引用的自定义插件不纳入清理。
