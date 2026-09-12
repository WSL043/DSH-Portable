# Appshots: research and native feasibility

Status: **Windows capture prototype verified; not integrated into the default product and not published.**

## Reference behavior

[Official Appshots documentation](https://learn.chatgpt.com/docs/appshots), checked 2026-09-12:

- Explicit hotkey captures the foreground application window and available accessibility text.
- Windows defaults to both Alt keys; macOS defaults to both Command keys.
- The result is an attachment, not an automatically submitted instruction.
- Automatic destination uses a recently active chat (60 seconds), otherwise a new chat. Current-chat and new-chat preferences also exist.
- Text availability depends on the application; this is not guaranteed whole-document extraction.

Read-only inspection of the installed Codex build `26.908.4834.0` confirmed native Windows capture orchestration, separate image/text updates, prepare/complete/cancel requests, and screenshot/text attachment previews. Its Windows helper contains Windows Graphics Capture and UI Automation identifiers. These observations support the architecture below; they do not establish every internal implementation detail or guarantee pixel-identical behavior. No proprietary implementation or artwork was copied.

## Implementation boundary

Use a small native helper owned by Portable, not an upstream Agent patch or a replacement browser runtime:

1. Latch the window identity before showing Portable or an overlay.
2. Capture that HWND through [Windows Graphics Capture](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow). Keep the OS capture indicator.
3. Return the image first. Extract UI Automation text in the same disposable worker; the parent terminates an unresponsive worker while preserving an already received image.
4. Preview the screenshot and text independently. Cancellation discards the pending result; sending remains a user action.
5. Add through the composer's ordinary attachment admission path, preserving limits, removal, drafts and session ownership.

The experimental helper uses C++/WinRT, D3D11, WIC PNG encoding and UI Automation. It is statically linked and needs no additional runtime installation. Capture refuses minimized, hidden, off-desktop, protected or ownership-mismatched windows. It does not fall back to capturing the whole desktop. Image limits are 16 megapixels / 16 MiB PNG; text is capped at 24,000 UTF-16 units and 400 nodes. UIA results are explicitly partial when truncated or unavailable. Password elements are excluded from text; this is not a claim that arbitrary app content is automatically redacted.

## Local evidence

Source: `experiments/appshots/`.

- Native helper: 250,880 bytes in the measured build.
- Final native fixture run: image at 198 ms; image plus text at 247 ms. A single small-window measurement, not a general performance promise.
- Captured the actual test window through WGC while it remained behind other windows, without activating it or sending input.
- Visible text and a sentinel below the visible scroll area were extracted; a password sentinel was excluded.
- An incorrect owner PID was rejected.
- Four orchestration checks passed: progressive delivery with text timeout, cancellation after image arrival, chunked UTF-8 responses, and capture failure without a false successful attachment.
- Earlier evidence is preserved. The first fixture was entirely offscreen and yielded an unpainted image; off-desktop targets now fail explicitly. The initial UIA prototype dereferenced a null optional pattern even though the COM call succeeded; the null check is fixed. Neither failure is attributed to Codex or DSH.

Raw evidence: `build/appshots-experiment/result.json`, `run-2/`, `run-3/`, `run-4/`. Final screenshot: `run-4/capture.png`. Test windows and capture workers exited after acceptance.

## Composer integration finding

The shipped DSH `0.1.5-rc.2` and current upstream `InputActions` expose `addAttachments(ids)`, but this accepts already registered draft IDs, not new browser Files. `createDrafts()` exists in the concrete conversation implementation; the upstream source explicitly describes access to it as package-internal. The normal composer's `intakeFiles` also performs image-count and byte-limit checks.

The [public input contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/ui-conversation/src/client/contract/input.ts) and the shipped client were both inspected. Do not call `addAttachments` with invented IDs or bypass normal intake. Do not replace the entire attachment slot, simulate a DOM paste or auto-submit a separate message merely to appear integrated.

Preferred next integration is a narrow public file-intake action shared with the normal composer. If an experimental compatibility adapter is needed before that exists, isolate and capability-gate it, then qualify against the exact core; do not advertise broad core compatibility from this native prototype alone.

## Still required before default availability

- Composer intake integration and native bridge correlation/cancellation.
- First-use explanation; explicit hotkey opt-in/conflict handling; latch-before-focus and release semantics. Do not register both Alt keys silently alongside Codex.
- Screenshot/text preview, removal, repeated captures and current/new/automatic destination behavior.
- Capability detection for image input, clear text-only fallback, reload/draft/session-switch behavior, bounded pending capture lifetime.
- Native acceptance on real Win32 and WebView2 content, mixed DPI/multiple displays, resize/close during capture, protected windows and unavailable UIA. The fixture does not prove arbitrary apps work.
- macOS implementation and acceptance separately; Linux must report unsupported until implemented. No unconditional cross-platform feature claim.

## Run the experiment

From the repository root, with MSVC x64 build tools and a Windows SDK installed:

```powershell
./experiments/appshots/build.ps1
node --test experiments/appshots/capture.test.mjs
./experiments/appshots/accept-windows.ps1 -RunName run-5
```

Use a new run name only after diagnosing a failed run or changing relevant code. The native acceptance creates its own nonactivating fixture; it does not capture user application contents.
