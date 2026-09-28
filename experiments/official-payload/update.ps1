# Background preparation only. The launcher alone activates a prepared version on next start.
param([Parameter(Mandatory=$true)][string]$Root, [string]$QualificationCandidate)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
Assert-PlainPath $Root
$storage = Join-Path $Root 'data/launcher'
Assert-PlainPath $storage
if (-not (Test-Path -LiteralPath $storage)) { throw 'Launcher storage is missing' }
$lock = $null
$temporary = $null
$payload = $null
$record = $false
$status = @{ checkedAt=[DateTime]::UtcNow.ToString('o'); status='failed' }
function Write-Atomic([string]$File, $Value) {
    Assert-PlainPath $File
    $temp = $File + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 8))
        $stream = [IO.File]::Open($temp,'CreateNew','Write','None')
        try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-Path -LiteralPath $File) { [IO.File]::Replace($temp, $File, [NullString]::Value) } else { [IO.File]::Move($temp, $File) }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
}
function Is-Newer([string]$Candidate, [string]$Current) {
    $a = $Candidate.Split('-',2); $b = $Current.Split('-',2)
    $comparison = ([Version]$a[0]).CompareTo([Version]$b[0])
    if ($comparison -ne 0) { return $comparison -gt 0 }
    if ($a.Length -eq 1) { return $b.Length -gt 1 }
    if ($b.Length -eq 1) { return $false }
    $ap = $a[1].Split('.'); $bp = $b[1].Split('.')
    for ($i=0; $i -lt [Math]::Min($ap.Length,$bp.Length); $i++) {
        if ($ap[$i] -ceq $bp[$i]) { continue }
        if ($ap[$i] -match '^\d+$' -and $bp[$i] -match '^\d+$') { return [decimal]$ap[$i] -gt [decimal]$bp[$i] }
        if ($ap[$i] -match '^\d+$') { return $false }
        if ($bp[$i] -match '^\d+$') { return $true }
        return [String]::CompareOrdinal($ap[$i],$bp[$i]) -gt 0
    }
    return $ap.Length -gt $bp.Length
}
function Clear-OldPrograms {
    $appRoot = Join-Path $Root 'app'
    $current = Get-Content (Join-Path $appRoot 'current.json') -Raw | ConvertFrom-Json
    $protected = @($current.version)
    if ($current.PSObject.Properties.Name -contains 'previous') { $protected += $current.previous }
    if (Test-Path (Join-Path $appRoot 'staged.json')) { $protected += (Get-Content (Join-Path $appRoot 'staged.json') -Raw | ConvertFrom-Json).version }
    $processes = @(Get-CimInstance Win32_Process)
    foreach ($receiptFile in Get-ChildItem (Join-Path $Root 'launcher/receipts') -Filter '*.json' -ErrorAction SilentlyContinue) {
        $receipt = Get-Content -LiteralPath $receiptFile.FullName -Raw | ConvertFrom-Json
        $version = $receipt.version
        if ($version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$' -or $receiptFile.BaseName -cne $version -or $version -in $protected) { continue }
        $directory = Join-Path $appRoot $version
        $prefix = [IO.Path]::GetFullPath($directory).TrimEnd('\')+'\'
        if (@($processes | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -eq 'DeepSeek Harness.exe' -and -not $_.ExecutablePath) }).Count) { continue }
        try { Remove-PortableScratch $directory $appRoot; Remove-Item -LiteralPath $receiptFile.FullName -Force } catch { $status.cleanup='deferred' }
    }
    foreach ($scratch in Get-ChildItem -LiteralPath $appRoot -Directory | Where-Object Name -match '^\d+\.\d+\.\d+.*\.staging-[a-f0-9]{32}(\.outer)?$') {
        Remove-PortableScratch $scratch.FullName $appRoot
    }
}
try {
    $lock = [IO.File]::Open((Join-Path $storage 'update.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $statusPath = Join-Path $storage 'update-status.json'
    if ((Test-Path $statusPath) -and (Get-Item $statusPath).LastWriteTimeUtc -gt [DateTime]::UtcNow.AddHours(-1)) { return }
    $record = $true
    Clear-OldPrograms
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    # This small channel lists qualified official bytes, not repackaged installers.
    if ($QualificationCandidate) {
        if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Candidate override is only for disposable qualification runners' }
        $candidateText = Get-Content -LiteralPath $QualificationCandidate -Raw
    } else {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri 'https://raw.githubusercontent.com/WSL043/DSH-Portable/main/channels/official-desktop/windows-x64.json'
        $candidateText = $response.Content
    }
    if ($candidateText.Length -gt 16384) { throw 'Candidate metadata is too large' }
    $candidate = $candidateText | ConvertFrom-Json
    Assert-Candidate $candidate
    if ($candidate.qualification -cne 'qualified' -or $candidate.launcherProtocol -ne 1) { throw 'Candidate is not qualified for this launcher' }
    $current = Get-Content (Join-Path $Root 'app/current.json') -Raw | ConvertFrom-Json
    if (-not (Is-Newer $candidate.version $current.version)) { $status.status='current'; return }
    if (Test-Path (Join-Path $Root 'app/staged.json')) { $status.status='staged'; return }
    $temporary = Join-Path $storage ('download-' + [guid]::NewGuid().ToString('N') + '.exe')
    Get-OfficialInstaller $temporary $candidate
    $payload = Join-Path $Root ('app/' + $candidate.version + '.staging-' + [guid]::NewGuid().ToString('N'))
    $receipt = Expand-OfficialPayload $temporary $candidate $payload (Join-Path $PSScriptRoot '7z.exe')
    $destination = Join-Path $Root ('app/' + $candidate.version)
    Assert-PlainPath $destination
    if (Test-Path $destination) { throw 'Candidate directory already exists; preserving it for diagnosis' }
    $operation = $null
    try {
        $operation = [IO.File]::Open((Join-Path $Root 'data/.launch.lock'),'OpenOrCreate','ReadWrite','None')
        # Persist ownership before the move so an interruption remains recoverable.
        Write-Atomic (Join-Path $Root "launcher/receipts/$($candidate.version).json") $receipt
        [IO.Directory]::Move($payload,$destination)
        Write-Atomic (Join-Path $Root 'app/staged.json') @{version=$candidate.version;from=$current.version;receipt=$receipt}
    } finally { if ($operation) { $operation.Dispose() } }
    $status.status='staged';$status.version=$candidate.version
} catch { $status.error=$_.Exception.Message }
finally {
    if ($lock) {
        if ($temporary -and (Test-Path -LiteralPath $temporary)) { Assert-PlainPath $temporary; Remove-Item -LiteralPath $temporary -Force }
        if ($payload) {
            foreach ($scratch in @($payload,($payload+'.outer'))) {
                $resolved = [IO.Path]::GetFullPath($scratch)
                if (-not $resolved.StartsWith((Join-Path $Root 'app')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Staging escaped app root' }
                if (Test-Path -LiteralPath $resolved) {
                    Assert-PlainPath $resolved
                    if (@(Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -eq 0) { Remove-Item -LiteralPath $resolved -Recurse -Force }
                }
            }
        }
        if ($record) { Write-Atomic (Join-Path $storage 'update-status.json') $status }
        $lock.Dispose()
    }
}
