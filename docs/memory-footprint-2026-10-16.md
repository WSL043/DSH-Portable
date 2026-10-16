# Memory footprint, 2026-10-16

Idle, no session open, private working set summed per process tree, 0.9.0 offline package and 1.0.0-alpha.5 full package,
isolated data folders.

| Line | Total | Parts |
| --- | --- | --- |
| 0.9.0 | about 320 MB | official core Node host about 127-143, WebView2 about 160 (6 processes), native shell about 15-17 |
| 1.0.0-alpha.5 | about 328 MB | Electron main about 121, renderers about 100, helper about 62, GPU about 30, launcher about 7 |

## What the 0.x core Node host holds (heap snapshot, 71 MB heap)

Strings 32 MB, code 17 MB, native buffers 12 MB, objects/arrays about 12 MB. Only 871 modules (10.4 MB of source) load at start, so most
strings are data, not source. Our startup source cache does not retain anything after `finish()` (cache on/off gives the same heap).

## Tried

- Node flags on the host (`--max-semi-space-size`, `--optimize-for-size`, `--single-threaded-gc`): within 3 %, noise. Not worth it.
- WebView2 arguments (via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, no code change): `--in-process-gpu` -13 MB (one process fewer);
  `--disable-gpu` -28 MB but renders in software, which hurts exactly the weak PCs we care about; turning site isolation off saves
  another 10 MB but weakens isolation. None adopted. Possible later: `--in-process-gpu` alone, about 4 %.

## Conclusion

Our own parts are small (0.x shell 15 MB, 1.x launcher 7 MB). The rest is the official core and the browser engine. Realistic safe
gain in the shell is about 4-5 %, not enough to justify a release. Unmeasured: memory with a long session open (renderer growth).

## Package weight and first-start prototype (0.9.0 capsule, measured)

Capsule raw 340 MB / 9,446 files, packed 86 MB. Of the raw size `@deepseek-ai/libreoffice-kit-win32-x64` is 182 MB (54 %, only 730 files,
used for Office document preview and created lazily by the official code), `sherpa-onnx` 22 MB (speech-to-text), `sharp` 19 MB, `pnpm` 18 MB.
Upstream already strips maps and .d.ts; nothing else is prunable.

Prototype: rebuilding the capsule without the LibreOffice kit gives packed 86 -> 35 MB (-60 %), raw 340 -> 159 MB; the offline zip would go
from about 120 to about 70 MB. First-start time did NOT change on a fast NVMe PC (median 12.1 s vs 12.5 s over 5 interleaved clean runs, very
noisy because of antivirus scanning): the first start is dominated by the 8,700 small files, not by the kit's few large ones. Slow disks
(writing 182 MB less) were not measured.

First-start trace (one run, 9.5 s): capsule extraction 3.9 s (9,446 files), profile resolver 2.5 s (515 junctions, cold), default plugin
seeding 0.9 s, official core import 2.2 s. Later starts skip the first three.

Where the real value is: engine (core) updates and full updates download the whole capsule; splitting the kit into its own optional pack
would make a core update about 35 MB instead of 86 MB and a first install about 50 MB smaller. It touches the capsule builder, the update
artifact, the extractor/updater and integrity checks, on every platform, so it is a deliberate project rather than a quick change.

## Decision (2026-10-16)

The LibreOffice kit is the official core's own dependency (`@deepseek-ai/libreoffice-kit`, pulled in by the official `dsh-office-to-pdf`
and also installed by a plain `npm i @deepseek-ai/dsh`). Rule: what the official core ships, Portable ships. So the kit stays in the
capsule and the split-pack project is shelved. Only non-core additions of ours (default plugins, our bridge) may be made optional.
