import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assessHealth } from '../experiments/official-payload/launcher/state.mjs';
import { windowsPowerShell } from './helpers/windows-powershell.mjs';

const repository = resolve(import.meta.dirname, '..');
const powershell = process.platform === 'win32' ? windowsPowerShell() : null;
const quote = value => `'${value.replaceAll("'", "''")}'`;
const ps = source => execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue';" + source, 'utf16le').toString('base64')], {
  encoding: 'utf8', windowsHide: true, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath')),
});

test('compiled pure launcher rejects redirected data before any creation and preserves external markers', { skip: process.platform !== 'win32' }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-pure-launcher-boundaries-'));
  const junctions = [];
  try {
    const launcher = join(scratch, 'launcher.exe');
    ps(`$ErrorActionPreference='Stop'; & ${quote(join(repository, 'experiments/official-payload/build-launcher.ps1'))} -Output ${quote(launcher)}`);
    const cases = [];
    for (const relative of ['data', 'data/electron', 'data/dsh-home', 'data/agents', 'data/cache', 'data/cache/native-addons']) {
      const root = join(scratch, `root-${cases.length}`), external = join(scratch, `outside-${cases.length}`);
      await mkdir(root, { recursive: true }); await mkdir(external);
      await writeFile(join(external, 'marker.txt'), 'external data must stay unchanged');
      const link = join(root, relative); await mkdir(resolve(link, '..'), { recursive: true });
      await symlink(external, link, 'junction'); junctions.push(link);
      cases.push({ root, external, relative });
    }
    const fileRoot = join(scratch, 'file-root'); await mkdir(join(fileRoot, 'data'), { recursive: true });
    await writeFile(join(fileRoot, 'data/cache'), 'occupied directory path');
    const normalRoot = join(scratch, 'normal 中文 root'); await mkdir(normalRoot);
    const input = join(scratch, 'cases.json'); await writeFile(input, JSON.stringify({ cases, fileRoot, normalRoot }));
    const output = ps(`
      $ErrorActionPreference='Stop'
      $assembly=[Reflection.Assembly]::LoadFile(${quote(launcher)})
      $type=$assembly.GetType('PortableLauncher'); $flags=[Reflection.BindingFlags]'NonPublic,Static'
      $fixtures=Get-Content -LiteralPath ${quote(input)} -Raw -Encoding UTF8 | ConvertFrom-Json
      function Set-Root([string]$root) {
        $type.GetField('Root',$flags).SetValue($null,$root)
        $type.GetField('DataRoot',$flags).SetValue($null,(Join-Path $root 'data'))
        $type.GetField('LauncherData',$flags).SetValue($null,(Join-Path $root 'data/launcher'))
      }
      $results=@()
      foreach($case in @($fixtures.cases)+@([pscustomobject]@{root=$fixtures.fileRoot;relative='file-obstruction'})) {
        Set-Root $case.root
        $kind=''; $message=''
        try { $type.GetMethod('StartOfficialProcess',$flags).Invoke($null,@([string](Join-Path $case.root 'not-an-application.exe'),$null,$null)) | Out-Null }
        catch { $failure=$_.Exception.GetBaseException(); $kind=$failure.GetType().FullName; $message=$failure.Message }
        $results+=@{relative=$case.relative;kind=$kind;message=$message}
      }
      Set-Root $fixtures.normalRoot
      try { $type.GetMethod('StartOfficialProcess',$flags).Invoke($null,@([string](Join-Path $fixtures.normalRoot 'not-an-application.exe'),$null,$null)) | Out-Null }
      catch { $normalError=$_.Exception.GetBaseException().GetType().FullName }
      @{cases=$results;normalError=$normalError} | ConvertTo-Json -Depth 5 -Compress
    `);
    const results = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    console.log('compiled launcher observed boundaries:', JSON.stringify(await Promise.all(cases.map(async item => ({ relative: item.relative,
      error: results.cases.find(row => row.relative === item.relative).kind, outsideFiles: await readdir(item.external) })))));
    for (const item of cases) {
      await t.test(item.relative, async () => {
        const result = results.cases.find(row => row.relative === item.relative);
        assert.equal(result.kind, 'System.IO.IOException', JSON.stringify(result));
        assert.deepEqual(await readdir(item.external), ['marker.txt'], `${item.relative} wrote through the junction`);
        assert.equal(await readFile(join(item.external, 'marker.txt'), 'utf8'), 'external data must stay unchanged');
      });
    }
    assert.equal(results.cases.find(row => row.relative === 'file-obstruction').kind, 'System.IO.IOException');
    assert.deepEqual((await readdir(join(fileRoot, 'data'))).sort(), ['cache'], 'a later obstruction must not partially initialize earlier directories');
    assert.equal(results.normalError, 'System.ComponentModel.Win32Exception', 'plain paths should reach Process.Start, which rejects the deliberately nonexistent executable');
    for (const relative of ['electron', 'dsh-home', 'cache/native-addons']) assert.ok((await readdir(join(normalRoot, 'data', relative))).length === 0);

    await t.test('a real child receives portable roots and cannot inherit the host agents directory', async () => {
      const external = join(scratch, 'inherited-home'); await mkdir(external);
      await writeFile(join(external, 'marker.txt'), 'inherited external marker');
      const source = join(scratch, 'Probe.cs'), executable = join(scratch, 'Probe.exe'), capture = join(scratch, 'child-roots.txt');
      await writeFile(source, `using System; using System.IO;
        class Probe { static int Main(string[] args) {
          string agents=Environment.GetEnvironmentVariable("DSH_AGENTS_HOME");
          bool outsideMarker=File.Exists(Path.Combine(agents,"marker.txt"));
          File.WriteAllText(Path.Combine(agents,"probe.txt"),outsideMarker?"outside marker read":"portable root only");
          File.WriteAllLines(Environment.GetEnvironmentVariable("DSH_BOUNDARY_PROBE"),new[]{Environment.GetEnvironmentVariable("DSH_HOME"),agents,Environment.GetEnvironmentVariable("NARB_NATIVE_CACHE_DIR"),args[0],outsideMarker.ToString()});
          return 0;
        } }`);
      ps(`$ErrorActionPreference='Stop'; & (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe') /nologo /target:exe ${quote('/out:' + executable)} ${quote(source)}; if($LASTEXITCODE -ne 0){throw 'Probe compilation failed'};
        $type=[Reflection.Assembly]::LoadFile(${quote(launcher)}).GetType('PortableLauncher');$flags=[Reflection.BindingFlags]'NonPublic,Static';
        $root=${quote(normalRoot)}; $type.GetField('Root',$flags).SetValue($null,$root); $type.GetField('DataRoot',$flags).SetValue($null,(Join-Path $root 'data')); $type.GetField('LauncherData',$flags).SetValue($null,(Join-Path $root 'data/launcher'));
        $env:DSH_HOME=${quote(external)};$env:DSH_AGENTS_HOME=${quote(external)};$env:NARB_NATIVE_CACHE_DIR=${quote(external)};$env:DSH_BOUNDARY_PROBE=${quote(capture)};
        $child=$type.GetMethod('StartOfficialProcess',$flags).Invoke($null,@(${quote(executable)},$null,$null)); if(-not $child.WaitForExit(10000)){throw 'Probe did not exit'}; if($child.ExitCode -ne 0){throw 'Probe failed'};$child.Dispose()`);
      const roots = (await readFile(capture, 'utf8')).trim().split(/\r?\n/);
      assert.deepEqual(roots.slice(0, 3), [join(normalRoot, 'data/dsh-home'), join(normalRoot, 'data/agents'), join(normalRoot, 'data/cache/native-addons')]);
      assert.equal(roots[3], `--user-data-dir=${join(normalRoot, 'data/electron')}`);
      assert.equal(roots[4], 'False');
      assert.equal(await readFile(join(normalRoot, 'data/agents/probe.txt'), 'utf8'), 'portable root only');
      assert.deepEqual(await readdir(external), ['marker.txt']);
      assert.equal(await readFile(join(external, 'marker.txt'), 'utf8'), 'inherited external marker');
    });

    await t.test('update pointer rejects an ancestor junction before creating a child', async () => {
      const cacheName = `dsh-boundary-${crypto.randomUUID()}`;
      const external = join(scratch, 'outside-pointer'); await mkdir(external);
      await writeFile(join(external, 'marker.txt'), 'pointer marker');
      const result = ps(`$ErrorActionPreference='Stop'; $type=[Reflection.Assembly]::LoadFile(${quote(launcher)}).GetType('PortableLauncher'); $flags=[Reflection.BindingFlags]'NonPublic,Static'; $type.GetField('Root',$flags).SetValue($null,${quote(normalRoot)});
        # Use the launcher's OS folder lookup, so an overridden LOCALAPPDATA cannot redirect this fixture.
        $link=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ${quote(cacheName)};
        $created=$false;
        try {
          $null=New-Item -ItemType Junction -Path $link -Target ${quote(external)} -ErrorAction Stop; $created=$true;
          try { $type.GetMethod('WritePortableRootPointer',$flags).Invoke($null,@(${quote(cacheName)})) | Out-Null; 'accepted' } catch { $_.Exception.GetBaseException().GetType().FullName }
        } finally { if($created) { [IO.Directory]::Delete($link) } }`);
      assert.equal(result.trim(), 'System.IO.IOException');
      assert.deepEqual(await readdir(external), ['marker.txt']);
    });

    await t.test('protocol metadata and value types restore on fresh and existing Windows profiles', async () => {
      const registryRoot = String.raw`Software\DSHPortableAcceptance\protocol-${crypto.randomUUID()}`;
      const source = await readFile(join(repository, 'experiments/official-payload/Launcher.cs'), 'utf8');
      const realRoot = String.raw`Software\Classes\dsh`;
      assert.equal(source.split(realRoot).length, 2, 'the fixture must replace the only real protocol root literal');
      const fixtureSource = join(scratch, 'ProtocolLauncher.cs'), fixtureExe = join(scratch, 'ProtocolLauncher.exe');
      await writeFile(fixtureSource, source.replaceAll(realRoot, registryRoot + String.raw`\dsh`));
      const output = ps(`
        $ErrorActionPreference='Stop'; $fixture=${quote(registryRoot)}; $root=$fixture+'\\dsh'
        if([Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($fixture)){throw 'Registry fixture already exists'}
        & (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe') /nologo /target:winexe /platform:x64 /optimize+ /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll ${quote('/out:' + fixtureExe)} ${quote(fixtureSource)}
        if($LASTEXITCODE -ne 0){throw 'Protocol fixture compilation failed'}
        $type=[Reflection.Assembly]::Load([IO.File]::ReadAllBytes(${quote(fixtureExe)})).GetType('PortableLauncher'); $flags=[Reflection.BindingFlags]'NonPublic,Static'
        function Write-Value([string]$path,[string]$name,$value,[Microsoft.Win32.RegistryValueKind]$kind) {
          $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($path); try{$key.SetValue($name,$value,$kind)}finally{$key.Dispose()}
        }
        function Read-Tree([string]$path,[string]$relative='') {
          $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path,$false); if($null -eq $key){return}
          try {
            $values=@(); foreach($name in @($key.GetValueNames()|Sort-Object)) {
              $values+=@{name=$name;kind=[string]$key.GetValueKind($name);value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
            }
            $rows=@(@{path=$relative;values=$values})
            foreach($name in @($key.GetSubKeyNames()|Sort-Object)){$rows+=@(Read-Tree ($path+'\\'+$name) ($relative+'\\'+$name))}
            return $rows
          } finally {$key.Dispose()}
        }
        $cases=@()
        try {
          foreach($kind in @('absent','existing','empty-ancestors')) {
            [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($root,$false)
            if($kind -eq 'existing') {
              Write-Value $root '' '%TEMP%\\prior-title' ExpandString
              Write-Value $root 'uRl PrOtOcOl' '%TEMP%\\prior-marker' ExpandString
              Write-Value $root 'unknown-binary' ([byte[]](1,2,3,4)) Binary
              Write-Value ($root+'\\unknown\\child') 'qword' ([long]1234567890123) QWord
              Write-Value ($root+'\\DefaultIcon') '' '%TEMP%\\prior.ico' ExpandString
              Write-Value ($root+'\\shell\\open\\command') '' '"%TEMP%\\prior.exe" "%1"' ExpandString
            } elseif($kind -eq 'empty-ancestors') {
              $empty=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($root+'\\shell\\open'); $empty.Dispose()
            }
            $before=@(Read-Tree $root)
            $snapshot=$type.GetMethod('CaptureProtocol',$flags).Invoke($null,@())
            $type.GetMethod('RegisterProtocol',$flags).Invoke($null,@())|Out-Null
            # These are exactly the three values written by Electron's Windows protocol registration.
            Write-Value $root '' 'URL:dsh' String; Write-Value $root 'URL Protocol' '' String
            Write-Value ($root+'\\shell\\open\\command') '' '"C:\\synthetic-official.exe" "%1"' String
            $type.GetMethod('RestoreProtocol',$flags).Invoke($null,@($snapshot))|Out-Null
            $cases+=@{kind=$kind;before=$before;after=@(Read-Tree $root)}
          }
        } finally {[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($fixture,$false)}
        @{cases=$cases;registryClean=($null -eq [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($fixture))}|ConvertTo-Json -Depth 10 -Compress
      `);
      const results = JSON.parse(output.trim().split(/\r?\n/).at(-1));
      assert.equal(results.registryClean, true);
      for (const item of results.cases) assert.deepEqual(item.after, item.before, `${item.kind} protocol tree was not restored`);
      console.log('isolated protocol restoration:', JSON.stringify(results.cases.map(item => ({ kind: item.kind, keys: item.after.length }))));
    });

    await t.test('activation lease and update exclusive lock are incompatible in both directions', async () => {
      const root = join(scratch, 'lease-root'); await mkdir(join(root, 'data/launcher'), { recursive: true });
      const output = ps(`
        $ErrorActionPreference='Stop'; $type=[Reflection.Assembly]::LoadFile(${quote(launcher)}).GetType('PortableLauncher'); $flags=[Reflection.BindingFlags]'NonPublic,Static'
        $directory=${quote(join(root, 'data/launcher'))}; $type.GetField('LauncherData',$flags).SetValue($null,$directory)
        $lockPath=Join-Path $directory 'activation.lock'; $method=$type.GetMethod('OpenActivationLock',$flags)
        $exclusive=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $launchBlocked=$false
        try { try { $lease=$method.Invoke($null,@()); if($lease){$lease.Dispose()} } catch { $launchBlocked=$_.Exception.GetBaseException() -is [IO.IOException] } } finally {$exclusive.Dispose()}
        $lease=$method.Invoke($null,@()); $updateBlocked=$false
        try {
          $childScript='try { $stream=[IO.File]::Open(''__LOCK__'',[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $stream.Dispose(); ''acquired'' } catch { if($_.Exception.GetBaseException() -is [IO.IOException]) { ''blocked'' } else { throw } }'
          $childScript=$childScript.Replace('__LOCK__',$lockPath.Replace("'","''"))
          $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
          $start=New-Object Diagnostics.ProcessStartInfo; $start.FileName=${quote(powershell)}; $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle='Hidden';$start.RedirectStandardOutput=$true
          $start.Arguments='-NoProfile -NonInteractive -OutputFormat Text -EncodedCommand '+$encoded
          $child=[Diagnostics.Process]::Start($start);$answer=$child.StandardOutput.ReadToEnd().Trim();$child.WaitForExit();$updateBlocked=$answer -ceq 'blocked';$child.Dispose()
        } finally {$lease.Dispose()}
        $released=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$released.Dispose()
        @{launchBlocked=$launchBlocked;updateBlocked=$updateBlocked;released=$true}|ConvertTo-Json -Compress
      `);
      assert.deepEqual(JSON.parse(output.trim()), { launchBlocked: true, updateBlocked: true, released: true });
    });
  } finally {
    for (const link of junctions.reverse()) await unlink(link);
    // These exact, newly-created test artifacts are recoverable; no recursive traversal of linked user paths.
    assert.ok(scratch.startsWith(join(tmpdir(), 'dsh-pure-launcher-boundaries-')));
    ps(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(${quote(scratch)},[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`);
  }
});

test('health rollback model clears the failed previous target and records its rejection', () => {
  const state = { version: '2.0.0', previous: '1.0.0', pendingHealth: true };
  const result = assessHealth(state, { exitCode: 7, at: '2026-10-22T00:00:00.000Z' });
  assert.equal(result.action, 'rollback');
  assert.equal(result.state.version, '1.0.0');
  assert.equal(result.state.previous, '');
  assert.equal(result.state.pendingHealth, false);
  assert.deepEqual(result.state.rejected, { version: '2.0.0', at: '2026-10-22T00:00:00.000Z' });
  assert.equal(assessHealth(result.state, { exitCode: 8 }).action, 'supervise');
});
