import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { windowsPowerShell } from './helpers/windows-powershell.mjs'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url)), '..')

test('launcher waits for the seed owner and accepts only completed or safely rolled-back batches', async () => {
  const launcher = await readFile(resolve(root, 'experiments/official-payload/Launcher.cs'), 'utf8')
  assert.match(launcher, /CheckExternalOfficialOrPort\(executable\);(?:\s*long conflictMs[^\n]*)?\s*RunSeedPluginsBeforeLaunch\(\);/)
  assert.match(launcher, /startup-trace ensureMs=/, 'each start logs where the launcher spent its time')
  assert.match(launcher, /File\.Exists\(manifest\) \|\| !File\.Exists\(profile\) \|\| !File\.Exists\(script\)/)
  const seed = launcher.replaceAll('\r\n', '\n').match(/private static void RunSeedPluginsBeforeLaunch\(\)[\s\S]*?\n    \}/)?.[0] ?? ''
  assert.match(seed, /child\.WaitForExit\(\)/)
  assert.doesNotMatch(seed, /WaitForExit\(\d+\)|child\.Kill\(/)
  assert.match(seed, /code != 0 && code != 1\) throw new IOException/)
  assert.match(seed, /catch \(Exception error\) \{ throw new IOException/)
  assert.match(launcher, /EnvironmentVariables\.Remove\("PSModulePath"\)/)
  assert.match(seed, /plugin seed failed safely; rollback completed/)
})

test('launcher confines the official native-addon cache to the portable data root', async () => {
  const launcher = await readFile(resolve(root, 'experiments/official-payload/Launcher.cs'), 'utf8')
  assert.match(launcher, /string nativeAddonCache = Path\.Combine\(DataRoot, "cache", "native-addons"\);/)
  assert.match(launcher, /EnvironmentVariables\["NARB_NATIVE_CACHE_DIR"\] = nativeAddonCache;/)
  assert.match(launcher, /Directory\.CreateDirectory\(nativeAddonCache\)/)
})

const execFileAsync = promisify(execFile)
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"

// Reuse the production launcher build and reflection seam from the existing
// official-pure-launcher-boundaries fixture; do not launch the official desktop.
test('compiled seed owner waits beyond 30 seconds and blocks unsafe exit codes', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-seed-launcher-owner-'))
  const powershell = windowsPowerShell()
  const invoke = async (source, timeout = 60000) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
    const result = await execFileAsync(powershell, [
      '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      Buffer.from("$ErrorActionPreference='Stop';" + source, 'utf16le').toString('base64'),
    ], { encoding: 'utf8', windowsHide: true, timeout, env })
    return result.stdout.trim()
  }
  try {
    const executable = join(scratch, 'SeedLauncher.exe')
    await invoke(`& ${literal(join(root, 'experiments/official-payload/build-launcher.ps1'))} -Output ${literal(executable)}`)
    const fixture = join(scratch, 'fixture')
    await mkdir(join(fixture, 'launcher', 'seed'), { recursive: true })
    await mkdir(join(fixture, 'data', 'dsh-home', 'profiles', 'desktop'), { recursive: true })
    await mkdir(join(fixture, 'data', 'launcher'), { recursive: true })
    await writeFile(join(fixture, 'launcher', 'seed', 'seed.json'), '{}')
    await writeFile(join(fixture, 'data', 'dsh-home', 'profiles', 'desktop', 'package.json'), '{}')
    await writeFile(join(fixture, 'launcher', 'seed-plugins.ps1'), [
      'param([string]$Root)',
      "$ErrorActionPreference='Stop'",
      "$control=Get-Content -LiteralPath (Join-Path $Root 'control.json') -Raw | ConvertFrom-Json",
      'foreach ($seconds in @($control.sleeps)) { Start-Sleep -Seconds ([int]$seconds) }',
      "[IO.File]::WriteAllText((Join-Path $Root 'completed.txt'),'batch completed')",
      'exit ([int]$control.code)',
      '',
    ].join('\r\n'))
    const output = await invoke(`
      $type=[Reflection.Assembly]::Load([IO.File]::ReadAllBytes(${literal(executable)})).GetType('PortableLauncher')
      $flags=[Reflection.BindingFlags]'NonPublic,Static'; $fixture=${literal(fixture)}
      $type.GetField('Root',$flags).SetValue($null,$fixture)
      $type.GetField('DataRoot',$flags).SetValue($null,(Join-Path $fixture 'data'))
      $type.GetField('LauncherData',$flags).SetValue($null,(Join-Path $fixture 'data/launcher'))
      $method=$type.GetMethod('RunSeedPluginsBeforeLaunch',$flags); $rows=@()
      foreach($case in @(@{name='slow-complete';code=0;sleeps=@(16,15)},@{name='safe-failure';code=1;sleeps=@(0)},@{name='unsafe';code=2;sleeps=@(0)},@{name='unexpected';code=7;sleeps=@(0)})) {
        $completed=Join-Path $fixture 'completed.txt'; if(Test-Path -LiteralPath $completed){[IO.File]::Delete($completed)}
        [IO.File]::WriteAllText((Join-Path $fixture 'control.json'),($case|ConvertTo-Json -Compress))
        $continued=$false; $kind=''; $message=''; $watch=[Diagnostics.Stopwatch]::StartNew()
        try { $method.Invoke($null,@())|Out-Null; $continued=$true }
        catch { $failure=$_.Exception; while($failure.InnerException -and $failure.GetType().Name -in @('MethodInvocationException','TargetInvocationException')){$failure=$failure.InnerException}; $kind=$failure.GetType().FullName; $message=$failure.Message }
        $watch.Stop()
        $rows+=@{name=$case.name;continued=$continued;kind=$kind;message=$message;elapsedMs=$watch.ElapsedMilliseconds;completed=(Test-Path -LiteralPath $completed)}
      }
      @{cases=$rows}|ConvertTo-Json -Depth 6 -Compress
    `, 60000)
    const result = JSON.parse(output.split(/\r?\n/).at(-1))
    for (const item of result.cases) {
      assert.equal(item.completed, true, JSON.stringify(item))
      assert.equal(item.continued, ['slow-complete', 'safe-failure'].includes(item.name), JSON.stringify(item))
      if (['unsafe', 'unexpected'].includes(item.name)) {
        assert.equal(item.kind, 'System.IO.IOException', JSON.stringify(item))
        assert.match(item.message, /needs recovery|需要恢复/)
      }
    }
    assert.ok(result.cases.find(item => item.name === 'slow-complete').elapsedMs >= 31000, 'the real batch must finish beyond the former outer deadline')
    console.log('compiled seed ownership:', JSON.stringify(result.cases))
  } finally {
    assert.ok(scratch.startsWith(join(tmpdir(), 'dsh-seed-launcher-owner-')))
    try {
      await invoke(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(${literal(scratch)},[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`)
    } catch { t.diagnostic(`Seed ownership fixture retained for recoverable cleanup: ${scratch}`) }
  }
})
