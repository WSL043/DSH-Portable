# Portable plugin storage

DSH-Portable keeps `data/` and `workspace/` with the folder, and the DSH host writes its own state
under `dsh-home`. Third-party plugins often do not know about `DSH_HOME` and hardcode user-profile
paths instead:

| Plugin | Hardcoded path |
|---|---|
| `@modusensus/dsh-mneme` | `~/.dsh/memory`, `~/.dsh/mneme/runtime`, `~/.dsh/mneme/models` |
| `dsh-pet` (Electron helper) | `%APPDATA%\dsh-pet-electron-helper` |
| `dsh-ego-browser` | `%LOCALAPPDATA%\ego-lite-linux` |
| `dsh-better-sidebar` | `~/.dsh/docs` (default) |
| `@duke-dsh-plugins/dsh-deveco` | `~/.dsh/data/dsh-deveco` (screenshot output) |

Without a redirect, that state stays on the host machine: moving the drive to another PC loses the
memories/settings, and the user profile grows on every machine. DSH-Portable cannot patch arbitrary
plugin code, but it can leave a directory link at the hardcoded path that points into the portable
folder. Plugins keep working unchanged; the bytes live with the drive.

## Manifest

Create `data/plugin-storage.json`:

```json
{
  "version": 1,
  "links": [
    { "id": "mneme-memory", "link": "%USERPROFILE%\\.dsh\\memory",
      "target": "%DSH_DATA%\\dsh-home\\storages\\plugin-data\\mneme-memory" },
    { "id": "mneme-runtime", "link": "%USERPROFILE%\\.dsh\\mneme",
      "target": "%DSH_DATA%\\dsh-home\\storages\\plugin-data\\mneme-runtime" },
    { "id": "pet-electron", "link": "%APPDATA%\\dsh-pet-electron-helper",
      "target": "%DSH_DATA%\\dsh-home\\storages\\plugin-data\\pet-electron" }
  ]
}
```

- `id` is a unique label (`^[a-z0-9][a-z0-9._-]*$`, case-insensitive on Windows).
- `link` is the path the plugin uses; it must be outside the portable root.
- `target` is where the data lives; it must stay under
  `data/dsh-home/storages/plugin-data/` so the existing data backup and exports include it.
- `%DSH_DATA%` expands to the environment's `data` directory, `%DSH_HOME%` to its DSH home; other
  `%NAME%`, `$NAME` and `${NAME}` tokens expand from the process environment, and a leading `~`
  expands to the user home.

## Lifecycle and migration

- **Start** creates a link only when the source is absent, or verifies that an existing link points
  to the declared target. Real directories, even empty ones, stay untouched. A malformed manifest,
  unsafe path or conflicting link blocks startup so plugins cannot write through another instance's link.
- **Stop** never migrates storage. Stopping one Portable environment does not prove that another
  application has closed the same files.
- **Migrate explicitly** after closing every Portable environment and any other application using
  these directories. From the portable folder on Windows:

  ```powershell
  .\runtime\node\node.exe .\launcher\runtime-entry.mjs portable-cli.mjs plugin-storage migrate --json
  ```

  On macOS/Linux, use `./runtime/node/bin/node launcher/runtime-entry.mjs portable-cli.mjs plugin-storage migrate --json`.
  Add `--environment NAME` for a named environment. Its manifest lives in that environment's `data/`.
  The command takes the existing environment and product locks and refuses to migrate while any
  environment in this Portable installation is running. A per-source lock also prevents two Portable
  copies from changing the same path concurrently; it cannot detect unrelated applications.

Migration exclusively creates a **previously absent** target, copies without overwriting, renames
the source to `<source>.pre-portable-<uuid>`, then creates the link. The original backup is retained
and reported in the result. After checking the plugin's actual data, move that backup to the Recycle
Bin yourself. A second migration verifies the link without copying again. Any failed entry makes the
command exit nonzero; successful earlier entries are reported and remain in effect.

If copying fails, the source remains intact; a partial target is retained for inspection. If link
creation fails after the rename, the source is restored when its name is still free. Otherwise the
backup is preserved. Never delete a conflicting source to force recovery. Inspect the reported paths
before retrying; restore the backup when needed and move an unneeded partial target to the Recycle Bin.
A hard kill can leave `<source>.dsh-portable-lock`; after confirming that no migration or application
is running, inspect the source, target and backup before removing this lock. Startup does not silently
take over a stale lock or repair an interrupted migration.

## Safety rules

- The link path must be absolute and outside the portable root; the target must stay inside
  `data/dsh-home/storages/plugin-data/`.
- The source cannot contain the Portable root or state directories. Relative, duplicate and
  overlapping paths are rejected. Existing symlink/junction ancestors, linked targets, and links
  inside a source tree are refused; use canonical paths without linked ancestors.
- A real source directory can migrate only to an absent target, even if an existing target is empty.
  Existing targets are never merged or overwritten. Ordinary files are rejected.
- Only a link already pointing at the declared target is accepted. A mismatching or dangling target
  is an error, not permission to replace another instance's link or create an empty replacement.

## Notes

- Windows uses a directory junction, which needs no admin rights. Links contain absolute paths;
  moving the portable folder or changing drive letters can invalidate them. Close all applications,
  verify the old link's destination and the data at the new target, then remove **only the old link**
  and run the migration command to reconnect. No automatic retargeting is performed.
- `%LOCALAPPDATA%\electron\Cache` is intentionally not redirected: it is a shared cache used by all
  Electron applications, not plugin data. External CLI homes (`~/.codex`, `~/.claude`) and browser
  profiles are also out of scope.
