[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$CacheDir
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$LauncherSource = Join-Path $ProjectRoot 'launcher\windows\DSH-Portable.cs'
$OriginalSource = [System.IO.File]::ReadAllText($LauncherSource)
$PatchedSource = $OriginalSource

$DelayPattern = 'Task\.Delay\(30000\)'
$DelayCount = [regex]::Matches($PatchedSource, $DelayPattern).Count
if ($DelayCount -ne 2) {
    throw "Expected exactly two 30-second WebView2 navigation delays, found $DelayCount. Refusing to build an ambiguous dev package."
}
$PatchedSource = [regex]::Replace($PatchedSource, $DelayPattern, 'Task.Delay(60000)')

# Keep this script ASCII-only because Windows PowerShell 5.1 treats a UTF-8
# script without a BOM as an ANSI code page. Construct the Chinese seconds
# marker from its Unicode code point instead of embedding non-ASCII source.
$SecondCharacter = [string][char]0x79D2
$Chinese30Seconds = '30 ' + $SecondCharacter
$Chinese60Seconds = '60 ' + $SecondCharacter
$ChineseTimeoutCount = [regex]::Matches($PatchedSource, [regex]::Escape($Chinese30Seconds)).Count
if ($ChineseTimeoutCount -ne 2) {
    throw "Expected exactly two Chinese 30-second timeout labels, found $ChineseTimeoutCount."
}
$PatchedSource = $PatchedSource.Replace($Chinese30Seconds, $Chinese60Seconds)

$EnglishReplacements = [ordered]@{
    'The updated workspace did not open within 30 seconds.' = 'The updated workspace did not open in the embedded WebView2 within 60 seconds. The local backend had already become ready before this timeout.'
    'The DeepSeek Harness workspace did not open within 30 seconds.' = 'The DeepSeek Harness workspace did not open in the embedded WebView2 within 60 seconds. The local backend had already become ready before this timeout.'
}

foreach ($Entry in $EnglishReplacements.GetEnumerator()) {
    $Count = ([regex]::Matches($PatchedSource, [regex]::Escape([string]$Entry.Key))).Count
    if ($Count -ne 1) {
        throw "Expected one launcher message matching '$($Entry.Key)', found $Count. Refusing to build an ambiguous dev package."
    }
    $PatchedSource = $PatchedSource.Replace([string]$Entry.Key, [string]$Entry.Value)
}

if ([regex]::Matches($PatchedSource, 'Task\.Delay\(60000\)').Count -ne 2) {
    throw 'The development timeout patch did not produce exactly two 60-second navigation waits.'
}
if ($PatchedSource.Contains('within 30 seconds') -or $PatchedSource.Contains($Chinese30Seconds)) {
    throw 'A stale 30-second workspace timeout message remains after the development patch.'
}

try {
    [System.IO.File]::WriteAllText($LauncherSource, $PatchedSource, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Development patch applied: embedded WebView2 navigation timeout is 60 seconds on initial and post-update navigation.'

    $BuildArgs = @{}
    if ($OutputDir) { $BuildArgs.OutputDir = $OutputDir }
    if ($CacheDir) { $BuildArgs.CacheDir = $CacheDir }
    & (Join-Path $PSScriptRoot 'build-windows.ps1') @BuildArgs
} finally {
    [System.IO.File]::WriteAllText($LauncherSource, $OriginalSource, [System.Text.UTF8Encoding]::new($false))
}
