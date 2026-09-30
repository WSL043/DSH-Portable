[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [Parameter(Mandatory=$true)][string]$EvidenceRoot,
    [switch]$Bootstrap
)

$ErrorActionPreference = 'Stop'
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
$script:SeedPassed = $false
$script:SecondStartHealthPassed = $false
$script:NormalExitPassed = $false
$script:BeforeMoveDumpPassed = $false
$script:AfterMoveDumpPassed = $false
$script:LauncherExitCode = $null
$script:Page = $null
$script:SeedStatus = $null
$script:SeededMarker = $null

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

function Get-ExpectedPlugins($Manifest) {
    $expected = @()
    foreach ($plugin in @($Manifest.plugins)) {
        $name = [string]$plugin.name
        $match = [Regex]::Match([string]$plugin.file, '^' + [Regex]::Escape($name) + '-(?<version>[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)\.tgz$')
        if (-not $match.Success) { throw "Seed manifest archive name does not match plugin '$name'." }
        $expected += [pscustomobject]@{ name=$name; version=$match.Groups['version'].Value; nameVersion=($name + '@' + $match.Groups['version'].Value) }
    }
    $expectedNames = @($expected | ForEach-Object { $_.name } | Sort-Object)
    if ($expected.Count -ne 2 -or ($expectedNames -join '|') -cne 'dsh-chat-manager|dsh-image-viewer') { throw 'Seed manifest must contain exactly dsh-image-viewer and dsh-chat-manager.' }
    return ,$expected
}

function Assert-SeedState([string]$Root) {
    $statusPath = Join-Path $Root 'data/launcher/seed-status.json'
    $markerPath = Join-Path $Root 'data/launcher/seeded.json'
    $status = Read-SharedJson $statusPath
    $marker = Read-SharedJson $markerPath
    if ($null -eq $status -or $null -eq $marker) { return $false }
    if ([string]$status.status -in @('failed', 'partial-failure')) { throw "Plugin seeding failed: $($status | ConvertTo-Json -Depth 8 -Compress)" }
    if ([string]$status.status -cne 'complete') { return $false }
    $manifest = Read-SharedJson (Join-Path $Root 'launcher/seed/seed.json')
    if ($null -eq $manifest) { throw 'Packaged seed manifest could not be read.' }
    $expected = Get-ExpectedPlugins $manifest
    $statusValues = @($status.plugins | Where-Object { $_.status -ceq 'seeded' } | ForEach-Object { [string]$_.name + '@' + [string]$_.version } | Sort-Object)
    $markerValues = @($marker.plugins | ForEach-Object { [string]$_.nameVersion } | Sort-Object)
    $expectedValues = @($expected | ForEach-Object { $_.nameVersion } | Sort-Object)
    if (@($status.plugins).Count -ne 2 -or ($statusValues -join '|') -cne ($expectedValues -join '|')) { throw "seed-status.json does not show both expected plugins as seeded: $($status | ConvertTo-Json -Depth 8 -Compress)" }
    if ([string]$marker.status -and [string]$marker.status -cne 'complete') { throw "seeded.json has an unexpected status: $($marker.status)" }
    if (@($marker.plugins).Count -ne 2 -or ($markerValues -join '|') -cne ($expectedValues -join '|')) { throw "seeded.json does not record both expected plugin versions: $($marker | ConvertTo-Json -Depth 8 -Compress)" }
    $script:SeedStatus = $status
    $script:SeededMarker = $marker
    return $true
}

function Start-SecondPortableRun([string]$Root) {
    $launcher = Join-Path $Root 'DeepSeek Harness Portable.exe'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Extracted Portable launcher is missing before the second startup.' }
    $script:ProbePort = Get-FreeLoopbackPort
    $script:LauncherProcess = Start-Process -FilePath $launcher -WorkingDirectory $Root -ArgumentList ("--probe-port=" + $script:ProbePort) -WindowStyle Hidden -PassThru
    $seedDeadline = [DateTime]::UtcNow.AddMinutes(4)
    $seedReady = $false
    while ([DateTime]::UtcNow -lt $seedDeadline) {
        if ($script:LauncherProcess.HasExited) { throw "Portable launcher exited during the second startup with code $($script:LauncherProcess.ExitCode)." }
        if (Assert-SeedState $Root) { $seedReady = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $seedReady) { throw 'Second startup did not complete plugin seeding within four minutes.' }
    $script:SeedPassed = $true

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

function Assert-DisabledDump([string]$Root, [string]$Prefix, $Plugins) {
    $outputPath = Join-Path $EvidenceRoot ($Prefix + '.dump.stdout.log')
    $errorPath = Join-Path $EvidenceRoot ($Prefix + '.dump.stderr.log')
    $dump = Invoke-DumpConfig $Root $outputPath $errorPath
    foreach ($plugin in $Plugins) {
        $index = $dump.IndexOf([string]$plugin.entryId, [StringComparison]::Ordinal)
        if ($index -lt 0) { throw "Dump config is missing Cordis entry '$($plugin.entryId)'; see $outputPath." }
        $start = [Math]::Max(0, $index - 120)
        $length = [Math]::Min(600, $dump.Length - $start)
        if ($dump.Substring($start, $length) -notmatch 'disabled["'']?\s*:\s*true|disabled:\s*true') { throw "Dump config does not mark '$($plugin.entryId)' disabled; see $outputPath." }
    }
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
    & $SmokePackage -Archive $Archive -WorkRoot $WorkRoot -Bootstrap:$Bootstrap
    if ($LASTEXITCODE -ne 0) { throw 'First-start package smoke failed.' }
    $script:FirstStartPassed = $true

    Start-SecondPortableRun $WorkRoot

    $desktop = Join-Path $WorkRoot 'data/dsh-home/profiles/desktop'
    $probe = Join-Path $WorkRoot 'data/dsh-home/profiles/probe'
    if (-not (Test-Path -LiteralPath $desktop -PathType Container)) { throw 'Official desktop profile is missing after the second startup.' }
    if (Test-Path -LiteralPath $probe) { throw 'Probe profile already exists; refusing to overwrite it.' }
    Copy-Item -LiteralPath $desktop -Destination $probe -Recurse -Force -ErrorAction Stop
    $manifest = Read-SharedJson (Join-Path $WorkRoot 'launcher/seed/seed.json')
    if ($null -eq $manifest -or @($manifest.plugins).Count -ne 2) { throw 'The packaged seed manifest is missing or does not contain two plugins.' }
    $script:BeforeMoveDumpPassed = Assert-DisabledDump $WorkRoot 'before-move' $manifest.plugins

    [IO.Directory]::Move($WorkRoot, $MovedRoot)
    $script:PortableRoot = $MovedRoot
    $script:AfterMoveDumpPassed = Assert-DisabledDump $MovedRoot 'after-move' $manifest.plugins
    Write-Host 'Second-start seed, disabled dump-config, and moved-root checks passed.'
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
        Save-TextEvidence (Join-Path $rootForEvidence 'data/launcher/seed-status.json') 'seed-status.json'
        Save-TextEvidence (Join-Path $rootForEvidence 'data/launcher/seeded.json') 'seeded.json'
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
        secondStartSeedPassed = $script:SeedPassed
        secondStartHealthPassed = $script:SecondStartHealthPassed
        secondStartNormalExitPassed = $script:NormalExitPassed
        secondStartLauncherExitCode = $script:LauncherExitCode
        beforeMoveDisabledDumpPassed = $script:BeforeMoveDumpPassed
        afterMoveDisabledDumpPassed = $script:AfterMoveDumpPassed
        secondStartPage = $script:Page
        seedStatus = $script:SeedStatus
        seededMarker = $script:SeededMarker
        portableRootAfterMove = $movedReportRoot
        failure = $script:Failure
    }
    try { [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'seed-smoke-report.json'), (($report | ConvertTo-Json -Depth 16) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false)) }
    catch { if (-not $script:Failure) { $script:Failure = 'Could not write the smoke report: ' + $_.Exception.Message } }
}

if ($script:Failure) {
    Write-Host ('Seed smoke failed: ' + $script:Failure)
    exit 1
}
exit 0
