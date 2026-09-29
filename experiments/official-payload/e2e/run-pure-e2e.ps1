# Starts the official desktop, rewrites HKCU\Software\Classes\dsh while running, and writes a unique updater cache under LocalAppData; restores and removes those changes in finally.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$InstallerOld,
    [Parameter(Mandatory=$true)][string]$CandidateOld,
    [Parameter(Mandatory=$true)][string]$InstallerNew,
    [Parameter(Mandatory=$true)][string]$CandidateNew,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [ValidateSet('en','zh')][string]$Locale = 'en'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:Ids = @(
    'old-app-running-from-root', 'update-copy-executed', 'update-applied', 'current-switched',
    'new-app-running', 'health-cleared', 'rewritten-app-update-yml', 'protocol-owned-while-running',
    'protocol-restored-after-exit', 'only-two-versions-kept', 'no-outside-writes', 'rollback-to-previous'
)
$script:Checks = [ordered]@{}
foreach ($id in $script:Ids) { $script:Checks[$id] = @{ passed = $false; evidence = 'Not run' } }
$script:Stages = New-Object 'System.Collections.Generic.List[string]'
$script:Failure = $null
$script:ExitCode = 1
$script:WorkCreated = $false
$script:TraceStarted = $false
$script:TraceStopped = $false
$script:ProtocolSnapshotReady = $false
$script:CacheWasAbsent = $false
$script:OldLauncherWasStarted = $false
$script:CrashLauncherWasStarted = $false
$script:PortableRoot = $null
$script:Node = $null
$script:FeedProcess = $null
$script:IndexProcess = $null
$script:UiProcess = $null
$script:OldLauncherProcess = $null
$script:CrashLauncherProcess = $null
$script:ProtocolBefore = $null
$script:ProtocolExpected = $null
$script:OutsideWriteDifferences = @()
$script:FeedUrl = $null
$script:IndexUrl = $null
$script:CacheName = $null
$script:CachePath = $null
$script:OldVersion = $null
$script:NewVersion = $null
$script:ReportFailure = $null
$script:HadLocalFeedFlag = Test-Path Env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED
$script:OldLocalFeedFlag = $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED
$script:StageLog = $null
$script:EvidenceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\build\orch-080\T27'))
$script:WorkPath = [IO.Path]::GetFullPath($WorkRoot)
$script:RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$script:Deadline = [DateTime]::UtcNow.AddMinutes(25)

function Set-Check([string]$Id, [bool]$Passed, $Evidence) {
    $script:Checks[$Id] = @{ passed = $Passed; evidence = $Evidence }
}

function Write-Stage([string]$Message) {
    $line = [DateTime]::UtcNow.ToString('o') + ' ' + $Message
    $script:Stages.Add($line)
    if ($script:StageLog) { Add-Content -LiteralPath $script:StageLog -Value $line -Encoding UTF8 }
    Write-Host $line
}

function Assert-E2ETime([string]$Stage) {
    if ([DateTime]::UtcNow -ge $script:Deadline) { throw ('Total 25-minute E2E deadline exceeded during ' + $Stage) }
}

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
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    throw 'node.exe was not found in PATH or the standard Node.js install locations'
}

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return [int]$listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

function Read-JsonFile([string]$Path) {
    Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json
}

function Write-JsonFile([string]$Path, $Value) {
    $text = ConvertTo-Json -InputObject $Value -Depth 16
    [IO.File]::WriteAllText($Path, $text + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Start-NodeProcess([string]$ScriptPath, [string[]]$Arguments, [string]$Stdout, [string]$Stderr) {
    $allArguments = @($ScriptPath) + $Arguments
    $native = @($allArguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) })
    $process = Start-Process -FilePath $script:Node -ArgumentList ([string]::Join(' ', $native)) -WindowStyle Hidden -PassThru -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
    $null = $process.Handle
    return $process
}

function Wait-ForReadyJson($Process, [string]$Stdout, [string]$Description, [int]$TimeoutSeconds = 15) {
    $end = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    if ($end -gt $script:Deadline) { $end = $script:Deadline }
    while ([DateTime]::UtcNow -lt $end) {
        if ($Process.HasExited) {
            $Process.WaitForExit()
            $stderr = if (Test-Path -LiteralPath ($Stdout + '.stderr')) { Get-Content -LiteralPath ($Stdout + '.stderr') -Raw } else { '' }
            throw ($Description + ' exited before readiness. ' + $stderr)
        }
        if (Test-Path -LiteralPath $Stdout) {
            $line = Get-Content -LiteralPath $Stdout -TotalCount 1 -ErrorAction SilentlyContinue
            if ($line) { try { return ($line | ConvertFrom-Json) } catch {} }
        }
        Start-Sleep -Milliseconds 150
    }
    throw ($Description + ' did not become ready within ' + $TimeoutSeconds + ' seconds')
}

function Get-OfficialProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue)
}

function Get-ProcessesInPortableRoot {
    $rootPrefix = [IO.Path]::GetFullPath($script:PortableRoot).TrimEnd('\') + '\'
    $launcher = [IO.Path]::GetFullPath((Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe'))
    $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    @($all | Where-Object {
        $_.ExecutablePath -and
            ([IO.Path]::GetFullPath([string]$_.ExecutablePath).StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
             [IO.Path]::GetFullPath([string]$_.ExecutablePath).Equals($launcher, [StringComparison]::OrdinalIgnoreCase))
    })
}

function Get-VersionProcesses([string]$Version) {
    $expected = [IO.Path]::GetFullPath((Join-Path $script:PortableRoot ('app\' + $Version + '\DeepSeek Harness.exe')))
    @(Get-OfficialProcesses | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath).Equals($expected, [StringComparison]::OrdinalIgnoreCase) })
}

function Get-PrimaryVersionProcesses([string]$Version) {
    @(Get-VersionProcesses $Version | Where-Object { $_.CommandLine -and [string]$_.CommandLine -notmatch '(?i)(?:^|\s)--type=' })
}

function Get-RootLauncherProcesses {
    $expected = [IO.Path]::GetFullPath((Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe'))
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath).Equals($expected, [StringComparison]::OrdinalIgnoreCase) })
}

function Start-PortableLauncher([int]$ProbePort) {
    $exe = Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe'
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $exe
    $info.WorkingDirectory = $script:PortableRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.Arguments = '--probe-port=' + $ProbePort
    $info.EnvironmentVariables['DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED'] = '1'
    $null = $info.EnvironmentVariables.Remove('PSModulePath')
    [System.Diagnostics.Process]::Start($info)
}

function Wait-ForVersionProcess([string]$Version, [int]$TimeoutSeconds) {
    $end = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    if ($end -gt $script:Deadline) { $end = $script:Deadline }
    while ([DateTime]::UtcNow -lt $end) {
        $found = @(Get-PrimaryVersionProcesses $Version)
        if ($found.Count -gt 0) { return $found }
        Start-Sleep -Milliseconds 250
    }
    throw ('Timed out waiting for official version ' + $Version + ' to start under the Portable root')
}

function Get-ProtocolSnapshot {
    $path = 'Software\Classes\dsh\shell\open\command'
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path, $false)
    if ($null -eq $key) { return [pscustomobject]@{ keyExists = $false; valueExists = $false; value = $null; kind = $null } }
    try {
        $exists = @($key.GetValueNames()) -contains ''
        $value = if ($exists) { $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
        $kind = if ($exists) { [string]$key.GetValueKind('') } else { $null }
        return [pscustomobject]@{ keyExists = $true; valueExists = $exists; value = $value; kind = $kind }
    } finally { $key.Dispose() }
}

function Test-ProtocolSnapshotEqual($Left, $Right) {
    [bool]($Left.keyExists -eq $Right.keyExists -and $Left.valueExists -eq $Right.valueExists -and
        [string]$Left.value -ceq [string]$Right.value -and [string]$Left.kind -ceq [string]$Right.kind)
}

function Restore-ProtocolSnapshot {
    if (-not $script:ProtocolSnapshotReady) { return }
    $path = 'Software\Classes\dsh\shell\open\command'
    if ($script:ProtocolBefore.keyExists) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($path)
        try {
            if ($script:ProtocolBefore.valueExists) {
                $kind = [Microsoft.Win32.RegistryValueKind][Enum]::Parse([Microsoft.Win32.RegistryValueKind], [string]$script:ProtocolBefore.kind)
                $key.SetValue('', $script:ProtocolBefore.value, $kind)
            } else { $key.DeleteValue('', $false) }
        } finally { $key.Dispose() }
        return
    }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path, $true)
    if ($null -ne $key) {
        try {
            $current = $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if ([string]$current -ceq [string]$script:ProtocolExpected) { $key.DeleteValue('', $false) }
            if ($key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0) { $key.Dispose(); $key = $null; [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($path, $false) }
        } finally { if ($null -ne $key) { $key.Dispose() } }
    }
    foreach ($parent in @('Software\Classes\dsh\shell\open', 'Software\Classes\dsh\shell', 'Software\Classes\dsh')) {
        $parentKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($parent, $true)
        if ($null -ne $parentKey) {
            try { if ($parentKey.ValueCount -eq 0 -and $parentKey.SubKeyCount -eq 0) { $parentKey.Dispose(); $parentKey = $null; [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($parent, $false) } }
            finally { if ($null -ne $parentKey) { $parentKey.Dispose() } }
        }
    }
}

function Close-CurrentOfficial([int]$ProbePort, [string]$Stage) {
    Write-Stage ('Requesting normal official-app exit: ' + $Stage)
    if ($ProbePort -gt 0) {
        $closeScript = Join-Path $PSScriptRoot 'close-app.mjs'
        $stdout = Join-Path $script:EvidenceRoot ('close-' + $Stage + '-stdout.log')
        $stderr = Join-Path $script:EvidenceRoot ('close-' + $Stage + '-stderr.log')
        $script:UiProcess = Start-NodeProcess $closeScript @([string]$ProbePort) $stdout $stderr
        $remainMs = [int][Math]::Max(1000, [Math]::Min(15000, ($script:Deadline - [DateTime]::UtcNow).TotalMilliseconds))
        if (-not $script:UiProcess.WaitForExit($remainMs)) { throw 'CDP Browser.close did not return before its deadline' }
        $script:UiProcess.WaitForExit()
        if ($script:UiProcess.ExitCode -ne 0) { throw ('CDP Browser.close failed: ' + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)) }
    } else {
        $closedAny = $false
        foreach ($app in @(Get-PrimaryVersionProcesses $script:NewVersion)) {
            $windowProcess = Get-Process -Id ([int]$app.ProcessId) -ErrorAction SilentlyContinue
            if ($null -eq $windowProcess -or $windowProcess.MainWindowHandle -eq [IntPtr]::Zero) { continue }
            if (-not $windowProcess.CloseMainWindow()) { throw 'Updated official app did not accept a normal main-window close' }
            $closedAny = $true
        }
        if (-not $closedAny) { throw 'Updated official app has no main window to close normally' }
    }
    $end = [DateTime]::UtcNow.AddSeconds(40)
    if ($end -gt $script:Deadline) { $end = $script:Deadline }
    do {
        if (@(Get-ProcessesInPortableRoot).Count -eq 0) { return }
        Start-Sleep -Milliseconds 350
    } while ([DateTime]::UtcNow -lt $end)
    throw ('Portable launcher did not exit after the official app closed normally: ' + $Stage)
}

function Stop-PortableProcessesSafely {
    if (-not $script:PortableRoot) { return }
    $prefix = [IO.Path]::GetFullPath($script:PortableRoot).TrimEnd('\') + '\'
    $launcher = [IO.Path]::GetFullPath((Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe'))
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if (-not $process.ExecutablePath) { continue }
        $path = [IO.Path]::GetFullPath([string]$process.ExecutablePath)
        if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $path.Equals($launcher, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }
    $end = [DateTime]::UtcNow.AddSeconds(10)
    do {
        if (@(Get-ProcessesInPortableRoot).Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $end)
    throw 'Path-verified Portable processes remain after cleanup'
}

function Wait-ForUpdaterState([string]$Description) {
    $statusPath = Join-Path $script:PortableRoot 'data\launcher\update-status.json'
    $currentPath = Join-Path $script:PortableRoot 'app\current.json'
    $pendingPath = Join-Path (Join-Path $env:LOCALAPPDATA $script:CacheName) ('pending\deepseek-harness-' + $script:NewVersion + '-win-x64.exe')
    $pendingCallEvidence = $null
    $lastStatus = $null
    $end = $script:Deadline
    while ([DateTime]::UtcNow -lt $end) {
        Assert-E2ETime $Description
        if (Test-Path -LiteralPath $statusPath) {
            $status = Read-JsonFile $statusPath
            $statusName = [string]$status.status
            if ($statusName -ne $lastStatus) {
                $progressText = if ($null -ne $status.progress) { ' progress=' + $status.progress } else { '' }
                Write-Stage ('Update engine state: ' + $statusName + $progressText)
                $lastStatus = $statusName
            }
            if ($statusName -eq 'failed') { throw ('Update engine failed: ' + [string]$status.error) }
        }
        if ($null -eq $pendingCallEvidence) {
            $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
            foreach ($process in $processes) {
                if (-not $process.ExecutablePath -or -not $process.CommandLine) { continue }
                if ([IO.Path]::GetFullPath([string]$process.ExecutablePath).Equals([IO.Path]::GetFullPath($pendingPath), [StringComparison]::OrdinalIgnoreCase)) {
                    $argsMatch = [string]$process.CommandLine -match '(?i)(?:^|\s)--updated\s+/S\s+--force-run(?:\s|$)'
                    $pendingCallEvidence = [pscustomobject]@{ executablePath = $process.ExecutablePath; commandLine = $process.CommandLine; expectedPath = $pendingPath; argsMatch = $argsMatch; processId = $process.ProcessId }
                    Set-Check 'update-copy-executed' $argsMatch $pendingCallEvidence
                    Write-Stage ('Observed pending launcher process pid=' + $process.ProcessId + ' argsMatch=' + $argsMatch)
                    break
                }
            }
        }
        if ((Test-Path -LiteralPath $statusPath) -and (Test-Path -LiteralPath $currentPath)) {
            $status = Read-JsonFile $statusPath
            $current = Read-JsonFile $currentPath
            if ($status.status -eq 'applied' -and $current.version -ceq $script:NewVersion) {
                return [pscustomobject]@{ status = $status; current = $current; pendingCall = $pendingCallEvidence; statusPath = $statusPath }
            }
        }
        Start-Sleep -Milliseconds 250
    }
    Set-Check 'update-copy-executed' $false @{ observed = $null -ne $pendingCallEvidence; evidence = $pendingCallEvidence; expectedPath = $pendingPath }
    throw ('Timed out waiting for the new official version to be applied' + $(if ($null -ne $pendingCallEvidence) { '; pending launcher was observed' } else { '; pending launcher process was not observed' }))
}

function Test-ProtocolOwnedStable([string]$Version) {
    $samples = New-Object 'System.Collections.Generic.List[object]'
    for ($i = 0; $i -lt 4; $i++) {
        $snapshot = Get-ProtocolSnapshot
        $samples.Add($snapshot)
        if (-not $snapshot.valueExists -or [string]$snapshot.value -cne [string]$script:ProtocolExpected) { return [pscustomobject]@{ passed = $false; samples = $samples.ToArray(); expected = $script:ProtocolExpected; launcherPath = (Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe') } }
        if ($i -lt 3) { Start-Sleep -Seconds 1 }
    }
    $launcherPath = Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe'
    $beforeApps = @(Get-PrimaryVersionProcesses $Version)
    $beforeLaunchers = @(Get-RootLauncherProcesses)
    $linkError = $null
    try { Start-Process -FilePath 'dsh://t27-e2e-probe' -ErrorAction Stop | Out-Null } catch { $linkError = $_.Exception.Message }
    Start-Sleep -Seconds 5
    $afterApps = @(Get-PrimaryVersionProcesses $Version)
    $afterLaunchers = @(Get-RootLauncherProcesses)
    $beforeAppIds = @($beforeApps | ForEach-Object { [int]$_.ProcessId })
    $beforeLauncherIds = @($beforeLaunchers | ForEach-Object { [int]$_.ProcessId })
    $addedApps = @($afterApps | Where-Object { [int]$_.ProcessId -notin $beforeAppIds })
    $addedLaunchers = @($afterLaunchers | Where-Object { [int]$_.ProcessId -notin $beforeLauncherIds })
    $noNewOfficialInstance = $beforeApps.Count -gt 0 -and $addedApps.Count -eq 0 -and @($afterApps | Where-Object { [int]$_.ProcessId -in $beforeAppIds }).Count -eq $beforeApps.Count
    $ownedWindowTitles = @(
        @($afterApps) + @($afterLaunchers) | ForEach-Object {
            $windowProcess = Get-Process -Id ([int]$_.ProcessId) -ErrorAction SilentlyContinue
            if ($null -ne $windowProcess) { [pscustomobject]@{ processId = $_.ProcessId; name = $_.Name; title = $windowProcess.MainWindowTitle } }
        }
    )
    $errorTitles = @($ownedWindowTitles | Where-Object { [string]$_.title -match '(?i)(error|exception|failed|错误|失败|出错|another DSH|另一个 DSH)' })
    $noErrorDialog = $null -eq $linkError -and $beforeLaunchers.Count -gt 0 -and $addedLaunchers.Count -eq 0 -and $addedApps.Count -eq 0 -and $errorTitles.Count -eq 0
    $link = [pscustomobject]@{ uri = 'dsh://t27-e2e-probe'; launchError = $linkError; beforeOfficialPids = $beforeAppIds; afterOfficialPids = @($afterApps | ForEach-Object { [int]$_.ProcessId }); newOfficialProcesses = @($addedApps | Select-Object ProcessId, ExecutablePath, CommandLine); beforeLauncherPids = $beforeLauncherIds; afterLauncherPids = @($afterLaunchers | ForEach-Object { [int]$_.ProcessId }); newLauncherProcesses = @($addedLaunchers | Select-Object ProcessId, ExecutablePath, CommandLine); ownedWindowTitles = $ownedWindowTitles; errorTitleWindows = $errorTitles; noNewOfficialInstance = $noNewOfficialInstance; noErrorDialog = $noErrorDialog; passed = ($noNewOfficialInstance -and $noErrorDialog) }
    [pscustomobject]@{ passed = ($link.passed); samples = $samples.ToArray(); expected = $script:ProtocolExpected; launcherPath = $launcherPath; linkHandoff = $link }
}

function Copy-E2EEvidence {
    if (-not $script:PortableRoot -or -not (Test-Path -LiteralPath $script:PortableRoot)) { return }
    $copies = @(
        @{ Source = 'data\launcher\launcher.log'; Destination = 'launcher.log' },
        @{ Source = 'data\launcher\update-status.json'; Destination = 'update-status.json' },
        @{ Source = 'app\current.json'; Destination = 'current.json' },
        @{ Source = 'launcher\follow.json'; Destination = 'follow.json' }
    )
    foreach ($copy in $copies) {
        $source = Join-Path $script:PortableRoot $copy.Source
        if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $script:EvidenceRoot $copy.Destination) -Force -ErrorAction Stop }
    }
    $receipts = Join-Path $script:PortableRoot 'launcher\receipts'
    if (Test-Path -LiteralPath $receipts) {
        $destinationRoot = Join-Path $script:EvidenceRoot 'receipts'
        $null = New-Item -ItemType Directory -Path $destinationRoot -Force
        Get-ChildItem -LiteralPath $receipts -Filter '*.json' -File | Copy-Item -Destination $destinationRoot -Force -ErrorAction Stop
    }
}

try {
    $null = New-Item -ItemType Directory -Path $script:EvidenceRoot -Force
    $script:StageLog = Join-Path $script:EvidenceRoot 'stage.log'
    Write-Stage 'T27 pure portable E2E started'
    $script:Node = Find-Node
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
        throw 'This end-to-end script is restricted to a clean GitHub-hosted Windows runner; local execution is intentionally disabled.'
    }
    $evidencePrefix = $script:EvidenceRoot.TrimEnd('\') + '\'
    if (-not $script:WorkPath.StartsWith($evidencePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'WorkRoot must be a new child of build/orch-080/T27' }
    if (Test-Path -LiteralPath $script:WorkPath) { throw ('WorkRoot already exists; refusing to overwrite it: ' + $script:WorkPath) }
    $script:CandidateOldPath = [IO.Path]::GetFullPath($CandidateOld)
    $script:CandidateNewPath = [IO.Path]::GetFullPath($CandidateNew)
    $script:InstallerOldPath = [IO.Path]::GetFullPath($InstallerOld)
    $script:InstallerNewPath = [IO.Path]::GetFullPath($InstallerNew)
    $script:SevenZipPath = [IO.Path]::GetFullPath($SevenZip)
    foreach ($file in @($script:CandidateOldPath, $script:CandidateNewPath, $script:InstallerOldPath, $script:InstallerNewPath, $script:SevenZipPath)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw ('Required runner input is missing: ' + $file) }
    }
    $oldCandidate = Read-JsonFile $script:CandidateOldPath
    $newCandidate = Read-JsonFile $script:CandidateNewPath
    $script:OldVersion = [string]$oldCandidate.version
    $script:NewVersion = [string]$newCandidate.version
    if ($script:OldVersion -cne '0.1.7-rc.2' -or [string]$oldCandidate.url -cne 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.2-win-x64.exe') {
        throw 'CandidateOld must be the repository official 0.1.7-rc.2 candidate'
    }
    if ([string]::IsNullOrWhiteSpace($script:NewVersion) -or $script:NewVersion -ceq $script:OldVersion) { throw 'CandidateNew must be a different real official version' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'CrashStub.cs') -PathType Leaf)) { throw 'The rollback crash stub source is missing' }

    Import-Module (Join-Path $PSScriptRoot '..\Payload.psm1') -Force
    $oldIdentity = [pscustomobject]@{ version = $oldCandidate.version; installerUrl = $oldCandidate.url; sha512 = $oldCandidate.sha512; size = $oldCandidate.size }
    $newIdentity = [pscustomobject]@{ version = $newCandidate.version; installerUrl = $newCandidate.url; sha512 = $newCandidate.sha512; size = $newCandidate.size }
    Assert-Installer $script:InstallerOldPath $oldIdentity
    Assert-Installer $script:InstallerNewPath $newIdentity
    Write-Stage 'Both supplied official installers match their candidate size, SHA-512, and Authenticode identity'

    $running = @(Get-OfficialProcesses)
    $listeners = @(Get-NetTCPConnection -LocalPort 19387 -State Listen -ErrorAction SilentlyContinue)
    $preflight = [pscustomobject]@{
        officialProcesses = @($running | Select-Object ProcessId, ExecutablePath)
        port19387Listeners = @($listeners | Select-Object LocalAddress, LocalPort, OwningProcess)
    }
    Write-Stage ('Preflight processes=' + $running.Count + ' port19387Listeners=' + $listeners.Count)
    if ($running.Count -ne 0 -or $listeners.Count -ne 0) { throw 'Preflight blocked: a DeepSeek Harness.exe process or listener on fixed port 19387 already exists; no process was stopped.' }

    $null = New-Item -ItemType Directory -Path $script:WorkPath -Force
    $script:WorkCreated = $true
    $script:PortableRoot = Join-Path $script:WorkPath 'portable'
    $script:CacheName = 'dsh-pure-e2e-' + [Guid]::NewGuid().ToString('N')
    $script:CachePath = Join-Path $env:LOCALAPPDATA $script:CacheName
    if (Test-Path -LiteralPath $script:CachePath) { throw 'Unique updater cache path unexpectedly exists; refusing to reuse or delete it' }
    $script:CacheWasAbsent = $true
    $script:ProtocolBefore = Get-ProtocolSnapshot
    $script:ProtocolSnapshotReady = $true
    $script:ProtocolExpected = '"' + (Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe') + '" --open "%1"'
    Write-JsonFile (Join-Path $script:EvidenceRoot 'protocol-before.json') $script:ProtocolBefore

    $indexScript = Join-Path $PSScriptRoot 'index-server.mjs'
    $script:IndexRequestLog = Join-Path $script:EvidenceRoot 'index-request-log.jsonl'
    $indexStdout = Join-Path $script:EvidenceRoot 'index-server-start.json'
    $indexStderr = Join-Path $script:EvidenceRoot 'index-server-stderr.log'
    $script:IndexProcess = Start-NodeProcess $indexScript @($script:CandidateOldPath, $script:CandidateNewPath, '0', $script:IndexRequestLog) $indexStdout $indexStderr
    $indexReady = Wait-ForReadyJson $script:IndexProcess $indexStdout 'Accepted-index server'
    $script:IndexUrl = [string]$indexReady.indexUrl

    $feedPort = Get-FreeLoopbackPort
    if ($feedPort -eq 19387 -or $feedPort -eq [int]$indexReady.port) { $feedPort = Get-FreeLoopbackPort }
    $script:FeedUrl = 'http://127.0.0.1:' + $feedPort + '/'
    $script:RequestLog = Join-Path $script:EvidenceRoot 'request-log.jsonl'
    $script:FeedStdout = Join-Path $script:EvidenceRoot 'feed-start.json'
    $script:FeedStderr = Join-Path $script:EvidenceRoot 'feed-stderr.log'
    $script:UiResultPath = Join-Path $script:WorkPath 'ui-result.json'
    $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED = '1'

    Write-Stage ('Packaging old official version ' + $script:OldVersion + '; index server already listening at ' + $script:IndexUrl)
    $packageScript = Join-Path $PSScriptRoot '..\package-pure.ps1'
    & $packageScript -Installer $script:InstallerOldPath -Output $script:PortableRoot -SevenZip $script:SevenZipPath -FeedUrl $script:FeedUrl -IndexUrl $script:IndexUrl -CacheDirName $script:CacheName
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw ('Pure package creation failed with exit code ' + $LASTEXITCODE) }
    $follow = Read-JsonFile (Join-Path $script:PortableRoot 'launcher\follow.json')
    $oldYml = Get-Content -LiteralPath (Join-Path $script:PortableRoot ('app\' + $script:OldVersion + '\resources\app-update.yml')) -Raw
    $oldFeedLine = [regex]::Match($oldYml, '(?m)^url:\s*(\S+)\s*$')
    if (-not $oldFeedLine.Success -or $oldFeedLine.Groups[1].Value -cne [string]$follow.feedUrl -or [string]$follow.feedUrl -cne $script:FeedUrl) {
        throw 'Packaged follow.json and old app-update.yml do not share the same fake feed URL'
    }
    if ([string]$follow.cacheDirName -cne $script:CacheName -or $oldYml -match '(?m)^publisherName:') { throw 'Packaged cache name or old app-update.yml publisher rewrite is invalid' }

    $feedScript = Join-Path $PSScriptRoot '..\contract\feed.mjs'
    $launcherExe = Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe'
    $script:FeedProcess = Start-NodeProcess $feedScript @($script:NewVersion, $launcherExe, [string]$feedPort, $script:RequestLog) $script:FeedStdout $script:FeedStderr
    $feedReady = Wait-ForReadyJson $script:FeedProcess $script:FeedStdout 'Fake electron-updater feed'
    if ([int]$feedReady.port -ne $feedPort -or [string]$feedReady.baseUrl -cne $script:FeedUrl) { throw 'Fake feed bound a different port or URL than the package configuration' }

    $traceScript = Join-Path $PSScriptRoot '..\trace-writes.ps1'
    Write-Stage 'Starting hosted-runner process/write trace'
    $script:TraceStarted = $true
    & $traceScript -Mode Start -Evidence $script:EvidenceRoot -PortableRoot $script:PortableRoot

    $oldProbePort = Get-FreeLoopbackPort
    $script:OldLauncherProcess = Start-PortableLauncher $oldProbePort
    $script:OldLauncherWasStarted = $true
    Write-Stage ('Started root launcher pid=' + $script:OldLauncherProcess.Id + ' probePort=' + $oldProbePort)
    $oldProcesses = Wait-ForVersionProcess $script:OldVersion 120
    $oldElectron = Join-Path $script:PortableRoot 'data\electron'
    $oldDshHome = Join-Path $script:PortableRoot 'data\dsh-home'
    $mainOldProcess = $oldProcesses | Select-Object -First 1
    $oldHasRootUserData = (Test-Path -LiteralPath $oldElectron -PathType Container) -and (Test-Path -LiteralPath $oldDshHome -PathType Container) -and
        @($oldProcesses | Where-Object { [string]$_.CommandLine -like ('*' + $oldElectron + '*') }).Count -gt 0
    $oldEvidence = [pscustomobject]@{ version = $script:OldVersion; portableRoot = $script:PortableRoot; primaryExecutablePath = $mainOldProcess.ExecutablePath; processes = @($oldProcesses | Select-Object ProcessId, ExecutablePath, CommandLine); dshHome = $oldDshHome; electronUserData = $oldElectron; userDataInsidePortableRoot = $oldHasRootUserData }
    Set-Check 'old-app-running-from-root' $oldHasRootUserData $oldEvidence
    if (-not $oldHasRootUserData) { throw 'Old official process path or portable Electron data directory was not verified' }

    $script:ProtocolExpected = '"' + (Join-Path $script:PortableRoot 'DeepSeek Harness Portable.exe') + '" --open "%1"'
    Start-Sleep -Seconds 3
    $protocolEvidence = Test-ProtocolOwnedStable $script:OldVersion
    Set-Check 'protocol-owned-while-running' $protocolEvidence.passed $protocolEvidence
    if (-not $protocolEvidence.passed) { throw 'The dsh protocol command was not stably owned by the running Portable launcher' }

    $uiScript = Join-Path $PSScriptRoot '..\contract\ui-probe.mjs'
    $uiStdout = Join-Path $script:EvidenceRoot 'ui-probe-output.log'
    $uiStderr = Join-Path $script:EvidenceRoot 'ui-probe-stderr.log'
    $remainingForUi = [int][Math]::Max(1000, [Math]::Min(420000, ($script:Deadline - [DateTime]::UtcNow).TotalMilliseconds - 60000))
    Write-Stage ('Waiting for old-version update controls; UI probe timeout=' + $remainingForUi + 'ms')
    $script:UiProcess = Start-NodeProcess $uiScript @([string]$oldProbePort, $script:NewVersion, $Locale, $script:UiResultPath, [string]$remainingForUi) $uiStdout $uiStderr
    if (-not $script:UiProcess.WaitForExit($remainingForUi + 10000)) {
        Stop-Process -Id $script:UiProcess.Id -Force -ErrorAction SilentlyContinue
        throw 'UI probe exceeded the bounded wait for the update entry and Install and Restart button'
    }
    $script:UiProcess.WaitForExit()
    $uiEvidence = if (Test-Path -LiteralPath $script:UiResultPath) { Read-JsonFile $script:UiResultPath } else { $null }
    if ($script:UiProcess.ExitCode -ne 0 -or $null -eq $uiEvidence -or $uiEvidence.installClicked -ne $true) {
        $pageText = if ($uiEvidence) { @($uiEvidence.targets | ForEach-Object { [string]$_.text }) -join [Environment]::NewLine } else { '' }
        throw ('Official update UI did not complete a real mouse click. Probe error=' + [string]$uiEvidence.error + '; visible page text=' + $pageText)
    }
    Write-Stage 'Official update entry and Install and Restart were clicked by CDP mouse events'

    $applied = Wait-ForUpdaterState 'official update download, verification, extraction and handoff'
    Set-Check 'update-applied' ($applied.status.status -ceq 'applied') ([pscustomobject]@{ status = $applied.status; path = $applied.statusPath })
    Set-Check 'current-switched' ($applied.current.version -ceq $script:NewVersion -and $applied.current.previous -ceq $script:OldVersion) $applied.current
    if ($null -eq $applied.pendingCall -or -not $applied.pendingCall.argsMatch) {
        Set-Check 'update-copy-executed' $false @{ process = $applied.pendingCall; expectedPendingPath = (Join-Path (Join-Path $script:CachePath 'pending') ('deepseek-harness-' + $script:NewVersion + '-win-x64.exe')); expectedArguments = @('--updated','/S','--force-run') }
        throw 'The exact cached updated launcher path and --updated /S --force-run argument sequence was not observed'
    }

    $newYmlPath = Join-Path $script:PortableRoot ('app\' + $script:NewVersion + '\resources\app-update.yml')
    $newYml = Get-Content -LiteralPath $newYmlPath -Raw
    $newUrl = [regex]::Match($newYml, '(?m)^url:\s*(\S+)\s*$')
    $newCache = [regex]::Match($newYml, '(?m)^updaterCacheDirName:\s*"?([^"\s]+)"?\s*$')
    $ymlEvidence = [pscustomobject]@{ path = $newYmlPath; feedUrl = if ($newUrl.Success) { $newUrl.Groups[1].Value } else { $null }; cacheDirName = if ($newCache.Success) { $newCache.Groups[1].Value } else { $null }; publisherNamePresent = [bool]($newYml -match '(?m)^publisherName:'); follow = $follow }
    $ymlPassed = $newUrl.Success -and $newUrl.Groups[1].Value -ceq $script:FeedUrl -and $newCache.Success -and $newCache.Groups[1].Value -ceq $script:CacheName -and -not $ymlEvidence.publisherNamePresent
    Set-Check 'rewritten-app-update-yml' $ymlPassed $ymlEvidence
    if (-not $ymlPassed) { throw 'Updated version app-update.yml does not match the local feed/cache contract or still has publisherName' }

    $appDirectories = @(Get-ChildItem -LiteralPath (Join-Path $script:PortableRoot 'app') -Directory | Select-Object -ExpandProperty Name | Sort-Object)
    $onlyTwo = $appDirectories.Count -eq 2 -and @($appDirectories | Where-Object { $_ -notin @($script:OldVersion, $script:NewVersion) }).Count -eq 0 -and
        (Test-Path -LiteralPath (Join-Path $script:PortableRoot 'app\current.json') -PathType Leaf)
    Set-Check 'only-two-versions-kept' $onlyTwo ([pscustomobject]@{ directories = $appDirectories; expected = @($script:OldVersion, $script:NewVersion); currentFilePresent = (Test-Path -LiteralPath (Join-Path $script:PortableRoot 'app\current.json') -PathType Leaf) })
    if (-not $onlyTwo) { throw 'The app directory does not contain exactly the current and previous official versions' }

    $newProcesses = Wait-ForVersionProcess $script:NewVersion 120
    $mainNewProcess = $newProcesses | Select-Object -First 1
    $newPid = [int]$mainNewProcess.ProcessId
    Write-Stage ('New official version running pid=' + $newPid + '; observing 25-second survival and health clear')
    $survived = $true
    for ($second = 0; $second -lt 25; $second++) {
        Assert-E2ETime 'new application health observation'
        $current = Read-JsonFile (Join-Path $script:PortableRoot 'app\current.json')
        $sameProcess = @(Get-VersionProcesses $script:NewVersion | Where-Object { [int]$_.ProcessId -eq $newPid }).Count -gt 0
        if (-not $sameProcess -or $current.version -cne $script:NewVersion) { $survived = $false; break }
        Start-Sleep -Seconds 1
    }
    Set-Check 'new-app-running' $survived ([pscustomobject]@{ version = $script:NewVersion; processId = $newPid; survivedSeconds = if ($survived) { 25 } else { $null }; executablePath = $mainNewProcess.ExecutablePath })
    if (-not $survived) { throw 'The updated official app did not remain alive in the new version directory for 25 seconds' }
    $healthCurrent = Read-JsonFile (Join-Path $script:PortableRoot 'app\current.json')
    $healthPassed = $healthCurrent.version -ceq $script:NewVersion -and $healthCurrent.pendingHealth -eq $false
    Set-Check 'health-cleared' $healthPassed ([pscustomobject]@{ current = $healthCurrent; launcherLogContainsHealthPassed = ((Get-Content -LiteralPath (Join-Path $script:PortableRoot 'data\launcher\launcher.log') -Raw -ErrorAction SilentlyContinue) -match 'health window passed') })
    if (-not $healthPassed) { throw 'The updated version remained pending health after the 25-second observation' }
    $protocolEvidence = Test-ProtocolOwnedStable $script:NewVersion
    Set-Check 'protocol-owned-while-running' $protocolEvidence.passed $protocolEvidence
    if (-not $protocolEvidence.passed) { throw 'The updated app/launcher did not retain dsh protocol ownership' }

    # The updated launcher restarts without forwarding --probe-port; close this app through its native main-window handle.
    Close-CurrentOfficial 0 'updated-version'
    $protocolAfter = Get-ProtocolSnapshot
    $restored = Test-ProtocolSnapshotEqual $script:ProtocolBefore $protocolAfter
    Set-Check 'protocol-restored-after-exit' $restored ([pscustomobject]@{ before = $script:ProtocolBefore; afterNormalExit = $protocolAfter; expected = $script:ProtocolExpected })
    if (-not $restored) { throw 'The dsh protocol registration did not return to its exact pre-run state after normal exit' }
    Write-Stage 'Normal updated-app exit restored the original dsh protocol registration'

    $crashVersion = '9.9.9-crash'
    $crashRoot = Join-Path $script:PortableRoot ('app\' + $crashVersion)
    $null = New-Item -ItemType Directory -Path (Join-Path $crashRoot 'resources') -Force
    $crashExe = Join-Path $crashRoot 'DeepSeek Harness.exe'
    Add-Type -Path (Join-Path $PSScriptRoot 'CrashStub.cs') -OutputAssembly $crashExe -OutputType WindowsApplication
    [IO.File]::WriteAllBytes((Join-Path $crashRoot 'resources\app.asar'), [byte[]]@())
    $crashCurrent = [ordered]@{ version = $crashVersion; previous = $script:NewVersion; pendingHealth = $true; switchedAt = [DateTime]::UtcNow.ToString('o') }
    Write-JsonFile (Join-Path $script:PortableRoot 'app\current.json') $crashCurrent
    $crashProbePort = Get-FreeLoopbackPort
    $script:CrashLauncherProcess = Start-PortableLauncher $crashProbePort
    $script:CrashLauncherWasStarted = $true
    Write-Stage ('Started crash rollback scenario launcher pid=' + $script:CrashLauncherProcess.Id)
    $rollbackEnd = [DateTime]::UtcNow.AddSeconds(90)
    if ($rollbackEnd -gt $script:Deadline) { $rollbackEnd = $script:Deadline }
    $rollbackEvidence = $null
    while ([DateTime]::UtcNow -lt $rollbackEnd) {
        $current = Read-JsonFile (Join-Path $script:PortableRoot 'app\current.json')
        $statusPath = Join-Path $script:PortableRoot 'data\launcher\update-status.json'
        $status = if (Test-Path -LiteralPath $statusPath) { Read-JsonFile $statusPath } else { $null }
        if ($current.version -ceq $script:NewVersion -and $current.previous -ceq '' -and $current.pendingHealth -eq $false -and $current.rejected.version -ceq $crashVersion -and $status.status -ceq 'rolled-back') {
            $rollbackEvidence = [pscustomobject]@{ current = $current; updateStatus = $status; rejectedDirectoryExists = (Test-Path -LiteralPath $crashRoot) }
            break
        }
        Start-Sleep -Milliseconds 250
    }
    $rollbackApp = @(Get-PrimaryVersionProcesses $script:NewVersion)
    $rollbackAlive = $false
    if ($rollbackEvidence -and -not $rollbackEvidence.rejectedDirectoryExists -and $rollbackApp.Count -gt 0) {
        $pidAfterRollback = [int]$rollbackApp[0].ProcessId
        Start-Sleep -Seconds 5
        $rollbackAlive = @(Get-VersionProcesses $script:NewVersion | Where-Object { [int]$_.ProcessId -eq $pidAfterRollback }).Count -gt 0
    }
    if ($rollbackEvidence) { $rollbackEvidence | Add-Member -NotePropertyName officialPreviousVersionAlive -NotePropertyValue $rollbackAlive }
    $rollbackPassed = $null -ne $rollbackEvidence -and -not $rollbackEvidence.rejectedDirectoryExists -and $rollbackAlive
    Set-Check 'rollback-to-previous' $rollbackPassed ([pscustomobject]@{ expectedCurrentVersion = $script:NewVersion; failedVersion = $crashVersion; evidence = $rollbackEvidence; officialPreviousVersionAlive = $rollbackAlive })
    if (-not $rollbackPassed) { throw 'Crash rollback did not restore and run the previous official version with the expected rejected-state record' }

    Close-CurrentOfficial $crashProbePort 'rollback-version'
    $protocolAfterRollback = Get-ProtocolSnapshot
    if (-not (Test-ProtocolSnapshotEqual $script:ProtocolBefore $protocolAfterRollback)) { throw 'Protocol registration was not restored after rollback-app exit' }
    $script:ExitCode = 0
    Write-Stage 'All online E2E phases completed; stopping trace and collecting final evidence'
} catch {
    $script:Failure = $_.Exception.Message
    $script:ExitCode = 1
    Write-Stage ('FAILED: ' + $script:Failure)
} finally {
    try { Stop-PortableProcessesSafely } catch { if (-not $script:Failure) { $script:Failure = 'Could not stop path-verified Portable processes: ' + $_.Exception.Message }; $script:ExitCode = 1 }
    foreach ($process in @($script:UiProcess, $script:FeedProcess, $script:IndexProcess)) {
        try {
            if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
            if ($null -ne $process -and -not $process.WaitForExit(5000)) { throw ('Child process did not exit: pid=' + $process.Id) }
        } catch { if (-not $script:Failure) { $script:Failure = 'Could not stop a script-started helper process: ' + $_.Exception.Message }; $script:ExitCode = 1 }
    }
    try { Restore-ProtocolSnapshot } catch { if (-not $script:Failure) { $script:Failure = 'Could not restore the original dsh protocol key: ' + $_.Exception.Message }; $script:ExitCode = 1 }

    if ($script:TraceStarted -and -not $script:TraceStopped) {
        try {
            & (Join-Path $PSScriptRoot '..\trace-writes.ps1') -Mode Stop -Evidence $script:EvidenceRoot -PortableRoot $script:PortableRoot
            $script:TraceStopped = $true
            $tracePath = Join-Path $script:EvidenceRoot 'outside-writes.json'
            if (Test-Path -LiteralPath $tracePath) {
                $script:OutsideWriteDifferences = @(Get-Content -LiteralPath $tracePath -Raw | ConvertFrom-Json)
                $unexpected = @($script:OutsideWriteDifferences | Where-Object {
                    $writePath = [string]$_.path
                    $cacheAllowed = $script:CachePath -and ($writePath.StartsWith($script:CachePath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $writePath.Equals($script:CachePath, [StringComparison]::OrdinalIgnoreCase))
                    $protocolAllowed = $writePath -match '^HKCU\\Software\\Classes\\dsh(?:\\|$)'
                    -not ($cacheAllowed -or $protocolAllowed)
                })
                Set-Check 'no-outside-writes' ($unexpected.Count -eq 0) ([pscustomobject]@{ captured = $true; allowedOutsideRoots = @($script:CachePath, 'HKCU\Software\Classes\dsh'); rawDifferences = $script:OutsideWriteDifferences; unexpected = $unexpected })
                if ($unexpected.Count -gt 0 -and -not $script:Failure) { $script:Failure = 'Process write trace found writes outside the portable root, unique updater cache, and dsh protocol key'; $script:ExitCode = 1 }
            } else {
                Set-Check 'no-outside-writes' $false 'Process trace completed without outside-writes.json'
                if (-not $script:Failure) { $script:Failure = 'Process write trace did not produce outside-writes.json'; $script:ExitCode = 1 }
            }
        } catch {
            Set-Check 'no-outside-writes' $false ('Write tracing failed: ' + $_.Exception.Message)
            if (-not $script:Failure) { $script:Failure = 'Write trace failed: ' + $_.Exception.Message }
            $script:ExitCode = 1
        }
    }

    try { Copy-E2EEvidence } catch { if (-not $script:Failure) { $script:Failure = 'Could not copy key Portable logs into the evidence directory: ' + $_.Exception.Message }; $script:ExitCode = 1 }
    try {
        foreach ($evidencePair in @(
            @{ Source = $script:RequestLog; Name = 'request-log.jsonl' },
            @{ Source = $script:IndexRequestLog; Name = 'index-request-log.jsonl' },
            @{ Source = $script:UiResultPath; Name = 'ui-result.json' },
            @{ Source = $script:FeedStderr; Name = 'feed-stderr.log' }
        )) {
            if ($evidencePair.Source -and (Test-Path -LiteralPath $evidencePair.Source -PathType Leaf)) {
                $destination = Join-Path $script:EvidenceRoot $evidencePair.Name
                if (-not [IO.Path]::GetFullPath($evidencePair.Source).Equals([IO.Path]::GetFullPath($destination), [StringComparison]::OrdinalIgnoreCase)) {
                    Copy-Item -LiteralPath $evidencePair.Source -Destination $destination -Force -ErrorAction Stop
                }
            }
        }
    } catch { if (-not $script:Failure) { $script:Failure = 'Could not copy request/UI logs into the evidence directory: ' + $_.Exception.Message }; $script:ExitCode = 1 }
    if ($script:ProtocolSnapshotReady) {
        try {
            $protocolAfterCleanup = Get-ProtocolSnapshot
            $stillRestored = Test-ProtocolSnapshotEqual $script:ProtocolBefore $protocolAfterCleanup
            if ($script:Checks['protocol-restored-after-exit'].passed -ne $true) {
                Set-Check 'protocol-restored-after-exit' $false ([pscustomobject]@{ before = $script:ProtocolBefore; afterCleanup = $protocolAfterCleanup; launcherNormalExitObserved = $false; restoredByFinally = $stillRestored })
            }
            if (-not $stillRestored) { throw 'Final protocol state differs from its initial snapshot' }
            Write-JsonFile (Join-Path $script:EvidenceRoot 'protocol-after.json') $protocolAfterCleanup
        } catch { if (-not $script:Failure) { $script:Failure = 'Could not verify final protocol state: ' + $_.Exception.Message }; $script:ExitCode = 1 }
    }
    if ($script:CacheWasAbsent -and $script:CachePath -and (Test-Path -LiteralPath $script:CachePath)) {
        try {
            $cachePrefix = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
            $cacheFull = [IO.Path]::GetFullPath($script:CachePath)
            if (-not $cacheFull.StartsWith($cachePrefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($cacheFull) -cne $script:CacheName) { throw 'Refusing to remove a cache path outside its exact unique LocalAppData directory' }
            $cacheProcessPrefix = $cacheFull.TrimEnd('\') + '\'
            $cacheProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath).StartsWith($cacheProcessPrefix, [StringComparison]::OrdinalIgnoreCase) })
            if ($cacheProcesses.Count -gt 0) { throw ('Updater-cache files are still in use by path-verified process ids: ' + (@($cacheProcesses | ForEach-Object { [string]$_.ProcessId }) -join ',')) }
            foreach ($entry in Get-ChildItem -LiteralPath $cacheFull -Recurse -Force -ErrorAction Stop) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing updater-cache cleanup through a reparse point' } }
            Remove-Item -LiteralPath $cacheFull -Recurse -Force -ErrorAction Stop
            if (Test-Path -LiteralPath $cacheFull) { throw 'Unique updater cache remains after cleanup' }
            Write-Stage 'Removed the unique e2e updater cache after recording its write evidence'
        } catch { if (-not $script:Failure) { $script:Failure = 'Updater cache cleanup failed: ' + $_.Exception.Message }; $script:ExitCode = 1 }
    }
    if ($script:HadLocalFeedFlag) { $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED = $script:OldLocalFeedFlag } else { Remove-Item Env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED -ErrorAction SilentlyContinue }

    $input = [ordered]@{
        oldVersion = $script:OldVersion
        newVersion = $script:NewVersion
        checks = $script:Checks
        outsideWriteDifferences = $script:OutsideWriteDifferences
        failure = $script:Failure
        feedUrl = $script:FeedUrl
        indexUrl = $script:IndexUrl
        workRoot = $script:WorkPath
        stages = $script:Stages.ToArray()
    }
    try {
        if (-not $script:Node) { $script:Node = Find-Node }
        $inputPath = Join-Path $script:EvidenceRoot 'pure-e2e-input.tmp.json'
        $reportPath = Join-Path $script:EvidenceRoot 'pure-e2e-report.json'
        Write-JsonFile $inputPath $input
        & $script:Node (Join-Path $PSScriptRoot 'report.mjs') $inputPath $reportPath
        $reportExit = $LASTEXITCODE
        if (Test-Path -LiteralPath $inputPath) { Remove-Item -LiteralPath $inputPath -Force -ErrorAction SilentlyContinue }
        if ($reportExit -ne 0) { $script:ExitCode = 1 }
        if (-not (Test-Path -LiteralPath $reportPath)) { throw 'Pure E2E report was not created' }
        $finalReport = Read-JsonFile $reportPath
        if ($finalReport.overallPassed -ne $true) { $script:ExitCode = 1 }
    } catch {
        $script:ExitCode = 1
        $fallbackResults = @($script:Ids | ForEach-Object { [pscustomobject]@{ id = $_; passed = $false; evidence = 'Report generation failed' } })
        $fallback = [ordered]@{ oldVersion = $script:OldVersion; newVersion = $script:NewVersion; overallPassed = $false; results = $fallbackResults; outsideWriteDifferences = $script:OutsideWriteDifferences; diagnostics = @{ failure = $script:Failure; reportError = $_.Exception.Message; stages = $script:Stages.ToArray() } }
        try { Write-JsonFile (Join-Path $script:EvidenceRoot 'pure-e2e-report.json') $fallback } catch {}
    }
    if ($script:Failure) { Write-Output ('E2E failure: ' + $script:Failure) }
    Write-Output ('Evidence directory: ' + $script:EvidenceRoot)
}

exit $script:ExitCode
