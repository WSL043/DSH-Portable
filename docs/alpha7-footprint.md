# DSH 0.1.7-alpha.1 footprint review

Run 35715835410 (c4ab92e) failed the old preview footprint budgets on all five platforms; no native product job ran. The original failures remain in that run. Contracts passed, which does not qualify a release.

| Platform | Archive bytes | Extracted bytes | Sherpa platform package, registry unpacked bytes |
| --- | ---: | ---: | ---: |
| Windows x64 | 153126101 | 590466574 | 23453246 |
| macOS x64 | 197558438 | 569644101 | 37678686 |
| macOS arm64 | 185441225 | 551841081 | 34089738 |
| Linux x64 | 162199386 | 563147989 | 33381117 |
| Linux arm64 | 164212061 | 564487833 | 40306856 |

DSH now includes sherpa-onnx 1.13.8 for voice input. These numbers describe runtime libraries, not downloaded speech models. They do not establish offline speech recognition readiness.

A disposable Windows copy processed by the existing packaging prune script retained 23453149 bytes of sherpa-onnx-win-x64. The document-preview client grew from 7268792 to 14435023 bytes after the same pruning. node-pty stayed at 1661537 bytes. Raw development node_modules cannot be directly compared with the pruned release: source maps, types and alternate builds make that comparison misleading.

Preview budgets now measure native speech payload separately, retain Office and total caps, and cap non-Office/non-speech growth at the previous threshold plus 10 MB to cover the reviewed document-preview increase. Windows/macOS file ceilings grow by 500 files; market and directory caps are unchanged. Stable budgets are unchanged. No upstream runtime feature was removed merely to pass a size budget.

Budget failures now preserve the full section/package report and upload it even when a build fails, while still failing the job. This avoids losing the breakdown needed to diagnose the next regression. The next exact-commit build must pass product qualification before release.

Host boundary follow-up: macOS Info.plist lacked NSMicrophoneUsageDescription. The app now declares the purpose of user-requested voice recording, as required by [Apple's media-capture authorization documentation](https://developer.apple.com/documentation/bundleresources/requesting-authorization-for-media-capture-on-macos). This declaration does not grant microphone access and does not replace official voice behavior. Real macOS permission/recording acceptance is still pending.
