[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$Fixture = (Join-Path (Join-Path $PSScriptRoot '..') 'tests\fixtures\dsh-portable-smoke-plugin'),
    [string]$ExpectedStateRoot,
    [switch]$InstalledMode
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$Fixture = [System.IO.Path]::GetFullPath($Fixture)
$Dsh = Join-Path $Root 'dsh.exe'
$Node = Join-Path $Root 'runtime\node\node.exe'
$PortableCli = Join-Path $Root 'launcher\portable-cli.mjs'
$Launcher = Join-Path $Root 'DeepSeek-Herness.exe'
$StopLauncher = Join-Path $Root 'Stop DeepSeek-Herness.exe'
foreach ($Required in @($Dsh, $Node, $PortableCli, $Launcher, $StopLauncher, (Join-Path $Root 'app\node_modules\pnpm\bin\pnpm.mjs'))) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { throw "plugin smoke prerequisite is missing: $Required" }
}
if (-not (Test-Path -LiteralPath $Fixture -PathType Container)) { throw "plugin fixture is missing: $Fixture" }

if (-not $ExpectedStateRoot) {
    $ExpectedStateRoot = $Root
}
$ExpectedStateRoot = [System.IO.Path]::GetFullPath($ExpectedStateRoot)
$Profile = 'web'
$ProfileRoot = Join-Path $ExpectedStateRoot "data\dsh-home\profiles\$Profile"
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-plugin-smoke-" + [Guid]::NewGuid().ToString('N'))
$PackageParent = Join-Path $TestRoot 'package source'
$PluginRoot = Join-Path $PackageParent 'package'
$PluginArchive = Join-Path $TestRoot 'generic plugin.tgz'
$RegistryScript = Join-Path $TestRoot 'registry.mjs'
$RegistryV1 = Join-Path $TestRoot 'plugin-v1.tgz'
$RegistryV2 = Join-Path $TestRoot 'plugin-v2.tgz'
$RegistryChannel = Join-Path $TestRoot 'registry-channel.txt'
$RegistryReady = Join-Path $TestRoot 'registry-ready.json'
$RegistryProcess = $null
$PriorPath = $env:PATH
$PriorStateRoot = $env:DSH_PORTABLE_STATE_ROOT
$PriorLauncherDiagnostic = $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC
$LauncherDiagnostic = Join-Path $ExpectedStateRoot 'data\logs\plugin-smoke-launcher.log'

function Invoke-Dsh {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $Lines = @(& $Dsh @Arguments 2>&1 | ForEach-Object { [string]$_ })
    if ($LASTEXITCODE -ne 0) {
        throw "dsh.exe failed ($LASTEXITCODE): dsh $($Arguments -join ' ')`n$($Lines -join [Environment]::NewLine)"
    }
    return ($Lines -join [Environment]::NewLine)
}

function Product-Status {
    $Deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $Raw = (& $Node $PortableCli status --json 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -eq 0) { return ($Raw | ConvertFrom-Json) }
        if ($Raw -notmatch 'Another portable launcher' -or [DateTime]::UtcNow -ge $Deadline) {
            throw "portable status failed: $Raw"
        }
        Start-Sleep -Milliseconds 100
    } while ($true)
}

function Start-Product {
    $Stdout = Join-Path $TestRoot 'launcher.stdout.log'
    $Stderr = Join-Path $TestRoot 'launcher.stderr.log'
    $Process = Start-Process -FilePath $Launcher -ArgumentList @('--no-browser', '--json') -PassThru -NoNewWindow `
        -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
    if (-not $Process.WaitForExit(60000)) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        throw 'product launcher did not exit within 60 seconds'
    }
    $Raw = ((Get-Content -Raw -LiteralPath $Stdout -ErrorAction SilentlyContinue) + [Environment]::NewLine +
        (Get-Content -Raw -LiteralPath $Stderr -ErrorAction SilentlyContinue)).Trim()
    if ($Process.ExitCode -ne 0) {
        $Diagnostic = if (Test-Path -LiteralPath $LauncherDiagnostic) {
            Get-Content -Raw -LiteralPath $LauncherDiagnostic
        } else { '(launcher diagnostic was not created)' }
        throw "product start failed: $Raw`n$Diagnostic"
    }
    $Status = Product-Status
    if ($Status.status -ne 'running') { throw "product status after start is $($Status.status)" }
    return $Status
}

function Stop-Product {
    $Stdout = Join-Path $TestRoot 'stop.stdout.log'
    $Stderr = Join-Path $TestRoot 'stop.stderr.log'
    $Process = Start-Process -FilePath $StopLauncher -PassThru -NoNewWindow `
        -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
    if (-not $Process.WaitForExit(60000)) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        throw 'product stop launcher did not exit within 60 seconds'
    }
    $Raw = ((Get-Content -Raw -LiteralPath $Stdout -ErrorAction SilentlyContinue) + [Environment]::NewLine +
        (Get-Content -Raw -LiteralPath $Stderr -ErrorAction SilentlyContinue)).Trim()
    if ($Process.ExitCode -ne 0) { throw "product stop failed: $Raw" }
    if ((Product-Status).status -ne 'stopped') { throw 'product did not stop' }
}

try {
    Write-Host '[plugin-smoke] preparing isolated finished product'
    New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $PackageParent | Out-Null
    Copy-Item -LiteralPath $Fixture -Destination $PluginRoot -Recurse
    & tar.exe -czf $PluginArchive -C $PackageParent 'package'
    if ($LASTEXITCODE -ne 0) { throw 'could not create the independent plugin fixture archive' }
    $RequiredSystemPaths = @(
        "$env:SystemRoot\System32",
        "$env:SystemRoot\System32\Wbem",
        "$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    )
    $PowerShellCore = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($PowerShellCore) { $RequiredSystemPaths += (Split-Path -Parent $PowerShellCore.Source) }
    $env:PATH = (($RequiredSystemPaths | Select-Object -Unique) -join [System.IO.Path]::PathSeparator)
    $env:DSH_PORTABLE_STATE_ROOT = $null
    $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC = $LauncherDiagnostic

    foreach ($Tool in @('node.exe', 'npm.cmd', 'npx.cmd', 'pnpm.cmd', 'dsh.exe')) {
        & "$env:SystemRoot\System32\where.exe" $Tool 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { throw "isolated PATH unexpectedly exposes $Tool" }
    }

    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\tests\fixtures\dsh-plugin-registry.mjs') -Destination $RegistryScript
    Copy-Item -LiteralPath $PluginArchive -Destination $RegistryV1
    $PluginManifest = Join-Path $PluginRoot 'package.json'
    $Manifest = Get-Content -Raw -LiteralPath $PluginManifest | ConvertFrom-Json
    $Manifest.version = '1.0.1'
    [System.IO.File]::WriteAllText($PluginManifest, (($Manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText(
        (Join-Path $PluginRoot 'cordis.patch.yml'),
        "- insert:`n    - id: dsh-portable-smoke-v2`n      name: '@deepseek-ai/cordis-plugin-timer'`n      disabled: true`n",
        [System.Text.UTF8Encoding]::new($false)
    )
    & tar.exe -czf $RegistryV2 -C $PackageParent 'package'
    if ($LASTEXITCODE -ne 0) { throw 'could not create the revised plugin fixture archive' }
    [System.IO.File]::WriteAllText($RegistryChannel, "1.0.0`n", [System.Text.UTF8Encoding]::new($false))
    $RegistryProcess = Start-Process -FilePath $Node -ArgumentList @($RegistryScript, $RegistryV1, $RegistryV2, $RegistryChannel, $RegistryReady) -PassThru -WindowStyle Hidden
    $ReadyDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path -LiteralPath $RegistryReady)) {
        if ($RegistryProcess.HasExited) { throw "fixture registry exited with code $($RegistryProcess.ExitCode)" }
        if ([DateTime]::UtcNow -gt $ReadyDeadline) { throw 'fixture registry did not become ready' }
        Start-Sleep -Milliseconds 100
    }
    $RegistryPort = [int]((Get-Content -Raw -LiteralPath $RegistryReady | ConvertFrom-Json).port)
    $Registry = "http://127.0.0.1:$RegistryPort"

    Write-Host '[plugin-smoke] add/list/dump v1'
    $AddOutput = Invoke-Dsh @('plugin', '--profile', $Profile, 'add', 'dsh-portable-smoke-plugin@1.0.0', '--registry', $Registry)
    if ($AddOutput -notmatch '不会自动重启|never restarts') { throw 'plugin mutation did not explain the manual restart boundary' }
    if (-not (Test-Path -LiteralPath (Join-Path $ProfileRoot 'package.json'))) {
        throw "plugin profile was not created in the product state root: $ProfileRoot"
    }

    $List = Invoke-Dsh @('plugin', '--profile', $Profile, 'list', '--depth', '0', '--json')
    if ($List -notmatch 'dsh-portable-smoke-plugin') { throw "plugin list does not include the fixture:`n$List" }
    $DumpV1 = Invoke-Dsh @('--profile', $Profile, '--dump-config')
    if ($DumpV1 -notmatch 'dsh-portable-smoke-v1') { throw 'dump-config did not compose the installed fixture' }

    # The installed launcher deliberately receives the same external root only
    # for process-lifecycle verification. Plugin commands above and below keep
    # the override empty, so installed-mode.json remains the path authority.
    Write-Host '[plugin-smoke] start without automatic restart'
    if ($InstalledMode) { $env:DSH_PORTABLE_STATE_ROOT = $ExpectedStateRoot }
    $BeforeUpdate = Start-Product
    $env:DSH_PORTABLE_STATE_ROOT = $null

    Write-Host '[plugin-smoke] update to v2 while product stays running'
    [System.IO.File]::WriteAllText($RegistryChannel, "1.0.1`n", [System.Text.UTF8Encoding]::new($false))
    $UpdateOutput = Invoke-Dsh @('plugin', '--profile', $Profile, 'update', 'dsh-portable-smoke-plugin', '--latest', '--force', '--registry', $Registry)
    if ($UpdateOutput -notmatch '不会自动重启|never restarts') { throw 'plugin update did not preserve the manual restart boundary' }
    Write-Host '[plugin-smoke] manual stop/restart and remove'
    $env:DSH_PORTABLE_STATE_ROOT = if ($InstalledMode) { $ExpectedStateRoot } else { $null }
    $AfterUpdate = Product-Status
    if ($AfterUpdate.pid -ne $BeforeUpdate.pid) { throw 'plugin update restarted or replaced the running DSH process' }
    $env:DSH_PORTABLE_STATE_ROOT = $null
    $DumpV2 = Invoke-Dsh @('--profile', $Profile, '--dump-config')
    if ($DumpV2 -notmatch 'dsh-portable-smoke-v2') { throw 'plugin update did not compose the revised fixture' }

    $env:DSH_PORTABLE_STATE_ROOT = if ($InstalledMode) { $ExpectedStateRoot } else { $null }
    Stop-Product
    $Restarted = Start-Product
    if ($Restarted.pid -eq $BeforeUpdate.pid) { throw 'manual restart did not create a new DSH process' }
    $env:DSH_PORTABLE_STATE_ROOT = $null

    $RemoveOutput = Invoke-Dsh @('plugin', '--profile', $Profile, 'remove', 'dsh-portable-smoke-plugin')
    if ($RemoveOutput -notmatch '不会自动重启|never restarts') { throw 'plugin removal did not preserve the manual restart boundary' }
    $ListAfterRemove = Invoke-Dsh @('plugin', '--profile', $Profile, 'list', '--depth', '0', '--json')
    if ($ListAfterRemove -match 'dsh-portable-smoke-plugin') { throw 'plugin remained installed after remove' }
    $DumpAfterRemove = Invoke-Dsh @('--profile', $Profile, '--dump-config')
    if ($DumpAfterRemove -match 'dsh-portable-smoke-v[12]') { throw 'removed plugin remained in dump-config' }

    $env:DSH_PORTABLE_STATE_ROOT = if ($InstalledMode) { $ExpectedStateRoot } else { $null }
    if ((Product-Status).pid -ne $Restarted.pid) { throw 'plugin removal restarted or replaced the running DSH process' }
    Stop-Product

    if (-not $InstalledMode) {
        Write-Host '[plugin-smoke] move folder and repeat local archive add/list/remove'
        $MovedRoot = "$Root-plugin-moved"
        if (Test-Path -LiteralPath $MovedRoot) { throw "plugin move target already exists: $MovedRoot" }
        Move-Item -LiteralPath $Root -Destination $MovedRoot
        $Root = $MovedRoot
        $ExpectedStateRoot = $MovedRoot
        $ProfileRoot = Join-Path $ExpectedStateRoot "data\dsh-home\profiles\$Profile"
        $Dsh = Join-Path $Root 'dsh.exe'
        $Node = Join-Path $Root 'runtime\node\node.exe'
        $PortableCli = Join-Path $Root 'launcher\portable-cli.mjs'
        $Launcher = Join-Path $Root 'DeepSeek-Herness.exe'
        $StopLauncher = Join-Path $Root 'Stop DeepSeek-Herness.exe'
        Invoke-Dsh @('plugin', '--profile', $Profile, 'add', $PluginArchive) | Out-Null
        $MovedList = Invoke-Dsh @('plugin', '--profile', $Profile, 'list', '--depth', '0', '--json')
        if ($MovedList -notmatch 'dsh-portable-smoke-plugin') { throw 'plugin management failed after moving the portable folder' }
        Invoke-Dsh @('plugin', '--profile', $Profile, 'remove', 'dsh-portable-smoke-plugin') | Out-Null
    }

    [pscustomobject]@{
        Root = $Root
        StateRoot = $ExpectedStateRoot
        Profile = $Profile
        StartPid = $BeforeUpdate.pid
        RestartPid = $Restarted.pid
        Status = 'passed'
    }
} finally {
    $env:PATH = $PriorPath
    $env:DSH_PORTABLE_STATE_ROOT = $PriorStateRoot
    $env:DSH_PORTABLE_LAUNCHER_DIAGNOSTIC = $PriorLauncherDiagnostic
    if ($RegistryProcess -and -not $RegistryProcess.HasExited) {
        Stop-Process -Id $RegistryProcess.Id -Force -ErrorAction SilentlyContinue
        $RegistryProcess.WaitForExit(5000) | Out-Null
    }
    if (Test-Path -LiteralPath $TestRoot) { Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
