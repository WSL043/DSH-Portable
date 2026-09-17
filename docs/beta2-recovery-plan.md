# Beta 2 recovery gate (2026-09-18)

Beta 1 was withdrawn after reports of an unusable composer and inability to
return from the plugin page. Do not publish Beta 2 on the strength of the old
green CI result. Website, Electron migration, storage pruning, and unrelated
features are outside this recovery release.

## Completed containment

- Deleted the `v0.7.0-beta.1` release and its downloadable assets; retained the
  source tag for investigation.
- Removed Beta 1 from all five candidate product catalogs and replaced their
  latest product manifests with the existing 0.6.9 manifests. Removed obsolete
  Beta 1 versioned assets and unversioned archive aliases.
- Added Beta 1 to `product-release-policy.json` so catalog generation cannot
  reintroduce it. Stable release remains 0.6.9.

## Confirmed evidence

- The installed Beta 1 component metadata specifies chat-manager 1.4.0-beta.1
  and image-viewer 0.1.2-beta.1. The existing profile still loads chat-manager
  1.3.5 and image-viewer 0.1.0.
- Startup logs at 2026-09-17T19:22:09Z and 19:22:16Z report
  `default_plugin_update_failed`. The offline default-plugin refresh tries to
  resolve the existing subscription plugin dependency graph and fails with
  `ERR_PNPM_NO_OFFLINE_META` for `@openai/codex@0.153.4-linux-x64`.
- `launcher/default-plugins.mjs` restores the profile manifest after that
  failure and returns a warning. Startup then proceeds with the old plugins.
  This establishes why the defaults were not updated; it does NOT yet prove
  the cause of the disabled composer.
- A no-third-party-plugin alpha2 fixture without a workspace/session has an
  inert composer. This is not an effective input regression test.
- A hidden WebView2 fixture can open and close the Plugin Market modal. This
  does not establish that the official Plugins main panel can return to an
  existing conversation. Keep these two surfaces distinct.

Local evidence: `build/input-editability-control-20260918/` and
`build/beta2-plugin-close-evidence.md` (the latter is the investigator's
handoff artifact). Do not commit raw user logs or authentication URLs.

## Ordered remaining work

1. Register a synthetic workspace and active session in an isolated alpha2
   fixture. Type text without submitting, first without third-party plugins,
   then with chat-manager 1.3.5, then the reviewed beta plugin. Record actual
   editability and return-from-Plugins behavior for each case.
2. Fix the proven failure at its boundary. Default-plugin upgrades must not
   silently leave a known incompatible workspace override active. Preserve
   plugin data, user choices, offline startup and rollback. Do not solve the
   optional dependency failure by unconditional startup network access or
   replacing arbitrary installed plugin directories.
3. Reproduce an existing-profile upgrade with an unrelated dependency absent
   from the offline cache. Verify the chosen failure/recovery behavior, not
   just a mocked successful install. No copying user credentials.
4. Run a clean-install and migrated-profile Windows acceptance: real text
   entry before visiting Plugins, open/leave the official Plugins main panel,
   open/close Market, repeat entry, and restart. Verify no message was sent.
5. Build Beta 2 only after those pass; qualify the exact release commit and
   artifacts using normal platform gates, then publish and read back candidate
   indexes. If a blocker remains, keep the release unpublished.

The tray bridge smoke now inserts text through CDP and checks it before
clearing it without submission. Source checks are not a claim that this new
interaction gate has passed against a built product.

## Cost and safety limits

Primary agent owns fixes and decisions. Luna performs bounded reproduction
and acceptance. Reuse captured evidence; do not repeat full audits or start
unrelated research. Stop owned fixture processes after collecting results;
never manipulate the user's foreground or running installation. Keep small
evidence artifacts and clean only identified disposable fixtures.
