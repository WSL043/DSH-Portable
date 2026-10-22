import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { windowsPowerShell } from './helpers/windows-powershell.mjs';

const root = resolve(import.meta.dirname, '..');
const payload = resolve(root, 'experiments/official-payload/Payload.psm1');
const engine = resolve(root, 'experiments/official-payload/apply-update.ps1');
const powershell = process.platform === 'win32' ? windowsPowerShell() : null;
const windows = { skip: process.platform !== 'win32' && 'requires Windows file-sharing and junction semantics' };
const quote = value => `'${value.replaceAll("'", "''")}'`;
function ps(source) {
  const env = { ...process.env };
  delete env.PSModulePath;
  return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; ${source}`, 'utf16le').toString('base64')], { encoding: 'utf8', env, windowsHide: true }).trim();
}

test('retention requires complete-tree ownership and preserves modified, unknown, linked and locked payloads', windows, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-owned-retention-'));
  try {
    const result = JSON.parse(ps(`
      Import-Module ${quote(payload)} -Force -DisableNameChecking;
      $app=Join-Path ${quote(fixture)} 'app'; $receipts=Join-Path ${quote(fixture)} 'receipts';
      $null=New-Item -ItemType Directory -Path $receipts -Force;
      foreach($v in @('0.1.0','0.2.0','0.3.0','0.4.0','0.5.0','0.6.0','1.0.0','2.0.0')) {
        $d=Join-Path $app $v; $null=New-Item -ItemType Directory -Path $d -Force;
        [IO.File]::WriteAllText((Join-Path $d 'marker.txt'),$v);
        if($v -eq '0.6.0') { [IO.File]::WriteAllText((Join-Path $d 'a-first.txt'),'must survive a later sharing failure') }
        if($v -ne '0.3.0') {
          @{version=$v;payloadTreeSha256=(Get-PortablePayloadTreeHash $d)}|ConvertTo-Json|Set-Content (Join-Path $receipts ($v+'.json'));
        }
      }
      [IO.File]::WriteAllText((Join-Path $app '0.2.0/unknown.txt'),'preserve');
      @{version='0.4.0'}|ConvertTo-Json|Set-Content (Join-Path $receipts '0.4.0.json');
      $outside=Join-Path ${quote(fixture)} 'outside'; $null=New-Item -ItemType Directory -Path $outside;
      [IO.File]::WriteAllText((Join-Path $outside 'marker.txt'),'outside');
      $null=New-Item -ItemType Junction -Path (Join-Path $app '0.2.0/link') -Target $outside;
      $held=[IO.File]::Open((Join-Path $app '0.5.0/marker.txt'),'Open','Read','None');
      $readHeld=[IO.File]::Open((Join-Path $app '0.6.0/marker.txt'),'Open','Read','Read');
      try { $plan=Remove-OwnedOlderPayloads $app $receipts '2.0.0' '1.0.0' } finally { $held.Dispose(); $readHeld.Dispose() }
      $remaining=@((Get-ChildItem $app -Directory).Name); $sharingFiles=@((Get-ChildItem (Join-Path $app '0.6.0') -File).Name);
      $retry=Remove-OwnedOlderPayloads $app $receipts '2.0.0' '1.0.0';
      @{plan=$plan; remaining=$remaining; sharingFiles=$sharingFiles; retry=$retry; outside=[IO.File]::ReadAllText((Join-Path $outside 'marker.txt')); legacyReceipt=(Test-Path (Join-Path $receipts '0.4.0.json'))}|ConvertTo-Json -Depth 5 -Compress;
    `));
    assert.deepEqual(result.plan.removed, ['0.1.0']);
    assert.deepEqual(result.remaining.sort(), ['0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '1.0.0', '2.0.0']);
    assert.equal(result.outside, 'outside');
    assert.equal(result.legacyReceipt, true);
    assert.ok(result.plan.deferred.includes('0.5.0'));
    assert.ok(result.plan.deferred.includes('0.6.0'));
    assert.deepEqual(result.sharingFiles.sort(), ['a-first.txt', 'marker.txt'], 'a read-shared lock must not leave a partially deleted tree');
    assert.ok(result.retry.removed.includes('0.6.0'), 'after the reader closes, the unchanged tree must remain eligible for cleanup');
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('a second update cannot overwrite the running update status when it cannot acquire the update lock', windows, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-update-lock-'));
  try {
    const result = JSON.parse(ps(`
      $storage=Join-Path ${quote(fixture)} 'data/launcher'; $null=New-Item -ItemType Directory -Path $storage -Force;
      $status=Join-Path $storage 'update-status.json'; [IO.File]::WriteAllText($status,'{"status":"downloading","owner":"first"}');
      $before=[IO.File]::ReadAllText($status); $held=[IO.File]::Open((Join-Path $storage 'update.lock'),'OpenOrCreate','ReadWrite','None');
      $ErrorActionPreference='Continue';
      try { & ${quote(powershell)} -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy Bypass -File ${quote(engine)} -Root ${quote(fixture)} -Version '2.0.0' -SelfPath 'unused.exe' *> (Join-Path ${quote(fixture)} 'second.log'); $code=$LASTEXITCODE } finally { $held.Dispose(); $ErrorActionPreference='Stop' }
      @{exitCode=$code; unchanged=($before -ceq [IO.File]::ReadAllText($status))}|ConvertTo-Json -Compress;
    `));
    assert.equal(result.exitCode, 1);
    assert.equal(result.unchanged, true);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('chunked update metadata is rejected before an oversized stream is fully buffered', windows, async () => {
  let sent = 0;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Transfer-Encoding': 'chunked' });
    const chunk = 'x'.repeat(65536);
    const timer = setInterval(() => {
      sent += chunk.length;
      response.write(chunk);
      if (sent >= 8 * 1024 * 1024) { clearInterval(timer); response.end(); }
    }, 2);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const source = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Import-Module ${quote(payload)} -Force -DisableNameChecking; $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED='1'; try { Read-BoundedHttpText 'http://127.0.0.1:${server.address().port}/' | Out-Null; throw 'Unexpected success' } catch { @{message=$_.Exception.Message}|ConvertTo-Json -Compress }`;
    const env = { ...process.env }; delete env.PSModulePath;
    const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8', env, windowsHide: true, timeout: 15000 });
    assert.match(JSON.parse(stdout.trim()).message, /Index response is too large/);
    assert.ok(sent < 4 * 1024 * 1024, `reader consumed ${sent} bytes instead of stopping near the 1 MiB limit`);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('real update transaction keeps a committed version on cleanup failure and refuses concurrent activation/state changes', windows, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-update-transaction-'));
  try {
    // The engine is unchanged. Only download/extraction are replaced at its module boundary;
    // activation, locks, atomic file replacement, rollback and cleanup execute on the real filesystem.
    const mockModule = `${await readFile(payload, 'utf8')}
function Read-BoundedHttpText { return (@{versions=@(@{version='2.0.0';installerUrl='https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-2.0.0-win-x64.exe';sha512=[Convert]::ToBase64String((New-Object byte[] 64));size=1000000})}|ConvertTo-Json -Depth 5) }
function Get-OfficialInstaller([string]$Destination) { [IO.File]::WriteAllText($Destination,'fixture'); return $Destination }
function Expand-OfficialPayload([string]$Installer,$Candidate,[string]$Output) {
  $null=New-Item -ItemType Directory -Path $Output -Force; [IO.File]::WriteAllText((Join-Path $Output 'DeepSeek Harness.exe'),'fixture');
  if($env:PURE_STATE_CHANGE -eq '1') { [IO.File]::WriteAllText((Join-Path $env:PURE_TEST_ROOT 'app/current.json'),'{"version":"1.1.0","pendingHealth":false}') }
  return @{version=$Candidate.version;payloadTreeSha256=(Get-PortablePayloadTreeHash $Output)}
}
function Remove-OwnedOlderPayloads { throw 'Injected old payload sharing failure' }
`;
    await writeFile(join(fixture, 'Payload.psm1'), mockModule);
    await writeFile(join(fixture, 'apply-update.ps1'), await readFile(engine));
    for (const scenario of ['cleanup', 'activation', 'state']) {
      const target = join(fixture, scenario);
      const result = JSON.parse(ps(`
        $env:PURE_TEST_ROOT=${quote(target)}; $env:PURE_STATE_CHANGE=${quote(scenario === 'state' ? '1' : '0')};
        $null=New-Item -ItemType Directory -Path ${quote(join(target, 'app/1.0.0'))},${quote(join(target, 'data/launcher'))},${quote(join(target, 'launcher'))} -Force;
        [IO.File]::WriteAllText(${quote(join(target, 'app/1.0.0/DeepSeek Harness.exe'))},'old');
        [IO.File]::WriteAllText(${quote(join(target, 'DeepSeek Harness Portable.exe'))},'launcher fixture');
        [IO.File]::WriteAllText(${quote(join(target, 'app/current.json'))},'{"version":"1.0.0","pendingHealth":false}');
        [IO.File]::WriteAllText(${quote(join(target, 'launcher/follow.json'))},'{"indexUrl":"https://example.invalid/index.json","feedUrl":"https://example.invalid/","cacheDirName":"test"}');
        $held=$null;
        if(${scenario === 'activation' ? '$true' : '$false'}) { $held=[IO.File]::Open(${quote(join(target, 'data/launcher/activation.lock'))},'OpenOrCreate','ReadWrite','None') }
        $ErrorActionPreference='Continue';
        try { & ${quote(powershell)} -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy Bypass -File ${quote(join(fixture, 'apply-update.ps1'))} -Root ${quote(target)} -Version '2.0.0' -SelfPath ${quote(join(target, 'DeepSeek Harness Portable.exe'))} -Install *> ${quote(join(target, 'engine.log'))}; $code=$LASTEXITCODE } finally { if($held){$held.Dispose()}; $ErrorActionPreference='Stop' }
        @{exitCode=$code;current=(Get-Content ${quote(join(target, 'app/current.json'))} -Raw|ConvertFrom-Json);status=(Get-Content ${quote(join(target, 'data/launcher/update-status.json'))} -Raw|ConvertFrom-Json);newExists=(Test-Path ${quote(join(target, 'app/2.0.0'))});old=[IO.File]::ReadAllText(${quote(join(target, 'app/1.0.0/DeepSeek Harness.exe'))})}|ConvertTo-Json -Depth 6 -Compress;
      `));
      assert.equal(result.old, 'old');
      if (scenario === 'cleanup') {
        assert.equal(result.exitCode, 0, JSON.stringify(result));
        assert.equal(result.current.version, '2.0.0');
        assert.equal(result.status.status, 'applied');
        assert.deepEqual(result.status.cleanup.deferred, ['older-versions']);
      } else {
        assert.equal(result.exitCode, 1);
        assert.equal(result.current.version, scenario === 'state' ? '1.1.0' : '1.0.0');
        assert.equal(result.newExists, false);
      }
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
