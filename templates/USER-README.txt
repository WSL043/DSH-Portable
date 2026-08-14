DSH-Portable
============

DSH-Portable runs the official DeepSeek Harness Web interface without an
installer. Keep this entire folder together. Your settings, sessions, browser
profile, and default workspace stay inside it.

WINDOWS
1. Extract the ZIP completely.
2. Double-click DeepSeek-Herness.exe.
3. Use Stop DeepSeek-Herness.exe before moving the folder or unplugging a drive.

MACOS
1. Extract the ZIP completely.
2. Double-click DSH-Portable.app.
3. If macOS blocks the first launch, Control-click the app, choose Open, then
   confirm Open. The app is ad-hoc signed but not Apple-notarized.
4. Run Stop DSH-Portable.command before moving the folder or unplugging a drive.

PORTABLE DATA
- data/dsh-home: DSH profiles, credentials, settings, and sessions
- data/browser: isolated Chrome or Edge profile when available
- workspace: default workspace that moves with this folder

The data folder can contain API credentials and private conversations. Treat
the whole folder like a password-bearing device. Stop DSH-Portable and eject
removable storage safely before unplugging it.

DSH binds only to 127.0.0.1. Telemetry is disabled by this launcher. External
workspaces selected in DSH remain outside this folder and are not moved.

This package contains the official DeepSeek Harness runtime plus a portable
launcher. It is independently packaged and is not an official DeepSeek app.
