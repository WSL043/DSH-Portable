# Issue 132: automode installation and restart diagnosis

Verified on Windows on 2026-09-10, in isolated state roots. No user profiles changed.

## Reproduction

- Stable 0.6.4: freshly extracted release ZIP; SHA256 `10ecfd184f47bfe1ce12116eb86d431fb6250e014590b832ba65bbabe56374a4` matches retained release checksums.
- Candidate: existing local 0.6.5-rc.2 finished product, capsule SHA256 `e4c858ecc86e2ff6bcac4b43d802c4ba6b31d4d20ca3af756ee1c28294b0ba0a`. This is local artifact acceptance, not proof about a published RC asset.
- Both boot successfully before installation. The real market installs npm `@log.li/dsh-automode@0.11.1` and returns `ok:true`, requiring restart.
- Both fail on the subsequent boot with `@deepseek-ai/dsh-permission-presets does not provide an export named effectivePermissionPreset` from automode's `lib/pre-execute.js:7`.
- Actual native EXE windows show startup failure; captures are under `evidence/stable/native/native-11.png` and `evidence/rc2/native/native-11.png`.
- Private bridge/market links remain links with unchanged targets after install. This reproduction is distinct from the original materialized bridge-directory conflict.

## Attribution

Downloaded original official permission-presets tarballs directly from npm and inspected their entry modules:

| Official version | effectivePermissionPreset present | lib/index.js SHA256 |
| --- | --- | --- |
| 0.1.0-rc.6 | yes | f19f19b55ba6e43d0c99a479df1dc651f288aa42d68f74d9196872710578c69e |
| 0.1.2-rc.1 | no | 44410c26714e93ea5fa46bf73ad97d2a1e7c451ba7eca80a86b4ece365b2b5e6 |
| 0.1.3-alpha.2 | no | same as above |
| 0.1.5-rc.1 | no | same as above |

Stable contains permission-presets 0.1.2-rc.1; the local candidate contains 0.1.3-alpha.2. Both actual files have the exact official SHA256 above. Portable packaging did not remove the export. Updating to current official 0.1.5-rc.1 would not restore it.

Automode 0.11.1 imports the removed function and calls it with session.events. Its manifest still declares permission-presets ^0.1.0-rc.6. The current official service exposes current(session), backed by registered session projections. Adapting this permission-related integration needs behavioral tests; do not insert a permissive fallback or just remove the check.

The primary incompatibility is automode's use of an obsolete upstream API. Official API evolution is established; whether removing this API violated a promised compatibility contract is not established. Portable also has a containment gap: installation is reported successful even though this bundle cannot load at restart. Default plugin success does not exercise this obsolete import.

## Implemented follow-up

Automode compatibility PR: https://github.com/log-li/dsh-automode/pull/2. The patched compiled plugin loaded after restart on both tested host artifacts; both default plugins remained live. Permission tests cover service precedence over stale events, unavailable projections, non-auto sessions, and rejection of failed modern setters. No model calls or blanket automatic-approval acceptance were exercised.

Portable now probes newly installed or updated host entries in a disposable process before hot activation. It follows import conditions and the host fallback for unavailable bare dependencies. It reads actual loader rows, not config display names. Import failure or timeout fails the operation; install recovery restores the prior manifest and lockfile before rematerializing dependencies, and update recovery restores the captured exact version/source.

Local finished-runtime validation on both 0.6.4 and rc.2 rejected unpatched automode 0.11.1, automatically rolled it back, and successfully restarted with both default plugins live. Sentinel bytes in session storage, group storage and workspace locations remained identical. These are controlled fixtures, not the reporter's private data or proof of recovery from arbitrary plugin data writes.

For this targeted test, the rebuilt market was placed in each isolated extracted runtime and startup source caching was disabled so it could not load the old bundle from the original capsule. This does not qualify an unchanged published asset. A first test exposed that harness distinction; its failure evidence was retained before the corrected test.

Import checks execute module top-level code in a separate process, not a security sandbox. They do not invoke the plugin lifecycle and cannot prove compatibility of deferred imports, live model behavior, or recovery after a host/process crash during installation. No general repair of arbitrary existing plugin corruption is claimed. Avoid downgrading or replacing the permission module alone because the host services are coupled.

Evidence: `evidence/{stable,rc2}/install.json`, `links-before.json`, `links-after.json`, `data/logs/dsh.stderr.log`, native captures, and `evidence/official/`.
