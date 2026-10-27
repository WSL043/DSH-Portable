import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
    // Server writes include socket/read-ahead queues; measure the real reader instead.
    const source = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Import-Module ${quote(payload)} -Force -DisableNameChecking;
      Add-Type -TypeDefinition @'
using System.IO; using System.Text;
public sealed class MetadataCountingReader : StreamReader {
  public static long Consumed;
  public MetadataCountingReader(Stream stream, Encoding encoding) : base(stream, encoding) {}
  public override int Read(char[] buffer, int index, int count) {
    int read = base.Read(buffer, index, count); Consumed += read; return read;
  }
}
'@;
      $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED='1';
      & (Get-Module Payload) {
        param($url)
        $body = (Get-Command Read-BoundedHttpText).ScriptBlock.ToString();
        $needle = 'New-Object IO.StreamReader(';
        if (($body.Split(@($needle), [StringSplitOptions]::None)).Length -ne 2) { throw 'Bounded-reader instrumentation seam changed' }
        Set-Item Function:Read-BoundedHttpText ([scriptblock]::Create($body.Replace($needle, 'New-Object MetadataCountingReader(')));
        try { Read-BoundedHttpText $url | Out-Null; throw 'Unexpected success' }
        catch { @{message=$_.Exception.Message;consumed=[MetadataCountingReader]::Consumed}|ConvertTo-Json -Compress }
      } 'http://127.0.0.1:${server.address().port}/'`;
    const env = { ...process.env }; delete env.PSModulePath;
    const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8', env, windowsHide: true, timeout: 15000 });
    const result = JSON.parse(stdout.trim());
    assert.match(result.message, /Index response is too large/);
    assert.ok(result.consumed > 1048576 && result.consumed <= 1048576 + 4096,
      `reader consumed ${result.consumed} ASCII characters; server queued ${sent} bytes`);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('real update transaction preserves existing trees and current state across locks, cancellation and write failures', windows, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-update-transaction-'));
  try {
    // The engine is unchanged. Only download/extraction are replaced at its module boundary;
    // activation, locks, atomic file replacement, rollback and cleanup execute on the real filesystem.
    const mockModule = `${await readFile(payload, 'utf8')}
function Read-BoundedHttpText { return (@{versions=@(@{version='2.0.0';installerUrl='https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-2.0.0-win-x64.exe';sha512=[Convert]::ToBase64String((New-Object byte[] 64));size=1000000})}|ConvertTo-Json -Depth 5) }
$script:fixtureAttempts=0
function Get-OfficialInstaller([string]$Destination) {
  $script:fixtureAttempts++
  [IO.File]::WriteAllText((Join-Path $env:PURE_TEST_ROOT 'attempt-count.txt'),[string]$script:fixtureAttempts)
  if($env:PURE_FAILURE -eq 'download-write') { throw [IO.IOException]::new('Injected destination write refusal') }
  if($env:PURE_FAILURE -eq 'permanent-network') { throw [Net.WebException]::new('Installer digest mismatch',[Net.WebExceptionStatus]::ConnectFailure) }
  if($env:PURE_FAILURE -eq 'download-partial') {
    $partial=Join-Path $env:PURE_TEST_ROOT 'app/2.0.0.partial'; $null=New-Item -ItemType Directory -Path $partial;
    [IO.File]::WriteAllText((Join-Path $partial 'preserve.txt'),'unknown/interrupted content')
  }
  if($env:PURE_FAILURE -eq 'network-retry') {
    if($script:fixtureAttempts -eq 1) { throw [Net.WebException]::new('接続に失敗しました',[Net.WebExceptionStatus]::ConnectFailure) }
  }
  [IO.File]::WriteAllText($Destination,'fixture'); return $Destination
}
function Expand-OfficialPayload([string]$Installer,$Candidate,[string]$Output) {
  $null=New-Item -ItemType Directory -Path $Output -Force; [IO.File]::WriteAllText((Join-Path $Output 'DeepSeek Harness.exe'),'fixture');
  if($env:PURE_FAILURE -eq 'extract-write') { throw [IO.IOException]::new('Injected extraction write failure (disk full/denied)') }
  if($env:PURE_FAILURE -eq 'cancel') { [IO.File]::WriteAllText((Join-Path $env:PURE_TEST_ROOT 'cancel.request'),'cancel') }
  if($env:PURE_STATE_CHANGE -eq '1') { [IO.File]::WriteAllText((Join-Path $env:PURE_TEST_ROOT 'app/current.json'),'{"version":"1.1.0","pendingHealth":false}') }
  return @{version=$Candidate.version;payloadTreeSha256=(Get-PortablePayloadTreeHash $Output)}
}
function Remove-OwnedOlderPayloads { throw 'Injected old payload sharing failure' }
`;
    await writeFile(join(fixture, 'Payload.psm1'), '\ufeff' + mockModule);
    await writeFile(join(fixture, 'apply-update.ps1'), await readFile(engine));
    for (const scenario of ['cleanup', 'activation', 'state', 'stale-partial', 'stale-target', 'extract-write', 'cancel', 'commit-write', 'network-retry', 'download-write', 'permanent-network', 'download-partial']) {
      const target = join(fixture, scenario);
      const result = JSON.parse(ps(`
        $env:PURE_TEST_ROOT=${quote(target)}; $env:PURE_STATE_CHANGE=${quote(scenario === 'state' ? '1' : '0')}; $env:PURE_FAILURE=${quote(scenario)};
        $null=New-Item -ItemType Directory -Path ${quote(join(target, 'app/1.0.0'))},${quote(join(target, 'data/launcher'))},${quote(join(target, 'launcher'))} -Force;
        [IO.File]::WriteAllText(${quote(join(target, 'app/1.0.0/DeepSeek Harness.exe'))},'old');
        [IO.File]::WriteAllText(${quote(join(target, 'DeepSeek Harness Portable.exe'))},'launcher fixture');
        [IO.File]::WriteAllText(${quote(join(target, 'app/current.json'))},'{"version":"1.0.0","pendingHealth":false}');
        [IO.File]::WriteAllText(${quote(join(target, 'launcher/follow.json'))},'{"indexUrl":"https://example.invalid/index.json","feedUrl":"https://example.invalid/","cacheDirName":"test"}');
        $marker=$null;
        if(${['stale-partial', 'stale-target'].includes(scenario) ? '$true' : '$false'}) {
          $existing=${quote(join(target, scenario === 'stale-partial' ? 'app/2.0.0.partial' : 'app/2.0.0'))};
          $null=New-Item -ItemType Directory -Path $existing; $marker=Join-Path $existing 'preserve.txt';
          [IO.File]::WriteAllText($marker,'unknown/interrupted content');
        }
        if(${scenario === 'download-partial' ? '$true' : '$false'}) { $marker=${quote(join(target, 'app/2.0.0.partial/preserve.txt'))} }
        $held=$null;
        if(${scenario === 'activation' ? '$true' : '$false'}) { $held=[IO.File]::Open(${quote(join(target, 'data/launcher/activation.lock'))},'OpenOrCreate','ReadWrite','None') }
        if(${scenario === 'commit-write' ? '$true' : '$false'}) { $held=[IO.File]::Open(${quote(join(target, 'app/current.json'))},'Open','Read','Read') }
        $ErrorActionPreference='Continue';
        try { & ${quote(powershell)} -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy Bypass -File ${quote(join(fixture, 'apply-update.ps1'))} -Root ${quote(target)} -Version '2.0.0' -SelfPath ${quote(join(target, 'DeepSeek Harness Portable.exe'))} -Install -CancelFile ${quote(join(target, 'cancel.request'))} *> ${quote(join(target, 'engine.log'))}; $code=$LASTEXITCODE } finally { if($held){$held.Dispose()}; $ErrorActionPreference='Stop' }
        $attempts=if(Test-Path ${quote(join(target, 'attempt-count.txt'))}){[int][IO.File]::ReadAllText(${quote(join(target, 'attempt-count.txt'))})}else{1};
        @{exitCode=$code;attempts=$attempts;current=(Get-Content ${quote(join(target, 'app/current.json'))} -Raw|ConvertFrom-Json);status=(Get-Content ${quote(join(target, 'data/launcher/update-status.json'))} -Raw|ConvertFrom-Json);newExists=(Test-Path ${quote(join(target, 'app/2.0.0'))});partialExists=(Test-Path ${quote(join(target, 'app/2.0.0.partial'))});receiptExists=(Test-Path ${quote(join(target, 'launcher/receipts/2.0.0.json'))});markerPreserved=($marker -and (Test-Path -LiteralPath $marker) -and [IO.File]::ReadAllText($marker) -ceq 'unknown/interrupted content');old=[IO.File]::ReadAllText(${quote(join(target, 'app/1.0.0/DeepSeek Harness.exe'))})}|ConvertTo-Json -Depth 6 -Compress;
      `));
      assert.equal(result.old, 'old');
      assert.equal(result.attempts, scenario === 'network-retry' ? 2 : 1, 'only a transient network failure is retried');
      if (scenario === 'cleanup' || scenario === 'network-retry') {
        assert.equal(result.exitCode, 0, JSON.stringify(result));
        assert.equal(result.current.version, '2.0.0');
        assert.equal(result.status.status, 'applied');
        assert.deepEqual(result.status.cleanup.deferred, ['older-versions']);
      } else {
        assert.equal(result.exitCode, scenario === 'cancel' ? 0 : 1, JSON.stringify(result));
        assert.equal(result.current.version, scenario === 'state' ? '1.1.0' : '1.0.0');
        assert.equal(result.newExists, scenario === 'stale-target');
        assert.equal(result.partialExists, ['stale-partial', 'download-partial'].includes(scenario));
        assert.equal(result.receiptExists, false);
        if (scenario.startsWith('stale-') || scenario === 'download-partial') assert.equal(result.markerPreserved, true, 'an existing tree is not this attempt\'s scratch');
        if (scenario === 'cancel') assert.equal(result.status.status, 'cancelled');
      }
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});


test('temporary installer HTTP failures share the bounded retry budget while permanent failures stop immediately', windows, async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-http-retry-'));
  const bytes = Buffer.alloc(1000000, 0x5a);
  const digest = createHash('sha512').update(bytes).digest('base64');
  const requests = new Map();
  const server = createServer(async (request, response) => {
    const scenario = request.url.split('/').at(-1);
    const seen = requests.get(scenario) || [];
    seen.push(request.headers.range || ''); requests.set(scenario, seen);
    if (scenario === 'cancel') await writeFile(join(fixture, scenario, 'cancel.request'), 'cancel');
    const code = scenario === '401' || scenario === '404' ? Number(scenario)
      : scenario === 'exhausted' || scenario === 'cancel' ? 503
      : ['503', 'range'].includes(scenario) && seen.length === 1 ? 503
      : scenario === '429' && seen.length === 1 ? 429 : 200;
    if (code !== 200) { response.writeHead(code).end(); return; }
    const offset = scenario === 'range' ? 32768 : 0;
    response.writeHead(offset ? 206 : 200, {
      'Content-Length': bytes.length - offset,
      ...(offset ? { 'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}),
    });
    response.end(scenario === 'digest' ? Buffer.alloc(bytes.length, 0x79) : bytes.subarray(offset));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const scenario of ['503', '429', 'range', 'exhausted', '401', '404', 'digest', 'signature', 'version', 'cancel']) {
      await t.test(scenario, async () => {
        const directory = join(fixture, scenario); await mkdir(directory);
        const destination = join(directory, 'installer.exe');
        if (scenario === 'range') await writeFile(destination + '.part', bytes.subarray(0, 32768));
        const candidate = { version: scenario === 'version' ? 'invalid-version' : '2.0.0', size: bytes.length, sha512: digest,
          installerUrl: `http://127.0.0.1:${server.address().port}/dsh-desk/bin/win-x64/${scenario}` };
        const candidateFile = join(directory, 'candidate.json'); await writeFile(candidateFile, JSON.stringify(candidate));
        const script = `
          $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
          Import-Module ${quote(payload)} -Force -DisableNameChecking
          $tokens=$null; $errors=$null; $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(engine)},[ref]$tokens,[ref]$errors)
          foreach($name in @('Invoke-WithNetworkRetry','Write-Atomic')) {
            $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
            if($definition.Count -ne 1){throw 'Update retry function seam changed'}
            . ([scriptblock]::Create($definition[0].Extent.Text))
          }
          $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_INSTALLER='1'; $candidate=Get-Content -LiteralPath ${quote(candidateFile)} -Raw | ConvertFrom-Json
          $script:status=@{retry=0}; $statusPath=${quote(join(directory, 'status.json'))}; $CancelFile=${quote(join(directory, 'cancel.request'))}
          $ok=$false; $message=''; $watch=[Diagnostics.Stopwatch]::StartNew()
          try { Invoke-WithNetworkRetry { ${scenario === 'signature' ? 'Get-OfficialInstaller' : 'Receive-OfficialInstallerBytes'} ${quote(destination)} $candidate $null $CancelFile | Out-Null }; $ok=$true }
          catch { $message=$_.Exception.Message }
          @{ok=$ok;error=$message;elapsedMs=$watch.ElapsedMilliseconds;partialExists=(Test-Path -LiteralPath ${quote(destination + '.part')})}|ConvertTo-Json -Compress
        `;
        const env = { ...process.env }; delete env.PSModulePath;
        const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', env, windowsHide: true, timeout: 25000 });
        const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
        const observed = requests.get(scenario) || [];
        console.log('real installer retry:', JSON.stringify({ scenario, attempts: observed.length, ...result }));
        if (['503', '429', 'range'].includes(scenario)) {
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(observed.length, 2);
          assert.deepEqual(await readFile(destination + '.part'), bytes);
          if (scenario === 'range') assert.deepEqual(observed, ['bytes=32768-', 'bytes=32768-']);
        } else {
          assert.equal(result.ok, false);
          assert.equal(observed.length, scenario === 'version' ? 0 : scenario === 'exhausted' ? 4 : 1);
          assert.match(result.error, scenario === 'digest' ? /digest mismatch/ : scenario === 'signature' ? /signature validation failed/
            : scenario === 'version' ? /Unsupported official version/ : scenario === 'cancel' ? /cancelled/ : scenario === 'exhausted' ? /HTTP 503/ : /Unexpected installer response/);
          if (['digest', 'signature'].includes(scenario)) assert.equal(result.partialExists, false);
        }
      });
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.ok(fixture.startsWith(join(tmpdir(), 'pure-http-retry-')));
    try { ps(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(${quote(fixture)},[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`); }
    catch { t.diagnostic(`HTTP fixtures retained for recoverable cleanup: ${fixture}`); }
  }
});
