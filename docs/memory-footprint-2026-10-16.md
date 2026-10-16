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
