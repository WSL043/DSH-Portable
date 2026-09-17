# Alpha.2 Office runtime footprint review

The 0.7.0 Beta keeps official Office document processing intact. The first
cross-platform build (Actions run 35245061836) stopped at the old footprint
ceilings; it did not qualify a product release.

| Platform | Archive bytes | Extracted bytes | Official Office package bytes |
| --- | ---: | ---: | ---: |
| Windows x64 (local) | 145177956 | 557321765 | 340863092 |
| macOS arm64 (CI) | 173360825 | 508057270 | 267516643 |
| macOS x64 (CI) | 184142190 | 522271318 | 276809916 |
| Linux arm64 (CI) | 148507921 | 514486533 | 194453149 |
| Linux x64 (CI) | 149145801 | 520072756 | 194453149 |

Office package sizes come from pinned 0.0.1 registry metadata and the local
Windows package breakdown. Linux uses the WASM package; macOS and Windows use
their matching platform packages. This is not a claim of Office feature testing.

Preview budgets now cap Office runtime bytes separately, retain the old
non-Office extracted-byte ceilings, and keep total archive/extracted limits.
Windows also retains the old non-Office app-byte ceiling (122000000).
The wrapper @deepseek-ai/libreoffice-kit is not excluded. Independent regression
checks prove that Office growth and unrelated app growth each still fail.
Stable-channel budgets are unchanged.

Windows has 10361 files (10257 in app), including 2050 files in the Office
runtime. Its app excluding that runtime is 120853821 bytes. The Windows total
file ceilings and macOS total file ceilings account for the added component;
directory limits and plugin-market limits remain unchanged. No component was
removed to satisfy a budget.
