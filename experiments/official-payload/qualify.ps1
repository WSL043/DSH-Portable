$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows runner required' }
$evidence = Join-Path $env:GITHUB_WORKSPACE 'build/official-payload-evidence'
$root = Join-Path $env:RUNNER_TEMP 'portable-official-alpha2'
New-Item -ItemType Directory -Path $evidence,$root -Force | Out-Null
$installer = Join-Path $root 'official.exe'
$url = 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.2-win-x64.exe'
Invoke-WebRequest -Uri $url -OutFile $installer
$hash = [Convert]::ToBase64String([Convert]::FromHexString((Get-FileHash $installer -Algorithm SHA512).Hash))
if ($hash -ne 'AY7f45dYO7BFrfgaLmzXNWP0pavlxkSbsehPo/WF6PXcFdDK3fF1oHUPs/4f2bzROgQvm6wSgawZ/g7UzbPRmw==') { throw 'Installer hash mismatch' }
$signature = Get-AuthenticodeSignature $installer
if ($signature.Status -ne 'Valid') { throw 'Invalid official installer signature' }
$signature | Select-Object Status,@{n='subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json | Set-Content "$evidence/signature.json"
$outer = Join-Path $root 'outer'
$app = Join-Path $root 'app'
& 7z x $installer "-o$outer" '-y' | Out-File "$evidence/extract.log"
if ($LASTEXITCODE -ne 0) { throw 'Outer extraction failed' }
$archive = Join-Path $outer '$PLUGINSDIR/app-64.7z'
& 7z x $archive "-o$app" '-y' | Out-File "$evidence/extract-app.log"
if ($LASTEXITCODE -ne 0) { throw 'Payload extraction failed' }
$exe = Join-Path $app 'DeepSeek Harness.exe'
if ((Get-AuthenticodeSignature $exe).Status -ne 'Valid') { throw 'Invalid payload signature' }
Remove-Item -LiteralPath "$app/resources/app-update.yml"
$env:DSH_PORTABLE_DEVELOPMENT_ROOT = $root
$env:DSH_HOME = Join-Path $root 'data/dsh-home'
$env:DSH_AGENTS_HOME = Join-Path $root 'data/agents'
$env:pnpm_config_store_dir = Join-Path $root 'data/pnpm-store'
$env:pnpm_config_cache_dir = Join-Path $root 'data/pnpm-cache'
$env:pnpm_config_state_dir = Join-Path $root 'data/pnpm-state'
$userData = Join-Path $root 'data/electron'
$watch = @("$env:APPDATA/@deepseek-ai", "$env:USERPROFILE/.dsh", "$env:LOCALAPPDATA/pnpm", "$env:LOCALAPPDATA/@deepseek-aidsh-desktop-updater")
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
  $leaks = @($watch | Where-Object { (Test-Path -LiteralPath $_) -and $_ -notin $before })
  @{ leaks=$leaks; userDataPresent=(Test-Path $userData); dshHomePresent=(Test-Path $env:DSH_HOME); originalSystemDirectories=$true } | ConvertTo-Json | Set-Content "$evidence/paths.json"
  Get-ChildItem "$root/data" -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName,Length | ConvertTo-Json | Set-Content "$evidence/data-inventory.json"
  Get-ChildItem "$root/data" -Recurse -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $evidence ($_.Name + '-' + [guid]::NewGuid().ToString('N') + '.txt')) }
  if (Test-Path "$env:DSH_HOME/acceptance-plugin-state.txt") { Copy-Item "$env:DSH_HOME/acceptance-plugin-state.txt" "$evidence/plugin-state.txt" }
}
if ($probeExit -ne 0 -or $leaks.Count -gt 0) { throw 'Official payload boundary qualification failed; inspect evidence' }
