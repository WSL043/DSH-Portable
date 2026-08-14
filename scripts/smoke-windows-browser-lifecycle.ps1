[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$StartExe = Join-Path $Root 'DeepSeek-Herness.exe'
$StopExe = Join-Path $Root 'Stop DeepSeek-Herness.exe'
$PortableNode = Join-Path $Root 'runtime\node\node.exe'
$PortableCli = Join-Path $Root 'launcher\portable-cli.mjs'
$BrowserProfile = Join-Path $Root 'data\browser'
$DecoyProfile = Join-Path $Root 'data\browser-decoy'
$WorkspaceMarker = Join-Path $Root 'workspace\browser-lifecycle-smoke.txt'
$HomeMarker = Join-Path $Root 'data\dsh-home\browser-lifecycle-smoke.txt'

foreach ($File in @($StartExe, $StopExe, $PortableNode, $PortableCli)) {
    if (-not (Test-Path -LiteralPath $File)) { throw "Portable file is missing: $File" }
}

function Get-BrowserProcessesForProfile {
    param([Parameter(Mandatory = $true)] [string]$Profile)
    $EscapedProfile = [regex]::Escape($Profile.Replace('/', '\'))
    $Pattern = '(?i)--user-data-dir="?{0}(?:"|\s|$)' -f $EscapedProfile
    @(
        Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\') -match $Pattern }
    )
}

function Get-PortableBrowserProcesses { @(Get-BrowserProcessesForProfile -Profile $BrowserProfile) }

function Stop-BrowserProfileFixture {
    param([Parameter(Mandatory = $true)] [string]$Profile)
    for ($Attempt = 0; $Attempt -lt 3; $Attempt++) {
        $Processes = @(Get-BrowserProcessesForProfile -Profile $Profile)
        if ($Processes.Count -eq 0) { return }
        $Ids = @{}; foreach ($Process in $Processes) { $Ids[[int]$Process.ProcessId] = $true }
        $Roots = @($Processes | Where-Object { -not $Ids.ContainsKey([int]$_.ParentProcessId) })
        if ($Roots.Count -eq 0) { $Roots = @($Processes[0]) }
        foreach ($Process in $Roots) {
            & taskkill.exe /PID $Process.ProcessId /T /F 2>$null | Out-Null
        }
        Start-Sleep -Milliseconds 250
    }
}

function Invoke-Launcher {
    param(
        [Parameter(Mandatory = $true)] [string]$FilePath,
        [string[]]$Arguments = @(),
        [int]$TimeoutMilliseconds = 90000
    )
    $Process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
        & taskkill.exe /PID $Process.Id /T /F 2>&1 | ForEach-Object { Write-Host $_ }
        $Process.WaitForExit(10000) | Out-Null
        throw "$([System.IO.Path]::GetFileName($FilePath)) timed out."
    }
    $Process.Refresh()
    if ($Process.ExitCode -ne 0) { throw "$([System.IO.Path]::GetFileName($FilePath)) exited with code $($Process.ExitCode)." }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $WorkspaceMarker), (Split-Path -Parent $HomeMarker) | Out-Null
[System.IO.File]::WriteAllText($WorkspaceMarker, 'workspace survives browser shutdown', [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($HomeMarker, 'home survives browser shutdown', [System.Text.UTF8Encoding]::new($false))
$WorkspaceDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $WorkspaceMarker).Hash
$HomeDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $HomeMarker).Hash

try {
    if ((Get-PortableBrowserProcesses).Count -ne 0) { throw 'browser lifecycle smoke started with an owned browser already running' }

    Invoke-Launcher -FilePath $StartExe -Arguments @('start', '--json')
    $Deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $OwnedBrowsers = @(Get-PortableBrowserProcesses)
        if ($OwnedBrowsers.Count -gt 0) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $Deadline)
    if ($OwnedBrowsers.Count -eq 0) { throw 'DeepSeek-Herness.exe did not launch a browser with the portable profile' }
    $BrowserState = Join-Path $Root 'data\runtime\browser.json'
    if (-not (Test-Path -LiteralPath $BrowserState)) { throw 'portable browser ownership state was not recorded' }

    $BrowserExecutable = $OwnedBrowsers[0].ExecutablePath
    $DecoyArguments = @('--headless=new', 'about:blank', "--user-data-dir=`"$DecoyProfile`"", '--no-first-run')
    Start-Process -FilePath $BrowserExecutable -ArgumentList $DecoyArguments -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
    $Deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $DecoyBrowsers = @(Get-BrowserProcessesForProfile -Profile $DecoyProfile)
        if ($DecoyBrowsers.Count -gt 0) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $Deadline)
    if ($DecoyBrowsers.Count -eq 0) { throw 'could not start the unrelated browser-profile safety fixture' }

    # Simulate an already-open browser inherited from a pre-fix package. The
    # Stop launcher must recover ownership from the exact profile path even
    # when no browser.json record is available.
    Remove-Item -LiteralPath $BrowserState -Force

    $StatusJson = & $PortableNode $PortableCli status --json
    if ($LASTEXITCODE -ne 0) { throw 'portable status command failed after start' }
    $Status = $StatusJson | ConvertFrom-Json
    if ($Status.status -ne 'running') { throw "portable host is not running after start: $($Status.status)" }

    Invoke-Launcher -FilePath $StopExe
    $Deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $RemainingBrowsers = @(Get-PortableBrowserProcesses)
        if ($RemainingBrowsers.Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $Deadline)
    if ($RemainingBrowsers.Count -ne 0) {
        throw "Stop DeepSeek-Herness.exe left portable browser processes running: $($RemainingBrowsers.ProcessId -join ', ')"
    }
    if (@(Get-BrowserProcessesForProfile -Profile $DecoyProfile).Count -eq 0) {
        throw 'Stop DeepSeek-Herness.exe terminated an unrelated browser profile'
    }

    $StoppedJson = & $PortableNode $PortableCli status --json
    if ($LASTEXITCODE -ne 0) { throw 'portable status command failed after stop' }
    $Stopped = $StoppedJson | ConvertFrom-Json
    if ($Stopped.status -ne 'stopped') { throw "portable host is still active after stop: $($Stopped.status)" }
    if (Test-Path -LiteralPath (Join-Path $Root 'data\runtime\process.json')) { throw 'host process state remained after stop' }
    if (Test-Path -LiteralPath (Join-Path $Root 'data\runtime\browser.json')) { throw 'browser process state remained after stop' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $WorkspaceMarker).Hash -ne $WorkspaceDigest) { throw 'workspace data changed during browser shutdown' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $HomeMarker).Hash -ne $HomeDigest) { throw 'DSH_HOME data changed during browser shutdown' }

    [pscustomobject]@{
        Root = $Root
        BrowserProcessesObserved = $OwnedBrowsers.Count
        Status = 'passed'
    }
} finally {
    & $PortableNode $PortableCli stop --json 2>$null | Out-Null
    Stop-BrowserProfileFixture -Profile $BrowserProfile
    Stop-BrowserProfileFixture -Profile $DecoyProfile
}
