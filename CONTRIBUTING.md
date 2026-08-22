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

Pull Request 请说明用户可见的问题、实现边界和实际完成的验证。无关重构请拆分提交。

提交贡献即表示你同意按本仓库的 MIT 许可证授权该贡献。

---

# Contributing to DSH-Portable

Thanks for helping improve DSH-Portable. Small, focused changes are easier to review and safer to ship.

1. Search existing issues and discussions.
2. Confirm that official DeepSeek Harness does not already provide the capability.
3. Discuss larger changes before implementation, describing the user problem and expected result.

Keep Portable-specific behavior in the launcher, desktop bridge, packaging, or update boundary. Preserve sessions, credentials, plugins, and workspaces across updates and repairs. Never commit credentials, private conversations, generated release artifacts, or local build caches.

Run `npm test` before opening a pull request. Platform or packaging changes must also pass their finished-product smoke tests in GitHub Actions; a successful source build alone is not sufficient release evidence.

Explain the user-visible problem, the implementation boundary, and the verification performed. Keep unrelated refactoring in a separate pull request.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
