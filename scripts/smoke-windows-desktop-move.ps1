[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$DesktopSmoke = Join-Path $PSScriptRoot 'smoke-windows-desktop-host.ps1'
$Parent = Split-Path -Parent $Root
$MovedRoot = Join-Path $Parent ((Split-Path -Leaf $Root) + '-moved')

if (-not (Test-Path -LiteralPath (Join-Path $Root 'DeepSeek-Herness.exe'))) {
    throw "Portable root is incomplete: $Root"
}
if (Test-Path -LiteralPath $MovedRoot) {
    throw "Move target already exists: $MovedRoot"
}

$First = & $DesktopSmoke -Root $Root
if ($LASTEXITCODE -ne 0) { throw "First desktop lifecycle failed with exit code $LASTEXITCODE" }

Move-Item -LiteralPath $Root -Destination $MovedRoot
if (Test-Path -LiteralPath $Root) { throw 'The original portable folder still exists after the move.' }

$Second = & $DesktopSmoke -Root $MovedRoot
if ($LASTEXITCODE -ne 0) { throw "Moved desktop lifecycle failed with exit code $LASTEXITCODE" }
Move-Item -LiteralPath $MovedRoot -Destination $Root
if (Test-Path -LiteralPath $MovedRoot) { throw 'The moved portable folder could not be restored for later smoke tests.' }

[pscustomobject]@{
    OriginalRoot = $Root
    MovedRoot = $MovedRoot
    FinalRoot = $Root
    FirstColdStartSeconds = $First.ColdStartSeconds
    MovedColdStartSeconds = $Second.ColdStartSeconds
    Status = 'passed'
}
