$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
# Load only pure helper declarations: never execute the updater/network entry point.
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'update.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Updater syntax error' }
$functions=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)
. ([scriptblock]::Create(($functions | ForEach-Object {$_.Extent.Text}) -join "`n"))
$cases=@(
    @('0.1.7-rc.2','0.1.7-rc.1',$true),
    @('0.1.7-rc.2','0.1.7-rc.2',$false),
    @('0.1.7-rc.1','0.1.7-rc.2',$false),
    @('0.1.7','0.1.7-rc.2',$true),
    @('0.1.7-rc.3','0.1.7',$false),
    @('0.1.8-alpha.1','0.1.7',$true),
    @('0.1.7-alpha.10','0.1.7-alpha.2',$true),
    @('0.1.6','0.1.7-alpha.1',$false)
)
foreach($case in $cases){ if ((Is-Newer $case[0] $case[1]) -ne $case[2]) { throw "Version comparison failed: $case" } }
$directory=Join-Path ([IO.Path]::GetTempPath()) ('portable-update-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$target=Join-Path $directory 'state.json'
$junction=$null
try {
    Write-Atomic $target @{version='old'}
    Write-Atomic $target @{version='new'}
    if ((Get-Content $target -Raw|ConvertFrom-Json).version -ne 'new') { throw 'Atomic replacement failed' }
    $reader=[IO.File]::Open($target,'Open','Read','None')
    $rejected=$false
    try { Write-Atomic $target @{version='unexpected'} } catch { $rejected=$true } finally { $reader.Dispose() }
    if (-not $rejected -or (Get-Content $target -Raw|ConvertFrom-Json).version -ne 'new') { throw 'Busy state was changed' }
    if (@(Get-ChildItem $directory -Filter '*.tmp').Count) { throw 'Failed transaction left temporary state' }
    $Root=$directory
    $status=@{}
    New-Item -ItemType Directory -Path "$Root/app","$Root/launcher/receipts","$Root/outside" | Out-Null
    Set-Content "$Root/outside/keep.txt" 'outside-survives'
    foreach($version in @('1.0.0','1.1.0','1.2.0','1.3.0','1.4.0','2.0.0')) {
        New-Item -ItemType Directory -Path "$Root/app/$version" | Out-Null
        Set-Content "$Root/app/$version/owned.txt" $version
        if($version -ne '1.4.0'){Write-Atomic "$Root/launcher/receipts/$version.json" @{version=$version}}
    }
    Write-Atomic "$Root/app/current.json" @{version='1.2.0';previous='1.1.0'}
    Write-Atomic "$Root/app/staged.json" @{version='1.3.0'}
    $scratch=Join-Path $Root ('app/1.5.0.staging-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    $junction=Join-Path $Root 'app/2.0.0/redirect'
    New-Item -ItemType Junction -Path $junction -Target "$Root/outside" | Out-Null
    Clear-OldPrograms
    if((Test-Path "$Root/app/1.0.0") -or (Test-Path $scratch)){throw 'Obsolete managed versions were retained'}
    foreach($version in @('1.1.0','1.2.0','1.3.0','1.4.0','2.0.0')) {if(-not(Test-Path "$Root/app/$version/owned.txt")){throw "Protected or unmanaged version removed: $version"}}
    if((Get-Content "$Root/outside/keep.txt") -ne 'outside-survives' -or $status.cleanup -ne 'deferred'){throw 'Redirected cleanup was not safely deferred'}
} finally {
    # Exact uniquely created test directory, checked against its intended parent.
    if (-not ([IO.Path]::GetFullPath($directory)).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped temp root' }
    if($junction -and (Test-Path -LiteralPath $junction)){[IO.Directory]::Delete($junction)}
    Remove-Item -LiteralPath $directory -Recurse -Force
}
Write-Output 'Version ordering, atomic replacement, busy-state preservation, bounded retention and junction-safe cleanup passed'
