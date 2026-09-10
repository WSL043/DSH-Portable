[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BaseArchive,
    [Parameter(Mandatory=$true)][string]$WebView2Cab,
    [Parameter(Mandatory=$true)][string]$OutputArchive
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
    & (Join-Path $PSScriptRoot 'stage-webview2-runtime.ps1') -Stage $Stage -CabPath $WebView2Cab
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
