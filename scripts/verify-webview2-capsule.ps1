[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][string]$LockFile
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$LockFile = [IO.Path]::GetFullPath($LockFile)
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw 'WebView2 capsule directory is missing.' }
function Get-Sha256([string]$Filename) {
    $Hasher = [Security.Cryptography.SHA256]::Create()
    $Stream = [IO.File]::OpenRead($Filename)
    try { return [BitConverter]::ToString($Hasher.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
    finally { $Stream.Dispose(); $Hasher.Dispose() }
}

$Expected = @('WebView2.dshpack', 'runtime-capsule.json', 'portable-runtime.json')
$Files = @(Get-ChildItem -LiteralPath $Root -Force)
if (@($Files | Where-Object { $_.PSIsContainer -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }).Count -ne 0) {
    throw 'WebView2 capsule cache contains a directory or link.'
}
$Actual = @($Files | ForEach-Object Name | Sort-Object)
if (@(Compare-Object -ReferenceObject ($Expected | Sort-Object) -DifferenceObject $Actual).Count -ne 0) {
    throw 'WebView2 capsule cache has missing or unexpected files.'
}

$Lock = Get-Content -Raw -LiteralPath $LockFile | ConvertFrom-Json
$Manifest = Get-Content -Raw -LiteralPath (Join-Path $Root 'runtime-capsule.json') | ConvertFrom-Json
$Payload = Join-Path $Root 'WebView2.dshpack'
if ($Manifest.schemaVersion -ne 1 -or $Manifest.format -ne 'dshpack-zstd-v1' -or
    $Manifest.filename -ne 'WebView2.dshpack' -or $Manifest.platform -ne 'win32' -or $Manifest.arch -ne 'x64' -or
    $Manifest.sha256 -ne $Lock.capsule.sha256 -or $Manifest.bytes -ne $Lock.capsule.bytes -or
    $Manifest.rawBytes -ne $Lock.capsule.rawBytes -or $Manifest.fileCount -ne $Lock.capsule.fileCount -or
    (@($Manifest.required) -join '|') -ne 'app/msedgewebview2.exe|app/msedge.dll') {
    throw 'WebView2 capsule metadata does not match the reviewed lock.'
}
if ((Get-Item -LiteralPath $Payload).Length -ne $Lock.capsule.bytes -or
    (Get-Sha256 $Payload) -ne $Lock.capsule.sha256) {
    throw 'WebView2 capsule bytes do not match the reviewed lock.'
}
if ((Get-Sha256 (Join-Path $Root 'portable-runtime.json')) -ne (Get-Sha256 $LockFile)) {
    throw 'WebView2 capsule cache belongs to another runtime lock.'
}
Write-Output ('Verified WebView2 capsule ' + $Lock.capsule.sha256)
