# Default plugin qualification for 0.7.5

Status: pending final product acceptance, 2026-09-26. Registry integrity check via `scripts/check-default-plugin-upstream.mjs` succeeded. No plugin channel or user profile was changed.

| Track | DSH | Chat manager | Image viewer |
| --- | --- | --- | --- |
| Stable product lock | 0.1.7-alpha.1 | 1.5.1 | 0.1.2 |
| Existing preview product lock | 0.1.7-rc.1 | 1.5.2-beta.4 | 0.1.3-beta.2 |
| Published RC2 plugin previews | 0.1.7-rc.2 | 1.5.2-beta.5 (`beta`) | 0.1.3-beta.3 (`next`) |

Do not promote RC2-only dependencies into the alpha.1 stable composition. The image viewer's older `beta` dist-tag is not its latest preview; select a verified exact version and evaluate compatibility, not the name of a tag alone.

## Evidence obtained this round

- Current clean preview source checkouts: chat manager 116 tests passed; image viewer 31 passed. These results do not qualify the stable binaries or replace visual acceptance.
- Both GitHub repositories have no open issues at this check. This does not establish absence of defects.
- Stable registry package integrity matches the Portable pins. Newer versions require compatibility review; they were not installed automatically.

## 2026-09-27 CI evidence review

Run `36253765356`, source `69a776746aa13df9b472d4aba9916d9e3cb62851`: the Windows official plugin lifecycle job passed uninstall cancellation, image uninstall/reinstall/enable, a simulated loader-state mismatch restart action, and composer availability. The build log identifies chat 1.5.1 and image 0.1.2; the pnpm operation log independently confirms removal and installation of image 0.1.2. The restart mismatch was deliberately supplied by response interception and is not evidence of a naturally occurring loader fault.

The screenshot's `Beta 1.5.2-beta.5` and `Beta 0.1.3-beta.3` strings were **available update hints**, not installed versions. Their placement beside plugin names was ambiguous. The client now labels these as available previews; the lifecycle runner also asserts installed package names/versions against COMPONENTS before and after reinstall and stores them in the report. These new checks still require execution on the next candidate. Existing evidence does not cover session deletion or image annotation interaction.

## Final product acceptance required

### Fresh-profile follow-up

Run `36255382365` completed 37 jobs successfully; the Windows 2025 native UI job and its aggregate gate failed. The added stale-archive fixture tried reading `storages/workspace.json` before the first web launch had created it. This was a fixture failure before UI operations, not a passed product gate.

The shared verifier now inserts the stale record only between the first and second web launches, after the host has created its workspace and exited. Creating a partial workspace file in advance was rejected after a clean-folder experiment showed that it suppresses the initial headless-session import. Regression coverage requires a host-created file, preserves existing fields and rejects corrupt JSON. Shared tool tests: 40 passed. Fixed verifier: `b5845fa22a6761a9e2b236f04e50820e617ca00a`.

A second entirely fresh extraction of the verified public 0.7.4 ZIP passed both themes with the fixed verifier: archive restore, archive-settings confirmed deletion in light mode, stale-record reconciliation in light mode, annotation/draft preservation and plugin toggles. No executable overlay was used in this follow-up; the isolated runtime cache remained separate from user data. Evidence: `build/native075-baseline/fresh-archive-v2.log`. This validates the fixture correction on the same stable core/plugin combination; the updated 0.7.5 CI pin still needs a complete product run.

### Native interaction evidence reviewed on 2026-09-27

The separate `windows-default-plugin-ui` artifact from run `36253765356` identifies Portable 0.7.5, DSH 0.1.7-alpha.1, chat 1.5.1 and image 0.1.2. Both themes passed annotation intake with draft preservation, cancelled deletion, archive restoration and plugin enable/disable with an editable composer. Light mode also passed confirmed session deletion. Reviewed screenshots show readable controls, distinct red destructive actions, four sidebar header actions and the image plus annotation text in the composer. The missing-credential model error shown in the synthetic session is intentional: no external model credentials were supplied.

The pinned shared verifier `3c8c68e` only confirmed deletion after restoring the archived session. The newer reviewed verifier `c2405ee4c530e7839cd1c24c5c9f49c55ba287cc` instead confirms deletion from archive settings and can reconcile a synthetic stale archive. Portable CI now pins that verifier and enables the stale-archive case with its own runtime cache.

Local native execution of that newer verifier passed with `DSH_CHAT_TEST_STALE_ARCHIVE=1`. It used the dedicated 0.7.4 extraction plus the current compiled native window executable, unchanged stable plugins (actual installed manifests 1.5.1 and 0.1.2), and an isolated runtime cache. Both themes passed stale-archive reconciliation, annotation intake, draft preservation, cancellation, restoration and enable/disable; light mode passed archive-settings confirmed deletion. No captured client errors. Evidence: `build/native075-baseline/archive-delete-acceptance.log` and `build/native075-baseline/extracted/DSH-Portable/acceptance/default-plugin-ui/`. This is focused interaction evidence, not a claim that the modified extraction is an immutable 0.7.5 release artifact.

The next exact candidate must execute the updated verifier and the installed-version assertions before final qualification. The cancelled overall run `36253765356` is not a full green product gate even though its completed native UI job succeeded.

- Install, update, enable, disable, uninstall, reinstall and restart each exact default package through the supported product UI. Verify both configured and loaded versions; keep settings open during download, and confirm the composer remains usable after activation changes.
- Chat: preserve all official sidebar actions; archive icon opens the official archive page; cancel deletion performs no mutation; confirm deletion only on generated disposable sessions; restore and content search work without reopening Settings or unloading the official workspace.
- Image: message/composer entry points, zoom, pan, gallery, download, Escape and focus restoration; edited annotations return image plus notes to the same composer without overwriting existing draft text or writing to a different session.
- Capture light and dark UI from the exact candidate, including destructive-action color and error/restart state. Record candidate commit, package versions and evidence location.
- Keep real-user data untouched. Use dedicated synthetic sessions and generated images in the isolated acceptance installation.

Release remains blocked until the exact stable product combination passes. Existing RC2 plugin evidence cannot remove Portable's independent historical-data blocker.
