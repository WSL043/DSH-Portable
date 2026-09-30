import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, execFile as execFileAsync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { assessHealth, isValidDshLink, parseUpdatedVersion } from '../experiments/official-payload/launcher/state.mjs';
import { shouldBootstrap } from '../experiments/official-payload/launcher/bootstrap-state.mjs';
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
  assert.match(source, /1\.0\.0\.5/);
  assert.match(source, /1\.0\.0-alpha\.5/);
});

test('bootstrap marker installs only when current state or its application is missing', async () => {
  assert.equal(shouldBootstrap({ markerExists: false, currentJsonExists: false, versionDirectoryExists: false }), false);
  assert.equal(shouldBootstrap({ markerExists: true, currentJsonExists: false, versionDirectoryExists: false }), true);
  assert.equal(shouldBootstrap({ markerExists: true, currentJsonExists: true, versionDirectoryExists: false }), true);
  assert.equal(shouldBootstrap({ markerExists: true, currentJsonExists: true, versionDirectoryExists: true }), false);
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /launcher", "bootstrap\.json/);
  assert.match(source, /if \(!File\.Exists\(current\)\) return true;/);
  assert.match(source, /return !Directory\.Exists\(Path\.Combine\(AppRoot, version\)\);/);
  const engine = await readFile(resolve(root, 'experiments/official-payload/apply-update.ps1'), 'utf8');
  for (const field of ['downloadedBytes', 'totalBytes', 'progress', 'reading-index', 'downloading', 'verifying', 'extracting', 'switching']) assert.ok(engine.includes(field), `missing update status field or phase ${field}`);
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
    $newer=$good | Select-Object *; $newer.version='0.2.0-rc.4'
    $checks.latest=(Get-LatestAcceptedIndexCandidate @{versions=@($good,$newer)}).version -eq '0.2.0-rc.4'
    ConvertTo-Json $checks -Compress
  `;
  const checks = JSON.parse(ps(source).split(/\r?\n/).at(-1));
  assert.deepEqual(checks, { valid: true, missingRejected: true, duplicateRejected: true, latest: true });
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
  assert.match(script, /\[switch\]\$Bootstrap/);
  assert.match(script, /Get-LatestAcceptedIndexCandidate/);
  assert.match(script, /mode='bootstrap'/);
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

test('PowerShell sources with non-ASCII text carry a UTF-8 BOM so Windows PowerShell 5.1 decodes them correctly', async () => {
  const { readdir } = await import('node:fs/promises');
  const dirs = ['experiments/official-payload', 'experiments/official-payload/e2e', 'experiments/official-payload/contract', 'launcher'];
  const offenders = [];
  for (const dir of dirs) {
    for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.psm?1$/.test(entry.name)) continue;
      const bytes = await readFile(resolve(root, dir, entry.name));
      const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      if (bytes.some(byte => byte > 127) && !hasBom) offenders.push(`${dir}/${entry.name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the index reader follows GitHub-style redirects but refuses other hosts, loops and oversized bodies', { skip: process.platform !== 'win32' && 'requires Windows PowerShell' }, async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    if (req.url === '/index.json') { res.writeHead(302, { Location: '/asset/index-body.json' }); res.end(); }
    else if (req.url === '/asset/index-body.json') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end('{"versions":[]}'); }
    else if (req.url === '/evil') { res.writeHead(302, { Location: 'https://example.test/index.json' }); res.end(); }
    else if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); }
    else if (req.url === '/big') { res.writeHead(200); res.end('x'.repeat(1_100_000)); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const source = `
      ${psModule}
      $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED='1'
      $checks=[ordered]@{}
      $checks.followed = (Read-BoundedHttpText '${base}/index.json') -ceq '{"versions":[]}'
      foreach ($case in 'evil','loop','big','missing') { try { Read-BoundedHttpText ('${base}/' + $case) | Out-Null; $checks[$case]=$false } catch { $checks[$case]=$true } }
      ConvertTo-Json $checks -Compress
    `;
    const checks = JSON.parse(await new Promise((resolvePromise, reject) => {
      
      execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolvePromise(stdout.trim().split(/\r?\n/).at(-1)));
    }));
    assert.deepEqual(checks, { followed: true, evil: true, loop: true, big: true, missing: true });
  } finally { server.close(); }
});

test('official installer transfer resumes Range downloads, restarts unsupported Range, and discards bad hashes', { skip: process.platform !== 'win32' && 'requires Windows PowerShell' }, async () => {
  const { createServer } = await import('node:http');
  const payload = Buffer.alloc(1_250_000);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + 11) & 0xff;
  const wrongHashPayload = Buffer.from(payload);
  wrongHashPayload[0] ^= 0xff;
  const rangeRequests = [];
  let interruptedRequests = 0;
  let unsupportedRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/dsh-desk/bin/win-x64/resume.exe') {
      interruptedRequests++;
      rangeRequests.push(req.headers.range ?? null);
      if (interruptedRequests === 1) {
        res.writeHead(200, { 'Content-Length': payload.length });
        res.write(payload.subarray(0, 500_000));
        setTimeout(() => res.destroy(), 100);
      } else {
        const start = Number(/^bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
        res.writeHead(start ? 206 : 200, start ? { 'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`, 'Content-Length': payload.length - start } : { 'Content-Length': payload.length });
        res.end(payload.subarray(start));
      }
    } else if (req.url === '/dsh-desk/bin/win-x64/no-range.exe') {
      unsupportedRequests++;
      rangeRequests.push(req.headers.range ?? null);
      res.writeHead(200, { 'Content-Length': payload.length });
      res.end(payload);
    } else if (req.url === '/dsh-desk/bin/win-x64/bad.exe') {
      res.writeHead(200, { 'Content-Length': payload.length });
      res.end(payload);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  const base = `http://127.0.0.1:${server.address().port}/dsh-desk/bin/win-x64/`;
  const directory = await mkdtemp(join(tmpdir(), 'dsh-resume-test-'));
  const psQuote = value => `'${value.replaceAll("'", "''")}'`;
  const candidate = url => ({ version: '0.2.0-rc.3', installerUrl: base + url, sha512: createHash('sha512').update(payload).digest('base64'), size: payload.length });
  const runPowerShell = source => new Promise((resolvePromise, reject) => {
    const env = { ...process.env, DSH_PORTABLE_TEST_ALLOW_LOCAL_INSTALLER: '1' };
    delete env.PSModulePath;
    execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {
      encoding: 'utf8', env,
    }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stderr}`)) : resolvePromise(stdout.trim().split(/\r?\n/).at(-1)));
  });
  try {
    const resumePath = join(directory, 'resume.exe');
    const resumeCandidate = JSON.stringify(candidate('resume.exe'));
    const resumeSource = `${psModule}
      $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_INSTALLER='1'
      $destination=${psQuote(resumePath)}; $candidate=${psQuote(resumeCandidate)} | ConvertFrom-Json
      $firstError=''; try { Receive-OfficialInstallerBytes $destination $candidate $null '' | Out-Null } catch { $firstError=$_.Exception.Message }
      $partPath=$destination+'.part'; $partBytes=if(Test-Path -LiteralPath $partPath){(Get-Item -LiteralPath $partPath).Length}else{0}
      $result=Receive-OfficialInstallerBytes $destination $candidate $null ''
      $checks=[ordered]@{ firstInterrupted=([string]::IsNullOrEmpty($firstError)-eq $false); partBytes=$partBytes; completed=($result -eq $partPath); hash=(Get-FileHash -LiteralPath $result -Algorithm SHA512).Hash }
      ConvertTo-Json $checks -Compress`;
    const resumed = JSON.parse(await runPowerShell(resumeSource));
    assert.equal(resumed.firstInterrupted, true);
    assert.ok(resumed.partBytes > 0 && resumed.partBytes < payload.length);
    assert.equal(resumed.completed, true);
    assert.equal(resumed.hash, createHash('sha512').update(payload).digest('hex').toUpperCase());
    assert.match(rangeRequests[1] ?? '', /^bytes=\d+-$/);

    const noRangePath = join(directory, 'no-range.exe');
    await writeFile(noRangePath + '.part', payload.subarray(0, 180_000));
    const noRangeSource = `${psModule}
      $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_INSTALLER='1'
      $candidate=${psQuote(JSON.stringify(candidate('no-range.exe')))} | ConvertFrom-Json
      $result=Receive-OfficialInstallerBytes ${psQuote(noRangePath)} $candidate $null ''
      ConvertTo-Json @{ completed=($result -eq (${psQuote(noRangePath)}+'.part')); length=(Get-Item -LiteralPath $result).Length } -Compress`;
    const restarted = JSON.parse(await runPowerShell(noRangeSource));
    assert.equal(restarted.completed, true);
    assert.equal(restarted.length, payload.length);
    assert.equal(unsupportedRequests, 2);
    assert.match(rangeRequests.at(-2) ?? '', /^bytes=\d+-$/);
    assert.equal(rangeRequests.at(-1), null);

    const badPath = join(directory, 'bad.exe');
    const badCandidate = { ...candidate('bad.exe'), sha512: createHash('sha512').update(wrongHashPayload).digest('base64') };
    const badSource = `${psModule}
      $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_INSTALLER='1'
      $candidate=${psQuote(JSON.stringify(badCandidate))} | ConvertFrom-Json
      $destination=${psQuote(badPath)}; $message=''
      try { Receive-OfficialInstallerBytes $destination $candidate $null '' | Out-Null } catch { $message=$_.Exception.Message }
      ConvertTo-Json @{ digestRejected=$message.Contains('digest'); partialRemoved=(-not (Test-Path -LiteralPath ($destination+'.part'))) } -Compress`;
    const rejected = JSON.parse(await runPowerShell(badSource));
    assert.deepEqual(rejected, { digestRejected: true, partialRemoved: true });
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolvePromise => server.close(resolvePromise));
    await rm(directory, { recursive: true, force: true });
  }
});
