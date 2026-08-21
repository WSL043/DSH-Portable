[CmdletBinding()]
param(
    [string[]]$TempTestIds = @(),
    [string[]]$DesktopTestIds = @(),
    [string[]]$ExtractorTestIds = @(),
    [string[]]$UpdateCliIds = @(),
    [string[]]$BuildStageIds = @(),
    [int[]]$AcceptanceOutputIds = @(),
    [switch]$VerifiedInstalledSmokeState
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$DownloadsRoot = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads')).TrimEnd('\')
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
$Targets += Join-Path $TempRoot 'dsh-portable-clean-build-cache'

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

foreach ($Id in $BuildStageIds) {
    if ($Id -notmatch '^[0-9a-f]{32}$') { throw "Invalid Windows build-stage id: $Id" }
    $Targets += Join-Path $TempRoot "dsh-portable-win-$Id"
}

foreach ($Id in $AcceptanceOutputIds) {
    if ($Id -lt 1 -or $Id -gt 999) { throw "Invalid acceptance output id: $Id" }
    $Targets += Join-Path $DownloadsRoot "DSH-Portable-clean-acceptance-$Id"
}

if ($VerifiedInstalledSmokeState) {
    $InstalledSmokeRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DeepSeek-Herness'
    $PortableState = Join-Path $InstalledSmokeRoot 'data\portable.json'
    if (Test-Path -LiteralPath $InstalledSmokeRoot) {
        if (-not (Test-Path -LiteralPath $PortableState -PathType Leaf)) {
            throw "Refusing to remove unverified installed state: $InstalledSmokeRoot"
        }
        $Metadata = Get-Content -Raw -LiteralPath $PortableState | ConvertFrom-Json
        if ([string]$Metadata.lastRoot -notmatch '(?i)\\Temp\\dsh-portable-win-[0-9a-f]{32}\\DSH-Portable$') {
            throw "Installed state does not belong to a verified temporary build: $($Metadata.lastRoot)"
        }
        if (Test-Path -LiteralPath (Join-Path $InstalledSmokeRoot 'data\runtime\process.json')) {
            throw "Refusing to remove installed smoke state while process state still exists: $InstalledSmokeRoot"
        }
        $Targets += $InstalledSmokeRoot
    }
}

$Removed = @()
foreach ($Target in $Targets) {
    $Full = [System.IO.Path]::GetFullPath($Target)
    $InsideProject = ($Full + '\').StartsWith($ProjectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)
    $VerifiedAcceptanceOutput = ([System.IO.Path]::GetDirectoryName($Full)).Equals($DownloadsRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        ([System.IO.Path]::GetFileName($Full) -match '^DSH-Portable-clean-acceptance-[1-9][0-9]{0,2}$')
    $VerifiedInstalledState = $VerifiedInstalledSmokeState -and
        $Full.Equals([System.IO.Path]::GetFullPath($InstalledSmokeRoot), [System.StringComparison]::OrdinalIgnoreCase)
    $InsideKnownTemp = ($Full + '\').StartsWith($TempRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -and
        (([System.IO.Path]::GetFileName($Full) -match '^dsh-(?:(?:i|la)-|desktop-|portable-extractor-)[0-9a-f]{12}$') -or
         ([System.IO.Path]::GetFileName($Full) -match '^dsh-portable-win-[0-9a-f]{32}$') -or
         ([System.IO.Path]::GetFileName($Full) -eq 'dsh-portable-clean-build-cache') -or
         ([System.IO.Path]::GetFileName($Full) -match '^dsh update cli 中文 [A-Za-z0-9]{6}$'))
    if (-not ($InsideProject -or $InsideKnownTemp -or $VerifiedInstalledState -or $VerifiedAcceptanceOutput)) { throw "Refusing cleanup outside verified roots: $Full" }
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
