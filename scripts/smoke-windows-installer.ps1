[CmdletBinding()]
param(
    [string]$Installer = (Join-Path (Join-Path $PSScriptRoot '..') 'artifacts\DeepSeek-Herness-Setup.exe'),
    [switch]$UseRealKnownFolder
)

$ErrorActionPreference = 'Stop'
$Installer = [System.IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $Installer)) { throw "Installer is missing: $Installer" }

function Invoke-BoundedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    Write-Host "::group::$Stage"
    Write-Host "Starting: $FilePath"
    $StartParameters = @{ FilePath = $FilePath; PassThru = $true }
    if ($ArgumentList.Count -gt 0) { $StartParameters.ArgumentList = $ArgumentList }
    $Process = Start-Process @StartParameters
    try {
        if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
            Write-Host "$Stage exceeded $TimeoutSeconds seconds; terminating process tree $($Process.Id)."
            & taskkill.exe /PID $Process.Id /T /F 2>&1 | ForEach-Object { Write-Host $_ }
            $Process.WaitForExit(10000) | Out-Null
            throw "$Stage timed out after $TimeoutSeconds seconds"
        }
        $Process.Refresh()
        Write-Host "$Stage completed with exit code $($Process.ExitCode)."
        return $Process
    } finally {
        Write-Host "::endgroup::"
    }
}

function Write-RuntimeDiagnostics {
    $LogRoot = Join-Path $StateRoot 'data\logs'
    foreach ($LogName in @('dsh.stderr.log', 'dsh.stdout.log')) {
        $Log = Join-Path $LogRoot $LogName
        if (Test-Path -LiteralPath $Log) {
            Write-Host "--- $LogName ---"
            Get-Content -LiteralPath $Log -Tail 160 | ForEach-Object { Write-Host $_ }
        }
    }
}

function Get-InstalledProductStatus {
    $PreviousStateRoot = $env:DSH_PORTABLE_STATE_ROOT
    try {
        $env:DSH_PORTABLE_STATE_ROOT = $StateRoot
        $Deadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            $PreviousErrorActionPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $Lines = @(& $Node $Cli status --json 2>&1 | ForEach-Object { [string]$_ })
                $ExitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $PreviousErrorActionPreference
            }
            $Raw = ($Lines -join [Environment]::NewLine).Trim()
            if ($ExitCode -eq 0) { return ($Raw | ConvertFrom-Json) }
            if ($Raw -notmatch 'Another portable launcher is already starting or stopping DSH' -or [DateTime]::UtcNow -ge $Deadline) {
                throw "installed status command failed (${ExitCode}): $Raw"
            }
            Start-Sleep -Milliseconds 100
        } while ($true)
    } finally {
        $env:DSH_PORTABLE_STATE_ROOT = $PreviousStateRoot
    }
}

function Wait-InstalledProductStatus {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('running', 'stopped')][string]$ExpectedStatus,
        [int]$TimeoutSeconds = 45
    )

    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $Status = Get-InstalledProductStatus
        if ($Status.status -eq $ExpectedStatus) { return $Status }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $Deadline)

    Write-RuntimeDiagnostics
    throw "installed runtime did not reach $ExpectedStatus within $TimeoutSeconds seconds; last status was $($Status.status)"
}

function Assert-ProductShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$ExpectedTarget
    )

    if (-not (Test-Path -LiteralPath $ShortcutPath)) { throw "installed shortcut is missing: $ShortcutPath" }
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $ActualTarget = [System.IO.Path]::GetFullPath($Shortcut.TargetPath)
    $ExpectedTarget = [System.IO.Path]::GetFullPath($ExpectedTarget)
    if (-not $ActualTarget.Equals($ExpectedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "shortcut target mismatch: $ShortcutPath -> $ActualTarget"
    }
    $IconPath = (($Shortcut.IconLocation -split ',', 2)[0]).Trim('"')
    if (-not $IconPath) { throw "shortcut icon is not explicit: $ShortcutPath" }
    $ActualIcon = [System.IO.Path]::GetFullPath($IconPath)
    if (-not $ActualIcon.Equals($ExpectedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "shortcut icon mismatch: $ShortcutPath -> $($Shortcut.IconLocation)"
    }
}

$TestId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$TempRoot = [System.IO.Path]::GetTempPath()
$InstallRoot = Join-Path $TempRoot ("dsh-i-$TestId")
$LocalAppData = Join-Path $TempRoot ("dsh-la-$TestId")
$StateRoot = if ($UseRealKnownFolder) {
    Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'DeepSeek-Herness'
} else {
    Join-Path $LocalAppData 'DeepSeek-Herness'
}
$SetupLog = Join-Path $TempRoot ("dsh-setup-$TestId.log")
$LauncherDiagnostic = Join-Path $TempRoot ("dsh-launcher-$TestId.log")
$PriorStateRoot = $env:DSH_PORTABLE_STATE_ROOT
$PriorLauncherDiagnostic = $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC
$PriorLocalAppData = $env:LOCALAPPDATA
$PriorTestHidden = $env:DSH_PORTABLE_TEST_HIDDEN
$UserEnvironmentKey = 'Registry::HKEY_CURRENT_USER\Environment'
$PriorUserPathProperty = Get-ItemProperty -LiteralPath $UserEnvironmentKey -Name Path -ErrorAction SilentlyContinue
$PriorUserPathExisted = $null -ne $PriorUserPathProperty
$PriorUserPath = if ($PriorUserPathExisted) { [string]$PriorUserPathProperty.Path } else { '' }
$CommandOwnershipKey = 'Registry::HKEY_CURRENT_USER\Software\WSL043\DSH-Portable'
$PriorCommandKeyExisted = Test-Path -LiteralPath $CommandOwnershipKey
$PriorCommandPathProperty = Get-ItemProperty -LiteralPath $CommandOwnershipKey -Name InstalledCommandPath -ErrorAction SilentlyContinue
$PriorCommandPathExisted = $null -ne $PriorCommandPathProperty
$PriorCommandPath = if ($PriorCommandPathExisted) { [string]$PriorCommandPathProperty.InstalledCommandPath } else { '' }
$PreviousManagedRoot = Join-Path $TempRoot 'previous-installed-location'

try {
    if ($UseRealKnownFolder -and (Test-Path -LiteralPath $StateRoot)) {
        throw "real installed-mode smoke state already exists: $StateRoot"
    }
    $env:DSH_PORTABLE_STATE_ROOT = if ($UseRealKnownFolder) { $null } else { $StateRoot }
    $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC = $LauncherDiagnostic
    $SeededUserPath = (@($PriorUserPath.TrimEnd(';'), $PreviousManagedRoot) | Where-Object { $_ }) -join ';'
    Set-ItemProperty -LiteralPath $UserEnvironmentKey -Name Path -Value $SeededUserPath
    New-Item -ItemType Directory -Force -Path $CommandOwnershipKey | Out-Null
    Set-ItemProperty -LiteralPath $CommandOwnershipKey -Name InstalledCommandPath -Value $PreviousManagedRoot
    $Setup = Invoke-BoundedProcess -Stage 'Install package' -TimeoutSeconds 300 -FilePath $Installer -ArgumentList @(
            '/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NOCANCEL', '/NORESTART', '/CURRENTUSER',
            '/TASKS=addtopath', "/DIR=$InstallRoot", "/LOG=$SetupLog"
        )
    if ($Setup.ExitCode -ne 0) {
        Write-Host "Inno Setup exited with code $($Setup.ExitCode). Setup log follows:"
        if (Test-Path -LiteralPath $SetupLog) {
            Get-Content -LiteralPath $SetupLog -Tail 240 | ForEach-Object { Write-Host $_ }
        } else {
            Write-Host "Setup log was not created: $SetupLog"
        }
        throw "installer exited with code $($Setup.ExitCode)"
    }

    foreach ($Name in @(
        'DeepSeek-Herness.exe',
        'installed-mode.json',
        'unins000.exe',
        'app\node_modules\@earendil-works\pi-ai\dist\providers\data\amazon-bedrock.json'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $Name))) { throw "installed file is missing: $Name" }
    }

    $RegisteredUserPath = [string](Get-ItemPropertyValue -LiteralPath $UserEnvironmentKey -Name Path)
    $RegisteredEntries = @($RegisteredUserPath -split ';' | ForEach-Object { $_.Trim().Trim('"').TrimEnd('\') } | Where-Object {
        $_.Equals($InstallRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($RegisteredEntries.Count -ne 1) { throw 'installed dsh command path was not registered exactly once' }
    $OldRegisteredEntries = @($RegisteredUserPath -split ';' | ForEach-Object { $_.Trim().Trim('"').TrimEnd('\') } | Where-Object {
        $_.Equals($PreviousManagedRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($OldRegisteredEntries.Count -ne 0) { throw 'installer retained the previously managed command path after moving the installation' }
    $CommandPath = [string](Get-ItemPropertyValue -LiteralPath $CommandOwnershipKey -Name InstalledCommandPath)
    if (-not $CommandPath.Equals($InstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "installed dsh command path ownership was not recorded: $CommandPath"
    }

    $ProgramGroup = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek-Herness'
    Assert-ProductShortcut `
        -ShortcutPath (Join-Path $ProgramGroup 'DeepSeek-Herness.lnk') `
        -ExpectedTarget (Join-Path $InstallRoot 'DeepSeek-Herness.exe')
    if (Test-Path -LiteralPath (Join-Path $ProgramGroup 'Stop DeepSeek-Herness.lnk')) {
        throw 'installer exposed a redundant Stop shortcut'
    }

    $env:LOCALAPPDATA = if ($UseRealKnownFolder) { $PriorLocalAppData } else { $LocalAppData }
    $env:DSH_PORTABLE_STATE_ROOT = if ($UseRealKnownFolder) { $null } else { $StateRoot }
    & (Join-Path $PSScriptRoot 'smoke-windows-plugins.ps1') `
        -Root $InstallRoot `
        -Fixture (Join-Path (Join-Path $PSScriptRoot '..') 'tests\fixtures\dsh-portable-smoke-plugin') `
        -ExpectedStateRoot $StateRoot `
        -InstalledMode
    if ($LASTEXITCODE -ne 0) { throw "installed plugin management smoke failed with exit code $LASTEXITCODE" }
    # portable-cli.mjs is the internal headless lifecycle entry. Unlike the
    # product GUI and dsh.exe, it deliberately receives its state root from the
    # caller instead of interpreting installed-mode.json.
    $env:DSH_PORTABLE_STATE_ROOT = $StateRoot

    $Node = Join-Path $InstallRoot 'runtime\node\node.exe'
    $Cli = Join-Path $InstallRoot 'launcher\portable-cli.mjs'
    $Started = Invoke-BoundedProcess -Stage 'Start installed runtime' -TimeoutSeconds 90 `
        -FilePath $Node -ArgumentList @($Cli, 'start', '--no-browser', '--json')
    if ($Started.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $LauncherDiagnostic) {
            Write-Host '--- launcher diagnostic ---'
            Get-Content -LiteralPath $LauncherDiagnostic -Tail 240 | ForEach-Object { Write-Host $_ }
        }
        Write-RuntimeDiagnostics
        throw "installed launcher exited with code $($Started.ExitCode)"
    }
    $Status = Wait-InstalledProductStatus -ExpectedStatus 'running'
    $Response = Invoke-WebRequest -UseBasicParsing -Uri $Status.url -TimeoutSec 10
    if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 500) { throw "installed Web returned $($Response.StatusCode)" }

    $Stopped = Invoke-BoundedProcess -Stage 'Stop installed runtime' -TimeoutSeconds 60 `
        -FilePath $Node -ArgumentList @($Cli, 'stop', '--json')
    if ($Stopped.ExitCode -ne 0) {
        Write-RuntimeDiagnostics
        throw "installed stop entry exited with code $($Stopped.ExitCode)"
    }
    $null = Wait-InstalledProductStatus -ExpectedStatus 'stopped'
    if (-not (Test-Path -LiteralPath (Join-Path $StateRoot 'data\portable.json'))) { throw 'installed state was not written outside the app' }

    $RepairStateSentinel = Join-Path $StateRoot 'data\repair-state-sentinel.txt'
    $RepairStateText = 'preserve-user-state-across-repeat-install'
    [System.IO.File]::WriteAllText($RepairStateSentinel, $RepairStateText, [System.Text.UTF8Encoding]::new($false))
    $RepairTarget = Join-Path $InstallRoot 'README.txt'
    $RepairDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $RepairTarget).Hash
    [System.IO.File]::WriteAllText($RepairTarget, 'corrupted-for-repair-smoke', [System.Text.UTF8Encoding]::new($false))
    $RepairLog = Join-Path $TempRoot ("dsh-repair-$TestId.log")
    $Repair = Invoke-BoundedProcess -Stage 'Repair existing installation' -TimeoutSeconds 300 -FilePath $Installer -ArgumentList @(
            '/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NOCANCEL', '/NORESTART', '/CURRENTUSER',
            "/DIR=$InstallRoot", "/LOG=$RepairLog"
        )
    if ($Repair.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $RepairLog) {
            Get-Content -LiteralPath $RepairLog -Tail 240 | ForEach-Object { Write-Host $_ }
        }
        throw "repair install exited with code $($Repair.ExitCode)"
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $RepairTarget).Hash -ne $RepairDigest) {
        throw 'repair did not restore packaged files'
    }
    if ((Get-Content -Raw -LiteralPath $RepairStateSentinel) -ne $RepairStateText) {
        throw 'repair changed durable user state'
    }
    $RepairedUserPath = [string](Get-ItemPropertyValue -LiteralPath $UserEnvironmentKey -Name Path)
    $RepairedEntries = @($RepairedUserPath -split ';' | ForEach-Object { $_.Trim().Trim('"').TrimEnd('\') } | Where-Object {
        $_.Equals($InstallRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($RepairedEntries.Count -ne 1) { throw 'repair duplicated or removed the installed dsh command path' }

    # Reproduce an app/profile version skew from a prior installed build. The
    # resolver tree is generated product state, while sessions and third-party
    # profile packages live elsewhere and must survive the repair.
    $ManagedFallback = Join-Path $StateRoot 'data\dsh-home\profiles\node_modules'
    $MissingUiPackage = Join-Path $ManagedFallback '@deepseek-ai\dsh-client-ui-jobs'
    $StaleUiPackage = Join-Path $ManagedFallback '@deepseek-ai\dsh-client-ui-jobs.stale-smoke'
    if (-not (Test-Path -LiteralPath $MissingUiPackage)) {
        throw 'installed smoke did not create the managed DSH module fallback'
    }
    Move-Item -LiteralPath $MissingUiPackage -Destination $StaleUiPackage

    $Restarted = Invoke-BoundedProcess -Stage 'Restart repaired installation' -TimeoutSeconds 90 `
        -FilePath $Node -ArgumentList @($Cli, 'start', '--no-browser', '--json')
    if ($Restarted.ExitCode -ne 0) {
        Write-RuntimeDiagnostics
        throw "repaired launcher exited with code $($Restarted.ExitCode)"
    }
    $null = Wait-InstalledProductStatus -ExpectedStatus 'running'
    if (-not (Test-Path -LiteralPath $MissingUiPackage)) { throw 'startup did not rebuild the managed DSH module fallback' }
    if (Test-Path -LiteralPath $StaleUiPackage) { throw 'startup retained the stale managed DSH module fallback' }
    $RunningRepairLog = Join-Path $TempRoot ("dsh-running-repair-$TestId.log")
    $RunningRepair = Invoke-BoundedProcess -Stage 'Repair running installation' -TimeoutSeconds 300 -FilePath $Installer -ArgumentList @(
            '/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NOCANCEL', '/NORESTART', '/CURRENTUSER',
            "/DIR=$InstallRoot", "/LOG=$RunningRepairLog"
        )
    if ($RunningRepair.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $RunningRepairLog) {
            Get-Content -LiteralPath $RunningRepairLog -Tail 240 | ForEach-Object { Write-Host $_ }
        }
        throw "running repair exited with code $($RunningRepair.ExitCode)"
    }
    $null = Wait-InstalledProductStatus -ExpectedStatus 'stopped'
    if ((Get-Content -Raw -LiteralPath $RepairStateSentinel) -ne $RepairStateText) {
        throw 'running repair changed durable user state'
    }

    # The real installed GUI must resolve installed-mode.json on its own.
    $env:DSH_PORTABLE_STATE_ROOT = $null
    $env:DSH_PORTABLE_TEST_HIDDEN = '1'
    $NativeBeforeUninstall = Start-Process -FilePath (Join-Path $InstallRoot 'DeepSeek-Herness.exe') -PassThru
    $NativeDeadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 250
        $NativeBeforeUninstall.Refresh()
        if ($NativeBeforeUninstall.HasExited) { throw "native installed host exited before uninstall: $($NativeBeforeUninstall.ExitCode)" }
        $NativeStatus = (Get-InstalledProductStatus).status
    } while ($NativeStatus -ne 'running' -and [DateTime]::UtcNow -lt $NativeDeadline)
    if ($NativeStatus -ne 'running') { throw 'native installed host did not become ready before uninstall' }

    $Uninstall = Invoke-BoundedProcess -Stage 'Uninstall package' -TimeoutSeconds 300 `
        -FilePath (Join-Path $InstallRoot 'unins000.exe') `
        -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
    if ($Uninstall.ExitCode -ne 0) { throw "uninstaller exited with code $($Uninstall.ExitCode)" }
    if (-not $NativeBeforeUninstall.WaitForExit(45000)) { throw 'uninstaller left the native desktop host running' }
    $env:DSH_PORTABLE_TEST_HIDDEN = $PriorTestHidden
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'DeepSeek-Herness.exe')) { throw 'uninstaller retained application binaries' }
    if (-not (Test-Path -LiteralPath $StateRoot)) { throw 'uninstaller deleted user state' }
    if ((Get-Content -Raw -LiteralPath $RepairStateSentinel) -ne $RepairStateText) { throw 'uninstaller changed retained user data' }
    $UninstalledUserPath = [string](Get-ItemPropertyValue -LiteralPath $UserEnvironmentKey -Name Path -ErrorAction SilentlyContinue)
    if (@($UninstalledUserPath -split ';' | ForEach-Object { $_.Trim().Trim('"').TrimEnd('\') } | Where-Object {
        $_.Equals($InstallRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
    }).Count -ne 0) { throw 'uninstaller did not remove its user PATH entry' }
    $UninstalledCommandPath = Get-ItemProperty -LiteralPath $CommandOwnershipKey -Name InstalledCommandPath -ErrorAction SilentlyContinue
    if ($null -ne $UninstalledCommandPath) { throw 'uninstaller retained its command path ownership value' }

    $ProcessExitDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $RemainingOwned = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine.IndexOf($InstallRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        })
        if ($RemainingOwned.Count -eq 0) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $ProcessExitDeadline)
    if ($RemainingOwned.Count -ne 0) { throw "uninstaller left product processes running: $($RemainingOwned.ProcessId -join ', ')" }
    $ResolvedStateRoot = [System.IO.Path]::GetFullPath($StateRoot)
    $ResolvedTempRoot = [System.IO.Path]::GetFullPath($TempRoot).TrimEnd('\') + '\'
    $ResolvedKnownFolderState = [System.IO.Path]::GetFullPath(
        (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'DeepSeek-Herness')
    )
    $InsideTemporaryRoot = ($ResolvedStateRoot + '\').StartsWith($ResolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)
    $IsIsolatedKnownFolder = $UseRealKnownFolder -and
        $ResolvedStateRoot.Equals($ResolvedKnownFolderState, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $RepairStateSentinel) -and
        ((Get-Content -Raw -LiteralPath $RepairStateSentinel) -eq $RepairStateText)
    if (-not ($InsideTemporaryRoot -or $IsIsolatedKnownFolder)) {
        throw "refusing to remove unverified smoke state: $ResolvedStateRoot"
    }
    Remove-Item -LiteralPath $ResolvedStateRoot -Recurse -Force
    if (Test-Path -LiteralPath $ResolvedStateRoot) { throw 'retained test state could not be deleted after uninstall' }

    [pscustomobject]@{ Installer = $Installer; InstallRoot = $InstallRoot; StateRoot = $StateRoot; Status = 'passed' }
} finally {
    $env:DSH_PORTABLE_STATE_ROOT = $PriorStateRoot
    $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC = $PriorLauncherDiagnostic
    $env:LOCALAPPDATA = $PriorLocalAppData
    $env:DSH_PORTABLE_TEST_HIDDEN = $PriorTestHidden
    if ($PriorUserPathExisted) {
        Set-ItemProperty -LiteralPath $UserEnvironmentKey -Name Path -Value $PriorUserPath
    } else {
        Remove-ItemProperty -LiteralPath $UserEnvironmentKey -Name Path -ErrorAction SilentlyContinue
    }
    if ($PriorCommandPathExisted) {
        New-Item -ItemType Directory -Force -Path $CommandOwnershipKey | Out-Null
        Set-ItemProperty -LiteralPath $CommandOwnershipKey -Name InstalledCommandPath -Value $PriorCommandPath
    } else {
        Remove-ItemProperty -LiteralPath $CommandOwnershipKey -Name InstalledCommandPath -ErrorAction SilentlyContinue
        if ((-not $PriorCommandKeyExisted) -and (Test-Path -LiteralPath $CommandOwnershipKey)) {
            Remove-Item -LiteralPath $CommandOwnershipKey -ErrorAction SilentlyContinue
        }
    }
}
