# Release 写作规范 / Release writing

这份规范用于版本 Release 说明。说明只记录用户能够看到或复现的变化，并且只写对应构建已经提供的证据。

## 中文

### 固定顺序

按下面的顺序写，短句优先：

1. **面向用户的变化 / 修复**：先说行为变化，再说它解决的用户问题。每条只表达一个结果，不把实现任务或内部文件名当成亮点。
2. **升级方式**：说明推荐下载项、完整包或组件更新的适用场景，以及升级后会保留的会话、设置、凭据、插件和工作区。只有实际验证过的步骤才写成操作建议。
3. **适用版本**：写清产品版本、官方 DSH 内核版本、Stable/Candidate 通道和受影响的平台。不要用“最新版”“所有设备”等无法核对的说法。
4. **验证范围**：列出这一个构建实际通过的系统、架构和用户流程。把自动化检查、成品测试和人工复核分开；没有证据的范围留空或明确写“未验证”。
5. **已知限制**：写出触发条件、影响、临时办法和适用版本。限制只归给已经观察到的版本和环境，不用推测替代复现证据。
6. **下载与安全**：下载链接指向本次不可变的 Release 资产；签名、校验和支持链接必须与实际发布内容一致。

Portable 的产品版本、官方 DSH 内核和 Plugin Market 是不同组件，各自有版本、来源和发布节奏。说明应明确组件边界；插件目录中的社区项目不因被收录就变成官方插件或经过安全审计。未写入本次验证范围的兼容性不构成承诺。

### 证据和发布状态

代码合并、开发任务完成、CI 通过、生成 descriptor 或创建 draft Release，都不等于已经发布。只有当不可变版本标签、用户下载资产、对应验证记录和匹配的说明都准备好时，才把它写成可下载版本；Alpha、Beta、RC 和稳定版仍按实际成熟度和发布阶段规则命名。阶段提升需要新的构建和新的成品级证据。

写作前核对：版本标签与资产名称相符，摘要和条目描述的是本版本，升级指引与实际路径相符，已知限制有版本和触发条件，验证范围来自记录而非计划。不要把“预计”“应该支持”写成“已支持”，也不要用一次本地成功推导出跨平台结论。

### 示例（不是已发布事实）

下面只演示结构和措辞；其中的版本、变化、限制和验证结果都是占位示例，不代表任何已发布事实。

```markdown
> 示例：这是一个写作示例，不是已发布版本的事实。

## 本次变化

修复在任务完成后无法及时看到结果的问题，并保留原有会话状态。

### 修复与改进

- 用户可以在受支持的平台上看到任务完成提示。
- 更新失败时保留原程序和用户数据。

## 升级与验证

### 升级说明

- [适用升级方式，以及会保留的数据]

适用版本：[产品版本]；官方 DSH：[内核版本]；通道：[Stable/Candidate]。
验证范围：[实际验证的平台、架构和流程]。

### 已知限制

- [版本、触发条件、影响和已确认的临时办法]

## 下载

- [本次 Release 的下载资产]
```

## English

### Required order

Keep the same order in the English section and prefer short, user-facing sentences:

1. **User-facing changes / fixes**: state the observable result and the user problem it addresses. One result per item; omit implementation tasks and internal file names.
2. **Upgrade path**: name the recommended asset, when a complete package or component update applies, and which sessions, settings, credentials, plugins, and workspace are preserved. Turn a step into guidance only when it was actually verified.
3. **Applicable versions**: identify the product version, official DSH core version, Stable/Candidate channel, and affected platforms. Avoid uncheckable phrases such as “latest” or “all devices.”
4. **Verification scope**: list the systems, architectures, and user flows that passed for this build. Separate automated checks, finished-product tests, and manual review; say when a scope was not verified.
5. **Known limitations**: give the trigger, impact, workaround, and applicable version. Attribute a limitation only to a version and environment where it was observed.
6. **Downloads and security**: link to the immutable assets for this release and keep signing, checksum, and support links consistent with what was published.

The Portable product, official DSH core, and Plugin Market are separate components with their own versions, sources, and release cadences. State that boundary clearly. A community project listed in the market is not thereby an official plugin or security-audited. Compatibility outside the stated verification scope is not a promise.

### Evidence and release status

Merged code, a completed development task, green CI, a generated descriptor, or a draft Release does not by itself mean that a release is published. Call a build downloadable only when its immutable tag, user assets, matching verification record, and matching notes are ready. Name Alpha, Beta, RC, and Stable according to actual maturity and the release-stage policy; promotion requires a new build and fresh finished-product evidence.

Before writing, check that the tag matches the asset names, the summary and bullets describe this version, the upgrade path matches the real user flow, every limitation has a version and trigger, and the verification scope comes from a record rather than a plan. Do not turn “expected to support” into “supports,” or infer cross-platform support from one local success.

### Example (not a published fact)

The following shows structure and wording only. Its version, changes, limitation, and verification result are placeholders and do not describe any published release.

```markdown
> Example only: this is a writing example, not a published release fact.

## Changes

Fixes a problem where task results were not visible promptly while preserving existing sessions.

### Fixes and improvements

- Users can see completion alerts on the supported platforms.
- A failed update keeps the previous program and user data.

## Upgrade and verification

### Upgrade notes

- [Applicable upgrade path and preserved data]

Applicable versions: [product version]; official DSH: [core version]; channel: [Stable/Candidate].
Verification scope: [platforms, architectures, and flows actually verified].

### Known limitations

- [Version, trigger, impact, and a confirmed workaround]

## Downloads

- [Download asset from this Release]
```
