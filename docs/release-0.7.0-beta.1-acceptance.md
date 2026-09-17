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

## Additional acceptance — 2026-09-18

- Exact-main run 35245061836 passed all five source contract platforms and
  packed official runtime production. All five product builds stopped at the
  previous footprint ceilings, before downstream product qualification.
- Office component growth is reviewed separately in [the footprint report](alpha2-office-footprint.md).
  Local Windows ZIP passes the revised bounded preview budget; no features
  were removed. Stable budgets are unchanged.
- Local built Windows ZIP passed hidden native restart and runtime-health
  recovery tests (beta-native-restart.log and beta-native-health.log). This
  does not substitute for exact-commit cross-platform qualification.
- The updated native market test reached the official manager and category
  controls but failed on an uncaught default-plugin exception:
  this.sessions.open is not a function, in connectWorkspace.then.initial.
  The packaged chat manager still targets the older session API. Publication
  remains blocked until plugin and native navigation compatibility are fixed
  and this acceptance passes with default plugins enabled.

## Follow-up fixes — 2026-09-18

- The desktop bridge now uses alpha.2's `uiWorkspace` navigation and derives
  current selection from main-view retention. Legacy navigation remains supported.
- The real Windows native market smoke passed with the locally rebuilt capsule
  and candidate chat-manager installed, without runtime exceptions. Evidence:
  `build/beta-native-market-fixed`. This fixture differs from the original ZIP;
  it is not evidence that the still-pinned published default plugin works.
- Image-viewer browser acceptance on the actual alpha.2 runtime passed gallery,
  zoom, pan, annotations, download, focus, and returning the annotated image and
  notes to the original draft without sending it. Evidence:
  `build/beta-viewer-acceptance`. This is browser acceptance, not native-shell proof.
- Latest Portable source suite: 675 passed, 1 skipped (676 total), recorded in
  `build/beta-source-final.log`. Chat-manager source suite: 97 passed. Viewer:
  31 passed.
- Live alpha.2 archive acceptance with the candidate chat plugin passed: the
  sidebar opens unified settings without the old dialog, delete is red
  (`rgb(236, 19, 19)`), cancellation makes no delete request, restoration succeeds,
  and closing/reopening/closing settings does not reopen it. No page reload or
  runtime exception was observed. Evidence: `build/beta-chat-modern-acceptance`.
  The test restored a synthetic session; permanent deletion was not executed.
- PR #138's preview lock was already integrated and was verified before closing
  it and deleting its branch. Portable, chat-manager and image-viewer each have
  only remote `main` after cleanup.
- The official Electron development source adapter is isolated under
  `experiments/official-desktop`; it is not part of product builds or a qualified
  replacement shell. Its coordinator makes no official update I/O in the test.

## Published plugin candidates and final product preparation

- Chat-manager `1.4.0-beta.1` passed stable `0.1.5-rc.2` and preview
  `0.1.6-alpha.2` release acceptance in run `35252566016`, including confirmed
  deletion of the newly created synthetic transcript. npm `latest` stayed at
  `1.3.5`; `beta` now points to this candidate.
- Image-viewer `0.1.2-beta.1` passed stable `0.1.2-rc.1` and preview
  `0.1.6-alpha.2` release acceptance in run `35252608804`. npm `latest` stayed
  at `0.1.1`; `next` points to this candidate. npm and GitHub asset hashes match.
- These published archives are now pinned separately in the candidate lock and
  reviewed launcher catalog. Stable pins remain unchanged. The candidate frozen
  dependency-store preparation passed locally without network work at first boot.
- Product run `35251820493` exposed two further blockers: an old Windows shell
  quoting workaround added literal quotes to the new official structured plugin
  argv; the native test also targeted the removed legacy Diagnostics page.
  The CLI now detects the actual shared official operations entry. Native
  acceptance exercises the new built-in configuration surface in both themes,
  while retaining legacy diagnostic contrast checks for older cores.

Remaining publication gates: verify these last fixes against actual finished
products, then pass cross-platform qualification on the exact final commit.
No Portable beta tag has been published yet.
