# 只按外壳指纹判断内核兼容：评估

## 结论

不建议把 engine 更新的 `productComparison === 0` 直接替换成“外壳指纹相等即兼容”。当前指纹只覆盖 launcher 子集；Portable 版本相等把内核资格绑定到一个完整产品发布版本。改成指纹判断会把未纳入指纹、也未被其他 manifest 字段验证的差异一并放行。

评估依据：当前仓库代码与测试；Updates 仓库只读快照 `C:\Users\Omo\Documents\Codex\DSH-Portable-Updates-work`，HEAD `0fe63c60d739b918b23f803b092fa936fa77569f`（`https://github.com/WSL043/DSH-Portable-Updates`）。

## 1. 放宽后会失去什么

- `evaluateUpdate` 将 engine manifest 的 Portable 版本与已安装版本比较：较新安装版本返回 `core-awaiting-qualification`，任何非相等版本均不提供内核组件（较旧安装版本为 `core-incompatible`）。这保证当前资格对应精确的 Portable 发布基线；它不是密码学完整性校验。`launcher/update-core.mjs:166-176`
- **已安装版本身份：**下载校验要求 staged `metadata.portableVersion === update.latest`，而安装会用 staged 的 `COMPONENTS.json` 替换现有文件。若只放宽前置比较，让较新 shell 接受针对旧 Portable 版本的内核包，成功后可能把安装记录写回旧版本，之后的候选 feed/资格基线随之错误。`launcher/update-core.mjs:971-985,802-815,839`；feed 选择：`launcher/update-core.mjs:48-60,578-583`
- `computeShellFingerprint` 只枚举 `launcher/` 直接子级的 `.mjs` 和当前平台的 `launcher/<平台>/` 全目录，再对路径及文件内容计算 SHA-256。`desktop-bridge/`、`config/`、`upstream.lock.json`、`app/`、随包 Node 二进制和用户数据不在这个输入集合中。`scripts/shell-fingerprint.mjs:6-40`
- **默认插件：**发布锁文件含 `defaultPlugins`。Updates 的 qualification preflight 将默认插件锁、peer 检查器和 `app/package-lock.json` 一起纳入 peer 输入哈希；这些与 launcher 指纹不是同一组输入。跨 Portable 版本复用资格可能漏掉插件 bundle/peer 差异。`upstream.lock.json:33-60`；Updates `scripts/discover-core-source.mjs:137-143`
- **desktop-bridge：**设置页及内核目录读取逻辑位于 `desktop-bridge/lib/client.js`，不属于上述指纹路径集合。指纹相同不能证明 bridge/UI 行为、协议或集成状态相同。`desktop-bridge/lib/client.js:392,467-494,579-587`
- **随包 Node：**Node 版本字符串仍由 `component.requiredNodeVersion === installed.nodeVersion` 单独核对；只删除 Portable 版本相等并保留该检查，不会丢掉此项版本约束。但指纹没有覆盖 Node 二进制内容，版本字符串也不是二进制哈希。`launcher/update-core.mjs:184-192,445-457`
- **数据格式：**`evaluateUpdate` 没有 DSH 用户数据/导入包格式字段；所以版本相等本身不是格式迁移测试。现有 app 更新测试验证用户数据在应用更新和失败回滚时保持不变，但不能证明未来任意两个同指纹 Portable 版本的数据格式兼容。不要把放宽指纹判断视作新增的数据兼容保证。`launcher/update-core.mjs:125-207`；`tests/update-core.test.mjs:1050-1066,1121-1135`
- **回滚：**事务日志、失败健康检查后的文件/元数据恢复仍由 updater 实现，单独放宽版本门槛不会删除这套机械回滚；但不能再由精确 Portable 版本推知该旧内核已针对当前发布基线验证。Updates 的历史内核资格明确需对新 shell SHA 重新验证。`launcher/update-core.mjs:714-739`；Updates `scripts/discover-core-source.mjs:71-108`；`tests/discover-core-source.test.mjs:100-115`
- 保留 `requiredShellSchema`、`requiredShellFingerprint`、`targetRuntimeLayout`、`requiredNodeVersion` 和组件 `runtimeLayout` 检查时，这些显式约束仍有效；updater 还继续校验目标组件的 portableVersion、内核版本及 SHA-256。它们不能补上未编码的默认插件、bridge 或数据格式契约。`launcher/update-core.mjs:179-196,971-985`
- 现有指纹测试证明 launcher 文件对换行归一化、对源代码变化敏感；没有证明 launcher 以外文件被纳入哈希。`tests/shell-fingerprint.test.mjs:8-25`

## 2. Updates qualification 的缓存/去重与工作量

- **直接 key 不是 Portable 版本号。**资格记录保存 `sourceSha` 与 DSH `version`；更新记录时按这两个字段去重。选择时也用 `item.sourceSha === sourceSha && item.version === candidate.version` 查已成功/冷却记录。Updates `scripts/update-qualification-state.mjs:14-40`；`scripts/discover-core-source.mjs:101-108`
- 但 workflow 将已发布 Portable tag 解到提交 SHA，并验证该 SHA 中 `package.json` 版本与 tag 相符。因此 source SHA 是发布基线身份；新 Portable 发布通常形成新 key，而非因指纹相同自动复用资格。Updates `.github/workflows/sync-core-channel.yml:81-112`
- 另外，core index 只保留 `portableVersion`、shell schema/fingerprint、runtime layout 与 required Node version 全相同的 manifest；这条精确版本条件仍会限制跨版本目录复用。Updates `scripts/build-core-index.mjs:35-42`
- 所以**仅放宽 Portable 客户端的比较不会改变 qualification 工作量**。若同时把 Updates 的去重/目录兼容改成指纹身份，理论上可减少同一完整兼容契约下的重复验证；当前 SHA key 不会自动做到这点。仓库代码/测试没有提供工时或节省量，具体变化未量化。新的 Portable SHA 触发重试的现有测试：Updates `tests/discover-core-source.test.mjs:100-115`。

## 3. 最小安全建议与新增测试

- 最小建议：保留精确 `portableVersion` gate。若确需跨 Portable 版本共享内核资格，先定义显式、版本化的兼容身份；除 launcher 外，至少纳入 desktop-bridge 产物/协议、默认插件清单与锁、Node 运行时内容摘要、runtime layout、updater/shell schema，以及任何会改变既有数据读写的 schema/migration 契约。资格 manifest 和 Updates 去重/index 必须统一使用该身份；不能只改客户端一处比较。
- 新测试至少覆盖：launcher 指纹相等但逐项改动 bridge、默认插件锁/包、Node 二进制、runtime layout 或数据 schema 时拒绝复用；所有纳入项相同的不同 Portable 版本按明确策略接受且安装后保留正确 Portable 版本身份；必需的 Node/schema/platform 检查仍拒绝不匹配；新 Portable SHA 在兼容身份变化时触发重新 qualification；旧内核回滚/重验及用户数据保持行为不退化。
- **不建议**以当前 launcher-only 指纹取代 Portable 版本相等。现有证据未建立“相同 launcher 指纹 ⇒ 完整 Portable 对内核兼容”的关系。
