param(
    [string]$RunnerLabel = "focused",
    [int]$FirstColdStartSeconds = 75,
    [switch]$TraceRuntimePreparation
)
$ErrorActionPreference = "Stop"
$Root = Join-Path $env:RUNNER_TEMP 'dsh-desktop-host'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
tar.exe -x -f artifacts/DSH-Portable-windows-x64-offline.zip -C $Root
if ($LASTEXITCODE -ne 0) { throw "Windows package extraction failed with exit code $LASTEXITCODE" }
if ($TraceRuntimePreparation) {
    # Diagnostic overlay only; this run cannot qualify the original release artifact.
    foreach ($Module in @('runtime-capsule.mjs', 'runtime-entry.mjs')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../launcher/$Module") -Destination (Join-Path $Root "DSH-Portable/launcher/$Module")
    }
    Write-Host 'DIAGNOSTIC OVERLAY: runtime preparation phase tracing; no timeout or concurrency changes.'
}
$StartupEvidence = Join-Path $env:RUNNER_TEMP "dsh-startup-transition-$RunnerLabel"
node scripts/audit-windows-startup-transition.mjs (Join-Path $Root 'DSH-Portable') $StartupEvidence $FirstColdStartSeconds
if ($LASTEXITCODE -ne 0) { throw "Windows startup transition audit failed with exit code $LASTEXITCODE" }
./scripts/smoke-windows-detached-updater.ps1 -Root (Join-Path $Root 'DSH-Portable')
./scripts/smoke-windows-desktop-move.ps1 `
  -Root (Join-Path $Root 'DSH-Portable') `
  -FirstColdStartLimit $FirstColdStartSeconds
./scripts/smoke-windows-dom-ready.ps1 -Root (Join-Path $Root 'DSH-Portable')
./scripts/smoke-windows-native-tray.ps1 -Root (Join-Path $Root 'DSH-Portable')
node scripts/smoke-capsule-maintenance.mjs (Join-Path $Root 'DSH-Portable')
if ($LASTEXITCODE -ne 0) { throw 'Capsule maintenance smoke failed.' }
$AliasRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-path-alias-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $AliasRoot | Out-Null
tar.exe -x -f artifacts/DSH-Portable-windows-x64-offline.zip -C $AliasRoot
if ($LASTEXITCODE -ne 0) { throw 'Path-alias fixture extraction failed.' }
node scripts/smoke-windows-path-alias.mjs (Join-Path $AliasRoot 'DSH-Portable')
if ($LASTEXITCODE -ne 0) { throw 'Windows path-alias smoke failed.' }
node scripts/smoke-windows-runtime-health.mjs (Join-Path $AliasRoot 'DSH-Portable')
$HealthEvidence = Join-Path $AliasRoot 'DSH-Portable\data\health-evidence.json'
if (Test-Path -LiteralPath $HealthEvidence) { Copy-Item -LiteralPath $HealthEvidence -Destination (Join-Path $Root 'DSH-Portable\data\health-evidence.json') -ErrorAction Stop }
if ($LASTEXITCODE -ne 0) { throw 'Windows runtime-health smoke failed.' }
node scripts/smoke-windows-native-restart.mjs (Join-Path $Root 'DSH-Portable')
if ($LASTEXITCODE -ne 0) { throw "Windows native restart smoke failed with exit code $LASTEXITCODE" }
node scripts/smoke-windows-native-restart.mjs (Join-Path $Root 'DSH-Portable') --force-job-close
if ($LASTEXITCODE -ne 0) { throw "Windows forced-job restart smoke failed with exit code $LASTEXITCODE" }
node scripts/smoke-windows-subprocess-hide.mjs (Join-Path $Root 'DSH-Portable')
if ($LASTEXITCODE -ne 0) { throw "Windows subprocess hiding smoke failed with exit code $LASTEXITCODE" }
node scripts/smoke-windows-tray-bridge.mjs (Join-Path $Root 'DSH-Portable')
if ($LASTEXITCODE -ne 0) { throw "Windows tray bridge smoke failed with exit code $LASTEXITCODE" }
# WebView2 can keep the previous user-data browser process alive after
# its host exits. Verify downloads from a separately extracted product
# root so the debugging arguments cannot be swallowed by that process.
$DownloadRoot = Join-Path $env:RUNNER_TEMP 'dsh-native-download-host'
New-Item -ItemType Directory -Force -Path $DownloadRoot | Out-Null
tar.exe -x -f artifacts/DSH-Portable-windows-x64-offline.zip -C $DownloadRoot
if ($LASTEXITCODE -ne 0) { throw "Windows download-smoke extraction failed with exit code $LASTEXITCODE" }
node scripts/smoke-windows-native-download.mjs (Join-Path $DownloadRoot 'DSH-Portable')
if ($LASTEXITCODE -ne 0) { throw "Windows native download smoke failed with exit code $LASTEXITCODE" }
$WorkspacePickerRoot = Join-Path $env:RUNNER_TEMP 'dsh-native-workspace-picker-host'
New-Item -ItemType Directory -Force -Path $WorkspacePickerRoot | Out-Null
tar.exe -x -f artifacts/DSH-Portable-windows-x64-offline.zip -C $WorkspacePickerRoot
if ($LASTEXITCODE -ne 0) { throw "Windows workspace-picker smoke extraction failed with exit code $LASTEXITCODE" }
node scripts/smoke-windows-native-workspace-picker.mjs (Join-Path $WorkspacePickerRoot 'DSH-Portable')
if ($LASTEXITCODE -ne 0) { throw "Windows native workspace picker smoke failed with exit code $LASTEXITCODE" }
$MigrationRoot = Join-Path $env:RUNNER_TEMP 'dsh-native-migration-host'
$MigrationEvidence = Join-Path $env:RUNNER_TEMP "dsh-native-migration-evidence-$RunnerLabel"
New-Item -ItemType Directory -Force -Path $MigrationRoot, $MigrationEvidence | Out-Null
tar.exe -x -f artifacts/DSH-Portable-windows-x64-offline.zip -C $MigrationRoot
if ($LASTEXITCODE -ne 0) { throw "Windows migration-smoke extraction failed with exit code $LASTEXITCODE" }
$MigrationProduct = Join-Path $MigrationRoot 'DSH-Portable'
$MigrationNode = Join-Path $MigrationProduct 'runtime\node\node.exe'
& $MigrationNode scripts/smoke-windows-data-export.mjs $MigrationProduct $MigrationEvidence
if ($LASTEXITCODE -ne 0) { throw "Windows native data migration smoke failed with exit code $LASTEXITCODE" }
