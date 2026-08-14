[CmdletBinding()]
param(
    [string]$Installer = (Join-Path (Join-Path $PSScriptRoot '..') 'artifacts\DeepSeek-Herness-Setup.exe')
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
    foreach ($LogName in @('dsh.stderr.log', 'dsh.stdout.log')) {
        $Log = Join-Path $StateRoot ("logs\$LogName")
        if (Test-Path -LiteralPath $Log) {
            Write-Host "--- $LogName ---"
            Get-Content -LiteralPath $Log -Tail 160 | ForEach-Object { Write-Host $_ }
        }
    }
}

$TestId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$TempRoot = [System.IO.Path]::GetTempPath()
$InstallRoot = Join-Path $TempRoot ("dsh-i-$TestId")
$StateRoot = Join-Path $TempRoot ("dsh-s-$TestId")
$SetupLog = Join-Path $TempRoot ("dsh-setup-$TestId.log")
$LauncherDiagnostic = Join-Path $TempRoot ("dsh-launcher-$TestId.log")
$PriorStateRoot = $env:DSH_PORTABLE_STATE_ROOT
$PriorLauncherDiagnostic = $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC

try {
    $env:DSH_PORTABLE_STATE_ROOT = $StateRoot
    $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC = $LauncherDiagnostic
    $Setup = Invoke-BoundedProcess -Stage 'Install package' -TimeoutSeconds 300 -FilePath $Installer -ArgumentList @(
            '/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NOCANCEL', '/NORESTART', '/CURRENTUSER',
            "/DIR=$InstallRoot", "/LOG=$SetupLog"
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
        'Stop DeepSeek-Herness.exe',
        'installed-mode.json',
        'unins000.exe',
        'app\node_modules\@earendil-works\pi-ai\dist\providers\data\amazon-bedrock.json'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $Name))) { throw "installed file is missing: $Name" }
    }

    $Started = Invoke-BoundedProcess -Stage 'Start installed runtime' -TimeoutSeconds 90 `
        -FilePath (Join-Path $InstallRoot 'DeepSeek-Herness.exe') -ArgumentList @('--no-browser', '--json')
    if ($Started.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $LauncherDiagnostic) {
            Write-Host '--- launcher diagnostic ---'
            Get-Content -LiteralPath $LauncherDiagnostic -Tail 240 | ForEach-Object { Write-Host $_ }
        }
        Write-RuntimeDiagnostics
        throw "installed launcher exited with code $($Started.ExitCode)"
    }
    $Node = Join-Path $InstallRoot 'runtime\node\node.exe'
    $Cli = Join-Path $InstallRoot 'launcher\portable-cli.mjs'
    $Status = (& $Node $Cli status --json | ConvertFrom-Json)
    if ($Status.status -ne 'running') { throw "installed runtime status is $($Status.status)" }
    $Response = Invoke-WebRequest -UseBasicParsing -Uri $Status.url -TimeoutSec 10
    if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 500) { throw "installed Web returned $($Response.StatusCode)" }

    $Stopped = Invoke-BoundedProcess -Stage 'Stop installed runtime' -TimeoutSeconds 60 `
        -FilePath (Join-Path $InstallRoot 'Stop DeepSeek-Herness.exe')
    if ($Stopped.ExitCode -ne 0) {
        Write-RuntimeDiagnostics
        throw "installed stop entry exited with code $($Stopped.ExitCode)"
    }
    if ((& $Node $Cli status --json | ConvertFrom-Json).status -ne 'stopped') { throw 'installed runtime did not stop' }
    if (-not (Test-Path -LiteralPath (Join-Path $StateRoot 'data\portable.json'))) { throw 'installed state was not written outside the app' }

    $Uninstall = Invoke-BoundedProcess -Stage 'Uninstall package' -TimeoutSeconds 300 `
        -FilePath (Join-Path $InstallRoot 'unins000.exe') `
        -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
    if ($Uninstall.ExitCode -ne 0) { throw "uninstaller exited with code $($Uninstall.ExitCode)" }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'DeepSeek-Herness.exe')) { throw 'uninstaller retained application binaries' }
    if (-not (Test-Path -LiteralPath $StateRoot)) { throw 'uninstaller deleted user state' }

    [pscustomobject]@{ Installer = $Installer; InstallRoot = $InstallRoot; StateRoot = $StateRoot; Status = 'passed' }
} finally {
    $env:DSH_PORTABLE_STATE_ROOT = $PriorStateRoot
    $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC = $PriorLauncherDiagnostic
}
