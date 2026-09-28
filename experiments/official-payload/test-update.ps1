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
try {
    Write-Atomic $target @{version='old'}
    Write-Atomic $target @{version='new'}
    if ((Get-Content $target -Raw|ConvertFrom-Json).version -ne 'new') { throw 'Atomic replacement failed' }
    $reader=[IO.File]::Open($target,'Open','Read','None')
    $rejected=$false
    try { Write-Atomic $target @{version='unexpected'} } catch { $rejected=$true } finally { $reader.Dispose() }
    if (-not $rejected -or (Get-Content $target -Raw|ConvertFrom-Json).version -ne 'new') { throw 'Busy state was changed' }
    if (@(Get-ChildItem $directory -Filter '*.tmp').Count) { throw 'Failed transaction left temporary state' }
} finally {
    # Exact uniquely created test directory, checked against its intended parent.
    if (-not ([IO.Path]::GetFullPath($directory)).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped temp root' }
    Remove-Item -LiteralPath $directory -Recurse -Force
}
Write-Output '8 version cases; atomic replacement; busy-state preservation; temporary cleanup passed'
