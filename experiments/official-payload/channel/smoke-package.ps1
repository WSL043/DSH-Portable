[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [switch]$Bootstrap
)
$ErrorActionPreference = 'Stop'
$Archive = [IO.Path]::GetFullPath($Archive)
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "Package archive is missing: $Archive" }
if (Test-Path -LiteralPath $WorkRoot) { throw "Smoke destination already exists: $WorkRoot" }
$running = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { throw 'A DeepSeek Harness process already exists on this runner; refusing to start a second instance' }
if (@(Get-NetTCPConnection -State Listen -LocalPort 19387 -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Official fixed port 19387 is already occupied' }

function Get-ProtocolSnapshot {
    $path = 'Software\Classes\dsh\shell\open\command'
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path, $false)
    if ($null -eq $key) { return [ordered]@{ keyExists=$false; valueExists=$false; value=$null; kind=$null } }
    try {
        $exists = @($key.GetValueNames()) -contains ''
        $value = if ($exists) { $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
        $kind = if ($exists) { [string]$key.GetValueKind('') } else { $null }
        return [ordered]@{ keyExists=$true; valueExists=$exists; value=$value; kind=$kind }
    } finally { $key.Dispose() }
}

function Read-SharedJson([string]$Path) {
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        try {
            $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
            try { $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8); return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $stream.Dispose() }
        } catch { if ($attempt -eq 40) { throw }; Start-Sleep -Milliseconds 100 }
    }
}

$protocolBefore = Get-ProtocolSnapshot
$launcherProcess = $null
$normalExit = $false
try {
    New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
    Expand-Archive -LiteralPath $Archive -DestinationPath $WorkRoot
    $currentPath = Join-Path $WorkRoot 'app\current.json'
    if ($Bootstrap) {
        if (-not (Test-Path -LiteralPath (Join-Path $WorkRoot 'launcher/bootstrap.json') -PathType Leaf) -or (Test-Path -LiteralPath $currentPath)) { throw 'Lite package must contain a bootstrap marker and no current.json' }
        $appRoot = Join-Path $WorkRoot 'app'
        if ((Test-Path -LiteralPath $appRoot) -and @(Get-ChildItem -LiteralPath $appRoot -Directory).Count -ne 0) { throw 'Lite package contains an application version directory' }
    } else {
        $current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
        if (-not $current.version) { throw 'Packaged current.json does not identify its official version' }
        $current.previous = [string]$current.version
        $current.pendingHealth = $true
        [IO.File]::WriteAllText($currentPath, (($current | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
    }
    $launcher = Join-Path $WorkRoot 'DeepSeek Harness Portable.exe'
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $port = [int]$listener.LocalEndpoint.Port } finally { $listener.Stop() }
    $launcherProcess = Start-Process -FilePath $launcher -WorkingDirectory $WorkRoot -ArgumentList "--probe-port=$port" -WindowStyle Hidden -PassThru
    $logPath = Join-Path $WorkRoot 'data\launcher\launcher.log'
    $deadline = if ($Bootstrap) { [DateTime]::UtcNow.AddMinutes(45) } else { [DateTime]::UtcNow.AddMinutes(3) }
    $protocolReady = $false
    $currentReady = -not $Bootstrap
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($launcherProcess.HasExited) { throw "Portable launcher exited early with code $($launcherProcess.ExitCode)" }
        if ($Bootstrap -and (Test-Path -LiteralPath $currentPath -PathType Leaf)) {
            $current = Read-SharedJson $currentPath
            if ($current.version -and (Test-Path -LiteralPath (Join-Path $WorkRoot ("app/$($current.version)/DeepSeek Harness.exe")) -PathType Leaf)) { $currentReady = $true }
        }
        $snapshot = Get-ProtocolSnapshot
        if ($snapshot.value -and $snapshot.value.Contains('DeepSeek Harness Portable.exe') -and $snapshot.value.Contains('--open')) { $protocolReady = $true }
        $log = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw } else { '' }
        if ($protocolReady -and $currentReady -and $log.Contains('health window passed')) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $protocolReady) { throw 'dsh:// protocol was not transferred to the extracted launcher' }
    if (-not $currentReady) { throw 'Lite bootstrap did not install the accepted official version within 45 minutes.' }
    if (-not (Test-Path -LiteralPath $logPath) -or -not (Get-Content -LiteralPath $logPath -Raw).Contains('health window passed')) { throw 'The 20-second health window did not pass' }
    $node = (Get-Command node.exe -ErrorAction Stop | Select-Object -First 1).Source
    $pageEvidence = Join-Path $WorkRoot 'smoke-page.json'
    & $node (Join-Path $PSScriptRoot 'verify-smoke-page.mjs') $port | Set-Content -LiteralPath $pageEvidence -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Official page did not render through the launcher probe port' }
    $page = Get-Content -LiteralPath $pageEvidence -Raw | ConvertFrom-Json
    if (-not $page.rendered -or $page.bodyTextLength -lt 5) { throw 'Official page rendering evidence is incomplete' }
    # The official app re-registers dsh:// on its own schedule and the launcher writes its command back within a second,
    # so judge ownership over several samples instead of one instant.
    $ownedSamples = 0; $protocolWhileRunning = $null
    for ($sample = 0; $sample -lt 8; $sample++) {
        $protocolWhileRunning = Get-ProtocolSnapshot
        if ($protocolWhileRunning.value -and $protocolWhileRunning.value.Contains('DeepSeek Harness Portable.exe')) { $ownedSamples++ }
        Start-Sleep -Milliseconds 750
    }
    if ($ownedSamples -lt 6) { throw "The launcher did not retain dsh:// ownership during the smoke run ($ownedSamples of 8 samples)" }
    if (-not ($protocolWhileRunning.value -and $protocolWhileRunning.value.Contains('DeepSeek Harness Portable.exe'))) { $protocolWhileRunning = Get-ProtocolSnapshot }
    & $node (Join-Path $PSScriptRoot '..\e2e\close-app.mjs') $port
    if ($LASTEXITCODE -ne 0) { throw 'Could not request a normal official application exit over CDP' }
    if (-not $launcherProcess.WaitForExit(45000)) { throw 'Launcher did not exit normally after Browser.close' }
    $normalExit = $true
    $protocolAfter = Get-ProtocolSnapshot
    if ((ConvertTo-Json $protocolAfter -Compress) -cne (ConvertTo-Json $protocolBefore -Compress)) { throw 'The dsh:// registry command was not restored after normal exit' }
    $updateStatus = $null
    $statusPath = Join-Path $WorkRoot 'data/launcher/update-status.json'
    if (Test-Path -LiteralPath $statusPath) { try { $updateStatus = Read-SharedJson $statusPath } catch {} }
    if ($Bootstrap -and [string]$updateStatus.status -cne 'applied') { throw 'Lite bootstrap status did not report a completed install.' }
    $report = [ordered]@{ overallPassed=$true; bootstrapInstallPassed=[bool]$Bootstrap; officialVersion=[string]$current.version; updateStatus=$updateStatus; page=$page; healthWindowPassed=$true; protocolBefore=$protocolBefore; protocolDuring=$protocolWhileRunning; protocolAfter=$protocolAfter; launcherExitCode=$launcherProcess.ExitCode }
    [IO.File]::WriteAllText((Join-Path $WorkRoot 'smoke-report.json'), (($report | ConvertTo-Json -Depth 12) + "`n"), [Text.UTF8Encoding]::new($false))
    Write-Output ($report | ConvertTo-Json -Depth 12 -Compress)
} finally {
    if ($null -ne $launcherProcess -and -not $launcherProcess.HasExited) {
        if ($port -and (Get-Command node.exe -ErrorAction SilentlyContinue)) {
            try { & (Get-Command node.exe).Source (Join-Path $PSScriptRoot '..\e2e\close-app.mjs') $port *> $null } catch {}
            $null = $launcherProcess.WaitForExit(45000)
        }
        try { $null = $launcherProcess.CloseMainWindow(); $null = $launcherProcess.WaitForExit(15000) } catch {}
    }
    if (-not $normalExit -and $WorkRoot -and (Test-Path -LiteralPath $WorkRoot)) {
        $failure = [ordered]@{ overallPassed=$false; normalExit=$normalExit; protocolBefore=$protocolBefore; protocolAfter=(Get-ProtocolSnapshot) }
        [IO.File]::WriteAllText((Join-Path $WorkRoot 'smoke-report.json'), (($failure | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
    }
}
