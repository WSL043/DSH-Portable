# 官方 Desktop rc.2 便携化首轮验证

检查日期：2026-09-25 至 26 日。目标是决定能否从官方 Electron Desktop 构建独立的 Portable 试验版；这不是正式产品、登录或跨机器迁移验收。

## 真实发行物

- 来源：[官方 Windows x64 Nightly feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml)，版本 `0.1.7-rc.2`，发行物 288,245,480 字节。下载后的 SHA-512（Base64）为 `AY7f45dYO7BFrfgaLmzXNWP0pavlxkSbsehPo/WF6PXcFdDK3fF1oHUPs/4f2bzROgQvm6wSgawZ/g7UzbPRmw==`，与 feed 完全一致。Windows `Get-AuthenticodeSignature` 对安装器和解出的 `DeepSeek Harness.exe` 均返回 `Valid`，证书主体为杭州深度求索人工智能有限公司。
- 只读解包发现 9,764 个文件，总文件长度 1,058,538,220 字节；这是直接提取的文件总量，不是完成安装后的磁盘占用，也不可与不同内核版本的 Portable ZIP 作同条件性能结论。归档目录 10,901 条，没有绝对路径或 `..` 路径。
- 发行物的 `resources/app-update.yml` 指向官方 `win-x64` Nightly feed。`app.asar` 中的应用清单标记 `dshMandatoryUpdatePolicy.origin=https://harness.deepseek.com`。源码的 `DesktopUpdateCoordinator` 在成品存在 `app-update.yml` 时可检查、下载和安装整套 Desktop。因此不把“外部启动器 + 原样签名成品”当作已解决更新归属；正式方案要么由官方整套更新独占 Electron 通道，要么取得明确的上游便携模式，不能暗改签名包。

## rc.2 开发适配

- 在隔离、忽略的检出中固定官方提交 `477b4f420553e8a52c2fbccc464d7561b239c443`。`experiments/official-desktop/prepare-development.mjs` 现支持 `rc2`，只接受 `main.ts` 和 `update-coordinator.ts` 的精确 SHA-256；输出独立源码覆盖层，不编辑下载的签名发行物。开发入口在 Electron 选定日志路径前要求绝对的 `DSH_PORTABLE_DEVELOPMENT_ROOT`，把 DSH home、Electron userData、sessionData、日志和崩溃目录放在该根目录；开发更新器拒绝官方安装器调用。
- `pnpm install --frozen-lockfile --ignore-scripts`、官方 `pnpm run build` 和适配后的 `pnpm --filter @deepseek-ai/dsh-desktop run build` 均成功；独立的 `pnpm run build:lib:host` 也成功。覆盖层校验在真实更新协调器上记录 **0 次更新 I/O**；原先 alpha.2 覆盖层仍通过校验。上游更新协调器专项 15/15 通过。
- rc.2 覆盖层还对上游开发启动脚本的精确 SHA-256 固定 `--prepare-only` 开关：只准备真实开发项目与 Primary Runtime，不打开窗口。这一步实跑成功，包含 Office runtime 版本和文档往返检查。开发源码覆盖层的 `dev.ts` 与隔离检出中实际执行的文件 SHA-256 一致。
- 用 Electron 44.0.0 官方 ZIP（SHA-256 `e61aa3bcea8152bc0730abd015e47c032d778a0ef10e2a1c78ba3c4ea47942f9`）在独立 Windows 桌面启动编译后的**真实官方 Desktop 开发宿主**，没有调用签名安装器，也没有使用现有 Portable profile。它连续运行 35 秒以上；CDP 显示欢迎页 `readyState=complete`，标题 `DeepSeek Harness`，可见登录与添加 API Key 入口，截图视觉检查通过。实际进程写入隔离的 DSH home、Electron userData 和日志根；原有 3080 服务仍由原进程占用。
- 退出后把隔离数据目录从 C 搬到 D，再次启动仍出现欢迎页。另一次从 E 搬到 F 的试验在搬迁前通过 CDP 写入固定的无敏感数据 `localStorage` 标记，搬迁后读回相同值 `rc2-test-value`。该证据只证明开发宿主的这部分状态可随目录移动，**不证明**跨机器凭据、全部会话、插件数据或账号登录可迁移。
- 上游 `main-startup.spec.ts` 的模拟 `app` 没有新适配所要求的 `isReady()`，故在这个隔离检出上大批失败；这是测试替身未接入新开发约束，不是实机启动失败。下一阶段须补齐该替身，再验断网冷启动、插件、账号、目录外写入及正常退出恢复。隐藏桌面探针到期后终止该进程组，因此本轮也不声称已验正常关闭。

本轮已证明当前官方 Desktop 开发宿主能在隔离目录启动、渲染欢迎页并保留一个随目录移动的浏览器状态标记；还不能分发开发包或替换正式产品。现有 Native 产品继续交付 Windows/macOS/Linux；Electron 试验版若成立，将以官方整套桌面更新与其绑定内核建模，不宣称保留 Native 通道的独立内核选择。

验收后确认没有残留的试验 Electron 进程；下载的安装器、约 1 GB 解包副本、Electron ZIP 和合成数据根已移入回收站。保留隔离源码检出、已校验的 Electron 开发运行时、构建日志和脱敏欢迎页截图，供下一轮补齐插件与离线验收；未改动现用 Portable 数据。
