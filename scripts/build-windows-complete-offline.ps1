[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BaseArchive,
    [Parameter(Mandatory=$true)][string]$WebView2Cab,
    [Parameter(Mandatory=$true)][string]$OutputArchive,
    [string]$CapsuleCache
)
$ErrorActionPreference = 'Stop'
$OutputArchive = [IO.Path]::GetFullPath($OutputArchive)
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($OutputArchive)) | Out-Null
$Temporary = Join-Path ([IO.Path]::GetDirectoryName($OutputArchive)) ('.complete-offline-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temporary | Out-Null
try {
    & tar.exe -x -f $BaseArchive -C $Temporary
    if ($LASTEXITCODE -ne 0) { throw 'Base package extraction failed.' }
    $Stage = Join-Path $Temporary 'DSH-Portable'
    if (-not (Test-Path -LiteralPath (Join-Path $Stage 'DeepSeek-Herness.exe'))) { throw 'Missing Windows desktop in base package.' }
    if (-not (Test-Path -LiteralPath (Join-Path $Stage 'launcher/webview-runtime.mjs'))) { throw 'Base package does not support the bundled WebView2 capsule.' }
    $Product = Get-Content -Raw (Join-Path $PSScriptRoot '../package.json') | ConvertFrom-Json
    $CoreLockName = if ($Product.version -match '-') { '../upstream.preview.lock.json' } else { '../upstream.lock.json' }
    $CoreLock = Get-Content -Raw (Join-Path $PSScriptRoot $CoreLockName) | ConvertFrom-Json
    $Components = Get-Content -Raw (Join-Path $Stage 'licenses/COMPONENTS.json') | ConvertFrom-Json
    if ($Components.portableVersion -ne $Product.version -or $Components.dshVersion -ne $CoreLock.dsh.version -or $Components.dshCommit -ne $CoreLock.dsh.reviewedCommit) {
        throw 'Base package does not match the current product and reviewed kernel. Refusing a stale offline bundle.'
    }
    $LockFile = Join-Path $PSScriptRoot '../config/webview2-runtime.lock.json'
    $Capsule = Join-Path $Stage 'runtime/webview2'
    $Cache = if ($CapsuleCache) { [IO.Path]::GetFullPath($CapsuleCache) } else { $null }
    if ($Cache -and (Test-Path -LiteralPath (Join-Path $Cache 'WebView2.dshpack'))) {
        & (Join-Path $PSScriptRoot 'verify-webview2-capsule.ps1') -Root $Cache -LockFile $LockFile
        New-Item -ItemType Directory -Path $Capsule | Out-Null
        Get-ChildItem -LiteralPath $Cache -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Capsule }
    } else {
        if ($Cache -and (Test-Path -LiteralPath $Cache) -and @(Get-ChildItem -LiteralPath $Cache -Force).Count -ne 0) {
            throw 'WebView2 capsule cache is incomplete; refusing to use it.'
        }
        & (Join-Path $PSScriptRoot 'stage-webview2-runtime.ps1') -Stage $Stage -CabPath $WebView2Cab
        & (Join-Path $PSScriptRoot 'verify-webview2-capsule.ps1') -Root $Capsule -LockFile $LockFile
        if ($Cache) {
            New-Item -ItemType Directory -Force -Path $Cache | Out-Null
            Get-ChildItem -LiteralPath $Capsule -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Cache }
        }
    }
    & (Join-Path $PSScriptRoot 'verify-webview2-capsule.ps1') -Root $Capsule -LockFile $LockFile
    $Candidate = $OutputArchive + '.new.zip'
    if (Test-Path -LiteralPath $Candidate) { throw 'An unfinished output exists; inspect it before rebuilding.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($Temporary, $Candidate, [IO.Compression.CompressionLevel]::Optimal, $false)
    Move-Item -LiteralPath $Candidate -Destination $OutputArchive -Force
    $Hash = (Get-FileHash -LiteralPath $OutputArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    ($Hash + '  ' + [IO.Path]::GetFileName($OutputArchive)) | Set-Content -LiteralPath ($OutputArchive + '.sha256') -Encoding ascii
} finally {
    $ExpectedParent = [IO.Path]::GetDirectoryName($OutputArchive) + [IO.Path]::DirectorySeparatorChar
    if ([IO.Path]::GetFullPath($Temporary).StartsWith($ExpectedParent, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $Temporary -Recurse -Force
    }
}
Write-Output $OutputArchive
