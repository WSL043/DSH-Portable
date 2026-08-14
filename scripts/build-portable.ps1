[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$CacheDir
)

$Arguments = @{}
if ($OutputDir) { $Arguments.OutputDir = $OutputDir }
if ($CacheDir) { $Arguments.CacheDir = $CacheDir }
& (Join-Path $PSScriptRoot 'build-windows.ps1') @Arguments
