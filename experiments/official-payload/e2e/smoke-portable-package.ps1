[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [Parameter(Mandatory=$true)][string]$EvidenceRoot,
    [switch]$Bootstrap,
    [string]$LocalInstallerFile
)

$ErrorActionPreference = 'Stop'
if ($LocalInstallerFile -and -not $Bootstrap) { throw 'LocalInstallerFile requires the Lite bootstrap smoke.' }
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Run this script with Windows PowerShell 5.1.' }
$Archive = [IO.Path]::GetFullPath($Archive)
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$MovedRoot = $WorkRoot + '-moved'
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$SmokePackage = Join-Path $RepositoryRoot 'experiments/official-payload/channel/smoke-package.ps1'
$VerifyPage = Join-Path $RepositoryRoot 'experiments/official-payload/channel/verify-smoke-page.mjs'
$CloseApp = Join-Path $PSScriptRoot 'close-app.mjs'
$script:PortableRoot = $WorkRoot
$script:LauncherProcess = $null
$script:ProbePort = 0
$script:Failure = $null
$script:FirstStartPassed = $false
$script:SecondStartHealthPassed = $false
$script:NormalExitPassed = $false
$script:BeforeMoveDumpPassed = $false
$script:AfterMoveDumpPassed = $false
$script:LauncherExitCode = $null
$script:Page = $null

function Read-SharedText([string]$Path) {
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        try {
            $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
            try {
                $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
                return $reader.ReadToEnd()
            } finally { $stream.Dispose() }
        } catch {
            if ($attempt -eq 40) { throw }
            Start-Sleep -Milliseconds 150
        }
    }
}

function Read-SharedJson([string]$Path) {
    try {
        $text = Read-SharedText $Path
        if ([string]::IsNullOrWhiteSpace($text)) { return $null }
        return ($text | ConvertFrom-Json)
    } catch { return $null }
}

function Get-FreeLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return [int]$listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

function Start-SecondPortableRun([string]$Root) {
    $launcher = Join-Path $Root 'DeepSeek Harness Portable.exe'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Extracted Portable launcher is missing before the second startup.' }
    $script:ProbePort = Get-FreeLoopbackPort
    $script:LauncherProcess = Start-Process -FilePath $launcher -WorkingDirectory $Root -ArgumentList ("--probe-port=" + $script:ProbePort) -WindowStyle Hidden -PassThru
    $healthDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $healthDeadline) {
        if ($script:LauncherProcess.HasExited) { throw 'Portable launcher exited during the second-start health window.' }
        Start-Sleep -Milliseconds 500
    }

    $node = (Get-Command node.exe -ErrorAction Stop | Select-Object -First 1).Source
    $pagePath = Join-Path $EvidenceRoot 'second-start-page.json'
    $pageText = & $node $VerifyPage $script:ProbePort
    $pageExit = $LASTEXITCODE
    $pageTextValue = [string]::Join([Environment]::NewLine, @($pageText))
    [IO.File]::WriteAllText($pagePath, $pageTextValue + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    if ($pageExit -ne 0) { throw "Official page did not render after the second startup; see $pagePath." }
    $page = $pageTextValue | ConvertFrom-Json
    if (-not $page.rendered -or [int]$page.bodyTextLength -lt 5 -or [string]::IsNullOrWhiteSpace([string]$page.title)) { throw 'Second-start official page evidence is incomplete.' }
    if ($script:LauncherProcess.HasExited) { throw 'Portable launcher exited before the second-start health check completed.' }
    $script:SecondStartHealthPassed = $true
    $script:Page = $page

    & $node $CloseApp $script:ProbePort
    if ($LASTEXITCODE -ne 0) { throw 'Could not request a normal official application exit after the second startup.' }
    if (-not $script:LauncherProcess.WaitForExit(45000)) { throw 'Portable launcher did not exit normally after the second-start Browser.close request.' }
    $script:LauncherExitCode = $script:LauncherProcess.ExitCode
    if ($script:LauncherExitCode -ne 0) { throw "Second-start Portable launcher exited with code $($script:LauncherExitCode)." }
    $script:NormalExitPassed = $true
}

function Invoke-DumpConfig([string]$Root, [string]$OutputPath, [string]$ErrorPath) {
    $current = Read-SharedJson (Join-Path $Root 'app/current.json')
    if ($null -eq $current -or -not $current.version) { throw 'Portable current version is unavailable for the probe dump.' }
    $dshCmd = Join-Path $Root ("app/$($current.version)/resources/runtime/cli/bin/dsh.cmd")
    if (-not (Test-Path -LiteralPath $dshCmd -PathType Leaf)) { throw "Official dsh.cmd is missing: $dshCmd" }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = Join-Path $env:SystemRoot 'System32/cmd.exe'
    $start.Arguments = '/d /s /c ""' + $dshCmd + '" --profile probe --dump-config"'
    $start.WorkingDirectory = $Root
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['DSH_HOME'] = Join-Path $Root 'data/dsh-home'
    $process = [Diagnostics.Process]::Start($start)
    try {
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(90000)) {
            try { $process.Kill() } catch {}
            throw 'Official --dump-config did not finish within 90 seconds.'
        }
        $process.WaitForExit()
        $stdout = $stdoutTask.Result
        $stderr = $stderrTask.Result
        [IO.File]::WriteAllText($OutputPath, $stdout, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($ErrorPath, $stderr, [Text.UTF8Encoding]::new($false))
        if ($process.ExitCode -ne 0) { throw "dsh.cmd --profile probe --dump-config returned $($process.ExitCode); see $OutputPath and $ErrorPath." }
        return $stdout
    } finally { $process.Dispose() }
}

function Assert-DumpConfig([string]$Root, [string]$Prefix) {
    $outputPath = Join-Path $EvidenceRoot ($Prefix + '.dump.stdout.log')
    $errorPath = Join-Path $EvidenceRoot ($Prefix + '.dump.stderr.log')
    $null = Invoke-DumpConfig $Root $outputPath $errorPath
    return $true
}

function Save-TextEvidence([string]$Source, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
    $text = Read-SharedText $Source
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot $Name), $text, [Text.UTF8Encoding]::new($false))
}

try {
    New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
    if (Test-Path -LiteralPath $MovedRoot) { throw "Smoke move destination already exists: $MovedRoot" }
    & $SmokePackage -Archive $Archive -WorkRoot $WorkRoot -Bootstrap:$Bootstrap -LocalInstallerFile $LocalInstallerFile -EvidenceRoot $EvidenceRoot
    $firstStartReport = Read-SharedJson (Join-Path $WorkRoot 'smoke-report.json')
    if ($null -eq $firstStartReport -or $firstStartReport.overallPassed -ne $true -or $firstStartReport.launcherExitCode -ne 0) { throw 'First-start package smoke did not report a verified normal exit.' }
    $script:FirstStartPassed = $true

    Start-SecondPortableRun $WorkRoot

    foreach ($relative in @('launcher/seed', 'launcher/seed-plugins.ps1', 'launcher/seed-plugins-core.psm1', 'data/launcher/seed-status.json', 'data/launcher/seeded.json')) {
        if (Test-Path -LiteralPath (Join-Path $WorkRoot $relative)) { throw "A plugin-free package must not contain or create seed state: $relative" }
    }

    $desktop = Join-Path $WorkRoot 'data/dsh-home/profiles/desktop'
    $probe = Join-Path $WorkRoot 'data/dsh-home/profiles/probe'
    if (-not (Test-Path -LiteralPath $desktop -PathType Container)) { throw 'Official desktop profile is missing after the second startup.' }
    if (Test-Path -LiteralPath $probe) { throw 'Probe profile already exists; refusing to overwrite it.' }
    Copy-Item -LiteralPath $desktop -Destination $probe -Recurse -Force -ErrorAction Stop
    $script:BeforeMoveDumpPassed = Assert-DumpConfig $WorkRoot 'before-move'

    [IO.Directory]::Move($WorkRoot, $MovedRoot)
    $script:PortableRoot = $MovedRoot
    $script:AfterMoveDumpPassed = Assert-DumpConfig $MovedRoot 'after-move'
    Write-Host 'Second startup, dump-config and moved-root checks passed.'
} catch {
    $script:Failure = $_.Exception.Message
} finally {
    if ($null -ne $script:LauncherProcess -and -not $script:LauncherProcess.HasExited) {
        try {
            $node = (Get-Command node.exe -ErrorAction Stop | Select-Object -First 1).Source
            if ($script:ProbePort -gt 0) { & $node $CloseApp $script:ProbePort *> $null }
        } catch {}
        $null = $script:LauncherProcess.WaitForExit(45000)
        if (-not $script:LauncherProcess.HasExited) {
            try { $null = $script:LauncherProcess.CloseMainWindow() } catch {}
            $null = $script:LauncherProcess.WaitForExit(15000)
        }
    }
    try {
        $rootForEvidence = $script:PortableRoot
        Save-TextEvidence (Join-Path $rootForEvidence 'data/launcher/launcher.log') 'launcher.log'
        Save-TextEvidence (Join-Path $rootForEvidence 'smoke-report.json') 'first-start-smoke-report.json'
        Save-TextEvidence (Join-Path $rootForEvidence 'smoke-page.json') 'first-start-smoke-page.json'
    } catch {
        if (-not $script:Failure) { $script:Failure = 'Could not preserve smoke evidence: ' + $_.Exception.Message }
    }
    $movedReportRoot = $null
    if (Test-Path -LiteralPath $MovedRoot) { $movedReportRoot = $MovedRoot }
    $report = [ordered]@{
        firstStartSmokePassed = $script:FirstStartPassed
        bootstrapInstallExpected = [bool]$Bootstrap
        localFirstInstallExpected = [bool]$LocalInstallerFile
        secondStartHealthPassed = $script:SecondStartHealthPassed
        secondStartNormalExitPassed = $script:NormalExitPassed
        secondStartLauncherExitCode = $script:LauncherExitCode
        beforeMoveDumpPassed = $script:BeforeMoveDumpPassed
        afterMoveDumpPassed = $script:AfterMoveDumpPassed
        secondStartPage = $script:Page
        portableRootAfterMove = $movedReportRoot
        failure = $script:Failure
    }
    try { [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'package-smoke-report.json'), (($report | ConvertTo-Json -Depth 16) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false)) }
    catch { if (-not $script:Failure) { $script:Failure = 'Could not write the smoke report: ' + $_.Exception.Message } }
}

if ($script:Failure) {
    Write-Host ('Package smoke failed: ' + $script:Failure)
    exit 1
}
exit 0
