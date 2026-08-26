[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$DesktopSmoke = Join-Path $PSScriptRoot 'smoke-windows-desktop-host.ps1'
$PerformanceBudgetPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\performance-budgets.json'
$PerformanceBudget = (Get-Content -Raw -LiteralPath $PerformanceBudgetPath | ConvertFrom-Json).platforms.'windows-x64'
$Parent = Split-Path -Parent $Root
$MovedRoot = Join-Path $Parent ((Split-Path -Leaf $Root) + '-moved')

if (-not (Test-Path -LiteralPath (Join-Path $Root 'DeepSeek-Herness.exe'))) {
    throw "Portable root is incomplete: $Root"
}
if (Test-Path -LiteralPath $MovedRoot) {
    throw "Move target already exists: $MovedRoot"
}

function Move-PortableDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    # Both lifecycle runs have already proved that DSH and its owned WebView2
    # tree are stopped. Windows Defender and the indexer can still retain a
    # newly executed directory for a fraction of a second, so tolerate only
    # that bounded external-lock window.
    $Deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ($true) {
        try {
            Move-Item -LiteralPath $Source -Destination $Destination
            return
        } catch {
            if (-not ($_.Exception -is [System.IO.IOException]) -and
                -not ($_.Exception -is [System.UnauthorizedAccessException])) { throw }
            if ([DateTime]::UtcNow -ge $Deadline) { throw }
            Start-Sleep -Milliseconds 100
        }
    }
}

function Assert-BoundedPerformance {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][double]$ColdStartLimit
    )

    $Metrics = @(
        @('ColdStartSeconds', [double]$Result.ColdStartSeconds, $ColdStartLimit),
        @('ExplicitExitSeconds', [double]$Result.ExplicitExitSeconds, [double]$PerformanceBudget.explicitExitSeconds),
        @('CloseToExitSeconds', [double]$Result.CloseToExitSeconds, [double]$PerformanceBudget.closeToExitSeconds)
    )
    foreach ($Metric in $Metrics) {
        if ($Metric[1] -gt $Metric[2]) {
            throw "$Label $($Metric[0])=$($Metric[1])s exceeds $($Metric[2])s"
        }
    }
}

$First = & $DesktopSmoke -Root $Root
if ($LASTEXITCODE -ne 0) { throw "First desktop lifecycle failed with exit code $LASTEXITCODE" }
Assert-BoundedPerformance -Result $First -Label 'First launch' -ColdStartLimit $PerformanceBudget.firstColdStartSeconds

Move-PortableDirectory -Source $Root -Destination $MovedRoot
if (Test-Path -LiteralPath $Root) { throw 'The original portable folder still exists after the move.' }

$Second = & $DesktopSmoke -Root $MovedRoot
if ($LASTEXITCODE -ne 0) { throw "Moved desktop lifecycle failed with exit code $LASTEXITCODE" }
Assert-BoundedPerformance -Result $Second -Label 'Moved launch' -ColdStartLimit $PerformanceBudget.movedColdStartSeconds
Move-PortableDirectory -Source $MovedRoot -Destination $Root
if (Test-Path -LiteralPath $MovedRoot) { throw 'The moved portable folder could not be restored for later smoke tests.' }

[pscustomobject]@{
    OriginalRoot = $Root
    MovedRoot = $MovedRoot
    FinalRoot = $Root
    FirstColdStartSeconds = $First.ColdStartSeconds
    MovedColdStartSeconds = $Second.ColdStartSeconds
    FirstExplicitExitSeconds = $First.ExplicitExitSeconds
    MovedExplicitExitSeconds = $Second.ExplicitExitSeconds
    FirstCloseToExitSeconds = $First.CloseToExitSeconds
    MovedCloseToExitSeconds = $Second.CloseToExitSeconds
    Status = 'passed'
}
