# Data transfer safety — 2026-09-19

Scope: Portable-owned `.dshdata` import/export and rollback. Baseline:
`11d2e3cb4459f51918de0217167b845489a72ab7`.

## Changes

- Normalize archive separators once, before category checks, duplicate detection,
  inspection, relocation and restoration. Reject empty/dot components, rooted
  paths and NULs. On Windows, also reject device/stream names and trailing aliases;
  compare duplicate paths without case. POSIX-only names are not silently renamed
  during export.
- Validate descendant paths with `lstat`, including dangling links. Check rollback
  and generated-path ancestors relative to the selected state root. Preserve a
  generated leaf link by moving the link itself, including during rollback.
- Write exports, restored files and rollback copies through exclusively created,
  randomly named temporary files. Clean up only a temporary file we successfully
  opened. Create rollback directories privately and only when needed.
- Apply profile artifact exclusions consistently across case aliases and credential
  entries. Keep normal keep/replace conflict handling and rollback snapshots.

## Evidence

The original `launcher/data-transfer.mjs` was verified against its Git blob hash
`2cd1c063dedafe70df317591f57cb25622672576` before modification.

On Linux with Node 22.16.0, `tests/data-transfer-security.test.mjs` reports:

- Original data-transfer implementation: 8 pass, 13 fail, 1 Windows-only skip.
- Patched implementation: 21 pass, 0 fail, 1 Windows-only skip.

These are isolated boundary tests. The local checkout contains only selected
files; the two unused core imports were guarded with throwing test-only functions.
That guard is not committed. This is not an `npm test` or native-product result.

The `Data transfer safety` workflow runs the existing data-transfer suite together
with the new suite against the actual repository on Linux, Windows and macOS,
using the repository's Node 24.19.0 baseline. Windows file-link tests explicitly
report a skip if the runner account cannot create links. Native artifact acceptance
and scanner closure remain separate checks.

## Trust boundary and remaining work

The user-selected state root and the local process environment remain trusted.
These checks reject pre-existing descendant links; they do not lock directory
handles against hostile concurrent replacement. Executable plugins are not
sandboxed by this change. No dependency pins or scanner settings are changed.

The separately recorded Linux `glib` advisory and the remaining market, bridge,
network and Actions alerts still require their own disposition. This patch does
not claim that all CodeQL alerts are fixed or that any alert has been dismissed.

---

本次仅修复 Portable 数据包的路径校验、暂存写入和回滚边界，不改 DSH 内核。
普通保留/替换冲突、回滚副本继续保留；不能安全表示的文件名会明确拒绝导出，
不会悄悄改名。Linux 定向测试通过不等于三平台成品验收完成，以上已分别记录。
已有告警继续保留，Linux glib 依赖及其他模块不在本批次的修复范围内。
