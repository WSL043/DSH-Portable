# Starts the official program, rewrites the HKCU dsh protocol key (restored at exit), and writes a probe-only updater cache (deleted at exit).
param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [string]$WorkRoot = 'build/orch-080/T22/probe',
    [ValidateSet('zh', 'en')][string]$Locale = 'zh'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ProbeAppExe = $null
$script:ProbeFeed = $null
$script:ProbeUi = $null
$script:WorkCreated = $false
$script:CacheWasAbsent = $false
$script:ProtocolSnapshotReady = $false
$script:ProtocolWasPresent = $false
$script:Input = @{
    requests = @(); stubCalls = @(); staticChecks = @(); userDataFiles = @();
    defaultDataBefore = @(); defaultDataAfter = @(); directoryOutsideWrites = @();
    noPreexistingOfficialInstance = $false; updateDialogShown = $false; installerFileExists = $false;
    appExitedAfterInstall = $false; version = $null
}
$script:Failure = $null
$script:ExitCode = 0
$script:Deadline = [DateTime]::UtcNow.AddMinutes(10)
$script:CachePath = $null
$script:CacheCleanup = 'not created'
$script:WorkCleanup = 'not created'
$script:ProtocolCleanup = 'not changed'
$script:RequestLog = $null
$script:StubLog = $null
$script:ProtocolBackup = $null
$script:AppExe = $null
$script:DefaultData = Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop'
$script:EvidenceRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $WorkRoot) ''))
$script:WorkPath = [IO.Path]::GetFullPath($WorkRoot)
$script:ReportPath = Join-Path $script:EvidenceRoot 'contract-report.json'
$script:UiLog = Join-Path $script:EvidenceRoot 'ui-probe-output.log'

function ConvertTo-NativeArgument([string]$Value) {
    '"' + $Value.Replace('"', '\"') + '"'
}

function Find-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    )
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return $candidate } }
    throw 'node.exe was not found in PATH or the standard Node.js install locations'
}

function Assert-ProbeTime {
    if ([DateTime]::UtcNow -ge $script:Deadline) { throw 'The contract probe exceeded its 10-minute total deadline' }
}

function Get-TreeSnapshot([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return @() }
    $root = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    @(
        Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction Stop |
            ForEach-Object {
                [pscustomobject]@{
                    path = $_.FullName.Substring($root.Length).Replace('\', '/')
                    length = [long]$_.Length
                    lastWriteUtcTicks = [long]$_.LastWriteTimeUtc.Ticks
                }
            } | Sort-Object path
    )
}

function Get-ProtocolCommand {
    $key = 'HKCU\Software\Classes\dsh\shell\open\command'
    $result = & reg.exe query $key /ve 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $line = @($result | Where-Object { $_ -match 'REG_\w+\s+' } | Select-Object -First 1)
    if (-not $line) { return $null }
    $raw = ($line[0] -replace '^.*?REG_\w+\s+', '').Trim()
    if ($raw -match '^"([^"]+)"') { return $Matches[1] }
    if ($raw -match '^(\S+)') { return $Matches[1] }
    return $null
}

function Get-OfficialProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue)
}

function Stop-ProbeProcesses {
    if (-not $script:ProbeAppExe) { return }
    $expected = [IO.Path]::GetFullPath($script:ProbeAppExe)
    foreach ($process in Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue) {
        if ($process.ExecutablePath -and [IO.Path]::GetFullPath($process.ExecutablePath).Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Restore-Protocol {
    if (-not $script:ProtocolSnapshotReady) { return }
    $key = 'HKCU\Software\Classes\dsh'
    & reg.exe delete $key /f 2>$null | Out-Null
    if ($script:ProtocolWasPresent -and (Test-Path -LiteralPath $script:ProtocolBackup)) {
        & reg.exe import $script:ProtocolBackup | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restore the original HKCU dsh protocol registration' }
    }
}

function Set-ResultInput {
    param([string]$FilePath, [hashtable]$Value)
    $parent = Split-Path -Parent $FilePath
    $null = New-Item -ItemType Directory -Path $parent -Force
    [IO.File]::WriteAllText($FilePath, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
}

try {
    $node = Find-Node
    $appSource = [IO.Path]::GetFullPath($AppDir)
    $appYmlSource = Join-Path $appSource 'resources\app-update.yml'
    $asarSource = Join-Path $appSource 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $appYmlSource -PathType Leaf) -or -not (Test-Path -LiteralPath $asarSource -PathType Leaf)) {
        throw "AppDir does not contain resources/app-update.yml and resources/app.asar: $appSource"
    }
    $null = New-Item -ItemType Directory -Path $script:EvidenceRoot -Force
    $sourceStaticPath = Join-Path $script:EvidenceRoot 'static-check-source.json'
    $sourceStaticOutput = & $node (Join-Path $PSScriptRoot 'static-check.mjs') $appYmlSource $asarSource $sourceStaticPath 2>&1
    if (-not (Test-Path -LiteralPath $sourceStaticPath)) { throw "Could not inspect the official static contract: $sourceStaticOutput" }
    $sourceStatic = Get-Content -LiteralPath $sourceStaticPath -Raw | ConvertFrom-Json
    $script:Input.staticChecks = @($sourceStatic.checks)
    $script:Input.sourceVersion = $sourceStatic.version
    if ($LASTEXITCODE -ne 0) { throw "Official static contract check failed: $sourceStaticOutput" }
    $running = @(Get-OfficialProcesses)
    $listeners = @(Get-NetTCPConnection -LocalPort 19387 -State Listen -ErrorAction SilentlyContinue)
    $script:Input.noPreexistingOfficialInstance = ($running.Count -eq 0 -and $listeners.Count -eq 0)
    $script:Input.preflightEvidence = [pscustomobject]@{
        processCount = $running.Count
        processes = @($running | Select-Object ProcessId, ExecutablePath)
        port19387Listeners = @($listeners | Select-Object LocalAddress, LocalPort, OwningProcess)
    }
    if (-not $script:Input.noPreexistingOfficialInstance) {
        $script:Failure = 'Preflight blocked: a DeepSeek Harness.exe process or listener on port 19387 already exists; no process was stopped.'
        $script:ExitCode = 1
        throw $script:Failure
    }
    if (Test-Path -LiteralPath $script:WorkPath) { throw "WorkRoot already exists; refusing to overwrite or delete it: $($script:WorkPath)" }
    $evidenceFull = [IO.Path]::GetFullPath($script:EvidenceRoot).TrimEnd('\') + '\'
    if ($script:WorkPath.StartsWith($evidenceFull, [StringComparison]::OrdinalIgnoreCase) -eq $false) { throw 'WorkRoot must be inside its evidence directory' }
    $null = New-Item -ItemType Directory -Path $script:EvidenceRoot -Force
    $null = New-Item -ItemType Directory -Path $script:WorkPath -Force
    $script:WorkCreated = $true
    $script:WorkCleanup = 'pending'

    $script:ProtocolBackup = Join-Path $script:WorkPath 'protocol-before.reg'
    $script:ProtocolWasPresent = Test-Path -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\Classes\dsh'
    if ($script:ProtocolWasPresent) {
        & reg.exe export 'HKCU\Software\Classes\dsh' $script:ProtocolBackup /y | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not snapshot the existing HKCU dsh protocol registration' }
    }
    $script:ProtocolSnapshotReady = $true
    $script:ProtocolCleanup = 'pending'
    $script:Input.defaultDataBefore = @(Get-TreeSnapshot $script:DefaultData)

    $appCopy = Join-Path $script:WorkPath 'app'
    Copy-Item -LiteralPath $appSource -Destination $appCopy -Recurse
    Assert-ProbeTime
    $script:AppExe = Join-Path $appCopy 'DeepSeek Harness.exe'
    $configPath = Join-Path $appCopy 'resources\app-update.yml'
    $asarPath = Join-Path $appCopy 'resources\app.asar'
    $configBefore = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $asarBefore = (Get-FileHash -LiteralPath $asarPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $sourceVersion = $script:Input.sourceVersion
    if (-not $sourceVersion -or $sourceVersion -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-.+)?$') { throw "Unsupported official app version: $sourceVersion" }
    $feedVersion = '{0}.{1}.{2}-contract.0' -f $Matches[1], $Matches[2], ([int]$Matches[3] + 1)
    $guid = [Guid]::NewGuid().ToString('N')
    $cacheName = "dsh-contract-probe-$guid"
    $script:CachePath = Join-Path $env:LOCALAPPDATA $cacheName
    if (Test-Path -LiteralPath $script:CachePath) { throw 'The unique probe-specific updater cache path already exists; refusing to overwrite or delete it' }
    $cacheBefore = @(Get-TreeSnapshot $script:CachePath)
    $script:CacheWasAbsent = $true
    $script:CacheCleanup = 'pending'
    $script:RequestLog = Join-Path $script:EvidenceRoot 'request-log.jsonl'
    $script:StubLog = Join-Path $script:EvidenceRoot 'stub-calls.jsonl'
    Remove-Item -LiteralPath $script:RequestLog, $script:StubLog -Force -ErrorAction SilentlyContinue

    $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $portProbe.Start()
    $cdpPort = $portProbe.LocalEndpoint.Port
    $portProbe.Stop()
    $stubPath = Join-Path $script:WorkPath 'stub.exe'
    & (Join-Path $PSScriptRoot 'build-stub.ps1') -OutputPath $stubPath | Out-Null
    $feedStdout = Join-Path $script:WorkPath 'feed-start.jsonl'
    $feedScript = Join-Path $PSScriptRoot 'feed.mjs'
    $feedArgs = @($feedScript, $feedVersion, $stubPath, '0', $script:RequestLog) | ForEach-Object { ConvertTo-NativeArgument $_ }
    $script:ProbeFeed = Start-Process -FilePath $node -ArgumentList ([string]::Join(' ', $feedArgs)) -WindowStyle Hidden -PassThru -RedirectStandardOutput $feedStdout -RedirectStandardError (Join-Path $script:WorkPath 'feed-stderr.log')
    $feedDeadline = [DateTime]::UtcNow.AddSeconds(15)
    $feedInfo = $null
    while ([DateTime]::UtcNow -lt $feedDeadline) {
        if ($script:ProbeFeed.HasExited) { throw 'Fake feed exited before becoming ready' }
        if (Test-Path -LiteralPath $feedStdout) {
            $line = Get-Content -LiteralPath $feedStdout -TotalCount 1 -ErrorAction SilentlyContinue
            if ($line) { try { $feedInfo = $line | ConvertFrom-Json; break } catch {} }
        }
        Start-Sleep -Milliseconds 150
    }
    if (-not $feedInfo) { throw 'Fake feed did not print its ready JSON line within 15 seconds' }

    $feedUrl = [string]$feedInfo.baseUrl
    $configRewrite = Join-Path $PSScriptRoot 'update-config.mjs'
    $rewrittenTemp = Join-Path $script:WorkPath 'app-update.rewritten.yml'
    & $node $configRewrite $configPath $feedUrl $cacheName $rewrittenTemp
    if ($LASTEXITCODE -ne 0) { throw 'app-update.yml rewrite failed' }
    [IO.File]::Copy($rewrittenTemp, $configPath, $true)
    $configAfter = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $asarAfter = (Get-FileHash -LiteralPath $asarPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($asarBefore -ne $asarAfter) { throw 'Unexpected app.asar modification in the work copy' }
    $staticResultPath = Join-Path $script:WorkPath 'static-check.json'
    $staticOutput = & $node (Join-Path $PSScriptRoot 'static-check.mjs') $configPath $asarPath $staticResultPath 2>&1
    if (Test-Path -LiteralPath $staticResultPath) { $script:Input.staticChecks = @((Get-Content -LiteralPath $staticResultPath -Raw | ConvertFrom-Json).checks) }
    if ($LASTEXITCODE -ne 0) { throw "Static contract check failed: $staticOutput" }
    Assert-ProbeTime
    $script:Input.rewriteEvidence = [pscustomobject]@{ originalYmlSha256 = $configBefore; rewrittenYmlSha256 = $configAfter; appAsarSha256Unchanged = ($asarBefore -eq $asarAfter); sourceVersion = $sourceVersion }

    $appData = Join-Path $script:WorkPath 'data'
    $dshHome = Join-Path $appData 'dsh-home'
    $electronData = Join-Path $appData 'electron'
    $null = New-Item -ItemType Directory -Path $dshHome, $electronData -Force
    $script:Input.appExe = $script:AppExe
    $script:Input.cacheRoot = $script:CachePath
    $script:Input.cdpPort = $cdpPort
    $script:Input.feedUrl = $feedUrl
    $script:Input.version = $feedVersion
    $script:Input.directoryOutsideWrites = @(
        [pscustomobject]@{ path = $script:CachePath; initialFiles = $cacheBefore; cleanup = 'removed in finally' },
        [pscustomobject]@{ path = 'HKCU\Software\Classes\dsh'; initial = $(if ($script:ProtocolWasPresent) { 'exported to temporary protocol-before.reg' } else { 'absent' }); cleanup = 'restored in finally' }
    )
    $previousDshHome = $env:DSH_HOME
    $previousStubLog = $env:DSH_CONTRACT_STUB_LOG
    try {
        $env:DSH_HOME = $dshHome
        $env:DSH_CONTRACT_STUB_LOG = $script:StubLog
        $appArgs = @("--user-data-dir=$electronData", "--remote-debugging-port=$cdpPort") | ForEach-Object { ConvertTo-NativeArgument $_ }
        $mainProcess = Start-Process -FilePath $script:AppExe -ArgumentList ([string]::Join(' ', $appArgs)) -PassThru -WindowStyle Normal
    } finally {
        if ($null -eq $previousDshHome) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue } else { $env:DSH_HOME = $previousDshHome }
        if ($null -eq $previousStubLog) { Remove-Item Env:DSH_CONTRACT_STUB_LOG -ErrorAction SilentlyContinue } else { $env:DSH_CONTRACT_STUB_LOG = $previousStubLog }
    }

    $protocolDeadline = [DateTime]::UtcNow.AddSeconds(90)
    $protocolPath = $null
    while ([DateTime]::UtcNow -lt $protocolDeadline) {
        $protocolPath = Get-ProtocolCommand
        if ($protocolPath -and $protocolPath.Equals($script:AppExe, [StringComparison]::OrdinalIgnoreCase)) { break }
        Start-Sleep -Milliseconds 250
    }
    $script:Input.protocolPath = $protocolPath
    $script:Input.directoryOutsideWrites[1] = [pscustomobject]@{
        path = 'HKCU\Software\Classes\dsh'
        initial = $(if ($script:ProtocolWasPresent) { 'snapshot exported to temporary protocol-before.reg' } else { 'absent' })
        during = $protocolPath
        cleanup = 'original key restored in finally'
    }
    $script:Input.preflightEvidence = [pscustomobject]@{ processCount = 0; port19387Listeners = @(); result = 'No pre-existing process or listener' }
    $uiResultPath = Join-Path $script:WorkPath 'ui-result.json'
    $uiScript = Join-Path $PSScriptRoot 'ui-probe.mjs'
    Assert-ProbeTime
    $uiTimeout = [Math]::Min(420000, [int](($script:Deadline - [DateTime]::UtcNow).TotalMilliseconds - 45000))
    if ($uiTimeout -lt 1000) { throw 'Insufficient time remains for the UI contract probe' }
    $uiArgs = @($uiScript, [string]$cdpPort, $feedVersion, $Locale, $uiResultPath, [string]$uiTimeout) | ForEach-Object { ConvertTo-NativeArgument $_ }
    $script:ProbeUi = Start-Process -FilePath $node -ArgumentList ([string]::Join(' ', $uiArgs)) -WindowStyle Hidden -PassThru -RedirectStandardOutput $script:UiLog -RedirectStandardError (Join-Path $script:WorkPath 'ui-probe-stderr.log')
    # Reading Handle right away caches it; otherwise ExitCode stays null for a redirected -PassThru process.
    $null = $script:ProbeUi.Handle
    if (-not $script:ProbeUi.WaitForExit($uiTimeout + 10000)) {
        Stop-Process -Id $script:ProbeUi.Id -Force -ErrorAction SilentlyContinue
        throw 'UI contract probe exceeded its 7-minute deadline'
    }
    # Start-Process -PassThru only exposes ExitCode after a parameterless WaitForExit() (timeout overload leaves it null).
    $script:ProbeUi.WaitForExit()
    if (Test-Path -LiteralPath $uiResultPath) {
        $ui = Get-Content -LiteralPath $uiResultPath -Raw | ConvertFrom-Json
        $script:Input.updateDialogShown = ($ui.updateDialogShown -eq $true)
        $uiError = if ($ui.PSObject.Properties.Name -contains 'error') { $ui.error } else { $null }
        $script:Input.updateDialogEvidence = [pscustomobject]@{ dialogText = $ui.dialogText; updateEntry = $ui.updateEntry; installButton = $ui.installButton; error = $uiError }
    }
    if ($script:ProbeUi.ExitCode -ne 0) { throw "UI contract probe failed (exit $($script:ProbeUi.ExitCode)): $($script:Input.updateDialogEvidence.error)" }

    $exitDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $remaining = @()
    do {
        $remaining = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($script:AppExe, [StringComparison]::OrdinalIgnoreCase) })
        if ($remaining.Count -eq 0) { break }
        Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $exitDeadline)
    $script:Input.appExitedAfterInstall = ($remaining.Count -eq 0)
    $script:Input.appExitEvidence = [pscustomobject]@{ remainingProcesses = @($remaining | Select-Object ProcessId, ExecutablePath); deadlineSeconds = 30 }
    $script:Input.requests = @((Get-Content -LiteralPath $script:RequestLog -ErrorAction SilentlyContinue) | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    $script:Input.stubCalls = @((Get-Content -LiteralPath $script:StubLog -ErrorAction SilentlyContinue) | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    $expectedInstaller = Join-Path (Join-Path $script:CachePath 'pending') "deepseek-harness-$feedVersion-win-x64.exe"
    $script:Input.installerFileExists = Test-Path -LiteralPath $expectedInstaller -PathType Leaf
    $script:Input.userDataFiles = @(
        (Get-TreeSnapshot $electronData | ForEach-Object { [pscustomobject]@{ root = 'electron'; path = $_.path; length = $_.length } }),
        (Get-TreeSnapshot $dshHome | ForEach-Object { [pscustomobject]@{ root = 'dsh-home'; path = $_.path; length = $_.length } })
    )
    $script:Input.defaultDataAfter = @(Get-TreeSnapshot $script:DefaultData)
    $script:Input.directoryOutsideWrites[0] = [pscustomobject]@{ path = $script:CachePath; initialFiles = $cacheBefore; filesBeforeCleanup = @(Get-TreeSnapshot $script:CachePath); cleanup = 'removed in finally' }
    $script:ExitCode = 0
} catch {
    if (-not $script:Failure) { $script:Failure = $_.Exception.Message }
    if ($_.Exception.Message -like 'Preflight blocked:*') { $script:ExitCode = 1 }
    elseif ($script:ExitCode -eq 0) { $script:ExitCode = 1 }
} finally {
    if ($script:ProbeUi -and -not $script:ProbeUi.HasExited) { Stop-Process -Id $script:ProbeUi.Id -Force -ErrorAction SilentlyContinue }
    try { Stop-ProbeProcesses } catch {
        if (-not $script:Failure) { $script:Failure = "Probe process cleanup failed: $($_.Exception.Message)" }
        $script:ExitCode = 1
    }
    if ($script:ProbeFeed -and -not $script:ProbeFeed.HasExited) { Stop-Process -Id $script:ProbeFeed.Id -Force -ErrorAction SilentlyContinue }
    try { Restore-Protocol; if ($script:ProtocolSnapshotReady) { $script:ProtocolCleanup = 'original registration restored' } } catch {
        $script:ProtocolCleanup = "restore failed: $($_.Exception.Message)"
        if ($script:WorkCreated -and (Test-Path -LiteralPath $script:ProtocolBackup)) {
            Copy-Item -LiteralPath $script:ProtocolBackup -Destination (Join-Path $script:EvidenceRoot 'protocol-restore-failure.reg') -Force -ErrorAction SilentlyContinue
        }
        if (-not $script:Failure) { $script:Failure = "Protocol restore failed: $($_.Exception.Message)" }
        $script:ExitCode = 1
    }
    try {
        if ($script:CacheWasAbsent -and $script:CachePath -and (Test-Path -LiteralPath $script:CachePath)) { Remove-Item -LiteralPath $script:CachePath -Recurse -Force -ErrorAction Stop }
        if ($script:CacheWasAbsent -and $script:CachePath -and (Test-Path -LiteralPath $script:CachePath)) { throw 'Probe updater cache still exists after cleanup' }
        if ($script:CacheWasAbsent) { $script:CacheCleanup = 'probe-only cache removed or absent' }
    } catch {
        $script:CacheCleanup = "cleanup failed: $($_.Exception.Message)"
        if (-not $script:Failure) { $script:Failure = "Updater cache cleanup failed: $($_.Exception.Message)" }
        $script:ExitCode = 1
    }
    try {
        if ($script:WorkCreated -and (Test-Path -LiteralPath $script:WorkPath)) { Remove-Item -LiteralPath $script:WorkPath -Recurse -Force -ErrorAction Stop }
        if ($script:WorkCreated -and (Test-Path -LiteralPath $script:WorkPath)) { throw 'Probe work copy still exists after cleanup' }
        if ($script:WorkCreated) { $script:WorkCleanup = 'work copy removed' }
    } catch {
        $script:WorkCleanup = "cleanup failed: $($_.Exception.Message)"
        if (-not $script:Failure) { $script:Failure = "Work copy cleanup failed: $($_.Exception.Message)" }
        $script:ExitCode = 1
    }
    if (@($script:Input.directoryOutsideWrites).Count -gt 0) {
        $cacheRecord = $script:Input.directoryOutsideWrites[0]
        $cacheFilesBeforeCleanup = @()
        if ($cacheRecord.PSObject.Properties.Name -contains 'filesBeforeCleanup') { $cacheFilesBeforeCleanup = @($cacheRecord.filesBeforeCleanup) }
        $script:Input.directoryOutsideWrites[0] = [pscustomobject]@{ path = $script:CachePath; initialFiles = $cacheRecord.initialFiles; filesBeforeCleanup = $cacheFilesBeforeCleanup; cleanup = $script:CacheCleanup }
        $script:Input.directoryOutsideWrites[1] = [pscustomobject]@{ path = 'HKCU\Software\Classes\dsh'; initial = $(if ($script:ProtocolWasPresent) { 'snapshot exported' } else { 'absent' }); during = $script:Input.protocolPath; cleanup = $script:ProtocolCleanup }
    }
    if ($script:Failure) { $script:Input.failure = $script:Failure }
    if (-not $script:Input.directoryOutsideWrites) { $script:Input.directoryOutsideWrites = @() }
    try {
        $nodeForReport = Find-Node
        $inputPath = Join-Path $script:EvidenceRoot 'contract-input.tmp.json'
        Set-ResultInput -FilePath $inputPath -Value $script:Input
        & $nodeForReport (Join-Path $PSScriptRoot 'report.mjs') $inputPath $script:ReportPath
        if ($LASTEXITCODE -ne 0) { $script:ExitCode = 1 }
        if (Test-Path -LiteralPath $inputPath) { Remove-Item -LiteralPath $inputPath -Force }
    } catch {
        $script:ExitCode = 1
        [IO.File]::WriteAllText($script:ReportPath, (@{ version = $script:Input.version; overallPassed = $false; error = $_.Exception.Message; results = @() } | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    }
    if ($script:Failure) { Write-Error $script:Failure -ErrorAction Continue }
}
exit $script:ExitCode
