param(
    [Parameter(Mandatory=$true)][string]$Root,
    [string]$Version,
    [Parameter(Mandatory=$true)][string]$SelfPath,
    [switch]$Install,
    [string]$CancelFile
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
Assert-PlainPath $Root
if ($Root.Length -le 3 -or $Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$') { throw 'Invalid update root or version' }
$appRoot = Join-Path $Root 'app'; $launcherRoot = Join-Path $Root 'launcher'; $storage = Join-Path $Root 'data/launcher'
foreach ($path in @($appRoot, $launcherRoot, $storage)) { Assert-PlainPath $path }
$statusPath = Join-Path $storage 'update-status.json'; $currentPath = Join-Path $appRoot 'current.json'
$lock = $null; $stage = $null; $partial = $null; $candidatePath = $null
$originalVersion = $null; $committed = $false; $status = [ordered]@{ status='starting'; phase='initializing'; version=$Version; downloadedBytes=0; totalBytes=0; progress=0 }

function Write-Atomic([string]$Path, $Value) {
    Assert-PlainPath $Path
    $temp = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 10))
        $stream = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp, $Path, [NullString]::Value) } else { [IO.File]::Move($temp, $Path) }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
}

function Get-StrictJson([string]$Url) {
    return ((Read-BoundedHttpText $Url) | ConvertFrom-Json)
}

function Get-Processes([string]$Kind) {
    $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    if ($Kind -eq 'app') {
        $prefix = [IO.Path]::GetFullPath($appRoot).TrimEnd('\') + '\'
        return @($all | Where-Object { ($_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -ceq 'DeepSeek Harness.exe' -and -not $_.ExecutablePath) })
    }
    $launcherExe = [IO.Path]::GetFullPath((Join-Path $Root 'DeepSeek Harness Portable.exe'))
    return @($all | Where-Object { $_.Name -ceq 'DeepSeek Harness Portable.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($launcherExe,[StringComparison]::OrdinalIgnoreCase) })
}

function Wait-NoOwnedProcesses {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        if (@(Get-Processes 'app').Count -eq 0 -and @(Get-Processes 'launcher').Count -eq 0) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Portable application or root launcher is still running after 60 seconds'
}

function Update-RootLauncher([string]$Source) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw 'Updated launcher copy is missing' }
    $destination = Join-Path $Root 'DeepSeek Harness Portable.exe'
    if (-not (Test-Path -LiteralPath $destination)) { throw 'Root launcher is missing; refusing to change the current app version' }
    try { $newVersion = [Reflection.AssemblyName]::GetAssemblyName($Source).Version; $oldVersion = [Reflection.AssemblyName]::GetAssemblyName($destination).Version } catch { return }
    if ($newVersion -le $oldVersion) { return }
    Wait-NoOwnedProcesses
    $newFile = Join-Path $launcherRoot ('.DeepSeek Harness Portable.' + [guid]::NewGuid().ToString('N') + '.new')
    $backup = Join-Path $launcherRoot 'DeepSeek Harness Portable.exe.previous'
    Assert-PlainPath $newFile; Assert-PlainPath $backup
    [IO.File]::Copy($Source, $newFile, $false)
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    try { [IO.File]::Replace($newFile, $destination, $backup) }
    catch {
        if (Test-Path $backup) {
            try { [IO.File]::Replace($backup, $destination, [NullString]::Value) } catch { }
        }
        if (Test-Path $newFile) { Remove-Item $newFile -Force }
        throw 'Could not atomically replace the portable launcher'
    }
}

function Clear-OlderVersions([string]$KeepCurrent, [string]$KeepPrevious) {
    $names = @((Get-ChildItem -LiteralPath $appRoot -Directory).Name)
    foreach ($name in Get-VersionRetentionPlan $names $KeepCurrent $KeepPrevious) {
        Remove-PortableScratch (Join-Path $appRoot $name) $appRoot
    }
    $receipts = Join-Path $launcherRoot 'receipts'
    if (Test-Path $receipts) {
        foreach ($file in Get-ChildItem -LiteralPath $receipts -Filter '*.json' -File) {
            if ($file.BaseName -notin @($KeepCurrent, $KeepPrevious)) { Assert-PlainPath $file.FullName; Remove-Item -LiteralPath $file.FullName -Force }
        }
    }
}

try {
    foreach ($path in @($appRoot, $launcherRoot, $storage, (Join-Path $storage 'downloads'))) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    $lock = [IO.File]::Open((Join-Path $storage 'update.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $current = $null
    if (Test-Path -LiteralPath $currentPath) {
        $current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
        $currentVersion = [string]$current.version
        if ($currentVersion -match '^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$' -and (Test-Path -LiteralPath (Join-Path $appRoot ($currentVersion + '/DeepSeek Harness.exe')))) { $originalVersion = $currentVersion }
    }
    if (-not $Install) {
        if (-not $current -or -not $originalVersion) { throw 'Current app version is missing or incomplete' }
        $Version = [string]$Version
        if ($null -ne $current.PSObject.Properties['rejected'] -and [string]$current.rejected.version -ceq $Version) {
            $rejectedAt = [DateTime]::MinValue
            if ([DateTime]::TryParse([string]$current.rejected.at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$rejectedAt) -and ([DateTime]::UtcNow - $rejectedAt.ToUniversalTime()).TotalHours -lt 24) { throw 'This version was rolled back within the last 24 hours; not retrying yet' }
        }
        if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$') { throw 'Invalid update version' }
    }
    $follow = Get-Content -LiteralPath (Join-Path $launcherRoot 'follow.json') -Raw | ConvertFrom-Json
    Assert-FeedUrl ([string]$follow.indexUrl); Assert-FeedUrl ([string]$follow.feedUrl)
    if ([string]$follow.cacheDirName -notmatch '^[A-Za-z0-9._@-]{1,100}$' -or [string]$follow.cacheDirName -in @('.', '..') -or -not ([string]$follow.feedUrl).EndsWith('/')) { throw 'Invalid updater cache directory name or feed URL' }
    $status.status = 'reading-index'; $status.phase = 'reading-index'; Write-Atomic $statusPath $status
    $index = Get-StrictJson ([string]$follow.indexUrl)
    if ($Install) { $candidate = Get-LatestAcceptedIndexCandidate $index; $Version = [string]$candidate.version; $status.version = $Version }
    else { $candidate = Get-AcceptedIndexCandidate $index $Version }
    $partial = Join-Path $appRoot ($Version + '.partial'); $candidatePath = Join-Path $appRoot $Version
    if (Test-Path -LiteralPath $candidatePath) { throw 'Target application directory already exists; preserving current state' }
    if (Test-Path -LiteralPath $partial) { throw 'Stale partial directory exists; refusing to overwrite it' }
    $stage = Join-Path $storage ('staging/' + $Version + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $installer = Join-Path (Join-Path $storage 'downloads') ('deepseek-harness-' + $Version + '-win-x64.exe')
    $status.status = 'downloading'; $status.phase = 'downloading'; $status.downloadedBytes = 0; $status.totalBytes = [long]$candidate.size; $status.progress = 0; Write-Atomic $statusPath $status
    Get-OfficialInstaller $installer $candidate { param($downloaded,$total) $status.downloadedBytes = [long]$downloaded; $status.totalBytes = [long]$total; $status.progress = [Math]::Floor(100 * $downloaded / $total); if ($downloaded -ge $total) { $status.phase = 'verifying' }; Write-Atomic $statusPath $status } $CancelFile | Out-Null
    if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation cancelled' }
    $status.status = 'extracting'; $status.phase = 'extracting'; Write-Atomic $statusPath $status
    $receipt = Expand-OfficialPayload $installer $candidate $partial (Join-Path $launcherRoot '7z.exe') ([string]$follow.feedUrl) ([string]$follow.cacheDirName)
    if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation cancelled' }
    $status.status = 'switching'; $status.phase = 'switching'; Write-Atomic $statusPath $status
    if (-not $Install) { $status.status = 'waiting-for-exit'; $status.phase = 'waiting-for-exit'; Write-Atomic $statusPath $status; Wait-NoOwnedProcesses }
    $receiptPath = Join-Path $launcherRoot ('receipts/' + $Version + '.json')
    if (-not (Test-Path (Split-Path -Parent $receiptPath))) { New-Item -ItemType Directory -Path (Split-Path -Parent $receiptPath) -Force | Out-Null }
    Write-Atomic $receiptPath $receipt
    [IO.Directory]::Move($partial, $candidatePath)
    try {
        if ($Install -and $CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation cancelled' }
        Update-RootLauncher $SelfPath
        $previous = if ($originalVersion) { [string]$originalVersion } else { $null }
        $next = [ordered]@{ version=$Version; previous=$previous; pendingHealth=$true; switchedAt=[DateTime]::UtcNow.ToString('o') }
        if ($Install -and $CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation cancelled' }
        Write-Atomic $currentPath $next
        $committed = $true
        Clear-OlderVersions $Version $previous
        Remove-PortableScratch $stage $storage; $stage = $null
        if (Test-Path -LiteralPath $installer) { Remove-Item -LiteralPath $installer -Force }
        if (Test-Path -LiteralPath ($installer + '.part')) { Remove-Item -LiteralPath ($installer + '.part') -Force }
        $status.status = 'applied'; $status.phase = 'applied'; Write-Atomic $statusPath $status
    } catch {
        if ($committed) {
            try { if ($current) { Write-Atomic $currentPath $current } else { Remove-Item -LiteralPath $currentPath -Force -ErrorAction SilentlyContinue }; $committed = $false } catch { }
        }
        if (-not $committed -and (Test-Path $candidatePath)) { Remove-PortableScratch $candidatePath $appRoot }
        if (-not $committed -and (Test-Path $receiptPath)) { Remove-Item $receiptPath -Force }
        throw
    }
} catch {
    $message = $_.Exception.Message
    if (-not [string]::IsNullOrEmpty($Root)) { $message = $message.Replace($Root, '<portable-root>') }
    $message = $message -replace '(?i)(token|password|secret|authorization)\s*[:=]\s*\S+', '$1=<redacted>'
    $status.status = if ($message -match '(?i)cancelled') { 'cancelled' } else { 'failed' }; $status.phase = $status.status; $status.error = $message
} finally {
    if (-not $committed -and $partial -and (Test-Path -LiteralPath $partial)) {
        try { Remove-PortableScratch $partial $appRoot } catch { }
    }
    if ($stage -and (Test-Path -LiteralPath $stage)) { try { Remove-PortableScratch $stage $storage } catch { } }
    if ($lock) { $lock.Dispose() }
    try { Write-Atomic $statusPath $status } catch { }
}
if ($status.status -eq 'failed') { exit 1 }
exit 0
