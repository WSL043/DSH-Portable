# 参与 DSH-Portable

感谢你帮助改进 DSH-Portable。范围清楚、改动集中的提交更容易审查，也更适合安全发布。

## 开始之前

1. 搜索已有 Issue 与 Discussion。
2. 确认官方 DeepSeek Harness 尚未提供同一能力。
3. 较大的改动请先发起 Discussion，说明用户问题和预期结果，再开始实现。

## 开发约定

- 便携版特有行为应位于启动器、桌面桥接、打包或更新边界；没有兼容性理由时，不要复刻官方 DSH 行为。
- 更新和修复必须保留会话、凭据、插件与工作区。
- 用户可见行为的公开文档保持中英双语。
- 不要提交凭据、私人会话、生成的发布成品或本地构建缓存。

提交 Pull Request 前运行契约测试：

```bash
npm test
```

平台或打包改动还必须通过 GitHub Actions 中对应的成品冒烟测试；源码能够构建不等于可以发布。

桌面改动以 0.6.4 的用户验收体验为基线：启动阶段保持连续加载与亮暗主题，原生导航和菜单一致，快捷键可用。默认插件也必须验证实际操作及受支持内核，不能只检查安装成功。Issue 关闭说明应对应具体修复和验证范围；包内组件版本、下载资产与 README 截图必须反映交付成品。保留失败日志和验收证据，不用重复重试代替定位。

Pull Request 请说明用户可见的问题、实现边界和实际完成的验证。无关重构请拆分提交。

## 持续维护与故障处理

- 每项修复记录复现条件、受影响模块、证据路径和验收结果；区分产品缺陷、测试工具故障和运行环境问题。未定位的失败不能写成已修复。
- 先运行受影响模块的定向检查。排查测试工具时复用已有成品，记录成品来源提交与测试脚本提交；这种结果不能替代最终发布提交的成品验收。
- 同一失败没有新证据不重复运行。先补齐失败阶段、进程退出信息和已脱敏的日志，再验证假设。通过的检查仅在相关代码、依赖或环境发生变化时重跑。
- Portable、官方内核、默认插件分别维护版本与兼容边界。优先检测实际能力，只在接口确有差异时增加适配；官方已有且满足需要的实现不再复制。兼容例外须记录原因和移除条件。
- 发布前集中验证同一提交生成的成品：启动、主题与导航、更新与回滚、数据保留、默认插件关键操作。未通过的检查保留为未通过，不用源码测试替代。
- 清理只针对确认不再使用的构建产物与缓存；保留当前验收包、失败证据和用户数据。重构围绕具体缺陷或重复实现，不与发布修复混入无关改写。

提交贡献即表示你同意按本仓库的 Apache-2.0 许可证授权该贡献。

---

# Contributing to DSH-Portable

Thanks for helping improve DSH-Portable. Small, focused changes are easier to review and safer to ship.

1. Search existing issues and discussions.
2. Confirm that official DeepSeek Harness does not already provide the capability.
3. Discuss larger changes before implementation, describing the user problem and expected result.

Keep Portable-specific behavior in the launcher, desktop bridge, packaging, or update boundary. Preserve sessions, credentials, plugins, and workspaces across updates and repairs. Never commit credentials, private conversations, generated release artifacts, or local build caches.

Run `npm test` before opening a pull request. Platform or packaging changes must also pass their finished-product smoke tests in GitHub Actions; a successful source build alone is not sufficient release evidence.

Use the user-accepted 0.6.4 desktop experience as the baseline: continuous loading and theme state, consistent native navigation and menus, and working shortcuts. Default plugins need real-operation checks on supported cores, beyond installation. Close issues with the specific fix and verification scope; keep component pins, assets and README screenshots aligned with the delivered product. Retain failure evidence instead of retrying until a check turns green.

Explain the user-visible problem, the implementation boundary, and the verification performed. Keep unrelated refactoring in a separate pull request.

## Ongoing maintenance and failure handling

- Record reproduction conditions, affected modules, evidence paths and acceptance results. Separate product defects, test harness failures and environment failures; an unexplained failure is not a fix.
- Run affected checks first. Reuse existing artifacts when diagnosing the harness, recording both artifact and test-script commits. Such results do not replace acceptance of the final release commit.
- Do not repeat an unchanged failure without new evidence. Capture the failing phase, process exit information and redacted logs before testing a hypothesis. Repeat passed checks when relevant code, dependencies or environment change.
- Version Portable, official cores and default plugins independently. Prefer capability checks; adapt only demonstrated interface differences. Do not duplicate adequate upstream behavior. Document compatibility exceptions and their removal conditions.
- Before release, qualify artifacts from one commit for startup, theme and navigation, updates and rollback, data preservation and essential default-plugin operations. Source tests do not replace failed product checks.
- Remove only confirmed unused build outputs and caches, preserving current acceptance artifacts, failure evidence and user data. Refactor concrete defects or duplication without mixing unrelated rewrites into release fixes.

By contributing, you agree that your contribution is licensed under the repository's Apache-2.0 License.
