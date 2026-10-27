import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { exportFixture } from '../experiments/official-payload/e2e/native-data.mjs';
import { inspectDataArchive } from '../launcher/data-transfer.mjs';
import { importNativeData } from '../experiments/official-payload/import-native-data.mjs';
import { windowsPowerShell } from './helpers/windows-powershell.mjs';
import { buildAcceptedIndex, buildPureE2EReport, expectedProtocolCommand, isPathOwnedByRoot, normalizeOfficialCandidate, packageFeedContract, REQUIRED_IDS, serializeCandidateFile } from '../experiments/official-payload/e2e/report.mjs';

const digest = Buffer.alloc(64, 7).toString('base64');
const oldCandidate = { version: '0.1.7-rc.2', url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.2-win-x64.exe', sha512: digest, size: 288245480 };
const newCandidate = { version: '0.2.0-rc.2', url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.0-rc.2-win-x64.exe', sha512: digest, size: 289313640 };

test('pure report treats missing evidence as failures and preserves explicit failures', () => {
  const missing = buildPureE2EReport();
  assert.equal(missing.results.length, REQUIRED_IDS.length);
  assert.equal(missing.overallPassed, false);
  assert.ok(missing.results.every(item => item.passed === false));
  assert.equal(missing.results.find(item => item.id === 'update-applied').evidence, 'Not run');
  const failed = buildPureE2EReport({ checks: { 'update-applied': { passed: false, evidence: { status: 'failed' } } } });
  assert.equal(failed.results.find(item => item.id === 'update-applied').evidence.status, 'failed');
  assert.equal(failed.overallPassed, false);
});

test('pure report passes only when every required evidence item passed', () => {
  const launcherPath = 'C:\\runner\\work\\portable\\DeepSeek Harness Portable.exe';
  const protocol = expectedProtocolCommand(launcherPath);
  const checks = Object.fromEntries(REQUIRED_IDS.map(id => [id, { passed: true, evidence: { source: id } }]));
  checks['old-app-running-from-root'].evidence = {
    portableRoot: 'C:\\runner\\work\\portable',
    primaryExecutablePath: 'C:\\runner\\work\\portable\\app\\0.1.7-rc.2\\DeepSeek Harness.exe',
    userDataInsidePortableRoot: true,
  };
  checks['protocol-owned-while-running'].evidence = {
    launcherPath,
    samples: [{ valueExists: true, value: protocol }, { valueExists: true, value: protocol }],
    linkHandoff: { passed: true, noNewOfficialInstance: true, noErrorDialog: true },
  };
  const report = buildPureE2EReport({ oldVersion: oldCandidate.version, newVersion: newCandidate.version, checks });
  assert.equal(report.overallPassed, true);
  assert.deepEqual(report.results.map(item => item.id), REQUIRED_IDS);
  assert.equal(buildPureE2EReport({ checks, failure: 'cache cleanup failed' }).overallPassed, false);
});

test('pure report rechecks process path ownership and the exact protocol command', () => {
  const launcherPath = 'C:\\runner\\work\\portable\\DeepSeek Harness Portable.exe';
  const protocol = expectedProtocolCommand(launcherPath);
  const checks = Object.fromEntries(REQUIRED_IDS.map(id => [id, { passed: true, evidence: {} }]));
  checks['old-app-running-from-root'].evidence = {
    portableRoot: 'C:\\runner\\work\\portable',
    primaryExecutablePath: 'C:\\runner\\work\\portable\\app\\0.1.7\\DeepSeek Harness.exe',
    userDataInsidePortableRoot: true,
  };
  checks['protocol-owned-while-running'].evidence = {
    launcherPath,
    samples: [{ valueExists: true, value: protocol }],
    linkHandoff: { passed: true, noNewOfficialInstance: true, noErrorDialog: true },
  };
  assert.equal(buildPureE2EReport({ checks }).overallPassed, true);
  checks['old-app-running-from-root'].evidence.primaryExecutablePath = 'C:\\runner\\work\\portable-other\\DeepSeek Harness.exe';
  checks['protocol-owned-while-running'].evidence.samples[0].value = '"C:\\other.exe" --open "%1"';
  const rejected = buildPureE2EReport({ checks });
  assert.equal(rejected.results.find(item => item.id === 'old-app-running-from-root').passed, false);
  assert.equal(rejected.results.find(item => item.id === 'protocol-owned-while-running').passed, false);
  assert.equal(rejected.overallPassed, false);
});

test('candidate files and the accepted index preserve both exact official installer identities', () => {
  const candidateFile = JSON.parse(serializeCandidateFile(oldCandidate));
  assert.deepEqual(candidateFile, normalizeOfficialCandidate(oldCandidate));
  assert.equal(candidateFile.url, oldCandidate.url);
  const index = buildAcceptedIndex(oldCandidate, newCandidate);
  assert.deepEqual(index.versions, [oldCandidate, newCandidate].map(candidate => ({
    version: candidate.version, installerUrl: candidate.url, sha512: candidate.sha512, size: candidate.size,
  })));
  assert.throws(() => buildAcceptedIndex(oldCandidate, oldCandidate), /must differ/);
  assert.throws(() => normalizeOfficialCandidate({ ...newCandidate, url: 'https://download.deepseek.com.evil.test/x.exe' }), /outside the official/);
});

test('process ownership uses a path boundary and protocol registration has the exact launcher command', () => {
  const root = 'C:\\runner\\work\\portable';
  assert.equal(isPathOwnedByRoot(root + '\\app\\0.1.7-rc.2\\DeepSeek Harness.exe', root), true);
  assert.equal(isPathOwnedByRoot(root + '-other\\app\\DeepSeek Harness.exe', root), false);
  assert.equal(isPathOwnedByRoot('C:\\runner\\work\\outside.exe', root), false);
  assert.equal(expectedProtocolCommand(root + '\\DeepSeek Harness Portable.exe'), '"' + root + '\\DeepSeek Harness Portable.exe" --open "%1"');
});

test('package follow.json feed and cache values must match the app-update.yml artifact', async () => {
  const source = await readFile(new URL('../experiments/official-payload/package-pure.ps1', import.meta.url), 'utf8');
  assert.match(source, /Expand-OfficialPayload\s+\$Installer\s+\$candidate\s+\$partial\s+\$SevenZip\s+\$FeedUrl\s+\$CacheDirName/);
  assert.match(source, /\$follow\s*=\s*\[ordered\]@\{\s*indexUrl=\$IndexUrl;\s*feedUrl=\$FeedUrl;\s*cacheDirName=\$CacheDirName\s*\}/);
  const follow = { indexUrl: 'http://127.0.0.1:42001/index.json', feedUrl: 'http://127.0.0.1:42002/', cacheDirName: 'dsh-pure-e2e-abc123' };
  const good = packageFeedContract(follow, 'provider: generic\nurl: http://127.0.0.1:42002/\nchannel: nightly\nupdaterCacheDirName: dsh-pure-e2e-abc123\n');
  assert.equal(good.passed, true);
  const bad = packageFeedContract(follow, 'provider: generic\nurl: http://127.0.0.1:49999/\nchannel: nightly\nupdaterCacheDirName: dsh-pure-e2e-abc123\n');
  assert.equal(bad.passed, false);
});

test('outside-write audit rejects a leaked native-addon cache and tolerates unusual trace paths', async () => {
  const source = await readFile(new URL('../experiments/official-payload/e2e/run-pure-e2e.ps1', import.meta.url), 'utf8');
  assert.match(source, /function Test-ForbiddenOfficialExternalWrite\(/);
  assert.match(source, /node-addon-native-custom-loader\\native-cache/);
  assert.doesNotMatch(source.match(/function Test-ForbiddenOfficialExternalWrite[\s\S]*?\n\}/)[0], /Documents/);
  assert.match(source, /catch \{ return \$false \}/);
  assert.match(source, /-and -not \$forbiddenOfficialExternalWrite/);
});

test('the actual write-audit predicate rejects global data/agents leaks without blocking sibling paths or opaque traces', { skip: process.platform !== 'win32' }, () => {
  const file = resolve(import.meta.dirname, '../experiments/official-payload/e2e/run-pure-e2e.ps1');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
    $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(file)},[ref]$null,[ref]$null);
    $function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-ForbiddenOfficialExternalWrite'},$true);
    . ([scriptblock]::Create($function.Extent.Text));
    $agents=Join-Path $env:USERPROFILE '.agents';
    @{ agents=(Test-ForbiddenOfficialExternalWrite ($agents+'/AGENTS.md')); agentsRoot=(Test-ForbiddenOfficialExternalWrite $agents); dsh=(Test-ForbiddenOfficialExternalWrite (Join-Path $env:USERPROFILE '.dsh/profile.json')); electron=(Test-ForbiddenOfficialExternalWrite (Join-Path $env:APPDATA 'DeepSeek Harness/Preferences')); sibling=(Test-ForbiddenOfficialExternalWrite ($agents+'-other/file')); opaque=(Test-ForbiddenOfficialExternalWrite 'HKCU\\Software\\Example') }|ConvertTo-Json -Compress`;
  const env = { ...process.env }; delete env.PSModulePath;
  const result = JSON.parse(execFileSync(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', env, windowsHide: true }).trim());
  assert.deepEqual(result, { agents: true, agentsRoot: true, dsh: true, electron: true, sibling: false, opaque: false });
});


test('the cross-host fixture supplies plain and encrypted imports with the same history and file-only password flow', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pure-cross-host-formats-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'origin');
  const plain = await exportFixture(join(root, 'native-source'), output);
  const encrypted = JSON.parse(await readFile(join(output, 'origin-encrypted.json'), 'utf8'));
  const passwordFile = join(output, 'synthetic-password.txt');
  const password = (await readFile(passwordFile, 'utf8')).replace(/[\r\n]+$/, '');
  assert.deepEqual(encrypted.identity, plain.identity);
  assert.equal(encrypted.sessionId, plain.sessionId);
  assert.equal(encrypted.exported.encrypted, true);
  assert.equal(plain.exported.encrypted, false);
  assert.ok(!JSON.stringify([plain, encrypted]).includes(password), 'password must not enter origin evidence or CLI output');
  const plainArchive = join(output, 'legacy.dshdata'), encryptedArchive = join(output, 'encrypted.dshdata');
  assert.deepEqual((await inspectDataArchive(encryptedArchive, { password })).files, (await inspectDataArchive(plainArchive)).files);
  for (const [name, archive, origin, options] of [
    ['plain', plainArchive, plain, {}],
    ['encrypted', encryptedArchive, encrypted, { passwordFile }],
  ]) {
    const bytes = await readFile(archive);
    assert.equal(bytes.subarray(0, 8).toString(), name === 'encrypted' ? 'DSHDAT1E' : 'DSHDAT1U');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), origin.archiveSha256);
    const desktop = join(root, name); await mkdir(desktop);
    const result = await importNativeData(archive, desktop, { workspaceRoot: root, ...options });
    assert.equal(result.archiveSha256, origin.archiveSha256);
    assert.ok(!JSON.stringify(result).includes(password), 'password must not enter import evidence');
  }
  const workflow = await readFile(new URL('../.github/workflows/official-pure-e2e.yml', import.meta.url), 'utf8');
  assert.match(workflow, /os: windows-2022\s+mode: plain\s+archive: legacy\.dshdata\s+origin: origin\.json\s+password_file: ''/);
  assert.match(workflow, /os: windows-2025\s+mode: encrypted\s+archive: encrypted\.dshdata\s+origin: origin-encrypted\.json\s+password_file: synthetic-password\.txt/);
  assert.match(workflow, /NATIVE_PASSWORD_FILE: \$\{\{ matrix\.password_file \}\}/);
  assert.doesNotMatch(workflow, /contents: write|publish_draft:|publish_channel:/);
  const runner = await readFile(new URL('../experiments/official-payload/e2e/run-native-data-e2e.ps1', import.meta.url), 'utf8');
  assert.match(runner, /\$importArguments \+= @\('--password-file', \$inputPassword\)/);
  assert.doesNotMatch(runner, /Get-Content[^\r\n]*(?:Password|password)/);
});


test('Procmon PID lifetimes retain a live child after parent exit and reject reuse by an unrelated parent', { skip: process.platform !== 'win32' }, () => {
  const file = resolve(import.meta.dirname, '../experiments/official-payload/trace-writes.ps1');
  const row = (pid, name, operation, path, detail = '') => ({ 'Time of Day': '16:30:00.0000000', 'Process Name': name, PID: String(pid), Operation: operation, Path: path, Result: 'SUCCESS', Detail: detail });
  const rows = [
    row(100, 'DeepSeek Harness.exe', 'Process Start', 'D:\\portable\\DeepSeek Harness.exe', 'Parent PID: 4, Command line: official'),
    row(100, 'DeepSeek Harness.exe', 'Process Create', 'C:\\Windows\\System32\\PowerShell.EXE', 'PID: 200, Command line: powershell.exe update.ps1'),
    row(100, 'DeepSeek Harness.exe', 'Process Exit', '', 'Exit Status: 0'),
    row(200, 'powershell.exe', 'Process Start', 'C:\\Windows\\System32\\powershell.exe', 'Parent PID: 100, Command line: powershell.exe update.ps1'),
    row(200, 'powershell.exe', 'RegSetValue', 'HKLM\\SOFTWARE\\Example', 'Type: REG_SZ, Length: 8, Data: update'),
    row(200, 'powershell.exe', 'Process Exit', '', 'Exit Status: 0'),
    row(300, 'unrelated.exe', 'Process Create', 'C:\\Windows\\System32\\powershell.exe', 'PID: 200, Command line: powershell.exe unrelated.ps1'),
    row(200, 'powershell.exe', 'Process Start', 'C:\\Windows\\System32\\powershell.exe', 'Parent PID: 300, Command line: powershell.exe unrelated.ps1\r\nEnvironment:\r\nSYNTHETIC_TRACE_ENV_SECRET=must-not-upload'),
    row(200, 'powershell.exe', 'RegSetValue', 'HKLM\\SOFTWARE\\Example', 'Type: REG_SZ, Length: 8, Data: unrelated'),
    row(101, 'DeepSeek Harness.exe', 'Process Create', 'C:\\Windows\\System32\\powershell.exe', 'PID: 400, Command line: powershell.exe update.ps1'),
    row(400, 'powershell.exe', 'Process Start', 'C:\\Windows\\System32\\powershell.exe', 'Parent PID: 300, Command line: powershell.exe unrelated.ps1'),
    row(400, 'powershell.exe', 'RegSetValue', 'HKLM\\SOFTWARE\\Example', 'Type: REG_SZ, Length: 8, Data: unrelated'),
  ];
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const fixture = Buffer.from(JSON.stringify(rows), 'utf8').toString('base64');
  const script = String.raw`$ErrorActionPreference='Stop';
    $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(file)},[ref]$null,[ref]$null);
    foreach($name in @('Update-TraceOwnership','New-TraceContextEvent')) {
      $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);
      . ([scriptblock]::Create($fn.Extent.Text));
    }
    $fixtureRows=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${fixture}'))|ConvertFrom-Json;
    $csvRows=@(foreach($fixtureRow in $fixtureRows) { $fixtureRow });
    $rows=@($csvRows|ConvertTo-Csv -NoTypeInformation|ConvertFrom-Csv);
    $state=@{active=@{};everOwned=(New-Object 'System.Collections.Generic.HashSet[string]');generation=0};
    $seen=@(); $sequence=0;
    foreach($row in $rows){$sequence++;$seen+=Update-TraceOwnership $state $row $sequence}
    $context=New-TraceContextEvent $rows[8] 9 $seen[8];
    $startContext=New-TraceContextEvent $rows[7] 8 $seen[7];
    $commaContext=New-TraceContextEvent ([pscustomobject]@{PID='200';Operation='Process Create';Detail='PID: 200, Command line: powershell.exe update.ps1, Environment: SYNTHETIC_TRACE_ENV_SECRET=must-not-upload'}) 13 $seen[7];
    $missing=New-TraceContextEvent ([pscustomobject]@{PID='200';Operation='RegSetValue'}) 10 $seen[8];
    $long=New-TraceContextEvent ([pscustomobject]@{PID='200';Detail=('x'*4096)}) 11 $seen[8];
    $seen[8].imagePath=('x'*4096);
    $longImage=New-TraceContextEvent ([pscustomobject]@{PID='200';Operation='Process Exit'}) 12 $seen[8];
    @{ owned=@($seen|ForEach-Object {$_.owned}); firstGeneration=$seen[4].generation; reusedGeneration=$seen[8].generation; parentAfterExit=$state.active.ContainsKey('100'); childParent=$seen[4].parentPid; context=$context; startContext=$startContext; commaContext=$commaContext; missing=$missing; longLength=$long.detail.Length; longTruncated=$long.fieldTruncated; imageLength=$longImage.imagePath.Length; imageTruncated=$longImage.fieldTruncated }|ConvertTo-Json -Depth 6 -Compress`;
  const env = { ...process.env }; delete env.PSModulePath;
  const result = JSON.parse(execFileSync(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', env, windowsHide: true }).trim());
  assert.deepEqual(result.owned, [true, true, true, true, true, true, false, false, false, true, false, false]);
  assert.notEqual(result.firstGeneration, result.reusedGeneration);
  assert.equal(result.parentAfterExit, false);
  assert.equal(result.childParent, '100');
  assert.equal(result.context.sequence, 9);
  assert.equal(result.context.parentPid, '300');
  assert.equal(result.context.time, rows[8]['Time of Day']);
  assert.equal(result.context.detail, rows[8].Detail);
  assert.equal(result.context.owned, false);
  for (const context of [result.startContext, result.commaContext]) {
    assert.equal(context.environmentOmitted, true);
    assert.doesNotMatch(JSON.stringify(context), /SYNTHETIC_TRACE_ENV_SECRET|must-not-upload|Environment:/);
    assert.match(context.detail, /Command line: powershell\.exe/);
  }
  assert.equal(result.startContext.parentPid, '300');
  assert.match(result.startContext.detail, /Parent PID: 300/);
  assert.match(result.commaContext.detail, /^PID: 200/);
  assert.equal(result.context.environmentOmitted, false);
  assert.equal(result.missing.path, '');
  assert.equal(result.missing.time, '');
  assert.equal(result.longLength, 2048);
  assert.equal(result.longTruncated, true);
  assert.equal(result.imageLength, 2048);
  assert.equal(result.imageTruncated, true);
});
