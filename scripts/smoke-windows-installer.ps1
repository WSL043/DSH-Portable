[CmdletBinding()]
param(
    [string]$Installer = (Join-Path (Join-Path $PSScriptRoot '..') 'artifacts\DeepSeek-Herness-Setup.exe')
)

$ErrorActionPreference = 'Stop'
$Installer = [System.IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $Installer)) { throw "Installer is missing: $Installer" }

$TestId = [Guid]::NewGuid().ToString('N')
$InstallRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("DeepSeek-Herness-installed-$TestId")
$StateRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("DeepSeek-Herness-state-$TestId")
$PriorStateRoot = $env:DSH_PORTABLE_STATE_ROOT

try {
    $env:DSH_PORTABLE_STATE_ROOT = $StateRoot
    $Setup = Start-Process -FilePath $Installer -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', "/DIR=$InstallRoot"
    ) -PassThru -Wait
    if ($Setup.ExitCode -ne 0) { throw "installer exited with code $($Setup.ExitCode)" }

    foreach ($Name in @('DeepSeek-Herness.exe', 'Stop DeepSeek-Herness.exe', 'installed-mode.json', 'unins000.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $Name))) { throw "installed file is missing: $Name" }
    }

    $Started = Start-Process -FilePath (Join-Path $InstallRoot 'DeepSeek-Herness.exe') -ArgumentList @('--no-browser', '--json') -PassThru -Wait
    if ($Started.ExitCode -ne 0) { throw "installed launcher exited with code $($Started.ExitCode)" }
    $Node = Join-Path $InstallRoot 'runtime\node\node.exe'
    $Cli = Join-Path $InstallRoot 'launcher\portable-cli.mjs'
    $Status = (& $Node $Cli status --json | ConvertFrom-Json)
    if ($Status.status -ne 'running') { throw "installed runtime status is $($Status.status)" }
    $Response = Invoke-WebRequest -UseBasicParsing -Uri $Status.url -TimeoutSec 10
    if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 500) { throw "installed Web returned $($Response.StatusCode)" }

    $Stopped = Start-Process -FilePath (Join-Path $InstallRoot 'Stop DeepSeek-Herness.exe') -PassThru -Wait
    if ($Stopped.ExitCode -ne 0) { throw "installed stop entry exited with code $($Stopped.ExitCode)" }
    if ((& $Node $Cli status --json | ConvertFrom-Json).status -ne 'stopped') { throw 'installed runtime did not stop' }
    if (-not (Test-Path -LiteralPath (Join-Path $StateRoot 'data\portable.json'))) { throw 'installed state was not written outside the app' }

    $Uninstall = Start-Process -FilePath (Join-Path $InstallRoot 'unins000.exe') -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -PassThru -Wait
    if ($Uninstall.ExitCode -ne 0) { throw "uninstaller exited with code $($Uninstall.ExitCode)" }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'DeepSeek-Herness.exe')) { throw 'uninstaller retained application binaries' }
    if (-not (Test-Path -LiteralPath $StateRoot)) { throw 'uninstaller deleted user state' }

    [pscustomobject]@{ Installer = $Installer; InstallRoot = $InstallRoot; StateRoot = $StateRoot; Status = 'passed' }
} finally {
    $env:DSH_PORTABLE_STATE_ROOT = $PriorStateRoot
}
