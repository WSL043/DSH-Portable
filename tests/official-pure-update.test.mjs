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
  $null=New-Item -ItemType Directory -Path (Join-Path $Output 'resources') -Force; [IO.File]::WriteAllText((Join-Path $Output 'DeepSeek Harness.exe'),'fixture'); [IO.File]::WriteAllText((Join-Path $Output 'resources/app.asar'),'fixture asar');
  if($env:PURE_FAILURE -eq 'extract-write') { throw [IO.IOException]::new('Injected extraction write failure (disk full/denied)') }
  if($env:PURE_FAILURE -eq 'cancel') { [IO.File]::WriteAllText((Join-Path $env:PURE_TEST_ROOT 'cancel.request'),'cancel') }
  if($env:PURE_STATE_CHANGE -eq '1') { [IO.File]::WriteAllText((Join-Path $env:PURE_TEST_ROOT 'app/current.json'),'{"version":"1.1.0","pendingHealth":false}') }
  return [pscustomobject]@{version=$Candidate.version;payloadTreeSha256=(Get-PortablePayloadTreeHash $Output)}
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
        assert.equal(result.newExists, ['stale-target', 'commit-write'].includes(scenario));
        assert.equal(result.partialExists, ['stale-partial', 'download-partial', 'activation', 'state'].includes(scenario));
        assert.equal(result.receiptExists, scenario === 'commit-write');
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


test('offline repair and retained rollback recover a failed atomic activation without touching user data', windows, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-recovery-entry-'));
  const installerBytes = Buffer.alloc(1000000, 0x37);
  const sha512 = createHash('sha512').update(installerBytes).digest('base64');
  try {
    const mock = (await readFile(payload, 'utf8')) + [
      '',
      "function Read-BoundedHttpText { throw 'Offline operation attempted network metadata' }",
      "function Get-OfficialInstaller { throw 'Offline operation attempted network download' }",
      "function Assert-Publisher { if ($env:PURE_SIGNATURE_FAIL -eq '1') { throw 'Official signature validation failed' } }",
      'function Expand-OfficialPayload([string]$Installer,$Candidate,[string]$Output) {',
      ' Assert-Installer $Installer $Candidate',
      " $null=New-Item -ItemType Directory -Path (Join-Path $Output 'resources') -Force",
      " [IO.File]::WriteAllText((Join-Path $Output 'DeepSeek Harness.exe'),'prepared executable')",
      " [IO.File]::WriteAllText((Join-Path $Output 'resources/app.asar'),'prepared asar')",
      ' return [pscustomobject]@{version=$Candidate.version;payloadTreeSha256=(Get-PortablePayloadTreeHash $Output)}',
      '}',
    ].join('\n');
    await writeFile(join(fixture, 'Payload.psm1'), '\ufeff' + mock);
    await writeFile(join(fixture, 'apply-update.ps1'), await readFile(engine));
    await writeFile(join(fixture, 'installer.exe'), installerBytes);
    await writeFile(join(fixture, 'index.json'), JSON.stringify({ schemaVersion: 1, versions: [{ version: '1.0.0', installerUrl: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-1.0.0-win-x64.exe', size: installerBytes.length, sha512, qualifiedAt: '2026-10-28T00:00:00.000Z' }] }));
    const result = JSON.parse(ps([
      '$root=' + quote(join(fixture, 'portable')) + '; Import-Module ' + quote(join(fixture, 'Payload.psm1')) + ' -Force -DisableNameChecking',
      "$null=New-Item -ItemType Directory -Path (Join-Path $root 'launcher/receipts'),(Join-Path $root 'data/launcher') -Force",
      "foreach($version in @('0.9.0','1.0.0')) {",
      " $tree=Join-Path $root ('app/'+$version); $null=New-Item -ItemType Directory -Path (Join-Path $tree 'resources') -Force",
      " [IO.File]::WriteAllText((Join-Path $tree 'DeepSeek Harness.exe'),'original executable')",
      " [IO.File]::WriteAllText((Join-Path $tree 'resources/app.asar'),'original asar')",
      " @{version=$version;payloadTreeSha256=(Get-PortablePayloadTreeHash $tree)}|ConvertTo-Json|Set-Content (Join-Path $root ('launcher/receipts/'+$version+'.json'))",
      '}',
      "[IO.File]::WriteAllText((Join-Path $root 'app/current.json'),'{\"version\":\"1.0.0\",\"previous\":\"0.9.0\",\"pendingHealth\":false}')",
      "[IO.File]::WriteAllText((Join-Path $root 'launcher/follow.json'),'{\"indexUrl\":\"https://example.invalid/index.json\",\"feedUrl\":\"https://example.invalid/\",\"cacheDirName\":\"fixture\"}')",
      "[IO.File]::WriteAllText((Join-Path $root 'DeepSeek Harness Portable.exe'),'fixture launcher')",
      "[IO.File]::WriteAllText((Join-Path $root 'data/draft.txt'),'user data stays')",
      "Remove-Item -LiteralPath (Join-Path $root 'app/1.0.0/DeepSeek Harness.exe')",
      "[IO.File]::WriteAllText((Join-Path $root 'app/1.0.0/unknown.txt'),'unknown user content')",
      "$call=@('-NoProfile','-NonInteractive','-OutputFormat','Text','-ExecutionPolicy','Bypass','-File'," + quote(join(fixture, 'apply-update.ps1')) + ",'-Root',$root,'-SelfPath',(Join-Path $root 'DeepSeek Harness Portable.exe'))",
      "$operation=@('-Repair','-InstallerFile'," + quote(join(fixture, 'installer.exe')) + ",'-IndexFile'," + quote(join(fixture, 'index.json')) + ')',
      '$identity=(Get-AcceptedInstallerCandidate (Read-LocalAcceptedIndex ' + quote(join(fixture, 'index.json')) + ') ' + quote(join(fixture, 'installer.exe')) + ').version',
      "$env:PURE_SIGNATURE_FAIL='1'; $ErrorActionPreference='Continue'; & " + quote(powershell) + " @call @operation *> (Join-Path $root 'signature.log'); $signatureCode=$LASTEXITCODE; $ErrorActionPreference='Stop'; $env:PURE_SIGNATURE_FAIL='0'",
      "$signature=Get-Content (Join-Path $root 'data/launcher/update-status.json') -Raw|ConvertFrom-Json",
      "$held=[IO.File]::Open((Join-Path $root 'app/current.json'),'Open','Read','Read')",
      "$ErrorActionPreference='Continue'",
      'try { & ' + quote(powershell) + " @call @operation *> (Join-Path $root 'repair.log'); $firstCode=$LASTEXITCODE } finally { $held.Dispose(); $ErrorActionPreference='Stop' }",
      "$first=Get-Content (Join-Path $root 'data/launcher/update-status.json') -Raw|ConvertFrom-Json",
      "$ErrorActionPreference='Continue'; & " + quote(powershell) + " @call -Recover *> (Join-Path $root 'recover.log'); $recoverCode=$LASTEXITCODE; $ErrorActionPreference='Stop'",
      "$recovered=Get-Content (Join-Path $root 'data/launcher/update-status.json') -Raw|ConvertFrom-Json",
      "$ErrorActionPreference='Continue'; & " + quote(powershell) + " @call @operation *> (Join-Path $root 'repeat.log'); $repeatCode=$LASTEXITCODE; $ErrorActionPreference='Stop'",
      "$repeat=Get-Content (Join-Path $root 'data/launcher/update-status.json') -Raw|ConvertFrom-Json",
      "[IO.File]::WriteAllText((Join-Path $root 'app/0.9.0/resources/app.asar'),'corrupted previous')",
      "$ErrorActionPreference='Continue'; & " + quote(powershell) + " @call -Rollback *> (Join-Path $root 'corrupt-rollback.log'); $corruptRollbackCode=$LASTEXITCODE; $ErrorActionPreference='Stop'",
      "$corruptRollback=Get-Content (Join-Path $root 'data/launcher/update-status.json') -Raw|ConvertFrom-Json",
      "[IO.File]::WriteAllText((Join-Path $root 'app/0.9.0/resources/app.asar'),'original asar')",
      "$ErrorActionPreference='Continue'; & " + quote(powershell) + " @call -Rollback *> (Join-Path $root 'rollback.log'); $rollbackCode=$LASTEXITCODE; $ErrorActionPreference='Stop'",
      "$current=Get-Content (Join-Path $root 'app/current.json') -Raw|ConvertFrom-Json",
      "@{identity=$identity;signatureCode=$signatureCode;signature=$signature;corruptRollbackCode=$corruptRollbackCode;corruptRollback=$corruptRollback;firstCode=$firstCode;first=$first;recoverCode=$recoverCode;recovered=$recovered;repeatCode=$repeatCode;repeat=$repeat;rollbackCode=$rollbackCode;current=$current;backup=[IO.File]::ReadAllText((Join-Path $root 'app/1.0.0.repair-backup/unknown.txt'));draft=[IO.File]::ReadAllText((Join-Path $root 'data/draft.txt'))}|ConvertTo-Json -Depth 12 -Compress",
    ].join('\n')));
    assert.equal(result.identity, '1.0.0');
    assert.equal(result.signatureCode, 1);
    assert.match(result.signature.error, /signature/);
    assert.equal(result.corruptRollbackCode, 1);
    assert.match(result.corruptRollback.error, /receipt/);
    assert.equal(result.firstCode, 1, JSON.stringify(result));
    assert.equal(result.first.transition.phase, 'prepared');
    assert.equal(result.recoverCode, 0, JSON.stringify(result));
    assert.equal(result.recovered.status, 'applied');
    assert.equal(result.recovered.transition, null);
    assert.equal(result.repeatCode, 1);
    assert.match(result.repeat.error, /preservation slot/);
    assert.equal(result.backup, 'unknown user content');
    assert.equal(result.rollbackCode, 0, JSON.stringify(result));
    assert.equal(result.current.version, '0.9.0');
    assert.equal(result.current.previous, '');
    assert.equal(result.current.pendingHealth, false);
    assert.equal(result.draft, 'user data stays');
    assert.deepEqual(await readFile(join(fixture, 'installer.exe')), installerBytes);
  } finally {
    assert.ok(fixture.startsWith(join(tmpdir(), 'pure-recovery-entry-')));
    ps('Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(' + quote(fixture) + ',[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)');
  }
});


test('repair interruption boundaries and untrusted recovery inputs preserve programs and scratch ownership', windows, async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-recovery-faults-'));
  const bytes = Buffer.alloc(1000000, 0x41);
  const digest = createHash('sha512').update(bytes).digest('base64');
  const originalEngine = await readFile(engine, 'utf8');
  try {
    const fixtureModule = (await readFile(payload, 'utf8')) + [
      '',
      "function Read-BoundedHttpText { throw 'UNEXPECTED_NETWORK_METADATA' }",
      "function Get-OfficialInstaller { throw 'UNEXPECTED_NETWORK_INSTALLER' }",
      'function Assert-Publisher { }',
      'function Expand-OfficialPayload([string]$Installer,$Candidate,[string]$Output) {',
      ' Assert-Installer $Installer $Candidate',
      " $null=New-Item -ItemType Directory -Path (Join-Path $Output 'resources') -Force",
      " [IO.File]::WriteAllText((Join-Path $Output 'DeepSeek Harness.exe'),'new executable')",
      " [IO.File]::WriteAllText((Join-Path $Output 'resources/app.asar'),'new asar')",
      ' return [pscustomobject]@{version=$Candidate.version;payloadTreeSha256=(Get-PortablePayloadTreeHash $Output)}',
      '}',
    ].join('\n');
    for (const scenario of ['offline-versionless', 'killed-after-preservation', 'killed-after-current', 'outside-transition', 'invalid-receipt', 'unknown-partial', 'occupied-backup', 'broken-index', 'broken-installer']) {
      await t.test(scenario, async () => {
        const directory = join(fixture, scenario);
        await mkdir(directory);
        await writeFile(join(directory, 'Payload.psm1'), '\ufeff' + fixtureModule);
        let interrupted = originalEngine;
        const boundary = scenario === 'killed-after-preservation' ? '[IO.Directory]::Move($target, $backup)' : scenario === 'killed-after-current' ? 'Write-Atomic $currentPath $Transition.next' : null;
        if (boundary) {
          assert.equal(interrupted.split(boundary).length, 2, 'the interruption must target one real transaction boundary');
          interrupted = interrupted.replace(boundary, boundary + '\n                    [Diagnostics.Process]::GetCurrentProcess().Kill()');
        }
        await writeFile(join(directory, 'apply-update.ps1'), interrupted);
        await writeFile(join(directory, 'uninterrupted.ps1'), originalEngine);
        await writeFile(join(directory, 'installer.exe'), scenario === 'broken-installer' ? Buffer.alloc(bytes.length, 0x42) : bytes);
        await writeFile(join(directory, 'index.json'), scenario === 'broken-index' ? '{broken' : JSON.stringify({ schemaVersion: 1, versions: [{ version: '1.0.0', installerUrl: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-1.0.0-win-x64.exe', size: bytes.length, sha512: digest, qualifiedAt: '2026-10-28T00:00:00.000Z' }] }));
        const result = JSON.parse(ps([
          '$root=' + quote(join(directory, 'portable')) + '; Import-Module ' + quote(join(directory, 'Payload.psm1')) + ' -Force -DisableNameChecking',
          "$tree=Join-Path $root 'app/1.0.0'; $null=New-Item -ItemType Directory -Path (Join-Path $tree 'resources'),(Join-Path $root 'launcher/receipts'),(Join-Path $root 'data/launcher') -Force",
          "[IO.File]::WriteAllText((Join-Path $tree 'resources/app.asar'),'old asar')",
          "[IO.File]::WriteAllText((Join-Path $tree 'unknown.txt'),'preserve damaged-tree content')",
          "[IO.File]::WriteAllText((Join-Path $root 'app/current.json'),'{\"version\":\"1.0.0\",\"previous\":\"\",\"pendingHealth\":false}')",
          "[IO.File]::WriteAllText((Join-Path $root 'launcher/follow.json'),'{\"indexUrl\":\"https://example.invalid/index.json\",\"feedUrl\":\"https://example.invalid/\",\"cacheDirName\":\"fixture\"}')",
          "[IO.File]::WriteAllText((Join-Path $root 'DeepSeek Harness Portable.exe'),'fixture launcher')",
          "[IO.File]::WriteAllText((Join-Path $root 'data/draft.txt'),'draft survives')",
          "if(" + quote(scenario) + " -eq 'offline-versionless') { $old=Join-Path $root 'app/0.9.0';[IO.Directory]::Move($tree,$old);$tree=$old;[IO.File]::WriteAllText((Join-Path $tree 'DeepSeek Harness.exe'),'old executable');[IO.File]::WriteAllText((Join-Path $root 'app/current.json'),'{\"version\":\"0.9.0\",\"previous\":\"\",\"pendingHealth\":false}') }",
          "$before=Get-PortablePayloadTreeHash $tree; $beforeCurrent=(Get-FileHash (Join-Path $root 'app/current.json') -Algorithm SHA256).Hash",
          '$scenario=' + quote(scenario),
          "$marker=$null; if($scenario -eq 'unknown-partial' -or $scenario -eq 'invalid-receipt') { $scratch=Join-Path $root 'app/1.0.0.partial';$null=New-Item -ItemType Directory -Path $scratch;$marker=Join-Path $scratch 'unknown.txt';[IO.File]::WriteAllText($marker,'unknown scratch survives') }",
          "if($scenario -eq 'occupied-backup') { $scratch=Join-Path $root 'app/0.9.0.repair-backup';$null=New-Item -ItemType Directory -Path $scratch;$marker=Join-Path $scratch 'unknown.txt';[IO.File]::WriteAllText($marker,'unknown scratch survives') }",
          "$outside=Join-Path $root 'outside';$null=New-Item -ItemType Directory -Path $outside;[IO.File]::WriteAllText((Join-Path $outside 'marker.txt'),'outside survives')",
          "if($scenario -eq 'outside-transition') { @{transition=@{schemaVersion=1;operation='repair';phase='extracting';version='../outside';currentSha256=$beforeCurrent}}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'data/launcher/update-status.json') }",
          "if($scenario -eq 'invalid-receipt') { @{transition=@{schemaVersion=1;operation='repair';phase='prepared';version='1.0.0';currentSha256=$beforeCurrent;next=@{version='1.0.0'};receipt=@{version='1.0.0';payloadTreeSha256='wrong'}}}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'data/launcher/update-status.json') }",
          "$call=@('-NoProfile','-NonInteractive','-OutputFormat','Text','-ExecutionPolicy','Bypass','-File'," + quote(join(directory, 'apply-update.ps1')) + ",'-Root',$root,'-SelfPath',(Join-Path $root 'DeepSeek Harness Portable.exe'))",
          "[string[]]$operation=if($scenario -eq 'outside-transition' -or $scenario -eq 'invalid-receipt'){@('-Recover')}elseif($scenario -eq 'offline-versionless'){@('-InstallerFile'," + quote(join(directory, 'installer.exe')) + ",'-IndexFile'," + quote(join(directory, 'index.json')) + ")}else{@('-Repair','-InstallerFile'," + quote(join(directory, 'installer.exe')) + ",'-IndexFile'," + quote(join(directory, 'index.json')) + ')}',
          "$ErrorActionPreference='Continue'; & " + quote(powershell) + " @call @operation *> (Join-Path $root 'attempt.log');$code=$LASTEXITCODE;$ErrorActionPreference='Stop'",
          "$first=Get-Content (Join-Path $root 'data/launcher/update-status.json') -Raw|ConvertFrom-Json;$recordPending=($null -ne $first.transition)",
          "$recoverCode=$null;$preservedHash=$null;if($scenario.StartsWith('killed-')){",
          " $preservedHash=Get-PortablePayloadTreeHash (Join-Path $root 'app/1.0.0.repair-backup')",
          " $call[7]=" + quote(join(directory, 'uninterrupted.ps1')),
          "$ErrorActionPreference='Continue'; & " + quote(powershell) + " @call -Recover *> (Join-Path $root 'recover.log');$recoverCode=$LASTEXITCODE;$ErrorActionPreference='Stop'",
          '}',
          "$final=Get-Content (Join-Path $root 'data/launcher/update-status.json') -Raw|ConvertFrom-Json",
          "$afterHash=if(Test-Path $tree){Get-PortablePayloadTreeHash $tree}else{$null};$backupHash=if(Test-Path (Join-Path $root 'app/1.0.0.repair-backup')){Get-PortablePayloadTreeHash (Join-Path $root 'app/1.0.0.repair-backup')}else{$null}",
          "@{code=$code;first=$first;recordPending=$recordPending;recoverCode=$recoverCode;final=$final;before=$before;after=$afterHash;preservedHash=$preservedHash;backupHash=$backupHash;currentUnchanged=((Get-FileHash (Join-Path $root 'app/current.json') -Algorithm SHA256).Hash -ceq $beforeCurrent);pendingHealth=(Get-Content (Join-Path $root 'app/current.json') -Raw|ConvertFrom-Json).pendingHealth;marker=if($marker){[IO.File]::ReadAllText($marker)}else{$null};outside=[IO.File]::ReadAllText((Join-Path $outside 'marker.txt'));draft=[IO.File]::ReadAllText((Join-Path $root 'data/draft.txt'))}|ConvertTo-Json -Depth 12 -Compress",
        ].join('\n')));
        if (scenario !== 'offline-versionless') assert.notEqual(result.code, 0, JSON.stringify(result));
        assert.equal(result.outside, 'outside survives');
        assert.equal(result.draft, 'draft survives');
        if (scenario === 'offline-versionless') {
          assert.equal(result.code, 0, JSON.stringify(result));
          assert.equal(result.final.status, 'applied');
          assert.equal(result.final.version, '1.0.0');
          assert.equal(result.pendingHealth, true);
          assert.equal(result.after, result.before, 'the previous program remains intact');
        } else if (scenario.startsWith('killed-')) {
          assert.equal(result.recordPending, true);
          assert.equal(result.first.transition.phase, 'prepared');
          assert.equal(result.recoverCode, 0, JSON.stringify(result));
          assert.equal(result.final.status, 'applied');
          assert.equal(result.final.transition, null);
          assert.equal(result.pendingHealth, true);
          assert.equal(result.preservedHash, result.before);
          assert.equal(result.backupHash, result.before, 're-entry preserves the exact isolated damaged tree');
        } else {
          assert.equal(result.currentUnchanged, true);
          assert.equal(result.after, result.before);
          if (['unknown-partial', 'invalid-receipt', 'occupied-backup'].includes(scenario)) assert.equal(result.marker, 'unknown scratch survives');
          if (['outside-transition', 'invalid-receipt'].includes(scenario)) assert.equal(result.recordPending, true);
          assert.doesNotMatch(result.first.error, /UNEXPECTED_NETWORK/);
          if (scenario === 'broken-installer') assert.match(result.first.error, /digest mismatch/);
          if (scenario === 'occupied-backup') assert.match(result.first.error, /preservation slot/);
        }
      });
    }
  } finally {
    assert.ok(fixture.startsWith(join(tmpdir(), 'pure-recovery-faults-')));
    ps('Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(' + quote(fixture) + ',[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)');
  }
});


test('extraction recovery preserves unlocked scratch while this root extractor is alive', windows, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-extraction-writer-'));
  const writerSource = join(fixture, 'ExtractorWriter.cs');
  try {
    await writeFile(join(fixture, 'apply-update.ps1'), await readFile(engine));
    await writeFile(join(fixture, 'Payload.psm1'), await readFile(payload));
    await writeFile(writerSource, [
      'using System; using System.IO; using System.Threading; using System.Diagnostics;',
      'class ExtractorWriter { static int Main(string[] args) {',
      ' File.WriteAllText(args[0], "writer marker; handle closed");',
      ' File.WriteAllText(args[1], Process.GetCurrentProcess().Id.ToString());',
      ' while (!File.Exists(args[2])) Thread.Sleep(25);',
      ' try { File.AppendAllText(args[0], " released"); return 0; } catch (IOException) { return 42; }',
      '} }',
    ].join('\n'));
    const observed = JSON.parse(ps([
      '$root=' + quote(join(fixture, 'portable')) + ';$writer=$null',
      "$null=New-Item -ItemType Directory -Path (Join-Path $root 'launcher'),(Join-Path $root 'data/launcher'),(Join-Path $root 'app/1.0.0/resources') -Force",
      "$current=Join-Path $root 'app/current.json'; [IO.File]::WriteAllText($current,'{\"version\":\"1.0.0\",\"pendingHealth\":false}')",
      "$beforeCurrent=(Get-FileHash -LiteralPath $current -Algorithm SHA256).Hash",
      "$scratch=Join-Path $root 'app/2.0.0.partial'; foreach($tree in @($scratch,($scratch+'.outer'),($scratch+'.verify'))){$null=New-Item -ItemType Directory -Path $tree;[IO.File]::WriteAllText((Join-Path $tree 'marker.txt'),'owned scratch survives')}",
      "$status=Join-Path $root 'data/launcher/update-status.json';@{status='extracting';transition=@{schemaVersion=1;operation='update';phase='extracting';version='2.0.0';currentSha256=$beforeCurrent}}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $status -Encoding UTF8",
      "$writerPath=Join-Path $root 'launcher/7z.exe';$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'",
      '& $compiler /nologo /target:winexe /platform:x64 /optimize+ ' + quote('/out:' + join(fixture, 'portable/launcher/7z.exe')) + ' ' + quote(writerSource),
      "if($LASTEXITCODE -ne 0){throw 'Extraction writer fixture compilation failed'}",
      "$ready=Join-Path $root 'data/launcher/writer-ready.txt';$release=Join-Path $root 'data/launcher/writer-release.txt';$target=Join-Path $scratch 'writer.txt'",
      "$start=[Diagnostics.ProcessStartInfo]::new($writerPath);$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle='Hidden';$start.Arguments='\"'+$target+'\" \"'+$ready+'\" \"'+$release+'\"'",
      'try {',
      ' $writer=[Diagnostics.Process]::Start($start)',
      ' $deadline=[DateTime]::UtcNow.AddSeconds(10);while(-not(Test-Path -LiteralPath $ready)){if($writer.HasExited -or [DateTime]::UtcNow -gt $deadline){throw \'Extraction writer did not become ready\'};Start-Sleep -Milliseconds 25}',
      " $identity=Get-CimInstance Win32_Process -Filter ('ProcessId='+$writer.Id) -ErrorAction Stop",
      " if(-not $identity.ExecutablePath -or -not [IO.Path]::GetFullPath($identity.ExecutablePath).Equals([IO.Path]::GetFullPath($writerPath),[StringComparison]::OrdinalIgnoreCase) -or [int][IO.File]::ReadAllText($ready) -ne $writer.Id){throw 'Extraction writer identity mismatch'}",
      " $probe=[IO.File]::Open($target,'Open','ReadWrite','None');$probe.Dispose() # prove no writer handle protects the file",
      " $ErrorActionPreference='Continue'; & " + quote(powershell) + ' -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy Bypass -File ' + quote(join(fixture, 'apply-update.ps1')) + " -Root $root -SelfPath (Join-Path $root 'DeepSeek Harness Portable.exe') -Recover *> (Join-Path $root 'recover-live.log');$firstCode=$LASTEXITCODE;$ErrorActionPreference='Stop'",
      ' $first=Get-Content -LiteralPath $status -Raw -Encoding UTF8|ConvertFrom-Json',
      " $markers=@(@($scratch,($scratch+'.outer'),($scratch+'.verify'))|ForEach-Object{Test-Path -LiteralPath (Join-Path $_ 'marker.txt')})",
      " $writerMarkerPresent=Test-Path -LiteralPath $target;$alive=-not $writer.HasExited;$currentUnchanged=(Get-FileHash -LiteralPath $current -Algorithm SHA256).Hash -ceq $beforeCurrent",
      " [IO.File]::WriteAllText($release,'release only this fixture writer')",
      " if(-not $writer.WaitForExit(10000)){throw 'Controlled extraction writer did not stop after release'};$writerCode=$writer.ExitCode",
      " $ErrorActionPreference='Continue'; & " + quote(powershell) + ' -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy Bypass -File ' + quote(join(fixture, 'apply-update.ps1')) + " -Root $root -SelfPath (Join-Path $root 'DeepSeek Harness Portable.exe') -Recover *> (Join-Path $root 'recover-exited.log');$secondCode=$LASTEXITCODE;$ErrorActionPreference='Stop'",
      ' $final=Get-Content -LiteralPath $status -Raw -Encoding UTF8|ConvertFrom-Json',
      " @{firstCode=$firstCode;first=$first;markers=@($markers);writerMarkerPresent=$writerMarkerPresent;alive=$alive;writerPid=$writer.Id;writerPath=$identity.ExecutablePath;writerCode=$writerCode;currentUnchanged=$currentUnchanged;secondCode=$secondCode;final=$final;remaining=@(@($scratch,($scratch+'.outer'),($scratch+'.verify'))|Where-Object{Test-Path -LiteralPath $_})}|ConvertTo-Json -Depth 10 -Compress",
      '} finally {',
      ' if($writer){try{if(-not $writer.HasExited){',
      "  $owned=Get-CimInstance Win32_Process -Filter ('ProcessId='+$writer.Id) -ErrorAction Stop",
      "  if(-not $owned.ExecutablePath -or -not [IO.Path]::GetFullPath($owned.ExecutablePath).Equals([IO.Path]::GetFullPath($writerPath),[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing to stop an unverified fixture writer'}",
      "  $writer.Kill();if(-not $writer.WaitForExit(10000)){throw 'Verified fixture writer did not stop'}",
      ' }}finally{$writer.Dispose()}}',
      '}',
    ].join('\n')));
    console.log('exact-root extraction writer:', JSON.stringify(observed));
    assert.equal(observed.firstCode, 1, JSON.stringify(observed));
    assert.match(observed.first.error, /extraction writer is still running/);
    assert.equal(observed.first.transition.phase, 'extracting');
    assert.equal(observed.alive, true);
    assert.equal(observed.writerMarkerPresent, true);
    assert.deepEqual(observed.markers, [true, true, true]);
    assert.equal(observed.currentUnchanged, true);
    assert.equal(observed.writerCode, 0, 'the unlocked writer can safely continue after the refused cleanup');
    assert.equal(observed.secondCode, 0, JSON.stringify(observed));
    assert.equal(observed.final.status, 'recovered');
    assert.equal(observed.final.transition, null);
    assert.deepEqual(observed.remaining, []);
  } finally {
    assert.ok(fixture.startsWith(join(tmpdir(), 'pure-extraction-writer-')));
    ps('Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(' + quote(fixture) + ',[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)');
  }
});


test('private file digest matches Get-FileHash for literal relative empty, small and large inputs', windows, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pure-digest-oracle-'));
  try {
    await writeFile(join(fixture, 'empty [].bin'), Buffer.alloc(0));
    await writeFile(join(fixture, 'small [literal].bin'), Buffer.alloc(4097, 0x3d));
    await writeFile(join(fixture, 'large [literal].bin'), Buffer.alloc(1048576 + 17, 0xa7));
    const result = JSON.parse(ps([
      '$module=Import-Module ' + quote(payload) + ' -Force -DisableNameChecking -PassThru',
      '$oldLocation=Get-Location;$oldCurrent=[Environment]::CurrentDirectory',
      'try {',
      ' Set-Location -LiteralPath ' + quote(fixture),
      ' [Environment]::CurrentDirectory=[IO.Path]::GetPathRoot(' + quote(fixture) + ')',
      ' $differentDotNetDirectory=([Environment]::CurrentDirectory -cne (Get-Location).Path)',
      ' $rows=& $module {',
      "  foreach($file in @('./empty [].bin','./small [literal].bin','./large [literal].bin')){",
      "   foreach($algorithm in @('SHA256','SHA512')){",
      '    $expected=(Get-FileHash -LiteralPath $file -Algorithm $algorithm -ErrorAction Stop).Hash',
      '    $actual=Get-PortableFileDigest $file $algorithm',
      '    [pscustomobject]@{file=$file;algorithm=$algorithm;expected=$expected;actual=$actual}',
      '   }',
      '  }',
      ' }',
      ' @{differentDotNetDirectory=$differentDotNetDirectory;rows=@($rows)}|ConvertTo-Json -Depth 5 -Compress',
      '} finally { Set-Location -LiteralPath $oldLocation.Path; [Environment]::CurrentDirectory=$oldCurrent }',
    ].join('\n')));
    assert.equal(result.differentDotNetDirectory, true, 'relative paths must resolve through the PowerShell location');
    assert.equal(result.rows.length, 6);
    for (const row of result.rows) assert.equal(row.actual, row.expected, row.file + '/' + row.algorithm);
  } finally {
    assert.ok(fixture.startsWith(join(tmpdir(), 'pure-digest-oracle-')));
    ps('Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(' + quote(fixture) + ',[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)');
  }
});
