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
- Later #642/#570 (disabled-plugin update-all/restart counts) still need legacy
  flow review. This document does not claim full synchronization with 1.48.0.

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
