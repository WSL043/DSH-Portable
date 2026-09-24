# Isolated installed-runtime preview

An installed UI preview must not edit `%LOCALAPPDATA%/DSH-Portable/runtime-cache/<capsule SHA>/app`. That directory is shared by installations using the same capsule, and the normal ready check does not hash every extracted file on each boot.

Build a disposable candidate from a packaged Windows product:

```powershell
node scripts/prepare-isolated-runtime-preview.mjs C:\path\to\DSH-Portable node_modules/@wsl043/dsh-portable-plugin-market/client/client.js=app/vendor/dsh-portable-plugin-market/client/client.js
```

The command creates a new directory under `build/runtime-previews/`. It copies program files, excludes `data/` and `workspace/`, extracts the source capsule into a private staging cache, applies each explicit replacement, and packs a new capsule with its own SHA-256 identity. `preview-receipt.json` records the source identity and both hashes for every replacement. The source product and the shared runtime cache are read-only throughout. The preview pack uses a faster compression level because it is a local candidate, not a release asset.

Start the candidate using `Launch preview.cmd`; it sets private state and runtime-cache paths. Running its executable directly still uses the candidate's distinct capsule identity, but the launcher is the supported acceptance path. Exit the candidate and move its entire preview directory to the Recycle Bin to withdraw it. Do not distribute a preview or infer release qualification from a successful local launch. Build a release candidate through the normal build workflow.
