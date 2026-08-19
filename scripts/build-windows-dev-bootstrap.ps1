[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestUrl,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot 'artifacts' }
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$SourcePath = Join-Path $ProjectRoot 'launcher\windows\DSH-Bootstrap.cs'
$ManifestPath = Join-Path $ProjectRoot 'launcher\windows\DSH-Portable.manifest'
$IconPath = Join-Path $ProjectRoot 'assets\DSH-Portable.ico'
$Original = [System.IO.File]::ReadAllText($SourcePath)
$Patched = $Original
$StableManifest = 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-manifest.json'

$Count = ([regex]::Matches($Patched, [regex]::Escape($StableManifest))).Count
if ($Count -ne 1) {
    throw "Expected exactly one stable bootstrap manifest URL, found $Count."
}
$Patched = $Patched.Replace($StableManifest, $ManifestUrl)

$Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc)) { $Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $Csc)) { throw 'The Windows .NET Framework C# compiler is unavailable.' }

$Output = Join-Path $OutputDir 'DSH-Portable-windows-x64-dev-bootstrap.exe'
try {
    [System.IO.File]::WriteAllText($SourcePath, $Patched, [System.Text.UTF8Encoding]::new($false))
    $CompilerArgs = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
        "/win32icon:$IconPath",
        "/win32manifest:$ManifestPath",
        '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll',
        '/reference:System.Windows.Forms.dll', '/reference:System.Net.Http.dll',
        '/reference:System.Runtime.Serialization.dll', '/reference:System.IO.Compression.dll',
        "/out:$Output",
        $SourcePath
    )
    & $Csc $CompilerArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Output)) {
        throw 'Development bootstrap compilation failed.'
    }
} finally {
    [System.IO.File]::WriteAllText($SourcePath, $Original, [System.Text.UTF8Encoding]::new($false))
}

$Size = (Get-Item -LiteralPath $Output).Length
if ($Size -ge 1MB) { throw "Development bootstrap exceeded 1 MiB: $Size bytes" }
$Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash.ToLowerInvariant()
"$Hash  DSH-Portable-windows-x64-dev-bootstrap.exe" | Set-Content -LiteralPath ($Output + '.sha256') -Encoding ascii -NoNewline
Write-Host "Development bootstrap: $Output ($Size bytes)"
Write-Host "SHA-256: $Hash"
