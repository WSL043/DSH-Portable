DSH-Portable
============

This folder is the complete work environment. Settings, sessions, plugins,
desktop data, and the default workspace move together. Before copying or backing
it up, choose Exit DeepSeek Harness from the system tray.

Windows: run DeepSeek-Herness.exe. Closing the window sends it to the tray by
default so active tasks continue. The tray menu can reopen the window, exit the
app, or change the close behavior.

macOS: run DSH-Portable.app. Control-click and choose Open if first launch is
blocked. Run Stop DSH-Portable.command before moving or unplugging the folder.

Linux: run ./DeepSeek-Herness from the complete portable folder. Make an AppImage
executable once with chmod +x. Its data lives in the sibling DSH-Portable-data
folder; move both together.

The launcher asks before installing an update. A normal update downloads only
the changed DSH application component and keeps sessions, settings, credentials,
and workspace in place. It requests the complete package only across a runtime
compatibility change and restores the previous version after a failed launch.

The Windows and Linux trays and the macOS application menu can check manually.
Automatic checks are off by default. Updates never interrupt a running task.

For a slow or failed launch, export the redacted support report from Settings >
General > Portable. It includes complete phase traces for the latest two launches;
share that report instead of raw logs that may contain login tokens.

On Windows, double-click dsh.exe or open DSH Terminal from the tray's More menu.
On macOS and Linux, open DSH Terminal from the application menu or tray. Paste
the official commands published by plugins without editing them:

  dsh plugin --profile web add <plugin>
  dsh plugin --profile web list --depth 0
  dsh plugin --profile web update <package-name>
  dsh plugin --profile web remove <package-name>
  dsh --profile web --dump-config

DSH Terminal never changes the system PATH. After moving the complete Portable
folder, a new terminal automatically uses the new location. Plugin changes do
not restart DSH automatically; save the task, exit, and reopen when convenient.

If no graphical terminal is available on Linux, run ./dsh from the Portable folder.
