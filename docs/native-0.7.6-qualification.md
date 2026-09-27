# Native 0.7.6 候选验收记录

状态：开发验收中，未发布。范围按 `native-release-exit-criteria.md` 的 G1–G8；Electron 与被隔离的 rc.2 不混入本批。

## 默认插件旧版升级

2026-09-27，使用隔离的隐藏 Native WebView2，通过随包 CLI 安装历史版本，再在官方插件页实际点击更新。未关闭 peer 或供应链检查，没有替换安装结果或伪造更新响应。

- 图片 `0.1.1 → 0.1.2`、会话 `1.4.0-beta.3 → 1.5.1`，安装版本与产品清单一致；下载更新期间未离开插件页，原来的禁用状态保留。
- 两款插件分别取消卸载、卸载、重新安装、启用通过。重装后图标显示正确；会话插件启用后，搜索、归档、视图、添加工作区四个按钮同时保留。
- 实际原生重启后输入框可编辑，页面异常为零，延迟日志维护保留近期日志、移除合成过期日志。
- 重启按钮的 loader mismatch 提示仍是明确标记的视图层注入；不把它计为真实插件加载失败恢复。

证据：`build/native-default-upgrade-20260927/result.json`，本轮新截图已查看。这一轮为既有隔离产品加源码覆盖，不是 0.7.6 最终不可变成品资格。脚本新增 `--upgrade-defaults`，CI 的原有 Native 插件作业也执行这一链路。

随后从新构建的 0.7.6 ZIP 全新解包，`build/native-076-qualification/plugin-evidence-v3/result.json` 通过同一旧版升级、取消卸载、卸载、重装、启用及重启输入检查，无源码覆盖。升级过程中观测到真实 profile 文件锁；第二个独立浏览器请求返回 409，随包 CLI 并发安装因文件锁冲突退出 1，清单及锁文件未被拒绝者改变。第二页可能在服务内存锁处被拒绝，跨进程文件锁证据来自 CLI，不混淆两者。

## 数据恢复与导入

同一 0.7.6 成品通过 Recovery 18 个场景，见 `build/native-076-qualification/recovery-evidence/result.json`（`sourceOverlay:false`）。`data-evidence/stdout.txt` 记录支持报告、普通/加密导出、实际导入成功；本轮确认导入截图已查看。所有测试宿主隐藏运行，使用私有运行时缓存；跨机凭据未由本机测试证明。

## 全新离线包的缓存整理

完整离线包维护验收发现 `STORE_UNRESOLVED_MANIFEST`：默认插件种子已将清单提升为 registry 精确版本，但锁文件仍引用随包 tarball。整理器原来只认原始依赖字符串，安全拒绝了这一正常状态；未执行 prune、未破坏现用插件。

修复只接受名称、版本、SHA512 和实际内容一致的受管 tarball，将对应 registry 精确版本纳入引用比对；依赖物化仍重放原锁文件，拒绝外部路径和符号链接。4 个 archive 测试与5个引用库存测试通过。对失败的隔离成品数据运行修复模块，真实 pnpm 离线整理通过且清单/锁文件摘要不变，见 `probe-store.txt`。这是修复模块集成证据，最终打包验收另记；旧 ZIP 不作为此修复的交付证据。

重新构建普通及完整离线 ZIP 后，全新解包执行设置页维护验收通过：`maintenance-evidence-v2/result.json` 为 `passed:true, sourceOverlay:false, exceptions:[]`；覆盖实际依赖整理、WebView 在用保护与退出后回收，亮暗截图已查看。产物位于 `artifacts-store-fix`，构建日志为 `build-store-fix.txt` / `complete-store-fix.txt`。copy/hardlink 各两轮新增回归均通过（`production-store-copy-U7w7f4`、`production-store-hardlink-lEEKPX`）；此前各十轮证据保留。定向测试18项通过，独立只读审计无 P1/P2。

## 构建可复现性

新版本构建首先被 `npm ci` 拒绝：`Missing: undici@7.30.0 from lock file`。命令使用 `--install-links`，但审核锁文件记录本地链接；npm 重新打包本地市场组件并解析版本范围，尝试选择锁外的新依赖。

三平台构建统一使用 `--install-links=false`，与锁文件匹配，仍由既有 `stage-local-integrations.mjs` 将审核源码物化到产物。未更新依赖范围、未绕过 `npm ci`、未关闭完整性检查。原始失败保留在 `build/native-076-qualification/build-pwsh-error.txt`；修复后日志在 `build-fixed-lock.txt`，最终成品资格单独记录。

## 内核交付核查

本次实际执行发现器仍拒绝精确 rc.2 包，原因是历史 descriptor-v2 读取失败；此保护保留。不能将调度成功说成 rc.2 已发布。

公开 Windows candidate 索引回读到 `0.1.7-alpha.1`，其 manifest 仍绑定 Portable `0.7.4`。最新普通调度 `36324488727` 的 stable 为无候选跳过，candidate 尝试历史 `0.1.6-alpha.1`，因默认插件 peer 不匹配而阻断；两者都未发布。

另发现 `accepted_only` 刷新错误：当 Portable preview 锁高于已发布核心时，选择器仍保留较新的 preview，未使用实际已接受核心。更新仓库修复为该模式采用公开核心；仍检查 registry 完整性、产品最低版本与插件兼容性。定向 29 项测试通过，真实发布及客户端回读尚需后续记录。

更新仓库 `e1572ea` 进一步将默认插件与最低核心绑定到已发布产品锁，发现器17项定向测试通过。真实刷新 run `36330998424` 已执行，但**未发布**：它读取的 accepted 核心为 `0.1.7-alpha.2`，被产品图片插件 `0.1.2` 的明确 peer 范围拒绝；构建/发布均跳过。先前回读的 Windows 索引为 alpha.1，不能用这个旧快照证明当前全渠道状态。G5 保持未通过，不绕过兼容检查。
# Final candidate follow-up (2026-09-28)

The final Windows candidate is built from `f1d3398755429e1daee0def1414a350fffadf673`. Artifact hashes and sizes are recorded in `build/native-076-qualification/artifacts-final-receipt.json`; the ordinary archive is 153,186,334 bytes and the complete offline archive is 437,466,310 bytes.

The complete offline artifact passed `maintenance-final/result.json` without source overlays. Dependency cleanup completed with the profile manifest, lockfile and modules metadata unchanged. The real WebView capsule test removed the retired managed runtime, preserved the legacy runtime and verified all 15 persistent profile files unchanged. The final light/dark cleanup screenshots were visually reviewed.

Five platform contract jobs passed in CI run `36332653696`; remaining build and artifact acceptance jobs must still finish before release. The final isolated 120-minute soak is running under `soak-final`; its initial `passed: false` is not a completed result. Its native window was verified non-foreground with `WS_EX_NOACTIVATE`. Release qualification remains pending until the final soak assertions pass.

Core queue run `36332797595` now advances after a blocked candidate, with successor runs `36332855120`, `36332946243` and `36332999937`. The last run exposed a preflight ordering defect: it tested unadapted alpha.1 although the published product already ships a digest-bound historical migration adapter. Updates commit `32b62ea` applies that selected product adapter before the migration check, matching product packaging. The same verifier passes against the actual final packaged runtime. A new normal bounded queue was dispatched; publish, index and client readback remain required.

The final `layout-final/result.json` passed without source overlays or page exceptions, including English/Chinese, light/dark and 580/1200-pixel market layouts. Narrow English/light and Chinese/dark theme screenshots were visually reviewed. `size-comparison.json` compares the verified 0.7.5 archive with this candidate: archive growth 57,119 bytes; unpacked growth 99,992 bytes (before runtime capsule expansion).

The current security readback found 101 new open CodeQL alerts beyond the previous reviewed range (18 launcher, 83 scripts/tests), zero open Dependabot alerts and zero open PRs. These new alerts require individual boundary review and disposition before G8 can pass. Issue #148 remains the external native hardware/DPI scope.
