param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Output,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [string]$CandidateFile = (Join-Path $PSScriptRoot 'candidate.json')
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$Output = [IO.Path]::GetFullPath($Output)
Assert-PlainPath $Output
if (Test-Path -LiteralPath $Output) { throw 'Packaging requires a fresh directory' }
$candidate = Get-Content -LiteralPath $CandidateFile -Raw | ConvertFrom-Json
$payload = Join-Path $Output "app/$($candidate.version)"
$receipt = Expand-OfficialPayload $Installer $candidate $payload $SevenZip
New-Item -ItemType Directory -Path (Join-Path $Output 'launcher') -Force | Out-Null
& (Join-Path $PSScriptRoot 'build-launcher.ps1') -Output (Join-Path $Output 'DeepSeek Harness Portable.exe')
@{ version=$candidate.version } | ConvertTo-Json | Set-Content (Join-Path $Output 'app/current.json') -Encoding UTF8
$receipt | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Output 'launcher/provenance.json') -Encoding UTF8
New-Item -ItemType Directory -Path (Join-Path $Output 'launcher/receipts') -Force | Out-Null
$receipt | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Output "launcher/receipts/$($candidate.version).json") -Encoding UTF8
Copy-Item -LiteralPath $CandidateFile -Destination (Join-Path $Output 'launcher/candidate.json')
foreach ($file in @('Payload.psm1','update.ps1','adapt-asar.cjs','desktop-adapter.mjs','update-bridge.mjs','default-plugins.mjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $Output "launcher/$file") }
foreach ($file in @('7z.exe','7z.dll','License.txt')) { Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $SevenZip) $file) -Destination (Join-Path $Output "launcher/$file") }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PACKAGE-README.md') -Destination (Join-Path $Output 'README.md')
& "$PSScriptRoot/prepare-defaults.ps1" -Root $Output -Version $candidate.version
$outer = [IO.Path]::GetFullPath($payload + '.outer')
if (-not $outer.StartsWith($Output.TrimEnd('\')+'\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction scratch escaped package root' }
Assert-PlainPath $outer
if (@(Get-ChildItem -LiteralPath $outer -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) { throw 'Redirected extraction scratch' }
Remove-Item -LiteralPath $outer -Recurse -Force
