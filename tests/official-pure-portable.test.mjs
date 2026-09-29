import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { assessHealth, isValidDshLink, parseUpdatedVersion } from '../experiments/official-payload/launcher/state.mjs';
import { rewriteAppUpdateYml } from '../experiments/official-payload/contract/update-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcherPath = resolve(root, 'experiments/official-payload/Launcher.cs');
const modulePath = resolve(root, 'experiments/official-payload/Payload.psm1');
const powershell = process.env.SystemRoot ? resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe';
const ps = source => execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8' }).trim();
const psModule = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Import-Module '${modulePath.replaceAll("'", "''")}' -Force -DisableNameChecking -WarningAction SilentlyContinue;`;

test('health state machine rolls back once only for pending non-zero exit and clears after 20 seconds', async () => {
  const base = { version: '2.0.0', previous: '1.0.0', pendingHealth: true };
  assert.deepEqual(assessHealth(base, { exitCode: 1 }), { action: 'rollback', state: { ...base, version: '1.0.0', previous: '2.0.0', pendingHealth: false } });
  assert.equal(assessHealth(base, { aliveForMs: 20_000 }).state.pendingHealth, false);
  assert.equal(assessHealth(base, { aliveForMs: 19_999 }).state.pendingHealth, true);
  assert.equal(assessHealth(base, { exitCode: 0 }).action, 'supervise');
  assert.equal(assessHealth({ ...base, pendingHealth: false }, { exitCode: 9 }).action, 'supervise');
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /ShouldRollback\(bool pendingHealth, int exitCode\) \{ return pendingHealth && exitCode != 0; \}/);
  assert.match(source, /WaitForExit\(20000\)/);
  assert.match(source, /state\["pendingHealth"\] = false/);
});

test('updated-copy filename, protocol link whitelist and launcher protocol command are locked', async () => {
  assert.equal(parseUpdatedVersion('deepseek-harness-0.2.0-rc.3-win-x64.exe', ['--updated', '/S']), '0.2.0-rc.3');
  assert.equal(parseUpdatedVersion('deepseek-harness-0.2.0-win-x64.exe', ['/S']), null);
  assert.equal(parseUpdatedVersion('deepseek-harness-0.2.exe', ['--updated']), null);
  assert.equal(isValidDshLink('dsh://conversation/abc?x=1'), true);
  assert.equal(isValidDshLink(`dsh://${'x'.repeat(8190)}`), false);
  assert.equal(isValidDshLink('dsh://x" --evil'), false);
  assert.equal(isValidDshLink('dsh://x\n'), false);
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /Software\\Classes\\dsh\\shell\\open\\command/);
  assert.match(source, /--open \\\"%1\\\"/);
  assert.match(source, /WritePortableRootPointer\(ReadCacheName\(\)\)/);
  assert.match(source, /1\.0\.0\.4/);
  assert.match(source, /1\.0\.0-alpha\.4/);
});

test('follow and accepted-index URL policy rejects downgrade and host/path confusion', { skip: process.platform !== 'win32' && 'requires Windows PowerShell' }, () => {
  const good = { version: '0.2.0-rc.3', installerUrl: 'https://download.deepseek.com/dsh-desk/bin/win-x64/app.exe', sha512: Buffer.alloc(64).toString('base64'), size: 289313640 };
  const source = `
    ${psModule}
    $good = '${JSON.stringify(good)}' | ConvertFrom-Json; Assert-Candidate $good
    $badHost = $good | Select-Object *; $badHost.installerUrl='https://download.deepseek.com.evil.test/dsh-desk/bin/win-x64/app.exe'; try { Assert-Candidate $badHost; throw 'host accepted' } catch { if ($_.Exception.Message -eq 'host accepted') { throw } }
    $badPath = $good | Select-Object *; $badPath.installerUrl='https://download.deepseek.com/other/app.exe'; try { Assert-Candidate $badPath; throw 'path accepted' } catch { if ($_.Exception.Message -eq 'path accepted') { throw } }
    Assert-FeedUrl 'https://example.test/feed/'
    try { Assert-FeedUrl 'http://example.test/feed'; throw 'external http accepted' } catch { if ($_.Exception.Message -eq 'external http accepted') { throw } }
    try { Assert-FeedUrl 'http://127.0.0.1:3333/feed'; throw 'local http accepted without switch' } catch { if ($_.Exception.Message -eq 'local http accepted without switch') { throw } }
    $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED='1'; Assert-FeedUrl 'http://127.0.0.1:3333/feed'
    $checks=[ordered]@{}; $index = @{versions=@($good)}
    try { $checks.valid=(Get-AcceptedIndexCandidate $index '0.2.0-rc.3').version -eq '0.2.0-rc.3' } catch { $checks.validError=$_.Exception.Message }
    try { Get-AcceptedIndexCandidate $index '0.2.0-rc.4' | Out-Null; $checks.missingRejected=$false } catch { $checks.missingRejected=$_.Exception.Message -eq 'Requested version is absent from the accepted index' }
    try { Get-AcceptedIndexCandidate @{versions=@($good,$good)} '0.2.0-rc.3' | Out-Null; $checks.duplicateRejected=$false } catch { $checks.duplicateRejected=$_.Exception.Message -eq 'Accepted index contains duplicate versions' }
    ConvertTo-Json $checks -Compress
  `;
  const checks = JSON.parse(ps(source).split(/\r?\n/).at(-1));
  assert.deepEqual(checks, { valid: true, missingRejected: true, duplicateRejected: true });
});

test('PowerShell app-update.yml rewrite matches phase-1 contract semantics', { skip: process.platform !== 'win32' && 'requires Windows PowerShell' }, () => {
  const source = [
    'provider: generic', 'url: https://updates.example.test/', 'channel: nightly',
    'publisherName: old publisher', '  nested: remove me', 'updaterCacheDirName: old-cache', 'custom: keep', '',
  ].join('\n');
  const expected = rewriteAppUpdateYml(source, 'http://127.0.0.1:4321/', 'deepseek-aidsh-desktop-updater-portable');
  const script = `${psModule} $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED='1'; $v=Rewrite-AppUpdateYml @'\n${source}\n'@ 'http://127.0.0.1:4321/' 'deepseek-aidsh-desktop-updater-portable'; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v))`;
  const actual = Buffer.from(ps(script), 'base64').toString('utf8');
  assert.equal(actual, expected);
  assert.match(actual, /^channel: nightly$/m);
  assert.doesNotMatch(actual, /^publisherName:/m);
});

test('archive path and version-retention PowerShell helpers enforce extraction boundaries', { skip: process.platform !== 'win32' && 'requires Windows PowerShell' }, () => {
  const script = `${psModule}
    Assert-ArchiveEntryPath 'resources/app.asar';
    foreach($bad in @('../escape','resources/../../escape','C:\\absolute','foo:bar','trailing. ')){ try { Assert-ArchiveEntryPath $bad; throw "accepted $bad" } catch { if ($_.Exception.Message -like 'accepted *') { throw } } }
    $plan=Get-VersionRetentionPlan @('0.1.0','0.2.0','0.3.0','junk','0.2.0.partial') '0.3.0' '0.2.0'; ConvertTo-Json -InputObject @($plan) -Compress`;
  const removable = JSON.parse(ps(script));
  assert.deepEqual(removable, ['0.1.0']);
});

test('pure package script only copies the pure allowlist and contains no adapter packaging route', async () => {
  const script = await readFile(resolve(root, 'experiments/official-payload/package-pure.ps1'), 'utf8');
  assert.match(script, /@\('apply-update\.ps1', 'Payload\.psm1'\)/);
  assert.match(script, /@\('7z\.exe', '7z\.dll', 'License\.txt'\)/);
  const copies = script.match(/Copy-Item[^\r\n]*/g) ?? [];
  assert.ok(copies.every(line => !/adapt-asar|desktop-adapter|update-bridge|default-plugins|prepare-defaults|market/i.test(line)));
  assert.match(script, /pendingHealth=\$false/);
  const source = await readFile(launcherPath, 'utf8');
  assert.doesNotMatch(source, /portable-adaptation|default-plugins|desktop-adapter|adapt-asar/);
});

// These behaviours were found only by running the real executable against the real official desktop.
test('launcher fixes found by the real end-to-end run stay in place', async () => {
  const source = await readFile(launcherPath, 'utf8');
  const engine = await readFile(resolve(root, 'experiments/official-payload/apply-update.ps1'), 'utf8');
  // `--open <link>` (the registered protocol command) must be accepted exactly once, not rejected as a duplicate.
  assert.match(source, /arg == "--open"\)\s*\{\s*if \(link != null \|\| i \+ 1 >= args\.Length \|\| !IsValidLink\(args\[i \+ 1\]\)\) throw[^;]*;\s*link = args\[\+\+i\];/);
  assert.doesNotMatch(source, /for \(int i = 0; i \+ 1 < args\.Length; i\+\+\) if \(args\[i\] == "--open"\)/);
  // The official app re-registers dsh:// on every start, so ownership is verified every supervision tick.
  assert.match(source, /while \(!app\.WaitForExit\(1000\)\)\s*\{\s*EnsureProtocolOwned\(\);/);
  assert.doesNotMatch(source, /nextProtocolRepair/);
  // The update root pointer is written only after the port and foreign-instance checks pass.
  assert.ok(source.indexOf('CheckExternalOfficialOrPort(executable);') < source.indexOf('WritePortableRootPointer(ReadCacheName());'));
  // A rolled-back version is never the rollback target, is removed, and is not retried for 24 hours.
  assert.match(source, /state\["previous"\] = ""/);
  assert.match(source, /state\["rejected"\]/);
  assert.match(source, /Directory\.Delete\(Path\.Combine\(AppRoot, version\), true\)/);
  assert.match(engine, /rejected/);
  assert.match(engine, /rolled back within the last 24 hours/);
});

// Found by running the real update chain on Windows PowerShell 5.1 against real official installers.
test('update engine survives Windows PowerShell 5.1 quirks and a hostile parent environment', async () => {
  const engine = await readFile(resolve(root, 'experiments/official-payload/apply-update.ps1'), 'utf8');
  const source = await readFile(launcherPath, 'utf8');
  // PowerShell 5.1 turns $null into "" for string parameters, which makes File.Replace throw "path is not of a legal form".
  assert.doesNotMatch(engine, /File\]::Replace\([^)]*,\s*\$null\)/);
  assert.match(engine, /File\]::Replace\(\$temp, \$Path, \[NullString\]::Value\)/);
  // A parent PowerShell 7 shell leaks its module path and breaks core cmdlets such as Get-FileHash in 5.1.
  assert.match(source, /ps\.EnvironmentVariables\.Remove\("PSModulePath"\);/);
});

test('launcher waits briefly for leftovers of a previous run before refusing to start', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /DateTime deadline = DateTime\.UtcNow\.AddSeconds\(20\);\s*string conflict;\s*while \(\(conflict = FindOfficialConflict\(\)\) != null\)/);
  assert.match(source, /if \(DateTime\.UtcNow >= deadline\) throw new IOException\(conflict\);\s*Thread\.Sleep\(500\);/);
});
