[CmdletBinding()]
param(
    [string[]]$TempTestIds = @(),
    [string[]]$DesktopTestIds = @(),
    [string[]]$ExtractorTestIds = @(),
    [string[]]$UpdateCliIds = @()
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$BuildNames = @(
    '.tmp-catalog-audit',
    '.tmp-product',
    'artifacts-candidate',
    'artifacts-candidate-rc1',
    'artifacts-candidate-rc1-current',
    'artifacts-installer-lifecycle',
    'artifacts-startup-fix',
    'candidate-runtime-current',
    'candidate-runtime-rc1'
)
$Targets = @($BuildNames | ForEach-Object { Join-Path $ProjectRoot $_ })

foreach ($Id in $TempTestIds) {
    if ($Id -notmatch '^[0-9a-f]{12}$') { throw "Invalid test id: $Id" }
    $Targets += Join-Path $TempRoot "dsh-i-$Id"
    $Targets += Join-Path $TempRoot "dsh-la-$Id"
}

foreach ($Id in $DesktopTestIds) {
    if ($Id -notmatch '^[0-9a-f]{12}$') { throw "Invalid desktop test id: $Id" }
    $Targets += Join-Path $TempRoot "dsh-desktop-$Id"
}

foreach ($Id in $ExtractorTestIds) {
    if ($Id -notmatch '^[0-9a-f]{12}$') { throw "Invalid extractor test id: $Id" }
    $Targets += Join-Path $TempRoot "dsh-portable-extractor-$Id"
}

foreach ($Id in $UpdateCliIds) {
    if ($Id -notmatch '^[A-Za-z0-9]{6}$') { throw "Invalid update CLI test id: $Id" }
    $Targets += Join-Path $TempRoot "dsh update cli 中文 $Id"
}

$Removed = @()
foreach ($Target in $Targets) {
    $Full = [System.IO.Path]::GetFullPath($Target)
    $InsideProject = ($Full + '\').StartsWith($ProjectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)
    $InsideKnownTemp = ($Full + '\').StartsWith($TempRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -and
        (([System.IO.Path]::GetFileName($Full) -match '^dsh-(?:(?:i|la)-|desktop-|portable-extractor-)[0-9a-f]{12}$') -or
         ([System.IO.Path]::GetFileName($Full) -match '^dsh update cli 中文 [A-Za-z0-9]{6}$'))
    if (-not ($InsideProject -or $InsideKnownTemp)) { throw "Refusing cleanup outside verified roots: $Full" }
    if (Test-Path -LiteralPath $Full) {
        Remove-Item -LiteralPath $Full -Recurse -Force
        $Removed += $Full
    }
}

[pscustomobject]@{
    RemovedCount = $Removed.Count
    Removed = $Removed
    FreeBytes = (Get-PSDrive C).Free
}
