# 0.7.6 candidate CodeQL review

Reviewed findings #1162–1262 against product commit `f1d3398755429e1daee0def1414a350fffadf673`. Two independent read-only reviews traced the runtime and acceptance-tool groups; the main agent reviewed their conclusions. The saved API records are under `build/native-076-qualification/security-readback`. These 101 findings are false positives under the current caller/privilege boundaries, not a claim that all local paths are uncontrollable or that the product is fully audited.

| IDs | Boundary checked |
| --- | --- |
| 1162–1163, 1166 | Configured state root, validated environment slug and fixed import journal suffix; existence checks receive no archive/request path. |
| 1164–1165 | Cache lock/lease paths derive from the configured root, validated hash and generated owner/token; removal rereads ownership. |
| 1167–1171 | Reference inventory uses directory entries, validated environment IDs, regular-file and symlink checks, bounded reads. Same-user filesystem races are not atomically eliminated; no cross-privilege traversal was identified. |
| 1172–1176 | Native product/cache roots plus fixed markers or validated SHA-256 capsule identities. |
| 1177 | Runtime root is set by the supported launcher, with fixed pnpm package suffix and version validation; direct environment overrides belong to the local caller. |
| 1178 | Fixed product lock path under the selected state root; PID/liveness/ownership checks follow. |
| 1249 | `execFile` uses a constant argument array without a shell. `SystemRoot` selects the executable, but no HTTP/import flow writes it and the application runs `asInvoker`. A same-user caller selecting its own process environment is not an identified privilege-boundary violation. Trusted-system-directory resolution remains optional hardening. |
| 1179–1218 | Local maintenance acceptance helper receives fixture/output paths from its driver; CI uses runner temp. Persistent WebView files are hashed for equality, not changed or exported. |
| 1219 | Local market acceptance evidence directory supplied by the caller; disposable mode is an operational guard. |
| 1220, 1250–1251 | Migration acceptance intentionally runs the selected local product with argument arrays and no shell; CI supplies an extracted temporary fixture. |
| 1221–1225, 1252–1253 | Plugin acceptance uses local fixture/driver/evidence roots and fixed reviewed plugin names, with explicit process arguments. |
| 1226–1242 | Recovery acceptance intentionally modifies the explicitly selected disposable fixture and restores test state. Its root is operator-controlled, not a sandbox or product request parameter. |
| 1243–1248 | Node tests create their own temporary root and explicitly redirect WebView cache there. |
| 1254–1262 | Standalone long-soak driver intentionally executes the selected local product and writes evidence. The loopback synthetic model endpoint cannot select these paths; a `build` path check is not treated as a security boundary. |

Each GitHub disposition must retain its group-specific explanation. Do not exclude directories or suppress queries. Re-read open alerts after disposition; newly introduced IDs require a new review. Open issue #148 remains a native hardware/DPI enhancement boundary, and is not closed by this review.

Follow-up `2626237` added #1263 (fixed notification-settings file in the local soak fixture) and #1264 (selected fixture Node exports post-failure support diagnostics, explicit arguments/no shell). These were separately reviewed under the same local acceptance-driver boundary and dismissed. The original 101 dispositions completed successfully; the two additional records are retained separately in the readback directory.

The post-disposition API readback in `codeql-final.json` returned no open findings. This includes the two follow-up alerts; it does not establish that future scans or a broader security audit will find none.

The intake fix `4c32c1d` subsequently produced #1265 at `scripts/update-upstream.mjs:185`: appending step outputs to `process.env.GITHUB_OUTPUT`. This is the runner-provided command-file path in a repository-local workflow script, not a path from registry data or product HTTP/IPC input. A standalone caller still controls its own environment. It was separately reviewed and dismissed as a false positive; the subsequent API readback again returned zero open alerts. No query or directory exclusion was added.

Diagnostic-only commit `93f6b3b` produced #1266 at `scripts/qualify-native-soak.mjs:76`. The local acceptance CLI reads the fixed Native executable inside the caller-selected disposable build fixture to record its SHA-256. No HTTP, IPC or registry input reaches the path, and the local caller already has filesystem authority. It was reviewed and dismissed as a false positive; the path guard is a fixture-safety check, not an authorization boundary.
