$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows runner required' }
$evidence = Join-Path $env:GITHUB_WORKSPACE 'build/official-payload-evidence'
$root = Join-Path $env:RUNNER_TEMP 'portable-official-alpha2'
New-Item -ItemType Directory -Path $evidence,$root -Force | Out-Null
$installer = Join-Path $root 'official.exe'
Import-Module "$PSScriptRoot/Payload.psm1" -Force
$candidate = Get-Content "$PSScriptRoot/candidate.json" -Raw | ConvertFrom-Json
Get-OfficialInstaller $installer $candidate
$signature = Get-AuthenticodeSignature $installer
if ($signature.Status -ne 'Valid') { throw 'Invalid official installer signature' }
$signature | Select-Object Status,@{n='subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json | Set-Content "$evidence/signature.json"
$outer = Join-Path $root 'outer'
$app = Join-Path $root 'app'
$receipt = Expand-OfficialPayload $installer $candidate $app (Get-Command 7z).Source
$exe = Join-Path $app 'DeepSeek Harness.exe'
if ((Get-AuthenticodeSignature $exe).Status -ne 'Valid') { throw 'Invalid payload signature' }
& "$PSScriptRoot/trace-writes.ps1" -Mode Start -Evidence $evidence -PortableRoot $root
$env:DSH_PORTABLE_DEVELOPMENT_ROOT = $root
$env:DSH_HOME = Join-Path $root 'data/dsh-home'
$env:DSH_AGENTS_HOME = Join-Path $root 'data/agents'
$env:pnpm_config_store_dir = Join-Path $root 'data/pnpm-store'
$env:pnpm_config_cache_dir = Join-Path $root 'data/pnpm-cache'
$env:pnpm_config_state_dir = Join-Path $root 'data/pnpm-state'
$env:NARB_NATIVE_CACHE_DIR = Join-Path $root 'data/native-cache'
$env:NODE_COMPILE_CACHE = Join-Path $root 'data/node-compile-cache'
$userData = Join-Path $root 'data/electron'
$watch = @("$env:APPDATA/@deepseek-ai", "$env:USERPROFILE/.dsh", "$env:LOCALAPPDATA/pnpm", "$env:LOCALAPPDATA/@deepseek-aidsh-desktop-updater", "$env:LOCALAPPDATA/node-addon-native-custom-loader")
$before = @($watch | Where-Object { Test-Path -LiteralPath $_ })
$harness = Join-Path $env:GITHUB_WORKSPACE 'experiments/official-desktop/launch-hidden-windows.ps1'
$job = Start-Job -ScriptBlock { param($h,$x,$a) & $h -Exe $x -Arguments $a -Milliseconds 180000 -CleanRunnerNativeDirectories } -ArgumentList $harness,$exe,"--user-data-dir=`"$userData`" --remote-debugging-port=19489"
try {
  node experiments/official-payload/probe.mjs 19489 "$evidence/page.json" "$env:GITHUB_WORKSPACE/experiments/official-desktop/fixtures/lifecycle"
  $probeExit = $LASTEXITCODE
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app) } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 4 | Set-Content "$evidence/processes.json"
} finally {
  $job | Wait-Job | Receive-Job | Out-File "$evidence/hidden-process.log"
  $job | Remove-Job
  & "$PSScriptRoot/trace-writes.ps1" -Mode Stop -Evidence $evidence -PortableRoot $root
  $leaks = @($watch | Where-Object { (Test-Path -LiteralPath $_) -and $_ -notin $before })
  @{ leaks=$leaks; userDataPresent=(Test-Path $userData); dshHomePresent=(Test-Path $env:DSH_HOME); originalSystemDirectories=$true } | ConvertTo-Json | Set-Content "$evidence/paths.json"
  Get-ChildItem "$root/data" -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName,Length | ConvertTo-Json | Set-Content "$evidence/data-inventory.json"
  Get-ChildItem "$root/data" -Recurse -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $evidence ($_.Name + '-' + [guid]::NewGuid().ToString('N') + '.txt')) }
  if (Test-Path "$env:DSH_HOME/acceptance-plugin-state.txt") { Copy-Item "$env:DSH_HOME/acceptance-plugin-state.txt" "$evidence/plugin-state.txt" }
}
if ($probeExit -ne 0 -or $leaks.Count -gt 0) { throw 'Official payload boundary qualification failed; inspect evidence' }
& "$PSScriptRoot/test-boundaries.ps1"
& "$PSScriptRoot/test-update.ps1"
$package = Join-Path $env:RUNNER_TEMP 'portable-alpha2-native'
& "$PSScriptRoot/package.ps1" -Installer $installer -Output $package -SevenZip (Get-Command 7z).Source
$env:DSH_PORTABLE_DEVELOPMENT_ROOT = $package
$env:DSH_HOME = Join-Path $package 'data/dsh-home'
$nativeExe = Join-Path $package 'DeepSeek Harness Portable.exe'
$job = Start-Job -ScriptBlock { param($h,$x) & $h -Exe $x -Arguments '--probe-port=19490' -Milliseconds 180000 -CleanRunnerNativeDirectories -WaitForDescendants } -ArgumentList $harness,$nativeExe
try {
  node experiments/official-payload/probe.mjs 19490 "$evidence/launcher-page.json" "$env:GITHUB_WORKSPACE/experiments/official-desktop/fixtures/lifecycle"
  $nativeExit = $LASTEXITCODE
} finally {
  $job | Wait-Job | Receive-Job | Out-File "$evidence/launcher-process.log"
  $job | Remove-Job
  Copy-Item "$package/launcher/provenance.json" "$evidence/provenance.json"
}
if ($nativeExit -ne 0) { throw 'Native launcher artifact qualification failed' }
$moved = Join-Path $env:RUNNER_TEMP 'portable-alpha2-moved'
if (Test-Path $moved) { throw 'Moved qualification destination already exists' }
# Both exact paths are inside the disposable runner temp root and owned by this run.
foreach ($path in @($package,$moved)) {
  if (-not ([IO.Path]::GetFullPath($path)).StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Move escaped disposable runner root' }
}
Move-Item -LiteralPath $package -Destination $moved
$env:DSH_PORTABLE_DEVELOPMENT_ROOT = $moved
$env:DSH_HOME = Join-Path $moved 'data/dsh-home'
$job = Start-Job -ScriptBlock { param($h,$x) & $h -Exe $x -Arguments '--probe-port=19491' -Milliseconds 180000 -CleanRunnerNativeDirectories -WaitForDescendants } -ArgumentList $harness,(Join-Path $moved 'DeepSeek Harness Portable.exe')
try {
  node experiments/official-payload/probe.mjs 19491 "$evidence/moved-page.json" '-' moved
  $movedExit = $LASTEXITCODE
} finally {
  $job | Wait-Job | Receive-Job | Out-File "$evidence/moved-process.log"
  $job | Remove-Job
}
if ($movedExit -ne 0) { throw 'Moved native artifact qualification failed' }
