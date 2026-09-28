$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted'){throw 'Disposable hosted Windows runner required'}
$evidence=Join-Path $env:GITHUB_WORKSPACE 'build/official-payload-evidence'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
Import-Module "$PSScriptRoot/Payload.psm1" -Force
$candidate=Get-Content "$PSScriptRoot/candidate.json" -Raw|ConvertFrom-Json
$installer=Join-Path $env:RUNNER_TEMP 'official-alpha3.exe'
Get-OfficialInstaller $installer $candidate
$sevenZip=Join-Path $env:ProgramFiles '7-Zip/7z.exe'
$package=Join-Path $env:RUNNER_TEMP 'portable-alpha3-native'
& "$PSScriptRoot/test-boundaries.ps1"
& "$PSScriptRoot/test-update.ps1"
node --test tests/official-payload.test.mjs tests/official-desktop-adapter.test.mjs tests/official-default-plugins.test.mjs
if($LASTEXITCODE -ne 0){throw 'Boundary unit tests failed'}
& "$PSScriptRoot/package.ps1" -Installer $installer -Output $package -SevenZip $sevenZip
$receipt=Get-Content "$package/launcher/provenance.json" -Raw|ConvertFrom-Json
Copy-Item "$package/launcher/provenance.json" "$evidence/provenance.json"
# Candidate source is restricted to disposable runners; public catalog is promoted only after all gates.
$candidate | Add-Member -NotePropertyName launcherProtocol -NotePropertyValue 2 -Force
$candidate.qualification='qualified'
$candidate | ConvertTo-Json -Depth 5 | Set-Content "$evidence/test-candidate.json" -Encoding UTF8
$env:DSH_PORTABLE_QUALIFICATION_CANDIDATE=Join-Path $evidence 'test-candidate.json'
$harness=Join-Path $PSScriptRoot 'launch-hidden-windows.ps1'
$watch=@("$env:APPDATA/@deepseek-ai", "$env:USERPROFILE/.dsh", "$env:LOCALAPPDATA/pnpm", "$env:LOCALAPPDATA/@deepseek-aidsh-desktop-updater", "$env:LOCALAPPDATA/node-addon-native-custom-loader")
$before=@($watch|Where-Object {Test-Path -LiteralPath $_})
& "$PSScriptRoot/trace-writes.ps1" -Mode Start -Evidence $evidence -PortableRoot $package
@{version=$candidate.version;from=$candidate.version;receipt=@{asarSha256=('0'*64)}} | ConvertTo-Json -Depth 4 | Set-Content "$package/app/staged.json"
$env:DSH_PORTABLE_DEVELOPMENT_ROOT=$package
$env:DSH_HOME=Join-Path $package 'data/dsh-home'
$job=Start-Job -ScriptBlock {param($h,$x) & $h -Exe $x -Arguments '--probe-port=19490' -Milliseconds 180000 -CleanRunnerNativeDirectories -WaitForDescendants} -ArgumentList $harness,(Join-Path $package 'DeepSeek Harness Portable.exe')
try {
 node experiments/official-payload/probe.mjs 19490 "$evidence/launcher-page.json" "$PSScriptRoot/fixtures/lifecycle"
 $nativeExit=$LASTEXITCODE
} finally {
 $job|Wait-Job|Receive-Job|Out-File "$evidence/launcher-process.log"
 $job|Remove-Job
 & "$PSScriptRoot/trace-writes.ps1" -Mode Stop -Evidence $evidence -PortableRoot $package
}
if($nativeExit -ne 0){throw 'Native alpha3 acceptance failed'}
$leaks=@($watch|Where-Object {(Test-Path -LiteralPath $_) -and $_ -notin $before})
if($leaks.Count){$leaks|ConvertTo-Json|Set-Content "$evidence/leaks.json";throw 'Application data escaped portable root'}
if((Get-Content "$evidence/write-trace-summary.json" -Raw|ConvertFrom-Json).unclassifiedEvents -gt 0){throw 'Unclassified outside writes require review'}
if(-not(Test-Path "$package/data/launcher/activation-error.json")){throw 'Corrupt stage did not preserve current program'}
Copy-Item "$package/data/launcher/activation-error.json" "$evidence/rejected-stage.json"
@{version=$candidate.version;from=$candidate.version;receipt=$receipt}|ConvertTo-Json -Depth 5|Set-Content "$package/app/staged.json"
$moved=Join-Path $env:RUNNER_TEMP 'portable-alpha3-moved 中文 space'
if(Test-Path $moved){throw 'Moved destination must be fresh'}
foreach($path in @($package,$moved)){if(-not([IO.Path]::GetFullPath($path)).StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Move outside runner root'}}
$deadline=[DateTime]::UtcNow.AddSeconds(10)
while($true){try{[IO.Directory]::Move($package,$moved);break}catch{if([DateTime]::UtcNow -ge $deadline){throw};Start-Sleep -Milliseconds 500}}
$env:DSH_PORTABLE_DEVELOPMENT_ROOT=$moved
$env:DSH_HOME=Join-Path $moved 'data/dsh-home'
$job=Start-Job -ScriptBlock {param($h,$x) & $h -Exe $x -Arguments '--probe-port=19491' -Milliseconds 180000 -CleanRunnerNativeDirectories -WaitForDescendants} -ArgumentList $harness,(Join-Path $moved 'DeepSeek Harness Portable.exe')
try {
 node experiments/official-payload/probe.mjs 19491 "$evidence/moved-page.json" '-' moved
 $movedExit=$LASTEXITCODE
} finally {$job|Wait-Job|Receive-Job|Out-File "$evidence/moved-process.log";$job|Remove-Job}
if($movedExit -ne 0 -or (Test-Path "$moved/app/staged.json")){throw 'Moved alpha3 acceptance failed'}
$candidate|Add-Member -NotePropertyName evidence -NotePropertyValue "https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID" -Force
$candidate|ConvertTo-Json -Depth 5|Set-Content "$evidence/qualified-candidate.json" -Encoding UTF8
& "$PSScriptRoot/qualify-upgrade.ps1" -CandidateFile "$evidence/qualified-candidate.json" -Evidence $evidence -SevenZip $sevenZip
if ($env:DSH_BUILD_ALPHA_ARCHIVE -eq 'true') {
  $release = Join-Path $env:GITHUB_WORKSPACE 'build/official-payload-release'
  $clean = Join-Path $env:RUNNER_TEMP 'DSH-Portable-1.0.0-alpha.3'
  if (Test-Path $clean) { throw 'Release directory must be fresh' }
  New-Item -ItemType Directory -Path $release,$clean | Out-Null
  foreach ($entry in Get-ChildItem -LiteralPath $moved -Force | Where-Object Name -ne 'data') { Copy-Item -LiteralPath $entry.FullName -Destination $clean -Recurse }
  if (Test-Path "$clean/data") { throw 'Acceptance data entered the release package' }
  $archive = Join-Path $release 'DSH-Portable-1.0.0-alpha.3-windows-x64.zip'
  & $sevenZip a -tzip -mx=7 $archive $clean | Out-File "$evidence/archive.log"
  if ($LASTEXITCODE -ne 0) { throw 'Release archive failed' }
  (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $archive) | Set-Content "$release/checksums.txt" -Encoding ASCII
  Copy-Item "$evidence/provenance.json" "$release/provenance.json"
  Copy-Item "$evidence/qualified-candidate.json" "$release/qualified-candidate.json"
  @{sourceCommit=$env:GITHUB_SHA;nativeQualification=$candidate.evidence;version='1.0.0-alpha.3';binarySha256=(Get-FileHash "$clean/DeepSeek Harness Portable.exe" -Algorithm SHA256).Hash.ToLowerInvariant();adaptedAsarSha256=$receipt.asarSha256;officialAsarSha256=$receipt.originalAsarSha256;scenarios=@('input','plugin-install-enable-disable','moved-draft','moved-plugin-enable-uninstall','corrupt-stage-preserves-current','interrupted-stage-converges','normal-exit','outside-write-audit','protocol-return','official-update-current','official-update-failure-retry','native-restart-preserves-draft');limits=@('external-workspaces','no-cross-machine-login-proof','no-historical-data-migration','no-real-distinct-version-upgrade-yet')} | ConvertTo-Json -Depth 5 | Set-Content "$release/qualification.json"
}
