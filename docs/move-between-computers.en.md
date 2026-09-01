# Move DSH-Portable to another computer

[简体中文](move-between-computers.md)

DSH-Portable keeps sessions, settings, plugins, and the default workspace inside its portable directory. Exit fully, copy the directory, and continue from another drive, USB device, or computer.

## Move the complete workspace

1. Choose **Exit DeepSeek Harness** from the tray menu.
2. Wait for the window and tray icon to disappear. On Windows, also wait until the folder can be renamed normally; do not force-copy or delete it while the app is still running.
3. Copy the entire `DSH-Portable` folder to the new location.
4. Run `DeepSeek-Herness.exe` from that location. On macOS, open the app bundle. Linux AppImage users should copy the adjacent `DSH-Portable-data` directory as well.
5. Open an existing session, then check a familiar plugin and the default workspace. Portable repairs paths it owns; projects you opened elsewhere stay in their original locations.

Do not run the same synchronized directory on two computers at once. A cloud or sync tool merging session data while it is being written can create conflicts.

## Move personal data only

If you do not want to copy the runtime, open **Settings → General → Portable → Data and migration**:

- **Export migration package** is convenient between devices you trust.
- **Export encrypted private package** contains the same data but requires a password, making it the safer choice for cloud storage or removable media.

Both packages contain sessions, settings, plugin configuration, and API credentials. Neither includes the runtime, caches, logs, or workspace files. An unencrypted migration package is sensitive and should never be shared publicly. It is still a compressed, integrity-checked container rather than a text file; use the import review screen or `dsh portable inspect` for a summary.

Importing into an existing environment fills missing data by default. Before an explicit overwrite, Portable creates a rollback copy under `data/backups/`. An import commits only after plugin dependencies are restored and every profile composes; dependency download or validation failure restores the previous data automatically. Registry plugins may need network access the first time they are restored on a new computer.

## Verify portability without a second computer

1. Create a test session and confirm that one plugin is enabled.
2. Exit completely from the tray.
3. Move or rename the entire folder, for example from `Downloads` to `Documents`.
4. Open it from the new location and confirm that the session, plugin, and settings remain available.

This checks Portable-managed data only. Code repositories, images, and documents opened from other locations are not copied into the portable directory.

## Before you move

- Prefer NTFS for removable Windows drives to avoid permission, long-path, and single-file-size limitations.
- Do not move the directory during an update or repair.
- If Windows still reports files in use, reopen DSH-Portable, run **Settings → General → Portable → Run check**, then exit fully from the tray.
- If the problem remains, export the redacted support report from the same page and [file a bug](https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml). Do not attach API keys, unencrypted migration packages, or private conversations.
