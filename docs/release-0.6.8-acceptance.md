# 0.6.8 release acceptance — 2026-09-12

Published stable release: https://github.com/WSL043/DSH-Portable/releases/tag/v0.6.8

- Release source: `411c7fec3cb892a0ba5928c0aec97e06c80ca3cc`.
- Source tests: 623 passed, zero failures or skips.
- Exact-source product CI: [34690587133](https://github.com/WSL043/DSH-Portable/actions/runs/34690587133), all 35 jobs passed, including Windows 2022/2025 native acceptance and the complete offline WebView2 package.
- Publication: [34691802250](https://github.com/WSL043/DSH-Portable/actions/runs/34691802250), successful. Publication reused the qualified artifacts without rebuilding.
- Public stable and candidate product catalogs were read back for all five platforms; every catalog includes 0.6.8. The GitHub latest release is v0.6.8.

## Local Windows acceptance

Used the unmodified Windows artifact from the exact CI run, with an isolated, previously empty runtime cache. Runtime preparation completed at 3,347 ms and the workspace became interactive at 8,019 ms. All eight resize edges/corners passed, and product shutdown passed. These are one local run's measurements, not a universal startup guarantee.

The published standard Windows ZIP SHA-256 matches the locally tested artifact:

`662237d2cf0dab6749f57b14f92523c3c699ad49dd50328a5e8c4bbb20418b86`

The bundled core remains DSH 0.1.5-rc.2. Default plugin versions are unchanged. Previously accepted independent cores were queued for requalification against the published 0.6.8 baseline in [34691873062](https://github.com/WSL043/DSH-Portable-Updates/actions/runs/34691873062); this record does not claim that separate run has completed.

Local logs, native screenshots, checks, and public catalog readbacks are retained under `build/release-0.6.8`, with a compact evidence archive alongside it. Isolated native test processes were stopped. Test directories that could not be removed are retained; cleanup is not reported as complete.
