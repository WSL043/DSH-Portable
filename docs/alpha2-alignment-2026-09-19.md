# Alpha.2 alignment and market ownership — 2026-09-19

Official latest published core checked via GitHub Releases: 0.1.6-alpha.2,
commit ddefc45fbc7f8e46dd73185e68295696d1297887. Portable preview pins already
match. A source-main change is not promoted as a released, qualified core.

## Applied

- PR #139 merged as 7d20453; exact-flow security reconciliation recorded in
  security-review-2026-09-19.md. Native full-product checks remain distinct.
- The modern market hands selected package/npm/tarball/repository specs to the
  official manager's openInstall/editInstallSpec controls. It does not submit a
  legacy market install when this capability is available. The official dialog
  owns verification, confirmation, progress, cancellation and live activation.
- Older supported cores retain their existing route until retired explicitly.
  This is version compatibility, not a second modern install implementation.
- README entry points distinguish package fields from terminal commands and
  explicitly identify alpha.2-compatible default plugin candidates.
- Added on-demand bounded storage inventory. No sessions or workspaces are
  scanned; linked directories are not followed, partial scans are labelled.

## dsh-market review

Compared v1.47.0..v1.48.0 and current main 66692ceb. Reference:
https://github.com/dsh-market/dsh-market/compare/v1.47.0...v1.48.0

- #593: applied noninteractive Git credentials to the legacy market runner.
- #617/#630: applied the locked-file boundary to update failure recovery; do not
  run a second package mutation over files held by the host. Restore the durable
  manifest and report unverified file recovery. Missing-entry wording no longer
  claims the next launch is safe when rollback failed.
- #633/#629: upstream now supports host-rendered market entry and update counts.
  Portable already has a manager toolbar extension; use its host controls rather
  than introducing another custom-element/configuration surface.
- #616: pnpm 12.3 release-age spelling is not adopted blindly; Portable pins
  runtime pnpm 11.11.0 (the source-build toolchain is separate). Review alongside an actual package-manager upgrade.
- #621: registry target pinning remains relevant for legacy installs, but modern
  installs now belong to the official manager's inspection/installation flow.
- #642: batch updates now exclude effectively disabled plugins. Individual
  update controls remain available; regression covers the batch boundary.
- #570: local code already adds updatedNames only when completionAction returns
  restart, and counts it in the restart banner. Do not copy the upstream second
  restartNames collection, whose updatedNames has different semantics.
  This document does not claim full synchronization with 1.48.0.

## Follow-up acceptance

Modern catalog install now opens the official confirmation directly, without an
extra market confirmation or gating on the legacy pnpm setup banner. Isolated
alpha.2 evidence: `build/market-official-install-acceptance-20260919/official-install-evidence-14204.json`.
Closing both windows and reopening the editable official input passed; no legacy
install request or console error. No real package was installed in this UI test.

Removed the unreachable cloud-backup UI and its state/effects (about 500 lines).
Although hidden behind a literal false branch, its WebDAV effect could still act
on old browser preferences. The same UI acceptance seeded the old auto-backup
preference and observed zero backup/WebDAV/Gist/restore requests. Portable data
transfer remains intact; legacy server endpoints have not yet been retired.
The rebuilt client fell from about 172.46 kB to 163.97 kB. This is client code
size only, not a material reduction of the full runtime archive.

Further isolated acceptance opened/closed the market 20 times, then reopened the
official add dialog and edited its input: evidence `official-install-evidence-14206.json`
in the same directory. No lingering dialog, legacy install/cloud-backup request,
or runtime exception. This short exercise is not multi-day memory qualification.
Unused global-pnpm provisioning hints were removed; the active bundled-tool
recovery hint now names the real Desktop & data settings section.

Storage prune experiment: `build/store-prune-offline-20260919-v4/result.json`.
With pnpm 11.11.0, the local-registry integrity-pinned fixture could rebuild
offline before pruning. Store prune retained linked payloads (zero files freed)
but deleted cached metadata. The installed module still loaded; subsequent
offline reconstruction attempted a registry policy check and failed to finish
within the 45-second limit. A no-retry follow-up returned ERR_PNPM_META_FETCH_FAIL.
Thus ordinary store prune is not qualified as transparent Portable maintenance.
Earlier fixture failures (missing integrity and frozen lockfile) are retained
separately and are not used as evidence against prune. No user store was changed.

## Remaining boundaries

Official alpha.2 exposes install/remove/enable, not a separate version-update
operation. Existing source-aware updates cannot be deleted without a replacement.
A discovery-only modern market and retirement of duplicate installed-state polling
need installation/cancellation/update/removal acceptance before shipping.

Chat Manager 1.4.0-beta.1 still copies and replaces the official workspace bundle.
That is a real maintenance liability, despite its alpha.2 adaptation. Move extras
to official extension points; where archive/delete hooks do not exist, propose a
narrow upstream hook rather than replacing the entire workspace again. The old
1.3.5 input failure must remain covered until affected upgrades are retired.

The native screenshot and full artifact gates have not yet qualified these new
changes. Do not describe this development work as already delivered in Beta 2.

## Size and long-term storage

Existing alpha2-office-footprint.md measures Windows Office runtime at 340,863,092
expanded bytes; this dominates the growth. The next useful experiment is an
optional Office component with version/hash checks and a complete-offline bundle
that retains it. Do not silently delete the official preview capability, strip
unverified resources or claim Electron would inherently be smaller.

pnpm stores retain older package content. Official guidance for store prune warns
that removed packages may need downloads again:
https://pnpm.io/cli/store#prune
Thus automatic whole-store pruning is incompatible with an untested offline
recovery guarantee. Before exposing a destructive option, test all profiles,
retained rollback requirements, file import/link mode, cancellation and offline
reinstall in an isolated store. User exports/import and repair backups remain
retained; current storage reporting makes their sizes visible. This is not a
claim that unbounded pnpm/files growth has been fixed.

### Confirmed cross-platform optional-package growth

Read-only inspection of the user's reported store found 1,971,563,871 logical
bytes in 279 files, versus zero import/recovery backup bytes and 3,444,564 log
bytes. The read-only pnpm index includes @openai/codex 0.153.4 for all six OS/CPU
variants. This is a snapshot, not a claim that every byte is reclaimable.

Moved-profile and imported-profile reconstruction had already moved old
node_modules aside but still passed `install --force`. pnpm force includes
foreign-platform optional dependencies. Removed that redundant flag from the
first attempt and the bounded release-age retry; existing transactional rollback
is unchanged. Real pnpm 11.11.0 offline local-tarball A/B:
`build/platform-install-scope-20260919/result.json` shows force installs native
and foreign packages; ordinary install rebuilds native and skips foreign.
36 relocation/import/rollback tests pass. This prevents this growth source;
existing store blobs are retained until reference-aware cleanup is qualified.
