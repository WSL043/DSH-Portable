param(
    [Parameter(Mandatory=$true)][string]$Root,
    [string]$Version,
    [Parameter(Mandatory=$true)][string]$SelfPath,
    [switch]$Install,
    [string]$CancelFile,
    [string]$InstallerFile,
    [string]$IndexFile,
    [switch]$Repair,
    [switch]$Rollback,
    [switch]$Recover,
    [ValidateRange(0, 2147483647)][int]$MaintenanceCallerPid = 0
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
Assert-PlainPath $Root
# A first install (-Install) picks the newest accepted version from the index, so only an update needs a version up front.
$versionPattern = '^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$'
if ($Root.Length -le 3 -or ($Version -and $Version -notmatch $versionPattern)) { throw 'Invalid update root or version' }
if (@(@($Install, $Repair, $Rollback, $Recover) | Where-Object { $_ }).Count -gt 1) { throw 'Install, repair, rollback and recovery are mutually exclusive' }
if ($IndexFile -and -not $InstallerFile) { throw 'A local index requires a local installer' }
if (($Rollback -or $Recover) -and ($InstallerFile -or $IndexFile -or $Version)) { throw 'Rollback and recovery do not accept an external candidate' }
if (-not ($Install -or $Repair -or $Rollback -or $Recover -or $InstallerFile) -and -not $Version) { throw 'An update requires a version' }
$appRoot = Join-Path $Root 'app'; $launcherRoot = Join-Path $Root 'launcher'; $storage = Join-Path $Root 'data/launcher'
if ($InstallerFile -and -not $IndexFile) { $IndexFile = Join-Path $launcherRoot 'accepted-index.json' }
foreach ($path in @($appRoot, $launcherRoot, $storage)) { Assert-PlainPath $path }
$statusPath = Join-Path $storage 'update-status.json'; $currentPath = Join-Path $appRoot 'current.json'
$lock = $null; $activation = $null; $sourceLease = $null; $partial = $null; $candidatePath = $null; $ownsPartial = $false
$statusWritable = $false
$originalVersion = $null; $committed = $false; $status = [ordered]@{ status='starting'; phase='initializing'; version=$Version; downloadedBytes=0; totalBytes=0; progress=0 }

# A flaky connection (weak Wi-Fi, a proxy that drops idle sockets) should not make the user press Retry: resume the
# partial download a few times with a growing pause. Cancellation, integrity and publisher failures are never retried.
function Invoke-WithNetworkRetry([scriptblock]$Action, [int]$Attempts = 4) {
    for ($attempt = 1; ; $attempt++) {
        try { & $Action; return } catch {
            $message = [string]$_.Exception.Message
            $permanent = $message -match '(?i)cancelled|digest mismatch|publisher|size mismatch|redirects require|invalid byte range|unexpected installer response|server did not honor'
            $transient = $message -match '(?i)timed out|timeout|unable to read|transport|connection|download is incomplete|exceeded bounds|could not be resolved|remote server|forcibly closed|reset'
            # .NET messages are localized, and PowerShell wraps GetResponse/Read failures.
            # Recognize known network statuses without retrying every IO exception.
            for ($failure = $_.Exception; $failure; $failure = $failure.InnerException) {
                if ($failure -is [Net.WebException] -and [string]$failure.Status -in @('Timeout', 'ConnectFailure', 'NameResolutionFailure', 'ProxyNameResolutionFailure', 'ConnectionClosed', 'KeepAliveFailure', 'ReceiveFailure', 'SendFailure')) {
                    $transient = $true; break
                }
                if ($failure -is [Net.WebException] -and $failure.Status -eq [Net.WebExceptionStatus]::ProtocolError -and $failure.Data['DshPortableInstallerHttpStatus'] -is [int] -and $failure.Data['DshPortableInstallerHttpStatus'] -in @(408, 429, 500, 502, 503, 504)) {
                    $transient = $true; break
                }
            }
            if ($permanent -or -not $transient -or $attempt -ge $Attempts) { throw }
            $script:status.retry = $attempt; Write-Atomic $statusPath $script:status
            $until = [DateTime]::UtcNow.AddSeconds(2 * [Math]::Pow(2, $attempt - 1))
            while ([DateTime]::UtcNow -lt $until) {
                if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation cancelled' }
                Start-Sleep -Milliseconds 250
            }
            $script:status.retry = 0; Write-Atomic $statusPath $script:status
        }
    }
}

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

function Get-Processes([string]$Kind, [object[]]$Snapshot = $null) {
    $all = if ($null -eq $Snapshot) { @(Get-CimInstance Win32_Process -Property Name, ExecutablePath, ProcessId -ErrorAction Stop) } else { $Snapshot }
    if ($Kind -eq 'app') {
        $prefix = [IO.Path]::GetFullPath($appRoot).TrimEnd('\') + '\'
        return @($all | Where-Object { ($_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -ceq 'DeepSeek Harness.exe' -and -not $_.ExecutablePath) })
    }
    if ($Kind -eq 'extractor') {
        $extractorExe = [IO.Path]::GetFullPath((Join-Path $launcherRoot '7z.exe'))
        return @($all | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($extractorExe, [StringComparison]::OrdinalIgnoreCase) })
    }
    $launcherExe = [IO.Path]::GetFullPath((Join-Path $Root 'DeepSeek Harness Portable.exe'))
    return @($all | Where-Object { $_.Name -ceq 'DeepSeek Harness Portable.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($launcherExe,[StringComparison]::OrdinalIgnoreCase) })
}

function Assert-NoExtractionWriters {
    if (@(Get-Processes 'extractor').Count -gt 0) { throw 'Portable extraction writer is still running; preserving extraction scratch' }
}

function Wait-NoOwnedProcesses {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        $snapshot = @(Get-CimInstance Win32_Process -Property Name, ExecutablePath, ProcessId -ErrorAction Stop)
        if (@(Get-Processes 'app' $snapshot).Count -eq 0 -and @(Get-Processes 'launcher' $snapshot | Where-Object { $_.ProcessId -ne $MaintenanceCallerPid }).Count -eq 0) { return }
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
    return Remove-OwnedOlderPayloads $appRoot (Join-Path $launcherRoot 'receipts') $KeepCurrent $KeepPrevious
}

function Get-CurrentHash {
    Assert-PlainPath $currentPath
    if (Test-Path -LiteralPath $currentPath -PathType Leaf) { return (Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash }
    if (Test-Path -LiteralPath $currentPath) { throw 'Current application state is not a regular file' }
    return $null
}

function Assert-UnchangedCurrent($ExpectedHash) {
    if ((Get-CurrentHash) -cne $ExpectedHash) { throw 'Current application state changed during preparation; preserving it' }
}

function Read-PayloadReceipt([string]$RequestedVersion) {
    $path = Join-Path $launcherRoot ('receipts/' + $RequestedVersion + '.json')
    Assert-PlainPath $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -gt 1048576) { throw 'Payload ownership receipt is missing or too large' }
    return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
}

# A single activation record lives in the existing status file. Paths are derived from
# validated versions; a saved record never grants authority over an arbitrary path.
function Complete-Transition($Transition) {
    if ($Transition.schemaVersion -ne 1 -or $Transition.operation -notin @('install', 'update', 'repair', 'rollback') -or [string]$Transition.version -notmatch $versionPattern -or $Transition.phase -notin @('extracting', 'prepared')) { throw 'Invalid pending activation record; preserving it' }
    $targetVersion = [string]$Transition.version
    $target = Join-Path $appRoot $targetVersion
    $prepared = Join-Path $appRoot ($targetVersion + '.partial')
    $backup = Join-Path $appRoot ($targetVersion + '.repair-backup')
    $receiptPath = Join-Path $launcherRoot ('receipts/' + $targetVersion + '.json')
    foreach ($path in @($target, $prepared, $backup, $receiptPath)) { Assert-PlainPath $path }
    if ($Transition.phase -eq 'extracting') {
        Assert-UnchangedCurrent $Transition.currentSha256
        Assert-NoExtractionWriters
        # This record was flushed before this attempt could create any extraction path.
        foreach ($scratch in @($prepared, ($prepared + '.outer'), ($prepared + '.verify'))) {
            if (Test-Path -LiteralPath $scratch) { Remove-PortableScratch $scratch $appRoot }
        }
        $script:status.transition = $null
        $script:status.status = 'recovered'; $script:status.phase = 'recovered'
        Write-Atomic $statusPath $script:status
        return
    }
    if ([string]$Transition.next.version -cne $targetVersion -or $null -eq $Transition.receipt -or [string]$Transition.receipt.version -cne $targetVersion) { throw 'Pending activation identity is inconsistent; preserving it' }
    Wait-NoOwnedProcesses
    $activationPath = Join-Path $storage 'activation.lock'; Assert-PlainPath $activationPath
    $script:activation = [IO.File]::Open($activationPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    # A protocol handoff can start a process after the wait and release its shared
    # lease before this exclusive open. Recheck while no new handoff can enter.
    $snapshot = @(Get-CimInstance Win32_Process -Property Name, ExecutablePath, ProcessId -ErrorAction Stop)
    if (@(Get-Processes 'app' $snapshot).Count -gt 0 -or @(Get-Processes 'launcher' $snapshot | Where-Object { $_.ProcessId -ne $MaintenanceCallerPid }).Count -gt 0) { throw 'Portable started during activation; exit it before recovering this operation' }
    $alreadyCommitted = $false
    if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
        $live = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
        $alreadyCommitted = ($live | ConvertTo-Json -Depth 10 -Compress) -ceq ($Transition.next | ConvertTo-Json -Depth 10 -Compress)
    }
    if (-not $alreadyCommitted) { Assert-UnchangedCurrent $Transition.currentSha256 }
    if ($Transition.operation -eq 'rollback') {
        Assert-ReceiptedPayload $target $Transition.receipt $targetVersion
    } else {
        $targetIsPrepared = $false
        if (Test-Path -LiteralPath $target -PathType Container) {
            try { Assert-ReceiptedPayload $target $Transition.receipt $targetVersion; $targetIsPrepared = $true } catch { }
        }
        if ($alreadyCommitted -and -not $targetIsPrepared) { throw 'Committed application no longer matches its receipt; preserving activation record' }
        if ($targetIsPrepared -and (Test-Path -LiteralPath $prepared)) {
            if ($Transition.operation -eq 'repair' -and -not (Test-Path -LiteralPath $backup)) { $targetIsPrepared = $false }
            else { throw 'Both prepared and installed candidates exist; preserving them' }
        }
        if (-not $targetIsPrepared) {
            Assert-ReceiptedPayload $prepared $Transition.receipt $targetVersion
            if ($Transition.operation -eq 'repair') {
                $backupReceipt = $receiptPath + '.repair-backup'; Assert-PlainPath $backupReceipt
                if ($Transition.originalReceiptSha256) {
                    if (Test-Path -LiteralPath $backupReceipt) {
                        if ((Get-FileHash -LiteralPath $backupReceipt -Algorithm SHA256).Hash -cne $Transition.originalReceiptSha256) { throw 'Repair receipt preservation slot conflicts; preserving it' }
                    } else {
                        if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf) -or (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash -cne $Transition.originalReceiptSha256) { throw 'Original repair receipt changed; preserving it' }
                        [IO.File]::Copy($receiptPath, $backupReceipt, $false)
                    }
                } elseif (Test-Path -LiteralPath $backupReceipt) { throw 'Unexpected repair receipt preservation slot exists' }
                if (Test-Path -LiteralPath $target) {
                    if (-not $Transition.hadTarget -or (Test-Path -LiteralPath $backup)) { throw 'Repair target preservation slot conflicts; preserving both trees' }
                    if ((Get-PortablePayloadTreeHash $target) -cne $Transition.originalTreeSha256) { throw 'Repair target changed during preparation; preserving it' }
                    [IO.Directory]::Move($target, $backup)
                } elseif ($Transition.hadTarget) {
                    if (-not (Test-Path -LiteralPath $backup -PathType Container) -or (Get-PortablePayloadTreeHash $backup) -cne $Transition.originalTreeSha256) { throw 'Preserved repair target is missing or changed' }
                } elseif (Test-Path -LiteralPath $backup) { throw 'Unexpected repair target preservation slot exists' }
            } elseif (Test-Path -LiteralPath $target) { throw 'Target application directory already exists; preserving current state' }
            [IO.Directory]::Move($prepared, $target)
        }
        if (-not (Test-Path -LiteralPath (Split-Path -Parent $receiptPath))) { New-Item -ItemType Directory -Path (Split-Path -Parent $receiptPath) -Force | Out-Null }
        Write-Atomic $receiptPath $Transition.receipt
    }
    if (-not $alreadyCommitted) {
        # Never overwrite a concurrent current.json writer, including after a lengthy tree check.
        Assert-UnchangedCurrent $Transition.currentSha256
        Write-Atomic $currentPath $Transition.next
    }
    $script:committed = $true
    $script:status.status = 'applied'; $script:status.phase = 'applied'; $script:status.version = $targetVersion
    $script:status.operation = [string]$Transition.operation
    if ($Transition.operation -eq 'repair' -and $Transition.hadTarget) { $script:status.preservedProgram = $backup }
    # Only drop the in-memory record after the completion write succeeds. A status
    # sharing failure must leave enough information for the next recovery attempt.
    $completedStatus = [ordered]@{}
    foreach ($key in $script:status.Keys) { $completedStatus[$key] = $script:status[$key] }
    $completedStatus.transition = $null
    Write-Atomic $statusPath $completedStatus
    $script:status = $completedStatus
}

try {
    foreach ($path in @($appRoot, $launcherRoot, $storage, (Join-Path $storage 'downloads'))) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    if ($MaintenanceCallerPid) {
        $caller = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $MaintenanceCallerPid) -ErrorAction Stop
        $expectedCaller = [IO.Path]::GetFullPath((Join-Path $Root 'DeepSeek Harness Portable.exe'))
        if (-not $caller -or -not $caller.ExecutablePath -or -not [IO.Path]::GetFullPath($caller.ExecutablePath).Equals($expectedCaller, [StringComparison]::OrdinalIgnoreCase)) { throw 'Maintenance caller is not the root portable launcher' }
    }
    $lock = [IO.File]::Open((Join-Path $storage 'update.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
        Assert-PlainPath $statusPath
        if ((Get-Item -LiteralPath $statusPath).Length -gt 1048576) { throw 'Update status is too large; preserving it' }
        $saved = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        $statusWritable = $true
        if ($null -ne $saved.PSObject.Properties['transition'] -and $null -ne $saved.transition) {
            $status.transition = $saved.transition
            Complete-Transition $saved.transition
            if ($activation) { $activation.Dispose(); $activation = $null }
            # Re-entry consumes exactly the pending operation. It never starts a second one.
            return
        }
    }
    $statusWritable = $true
    if ($Recover) { $status.status = 'recovered'; $status.phase = 'recovered'; return }
    $current = $null; $currentHash = Get-CurrentHash
    if ($currentHash) { $current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json }
    if ($current) {
        $currentVersion = [string]$current.version
        if ($currentVersion -notmatch $versionPattern) { throw 'Current application version is invalid' }
        $originalVersion = $currentVersion
    }
    $operation = if ($Rollback) { 'rollback' } elseif ($Repair) { 'repair' } elseif ($Install) { 'install' } else { 'update' }
    $status.operation = $operation
    if (-not $Install -and -not $current) { throw 'Current app version is missing or incomplete' }
    if ($Repair) {
        if ($Version -and $Version -cne $originalVersion) { throw 'Repair must use the current application version' }
        $Version = $originalVersion
    } elseif ($Rollback) {
        $Version = [string]$current.previous
        if ($Version -notmatch $versionPattern -or $Version -ceq $originalVersion) { throw 'A retained previous version is not available' }
    } elseif (-not $Install) {
        if (-not (Test-Path -LiteralPath (Join-Path $appRoot ($originalVersion + '/DeepSeek Harness.exe')) -PathType Leaf)) { throw 'Current app version is missing or incomplete; use repair' }
        if ($null -ne $current.PSObject.Properties['rejected'] -and [string]$current.rejected.version -ceq $Version) {
            $rejectedAt = [DateTime]::MinValue
            if ([DateTime]::TryParse([string]$current.rejected.at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$rejectedAt) -and ([DateTime]::UtcNow - $rejectedAt.ToUniversalTime()).TotalHours -lt 24) { throw 'This version was rolled back within the last 24 hours; not retrying yet' }
        }
    }
    $status.version = $Version
    if ($Rollback) {
        $receipt = Read-PayloadReceipt $Version
        Assert-ReceiptedPayload (Join-Path $appRoot $Version) $receipt $Version
        $next = [ordered]@{ version=$Version; previous=''; pendingHealth=$false; switchedAt=[DateTime]::UtcNow.ToString('o'); rejected=@{ version=$originalVersion; at=[DateTime]::UtcNow.ToString('o') } }
        $status.transition = [ordered]@{ schemaVersion=1; operation=$operation; phase='prepared'; version=$Version; currentSha256=$currentHash; next=$next; receipt=$receipt }
        Write-Atomic $statusPath $status
        Complete-Transition $status.transition
        return
    }
    $followPath = Join-Path $launcherRoot 'follow.json'; Assert-PlainPath $followPath
    $follow = Get-Content -LiteralPath $followPath -Raw | ConvertFrom-Json
    Assert-FeedUrl ([string]$follow.indexUrl); Assert-FeedUrl ([string]$follow.feedUrl)
    if ([string]$follow.cacheDirName -notmatch '^[A-Za-z0-9._@-]{1,100}$' -or [string]$follow.cacheDirName -in @('.', '..') -or -not ([string]$follow.feedUrl).EndsWith('/')) { throw 'Invalid updater cache directory name or feed URL' }
    $status.status = 'reading-index'; $status.phase = 'reading-index'; Write-Atomic $statusPath $status
    $index = if ($IndexFile) { Read-LocalAcceptedIndex $IndexFile } else { Get-StrictJson ([string]$follow.indexUrl) }
    if ($InstallerFile -and -not $Version) {
        $candidate = Get-AcceptedInstallerCandidate $index $InstallerFile
        $Version = [string]$candidate.version
    } elseif ($Install -and -not $Version) { $candidate = Get-LatestAcceptedIndexCandidate $index; $Version = [string]$candidate.version }
    else { $candidate = Get-AcceptedIndexCandidate $index $Version }
    # Preserve the exact accepted-index schema for a later completely offline operation.
    # It records candidate identity; it does not grant release/security qualification.
    if (-not $IndexFile) { Write-Atomic (Join-Path $launcherRoot 'accepted-index.json') $index }
    $status.version = $Version
    $partial = Join-Path $appRoot ($Version + '.partial'); $candidatePath = Join-Path $appRoot $Version
    $repairBackup = Join-Path $appRoot ($Version + '.repair-backup')
    $receiptPath = Join-Path $launcherRoot ('receipts/' + $Version + '.json')
    $hadTarget = Test-Path -LiteralPath $candidatePath
    $originalTreeHash = $null; $originalReceiptHash = $null
    if ($Repair) {
        foreach ($path in @($candidatePath, $repairBackup, ($receiptPath + '.repair-backup'))) { Assert-PlainPath $path }
        # One preservation slot for the whole root, including unknown or linked entries.
        # Enumerate names only: never follow, inventory or delete a preserved entry.
        foreach ($slotRoot in @($appRoot, (Join-Path $launcherRoot 'receipts'))) {
            Assert-PlainPath $slotRoot
            if (-not (Test-Path -LiteralPath $slotRoot)) { continue }
            $suffix = if ($slotRoot -ceq $appRoot) { '.repair-backup' } else { '.json.repair-backup' }
            foreach ($entry in Get-ChildItem -LiteralPath $slotRoot -Force -ErrorAction Stop) {
                if ($entry.Name.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase)) {
                    throw ('Repair preservation slot already exists: ' + $entry.FullName + '; preserve or recover it before repairing again')
                }
            }
        }
        if ($hadTarget) { $originalTreeHash = Get-PortablePayloadTreeHash $candidatePath }
        if (Test-Path -LiteralPath $receiptPath) {
            Assert-PlainPath $receiptPath
            if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf) -or (Get-Item -LiteralPath $receiptPath).Length -gt 1048576) { throw 'Original repair receipt is not a bounded regular file' }
            $originalReceiptHash = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash
        }
    } elseif ($hadTarget) { throw 'Target application directory already exists; preserving current state' }
    foreach ($scratch in @($partial, ($partial + '.outer'), ($partial + '.verify'))) { Assert-PlainPath $scratch; if (Test-Path -LiteralPath $scratch) { throw 'Stale partial directory exists; refusing to overwrite it' } }
    if ($InstallerFile) {
        $installer = [IO.Path]::GetFullPath($InstallerFile); Assert-PlainPath $installer
        # Keep the user-selected source stable through signature checks and extraction.
        $sourceLease = [IO.File]::Open($installer, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        Assert-Installer $installer $candidate
        $status.status = 'verifying'; $status.phase = 'verifying'; Write-Atomic $statusPath $status
    } else {
        $installer = Join-Path (Join-Path $storage 'downloads') ('deepseek-harness-' + $Version + '-win-x64.exe')
        $status.status = 'downloading'; $status.phase = 'downloading'; $status.downloadedBytes = 0; $status.totalBytes = [long]$candidate.size; $status.progress = 0; Write-Atomic $statusPath $status
        Invoke-WithNetworkRetry { Get-OfficialInstaller $installer $candidate { param($downloaded,$total) $status.downloadedBytes = [long]$downloaded; $status.totalBytes = [long]$total; $status.progress = [Math]::Floor(100 * $downloaded / $total); if ($downloaded -ge $total) { $status.phase = 'verifying' }; Write-Atomic $statusPath $status } $CancelFile | Out-Null }
    }
    if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation cancelled' }
    # Recheck after download: never claim an unknown tree which appeared concurrently.
    foreach ($scratch in @($partial, ($partial + '.outer'), ($partial + '.verify'))) { if (Test-Path -LiteralPath $scratch) { throw 'Partial directory appeared during download; preserving it' } }
    $status.transition = [ordered]@{ schemaVersion=1; operation=$operation; phase='extracting'; version=$Version; currentSha256=$currentHash }
    $status.status = 'extracting'; $status.phase = 'extracting'; Write-Atomic $statusPath $status
    $ownsPartial = $true
    $receipt = Expand-OfficialPayload $installer $candidate $partial (Join-Path $launcherRoot '7z.exe') ([string]$follow.feedUrl) ([string]$follow.cacheDirName)
    Assert-ReceiptedPayload $partial $receipt $Version
    if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'Installation cancelled' }
    $previous = if ($Repair) { [string]$current.previous } elseif ($originalVersion) { [string]$originalVersion } else { $null }
    $next = [ordered]@{ version=$Version; previous=$previous; pendingHealth=$true; switchedAt=[DateTime]::UtcNow.ToString('o') }
    $status.transition = [ordered]@{ schemaVersion=1; operation=$operation; phase='prepared'; version=$Version; currentSha256=$currentHash; next=$next; receipt=$receipt; hadTarget=[bool]$hadTarget; originalTreeSha256=$originalTreeHash; originalReceiptSha256=$originalReceiptHash }
    $status.status = 'switching'; $status.phase = 'switching'; Write-Atomic $statusPath $status
    # Source launcher upgrades remain on the existing path; maintenance passes the root itself.
    if (-not $Repair -and -not $Install) { Update-RootLauncher $SelfPath }
    Complete-Transition $status.transition
    # Cleanup is not part of activation, and repair's preservation slot is never a cleanup candidate.
    try { $status.cleanup = Clear-OlderVersions $Version $previous }
    catch { $status.cleanup = @{ removed=@(); preserved=@(); deferred=@('older-versions') } }
    if (-not $InstallerFile) {
        foreach ($file in @($installer, ($installer + '.part'))) {
            try { if (Test-Path -LiteralPath $file) { Assert-PlainPath $file; Remove-Item -LiteralPath $file -Force -ErrorAction Stop } }
            catch { $status.downloadCleanup = 'deferred' }
        }
    }
} catch {
    $message = $_.Exception.Message
    if (-not [string]::IsNullOrEmpty($Root)) { $message = $message.Replace($Root, '<portable-root>') }
    $message = $message -replace '(?i)(token|password|secret|authorization)\s*[:=]\s*\S+', '$1=<redacted>'
    $status.status = if ($message -match '(?i)cancelled') { 'cancelled' } else { 'failed' }; $status.phase = $status.status; $status.error = $message
    if (-not $lock) { Write-Error $message -ErrorAction Continue }
} finally {
    if ($lock -and $ownsPartial -and -not $committed -and $status.transition -and $status.transition.phase -eq 'extracting') {
        try {
            Assert-NoExtractionWriters
            foreach ($scratch in @($partial, ($partial + '.outer'), ($partial + '.verify'))) { if (Test-Path -LiteralPath $scratch) { Remove-PortableScratch $scratch $appRoot } }
            $status.transition = $null
        } catch { }
    }
    if ($sourceLease) { $sourceLease.Dispose() }
    if ($activation) { $activation.Dispose() }
    if ($lock) {
        try { if ($statusWritable) { Write-Atomic $statusPath $status } } catch { }
        finally { $lock.Dispose() }
    }
}
if ($status.status -eq 'failed') { exit 1 }
exit 0
