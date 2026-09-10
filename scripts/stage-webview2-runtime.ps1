[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Stage,
    [Parameter(Mandatory=$true)][string]$CabPath
)
$ErrorActionPreference = 'Stop'
$Stage = [IO.Path]::GetFullPath($Stage)
$Lock = Get-Content -Raw (Join-Path $PSScriptRoot '../config/webview2-runtime.lock.json') | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $CabPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Lock.sha256) {
    throw 'WebView2 CAB does not match the reviewed runtime lock.'
}
$Destination = Join-Path $Stage 'runtime/webview2'
if (Test-Path -LiteralPath $Destination) { throw 'WebView2 destination already exists; use a fresh stage.' }
$Temporary = Join-Path $Stage ('.webview2-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temporary | Out-Null
try {
    & expand.exe $CabPath '-F:*' $Temporary | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'WebView2 extraction failed.' }
    $Runtime = Join-Path $Temporary ('Microsoft.WebView2.FixedVersionRuntime.' + $Lock.version + '.' + $Lock.architecture)
    $Browser = Join-Path $Runtime 'msedgewebview2.exe'
    $Signature = Get-AuthenticodeSignature -LiteralPath $Browser
    if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'WebView2 executable has no valid Microsoft signature.'
    }
    & (Join-Path $Stage 'runtime/node/node.exe') (Join-Path $PSScriptRoot 'create-webview2-capsule.mjs') $Runtime $Destination
    if ($LASTEXITCODE -ne 0) { throw 'WebView2 capsule creation failed.' }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../config/webview2-runtime.lock.json') -Destination (Join-Path $Destination 'portable-runtime.json')
} finally {
    # The exact generated child is inside the verified stage, never a user path.
    if ([IO.Path]::GetFullPath($Temporary).StartsWith($Stage + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $Temporary -Recurse -Force
    }
}
Write-Output ('Staged Microsoft WebView2 ' + $Lock.version)
