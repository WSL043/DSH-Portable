# Security review — 2026-09-19

## Snapshot and actual dispositions

The owner's complete export ended at `2026-09-19T07:14:05.448Z` and contains 874 open CodeQL alerts plus one Dependabot alert. The default-branch commit was `11d2e3cb4459f51918de0217167b845489a72ab7`. No severity, rule or path filter was used. The export is not an atomic snapshot; GitHub's SARIF export is a subset of the original analysis.

[The immutable review manifest](security-review-2026-09-19-manifest.json) lists all 874 code IDs exactly once, the applicable reasoning and three normalized SARIF digests. [The repair map](security-review-2026-09-19-fixes.json) assigns every held code ID and the separate dependency alert to source files and regression tests. The coverage contract checks that no ID is omitted or assigned twice; it does not claim that a passing test closes a GitHub alert.

The [reviewed-dispositions run](https://github.com/WSL043/DSH-Portable/actions/runs/35431596133) completed at `2026-09-19T08:42:03Z`. Its receipt records 845 successful false-positive dispositions, zero API errors and 29 remaining open code alerts. It validates the source commit, pinned SARIF digests and each alert's exact rule/location before writing. Full comments and API receipts are in its `reviewed-alert-dispositions` artifact. These 845 are not 845 repaired exploitable vulnerabilities.

Most reported flows start at a same-user installation/profile/workspace root from argv, environment or an OS folder API. The reviewed application does not elevate those operations. That is different from a remote caller choosing a path across an authorization boundary. The decision is limited to the recorded flow: it does not confer trust on imported archive members, hostile concurrent writers, elevated launches or executable plugins. Compilation-only checks, non-security object IDs, bounded timers and repository-owned test code have separate reasons in the manifest.

## Code changes associated with the retained alerts

| IDs | Boundary and change |
| --- | --- |
| 216–222, 227, 235–236, 241, 253 | Data archives: canonical path checks, dangling-link and rollback-ancestor checks, exclusive random staging files; preserve conflict choices and recovery copies. |
| 110, 139, 864–867 | Package-declared files: use the real package root, reject escaping and dangling links, preserve internal links and pnpm-linked package roots; rebuild shipped market bundles. |
| 56–61 | Profile backup restoration: normalize paths before use, reject excluded-directory/case aliases and linked descendants, restore with exclusive staging and rollback. |
| 420–422 | Shared launcher JSON/session writes: use independently named, exclusively created staging files rather than predictable PID-only names. |
| 50, 53 | Windows full updater: unpredictable helper name and non-overwriting copy; start native executables without the shell resolver while preserving quoted arguments. |

The catalog and Windows launcher fixtures include the new shared module dependency. The dedicated native regression compiles `PortableProcessJob.cs` and checks empty, quoted, Unicode and shell-metacharacter arguments through an actual child process.

## Dependabot #1: glib

`GHSA-wrw7-89jp-8q8g` / `RUSTSEC-2024-0429` affects registry glib 0.18.5. The Linux GTK3/Tauri graph cannot be repaired by adding an unrelated 0.20 dependency. The PR carries the original 0.18.5 crate, verified against its existing lockfile SHA-256, with the exact mutable-output-pointer fix from [upstream PR 1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343). Cargo selects it through `patch.crates-io`; the version is not falsified. Original licensing and provenance are retained in `launcher/linux/vendor/glib-0.18.5/PORTABLE-PATCH.md`.

The [initial native qualification run](https://github.com/WSL043/DSH-Portable/actions/runs/35430586500) verified Cargo resolution and passed an optimized iterator regression. The permanent read-only workflow repeats those checks and exercises next, next_back, nth, nth_back and last, including empty and Unicode strings. This is a compatibility backport, not a claim to have upgraded the entire native stack.

## Remaining acceptance and maintenance

At this review checkpoint the code changes are in PR #139, not the default branch or a published release. The 29 retained code alerts and Dependabot #1 must be reconciled against the default branch after merge; a version-based scanner may still need the backport evidence. Do not report them as GitHub-closed merely because the source/tests changed. Native release packaging, actual upgrade/rollback and full desktop acceptance remain separate from the PR contract suite.

The one-time source-editing and alert-writing workflows have been removed. The permanent security regression workflow has read-only repository permissions; it neither rewrites code nor dismisses alerts. Existing CodeQL and Dependabot detection remain enabled. No blanket query/path exclusions were added.

Filesystem parent replacement races and execution isolation of arbitrary third-party plugins are not claimed to be solved. Revisit a disposition if its source, caller authority or privilege assumptions change. Remove the glib backport when the native dependency family supports an upstream fixed release.

---

## 中文摘要

本次按完整导出处理：874 条代码告警、1 条依赖告警。845 条代码告警已有逐条误报处置回执；剩余 29 条全部对应上述修复文件与测试，glib 则采用保留真实版本号的兼容回移补丁。误报处置不等于修复了 845 个可利用漏洞。

这里记录的是 PR #139 的修复与审查，不是默认分支告警全部关闭或新版已发布。合并后仍需核对新扫描结果与成品验收。一次性自动修改源码、自动关闭告警的工作流已移除，仅保留只读回归测试和完整编号映射。

## Follow-up review (2026-09-19)

PR head `a3852cd` introduced 13 scanner locations in the new shared helpers:
894-901, 907-911. Analysis 1803995600 contains all 13 paths. Their sources are
`profile.ts:21` (the same-user `DSH_HOME`) or `portable-cli.mjs:57`
(the same-user `DSH_PORTABLE_STATE_ROOT`), not imported archive members.
The application does not elevate these operations. Canonical member validation,
physical descendant checks and exclusive random temporary creation remain in place.
These exact flows were dismissed as false positives after source-to-sink review;
this does not waive hostile concurrent parent replacement or future remote callers.

Local focused validation: 45 passed and 6 failed solely at file-symlink creation
with EPERM on this Windows account. The PR's Windows/macOS/Linux boundary jobs
passed at the reviewed head, including those symlink scenarios. Local failures
are retained in `build/security139-local-review.log`; no assertion was disabled.
The optimized glib compatibility job and native argument-handling regression
also passed in the PR. Whole-product release qualification remains separate.

Main-branch reconciliation at `7d20453`: analyses 1804062082 (JavaScript),
1804061728 (C#) and 1804059822 were read back. Remaining paths 57-60, 110,
139, 216, 218 and 913-916 still originate at the same-user state/profile root,
not imported members. 50/912 use the OS-selected temporary directory for the
unpredictable exclusive helper copy with native argument quoting and no shell.
917/918 are repository-owned csc.exe regression invocations from WINDIR with
execFile and literal arguments. Each was reviewed and dismissed with its own
API record. GitHub then reported zero open main-branch CodeQL alerts and zero
open Dependabot alerts; glib #1 was automatically marked fixed after merge.
This is a scanner-state result, not a complete security audit or release claim.
