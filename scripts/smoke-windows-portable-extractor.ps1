[CmdletBinding()]
param(
    [string]$Extractor = (Join-Path (Join-Path $PSScriptRoot '..') 'artifacts\DSH-Portable-windows-x64.exe')
)

$ErrorActionPreference = 'Stop'
$Extractor = [System.IO.Path]::GetFullPath($Extractor)
if (-not (Test-Path -LiteralPath $Extractor)) { throw "Portable self-extractor is missing: $Extractor" }

$TestId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$TestParent = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-portable-extractor-$TestId")
$UnicodeMarker = [char]0x00FC
$ExtractRoot = Join-Path $TestParent ("DSH Portable extracted $UnicodeMarker")
$MovedRoot = "$ExtractRoot moved $UnicodeMarker"
$SetupLog = Join-Path $TestParent 'extractor.log'
New-Item -ItemType Directory -Force -Path $TestParent | Out-Null

Write-Host '::group::Extract portable package'
# Windows PowerShell 5.1 joins an ArgumentList array into one command line and
# does not preserve the element boundary around values containing spaces. Inno
# Setup requires the quotes to be part of that final command line.
$ExtractorArguments = '/SP- /VERYSILENT /SUPPRESSMSGBOXES /NOCANCEL /NORESTART /CURRENTUSER /DIR="{0}" /LOG="{1}"' -f $ExtractRoot, $SetupLog
$Process = Start-Process -FilePath $Extractor -ArgumentList $ExtractorArguments -PassThru
try {
    if (-not $Process.WaitForExit(300000)) {
        & taskkill.exe /PID $Process.Id /T /F 2>&1 | ForEach-Object { Write-Host $_ }
        $Process.WaitForExit(10000) | Out-Null
        throw 'portable extraction timed out after 300 seconds'
    }
    $Process.Refresh()
    if ($Process.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $SetupLog) {
            Get-Content -LiteralPath $SetupLog |
                Where-Object { $_ -notmatch '^\d{4}-\d{2}-\d{2} .+\s+Deleting (?:file|directory):' } |
                Select-Object -Last 400 |
                ForEach-Object { Write-Host $_ }
        }
        throw "portable extraction exited with code $($Process.ExitCode)"
    }
} finally {
    Write-Host '::endgroup::'
}

foreach ($Name in @(
    'DeepSeek-Herness.exe',
    'Stop DeepSeek-Herness.exe',
    'runtime\node\node.exe',
    'data\README.txt',
    'workspace\README.txt',
    'app\node_modules\@earendil-works\pi-ai\dist\providers\data\amazon-bedrock.json'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $ExtractRoot $Name))) { throw "portable file is missing: $Name" }
}
if (Test-Path -LiteralPath (Join-Path $ExtractRoot 'installed-mode.json')) {
    throw 'portable extraction incorrectly contains installed-mode.json'
}
if (Get-ChildItem -LiteralPath $ExtractRoot -Filter 'unins*.exe' -File) {
    throw 'portable extraction created an uninstaller'
}

Write-Host '::group::Run movable portable smoke test'
try {
    $PortableNode = Join-Path $ExtractRoot 'runtime\node\node.exe'
    & $PortableNode (Join-Path $PSScriptRoot 'smoke-portable.mjs') $ExtractRoot
    if ($LASTEXITCODE -ne 0) { throw "portable smoke test failed with exit code $LASTEXITCODE" }
} finally {
    Write-Host '::endgroup::'
}

if (-not (Test-Path -LiteralPath (Join-Path $MovedRoot 'data\portable.json'))) {
    throw 'portable state did not move with the extracted folder'
}

[pscustomobject]@{
    Extractor = $Extractor
    ExtractedRoot = $MovedRoot
    Status = 'passed'
}
