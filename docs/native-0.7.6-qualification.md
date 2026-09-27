# Native 0.7.6 候选验收记录

状态：开发验收中，未发布。范围按 `native-release-exit-criteria.md` 的 G1–G8；Electron 与被隔离的 rc.2 不混入本批。

最新阻断（2026-09-28）：`soak-final/result.json` 完成120分钟后未通过。基线私有内存中位数501,723,136字节，结束静置682,921,984字节，超过原定 `baseline * 1.2 + 64 MiB`；句柄增长110，超过100上限。200次导航、20次图片、10轮插件操作完成，页面异常为零，退出后所属进程为空。保留原始报告，不放宽阈值、不发布该候选。后台内存策略对照未证明收益，已撤回实验代码；诊断记录见下文。

### 本轮诊断与工作区整理

`memory-policy-probe` 和 `memory-policy-control` 在相同导航、图片和插件循环后，分别切换 Low 或保持 Normal。两组均完成操作及退出，前者四次静置总私有内存约 619–624 MiB，后者约 617–619 MiB。冷启动 Node 内存自行回落，两组 GPU/renderer 也都回落；不能把总量下降归功于 Low。没有证明此改动能解决 G7，已从产品源码撤回实验，仅保留 patch 和报告。未增加强制 GC、暂停脚本或修改发布阈值。

后续诊断将设置导航、插件循环、图片操作分开记录 DOM、监听器和 JS heap 指标，使用原不可变成品；诊断 probe 不冒充 120 分钟验收。既有 G1–G6 证据继续保留。

`renderer-growth/result.json` 已完成上述分场景诊断：200 次导航、20 次图片操作、10 轮插件操作通过，静置四个样本约 611–614 MiB。DOM/监听器在操作期间有升有降，退出无残留，不能据此声称所有长时资源行为均已排除。

`model-growth/result.json` 单独执行 100 轮流式完成和取消，每十轮建立新会话；包括预热及标题调用共 213 个本地请求。突发工作量结束后总私有内存从约 1089 MiB 回落，四次原会话静置样本约 789、789、788、622 MiB；切换新会话后约 620–624 MiB，没有证明视图切换能显著降低占用。JS heap 从操作末约 57 MiB 降至约 32 MiB，退出无残留。这是短时诊断，不是 G7 通过或某项产品修复的证据。

两次独立源码复核覆盖 Portable 适配边界，以及相同 capsule 内的官方 client-modules 和默认插件：停用会移除注册、模块缓存和事件监听，模块 URL 基于当前资源的确定性 rev；未发现每轮随机 URL 或缺失 dispose 的确认缺陷。G7 脚本现在保存每分钟 DOM/JS heap/布局对象、浏览器版本、Native 可执行文件和脚本摘要，失败信息直接输出实际值和上限。操作量、120 分钟时间窗及内存/句柄门槛均未改变，也未强制 GC。下一轮补采样是为定位原失败，不能把短 probe 替代最终长稳。

已将八个停用的构建／验收目录移入回收站，合计 7,004,397,791 字节。目标均在本轮 `build/native-076-qualification` 内，执行前检查活跃进程，完成后核对源目录消失；证据报告未删除。收据为 `recycle-completed.txt`。用户已有的未跟踪文件不属于清理范围。

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

## 内核交付早期失败记录（已由后续成功证据更新）

本次实际执行发现器仍拒绝精确 rc.2 包，原因是历史 descriptor-v2 读取失败；此保护保留。不能将调度成功说成 rc.2 已发布。

公开 Windows candidate 索引回读到 `0.1.7-alpha.1`，其 manifest 仍绑定 Portable `0.7.4`。最新普通调度 `36324488727` 的 stable 为无候选跳过，candidate 尝试历史 `0.1.6-alpha.1`，因默认插件 peer 不匹配而阻断；两者都未发布。

另发现 `accepted_only` 刷新错误：当 Portable preview 锁高于已发布核心时，选择器仍保留较新的 preview，未使用实际已接受核心。更新仓库修复为该模式采用公开核心；仍检查 registry 完整性、产品最低版本与插件兼容性。定向 29 项测试通过，真实发布及客户端回读尚需后续记录。

更新仓库 `e1572ea` 进一步将默认插件与最低核心绑定到已发布产品锁，发现器17项定向测试通过。真实刷新 run `36330998424` 已执行，但**未发布**：它读取的 accepted 核心为 `0.1.7-alpha.2`，被产品图片插件 `0.1.2` 的明确 peer 范围拒绝；构建/发布均跳过。先前回读的 Windows 索引为 alpha.1，不能用这个旧快照证明当前全渠道状态。该次运行未通过；后续 `36333805484` 完成五平台发布及客户端回读，G5 已通过，详见下文。
## Final candidate evidence (2026-09-28)

The final Windows candidate is built from `f1d3398755429e1daee0def1414a350fffadf673`. Artifact hashes and sizes are recorded in `build/native-076-qualification/artifacts-final-receipt.json`; the ordinary archive is 153,186,334 bytes and the complete offline archive is 437,466,310 bytes.

The complete offline artifact passed `maintenance-final/result.json` without source overlays. Dependency cleanup completed with the profile manifest, lockfile and modules metadata unchanged. The real WebView capsule test removed the retired managed runtime, preserved the legacy runtime and verified all 15 persistent profile files unchanged. The final light/dark cleanup screenshots were visually reviewed.

Full CI `36336780636` at `4c32c1d` passed all 39 jobs. Its macOS x64 artifact upload first failed with ENOTFOUND; one retry of the failed jobs succeeded without product changes. The completed `soak-final` failed resource limits, as recorded at the top of this document; no release is authorized by that result. Its native window was verified non-foreground with `WS_EX_NOACTIVATE`.

Core queue run `36332797595` now advances after a blocked candidate, with successor runs `36332855120`, `36332946243` and `36332999937`. The last run exposed a preflight ordering defect: it tested unadapted alpha.1 although the published product already ships a digest-bound historical migration adapter. Updates commit `32b62ea` applies that selected product adapter before the migration check, matching product packaging. The same verifier passes against the actual final packaged runtime. The subsequent normal queue completed in `36333805484`; its publication and client readback evidence is recorded below.

The final `layout-final/result.json` passed without source overlays or page exceptions, including English/Chinese, light/dark and 580/1200-pixel market layouts. Narrow English/light and Chinese/dark theme screenshots were visually reviewed. The earlier `size-comparison.json` is superseded: its locally named 0.7.5 baseline actually contained 0.7.4. `size-comparison-published.json` instead verifies the public v0.7.5 checksum and internal version: archive growth 65,862 bytes; unpacked growth 104,859 bytes (before runtime capsule expansion).

The security readback found 101 new CodeQL alerts beyond the previous reviewed range (18 launcher, 83 scripts/tests), plus two later acceptance-harness findings. These were individually reviewed and dispositioned; `security-readback/codeql-final.json` returned zero open findings. See `security-review-2026-09-28.md`. Dependabot and PR readbacks also returned zero open items. Issue #148 remains the external native hardware/DPI scope.

Final production storage tests passed ten cycles per mode with the registry closed: `build/production-store-copy-efrGmd/result.json` and `build/production-store-hardlink-Hr9z7N/result.json`. Each covers two environments/four references plus writer-conflict, unknown recovery graph and failed-verification retry boundaries.

`archive-final-fixture/DSH-Portable/acceptance/default-plugin-ui/result.json` passes dark/light image annotation, draft preservation, delete cancellation, archive/restore, permanent deletion and plugin enable/disable against final ZIP binaries. `delete-persistence.json` confirms the deleted title remains absent from both active and archived lists after another native restart, with an empty archive registry and editable composer. Screenshots were visually reviewed.

Core run `36333805484` passed all five platform builds and published alpha.1 for the public 0.7.5 shell. `core-readback/download-verification.json` verifies the downloaded Windows component SHA-256, and `core-client-result.json` shows the unmodified public 0.7.5 client accepts it with no unavailable entries. The follow-up selection in run `36335005271` does not republish alpha.1; it moves to a different historical candidate and records its peer block. Requalification for 0.7.6 remains a post-release readback requirement.

CI `36332653696` passed the actual public 0.7.5-to-0.7.6 upgrade (`published-upgrade-final.log`, four preserved markers), but Windows 2025 migration failed to observe the import marker. The same artifact passed both OS versions in diagnostic run `36334336817` after harness-only failure capture was added. This is an unreproduced failure, not a claimed product fix. Subsequent full CI `36334249257` passed all 39 jobs at `26262376b19d1400e90b507c2c7cd3447d357d55`, including both Windows migration jobs.

The diff from `f1d3398` to `2626237` contains only this qualification document and two acceptance scripts. `Copy-PortableSources` does not package these files; application sources, dependency locks and build configuration are unchanged. Local final-artifact evidence therefore transfers by identical product inputs, not by a claim that locally compiled ZIP bytes equal CI ZIP bytes. The soak fixture has task notifications disabled; it does not qualify notification-enabled behavior.

`historical-final.txt` verifies the extracted final runtime with official JSONL persistence: historical sessions can be read, continued and reopened, interrupted-journal recovery succeeds, and original historical files remain unchanged. The deterministic adapter avoids paid model requests; this is not a claim about every user's historical data or physical power loss.

`startup-comparison.json` records backend readiness using a new private runtime cache for cold starts: public 0.7.5 cold/warm 7,501/2,698 ms; final 0.7.6 cold/warm 7,402/2,566 ms. These single controlled measurements exclude native first-paint time and do not establish a general performance improvement. The prewarmed preliminary measurement is retained separately and is not counted as cold-start evidence.
