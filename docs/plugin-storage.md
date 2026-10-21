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

## Lifecycle

- **Start** (`dsh-portable start`): before the host process is spawned, absent or empty sources get
  a directory link (NTFS junction on Windows, symlink elsewhere). A non-empty real directory is left
  alone; the plugin keeps using it for this run.
- **Stop** (`dsh-portable stop`, including the tray's quit path): after the host process is gone and
  no other environment is running, a real source directory is migrated:
  copy to target → rename source to `<source>.pre-portable-<stamp>` → create the link → delete the
  backup. On failure the original is restored and the plugin stays on its old path; the next stop
  retries. Running the command twice is safe.
- Both steps are best-effort and never block startup or stop on a malformed manifest; problems are
  written to `data/logs/launcher.log`.

A hard kill (Task Manager, power loss) skips the stop step. The next `dsh-portable stop` retries the
migration; until then the plugin keeps using the old path (no data loss).

## Safety rules

- The link path must be absolute and outside the portable root; the target must stay inside
  `data/dsh-home/storages/plugin-data/`.
- Entries are processed only when `link` is absent, already a link, or a directory; files are
  rejected.
- Links are never followed when copying or deleting. A source that is already a link is only
  verified/repaired to point at the declared target.
- Migration requires the app to be stopped; the launcher calls it only from `stop` after the host
  process exited.

## Notes

- On Windows the link is a directory junction (`fs.symlink` type `junction`), which needs no admin
  rights and survives moving the portable folder as long as the data folder moves with it.
- A drive-letter change invalidates the old link target. `dsh-portable start` repairs links whose
  target no longer matches, as long as the new target exists at the declared path.
- `%LOCALAPPDATA%\electron\Cache` is intentionally not redirected: it is a shared cache used by all
  Electron applications, not plugin data. External CLI homes (`~/.codex`, `~/.claude`) and browser
  profiles are also out of scope.
