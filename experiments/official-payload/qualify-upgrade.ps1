param([string]$CandidateFile,[string]$Evidence,[string]$SevenZip)
$ErrorActionPreference='Stop'
Import-Module "$PSScriptRoot/Payload.psm1" -Force
$previousFile=Join-Path $env:GITHUB_WORKSPACE 'channels/official-desktop/windows-x64.json'
$candidate=Get-Content $CandidateFile -Raw|ConvertFrom-Json
if(-not(Test-Path $previousFile)){ @{status='not-run';reason='no-previous-qualified-channel'}|ConvertTo-Json|Set-Content "$Evidence/upgrade.json"; return }
$previous=Get-Content $previousFile -Raw|ConvertFrom-Json
if($previous.version -eq $candidate.version){ @{status='not-run';reason='no-distinct-official-version'}|ConvertTo-Json|Set-Content "$Evidence/upgrade.json"; return }
$root=Join-Path $env:RUNNER_TEMP 'portable-alpha2-upgrade'
$installer=Join-Path $env:RUNNER_TEMP 'portable-previous-official.exe'
Get-OfficialInstaller $installer $previous
& "$PSScriptRoot/package.ps1" -Installer $installer -Output $root -SevenZip $SevenZip -CandidateFile $previousFile
$env:DSH_PORTABLE_DEVELOPMENT_ROOT=$root
$env:DSH_HOME=Join-Path $root 'data/dsh-home'
$harness=Join-Path $PSScriptRoot 'launch-hidden-windows.ps1'
$exe=Join-Path $root 'DeepSeek Harness Portable.exe'
foreach($phase in @('before','after')){
    if($phase -eq 'after'){
        & "$root/launcher/update.ps1" -Root $root -QualificationCandidate $CandidateFile
        $status=Get-Content "$root/data/launcher/update-status.json" -Raw|ConvertFrom-Json
        if($status.status -ne 'staged'){throw "Real official update was not staged: $($status.error)"}
    }
    $job=Start-Job -ScriptBlock {param($h,$x) & $h -Exe $x -Arguments '--probe-port=19492' -Milliseconds 180000 -CleanRunnerNativeDirectories -WaitForDescendants} -ArgumentList $harness,$exe
    try{
        $mode=if($phase -eq 'before'){'install'}else{'upgraded'}
        node experiments/official-payload/probe.mjs 19492 "$Evidence/upgrade-$phase.json" "$PSScriptRoot/fixtures/lifecycle" $mode
        $probeExit=$LASTEXITCODE
    }finally{
        $job|Wait-Job|Receive-Job|Out-File "$Evidence/upgrade-$phase-process.log"
        $job|Remove-Job
    }
    if($probeExit -ne 0){throw "Official upgrade $phase acceptance failed"}
}
$current=Get-Content "$root/app/current.json" -Raw|ConvertFrom-Json
if($current.version -ne $candidate.version -or $current.previous -ne $previous.version){throw 'Real upgrade activation state mismatch'}
@{status='passed';from=$previous.version;to=$candidate.version;through='shipped updater and native launcher'}|ConvertTo-Json|Set-Content "$Evidence/upgrade.json"
