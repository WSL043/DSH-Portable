# 0.7.0-beta.1 preparation — 2026-09-17

Status: **not published; product qualification pending**.

Candidate core: official DSH `0.1.6-alpha.2`, commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`.

## Scope

- Integrate market discovery with the official plugin manager while retaining
  legacy-core navigation. Keep official inventory, enable/disable and removal.
- Windows subtle border and repository/feedback links; portable settings expose
  the same GitHub destinations without account tokens or automatic uploads.
- Reject traversal in plugin-declared patch and client-entry paths.
- Separate website deployment privileges from source builds.
- Replace README's lead screenshot with a bilingual portable-directory diagram.

The official Electron host remains a separate investigation. It is not the host
in these artifacts. Default plugins are retained until their replacement paths
pass actual acceptance. Indexing CodeQL alerts is not resolving all alerts.

## Initial failures and evidence

- Official candidate intake `35238828943` detected alpha.2 and opened PR #138.
- Product run `35238941668` failed because the old plugin installation guidance
  text no longer exists in alpha.2. The adapter now recognizes the exact new
  built-in-plugin copy and preserves it; unknown changes still fail closed.
- Published-core synchronization `35238838001` / `35238845063` reached builds,
  but old released adapters rejected the new upstream permission UI. No alpha.2
  update was published. A successful discovery run is not successful delivery.
- Earlier main run `35182676586` lost its prior-release download connection.
  The upgrade job now checks download completion before reading ZIP metadata,
  rejects missing/duplicate metadata entries, and uses a random-access ZIP reader.
- Local Windows build reached the actual alpha.2 adapters and found the official
  Hero preset scope changed from `root` to `session-maybe`. The adapter now
  preserves either verified upstream scope and keeps Portable's own context at
  application scope; unknown/duplicate shapes still fail. Three focused checks
  passed, and adaptation succeeded on the failed build's real bundle.
- The following Windows process adapter found alpha.2 already supplies
  `STARTF_USESHOWWINDOW/SW_HIDE` at both shared process creation sites. The
  adapter now recognizes and preserves that implementation. Focused tests and
  the native subprocess smoke passed; full product acceptance remains separate.

## Local evidence so far

- Official alpha.2 packed runtime staged with a matching source receipt.
- Settings and plugin-manager adapters applied to the actual alpha.2 bundles;
  adapted JavaScript passed syntax validation.
- Chinese and English directory diagrams inspected in the browser; no clipping
  observed at their natural size. They are diagrams, not product screenshots.
- Targeted settings/adapter tests: 24 passed. Full source checks: 669 passed,
  1 skipped (`build/beta-final-source-tests.log`). Native product acceptance
  remains pending; these source checks do not establish UI integration.
- Alpha.2's runtime resolver omitted the extra-patch private packages from its
  declared installation closure. Staging now records their exact versions in
  the community build's DSH manifest; no user profile or resolver code changes.
  The official generated resolver map and live runtime startup passed in an
  isolated fixture. Product verification now checks that actual resolver map.
- Browser acceptance on the isolated alpha.2 host: one market toolbar action;
  catalog opened; image viewer installed without premature navigation; closing
  discovery refreshed the official installed list; official disable/re-enable
  worked. Settings has no duplicate market/installed tabs; feedback links render.
- The reused browser profile logged an upstream unknown-session locale callback
  during restart. No new errors appeared during the above interactions. Fresh
  native product startup still needs verification; this is not dismissed as noise.

## Required before publication

- [ ] Official plugin page shows one reachable discovery entry; old duplicate
  tabs disappear, and closing/unloading does not reopen or leak a view.
- [ ] Discovery installation and official inventory/enable/disable stay in sync.
- [ ] Default plugins, settings, restart and real native window acceptance.
- [ ] Full source checks and exact-main cross-platform product CI pass.
- [ ] Publish only the qualified artifacts as a prerelease; read back assets
  and candidate update indexes. Keep the stable channel unchanged.
