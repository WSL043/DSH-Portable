param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Output,
    [Parameter(Mandatory=$true)][string]$SevenZip
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$Output = [IO.Path]::GetFullPath($Output)
Assert-PlainPath $Output
if (Test-Path -LiteralPath $Output) { throw 'Packaging requires a fresh directory' }
$candidate = Get-Content (Join-Path $PSScriptRoot 'candidate.json') -Raw | ConvertFrom-Json
$payload = Join-Path $Output "app/$($candidate.version)"
$receipt = Expand-OfficialPayload $Installer $candidate $payload $SevenZip
New-Item -ItemType Directory -Path (Join-Path $Output 'launcher') -Force | Out-Null
& (Join-Path $PSScriptRoot 'build-launcher.ps1') -Output (Join-Path $Output 'DeepSeek Harness Portable.exe')
@{ version=$candidate.version } | ConvertTo-Json | Set-Content (Join-Path $Output 'app/current.json') -Encoding UTF8
$receipt | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Output 'launcher/provenance.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'candidate.json') -Destination (Join-Path $Output 'launcher/candidate.json')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $Output 'README.md')
# The extraction scratch directory is outside the final payload. Never include it in a ZIP.
# It remains owned by the caller until evidence has been collected and cleanup is authorized.
