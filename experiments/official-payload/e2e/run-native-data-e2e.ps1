param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Candidate,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [Parameter(Mandatory=$true)][string]$NativeArchive,
    [Parameter(Mandatory=$true)][string]$Origin,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [string]$IndexBaselineCandidate = (Join-Path $PSScriptRoot '../candidate.json'),
    [string]$PasswordFile = ''
)
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot '../Payload.psm1') -Force -DisableNameChecking
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot); Assert-PlainPath $WorkRoot
if (Test-Path -LiteralPath $WorkRoot) { throw 'Use a fresh acceptance work root' }
$evidence = Join-Path $WorkRoot 'evidence'; $portable = Join-Path $WorkRoot 'portable'
$null = New-Item -ItemType Directory -Path $evidence -Force
$node = (Get-Command node.exe -ErrorAction Stop | Select-Object -First 1).Source
$report = [ordered]@{ passed=$false; archiveMode=$(if ($PasswordFile) { 'encrypted' } else { 'plain' }); sourceCommit=$env:GITHUB_SHA; rounds=@(); failure=$null; protocolRestored=$false; ownedProcessesRemaining=@(); releaseQualified=$false }
$indexProcess = $null; $launcher = $null; $probePort = 0
$previousLocalFeed = [Environment]::GetEnvironmentVariable('DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED')

# Capture every value and kind in the complete protocol tree. A command-only
# comparison could hide changes made by the official app to its parent keys.
function Get-ProtocolTree {
    $records = New-Object 'System.Collections.Generic.List[object]'
    function Read-ProtocolKey([string]$Relative) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(('Software\Classes\dsh' + $Relative), $false)
        if (-not $key) { return }
        try {
            $values = @(foreach ($name in @($key.GetValueNames() | Sort-Object)) {
                [ordered]@{ name=$name; kind=[string]$key.GetValueKind($name); data=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
            })
            $records.Add([ordered]@{ path=$Relative; values=$values })
            foreach ($child in @($key.GetSubKeyNames() | Sort-Object)) { Read-ProtocolKey ($Relative + '\' + $child) }
        } finally { $key.Dispose() }
    }
    Read-ProtocolKey ''
    ConvertTo-Json -InputObject @($records.ToArray()) -Depth 16 -Compress
}
function Free-Port {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start(); try { $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
function Save-Json([string]$Name, $Value) {
    [IO.File]::WriteAllText((Join-Path $evidence $Name), (($Value | ConvertTo-Json -Depth 16) + "`n"), [Text.UTF8Encoding]::new($false))
}
$protocolBefore = Get-ProtocolTree
[IO.File]::WriteAllText((Join-Path $evidence 'protocol-before.json'), $protocolBefore)
try {
    # Reuse the accepted-index server without downloading a second installer.
    $old = Join-Path $WorkRoot 'old-candidate.json'; $current = Join-Path $WorkRoot 'candidate.json'
    & $node (Join-Path $PSScriptRoot 'report.mjs') candidate $IndexBaselineCandidate $old
    if ($LASTEXITCODE -ne 0) { throw 'Could not normalize the old index fixture' }
    & $node (Join-Path $PSScriptRoot 'report.mjs') candidate $Candidate $current
    if ($LASTEXITCODE -ne 0) { throw 'Could not normalize the actual candidate' }
    $indexOutput = Join-Path $evidence 'index-server.log'
    $indexArgs = @((Join-Path $PSScriptRoot 'index-server.mjs'),$old,$current,'0',(Join-Path $evidence 'index-requests.jsonl')) | ForEach-Object { '"' + $_ + '"' }
    $indexProcess = Start-Process -FilePath $node -ArgumentList ($indexArgs -join ' ') -WindowStyle Hidden -PassThru -RedirectStandardOutput $indexOutput -RedirectStandardError (Join-Path $evidence 'index-server.stderr.log')
    $null = $indexProcess.Handle; $ready = $null; $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not $ready -and [DateTime]::UtcNow -lt $deadline) {
        if ($indexProcess.HasExited) { throw 'Accepted-index fixture server exited' }
        try { $ready = Get-Content -LiteralPath $indexOutput -Raw | ConvertFrom-Json } catch { }
        if (-not $ready) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) { throw 'Accepted-index fixture server did not become ready' }
    $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED = '1'
    $cacheName = 'dsh-native-transfer-' + [guid]::NewGuid().ToString('N')
    $report.cachePath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $cacheName
    & (Join-Path $PSScriptRoot '../package-pure.ps1') -Installer $Installer -Output $portable -SevenZip $SevenZip -FeedUrl $ready.baseUrl -IndexUrl $ready.indexUrl -CacheDirName $cacheName
    $inputArchive = Join-Path $WorkRoot 'input.dshdata'
    [IO.File]::Copy([IO.Path]::GetFullPath($NativeArchive), $inputArchive, $false)
    $report.inputArchiveSha256 = (Get-FileHash -LiteralPath $inputArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    # The maintenance CLI confines both inputs and outputs to the operator's cwd.
    # Only this new work root is used; the downloaded source archive stays intact.
    $importArguments = @((Join-Path $PSScriptRoot '../import-native-data.mjs'), $inputArchive, $portable)
    if ($PasswordFile) {
        $inputPassword = Join-Path $WorkRoot 'synthetic-password.txt'
        [IO.File]::Copy([IO.Path]::GetFullPath($PasswordFile), $inputPassword, $false)
        $importArguments += @('--password-file', $inputPassword)
    }
    Push-Location -LiteralPath $WorkRoot
    try {
        & $node @importArguments
        if ($LASTEXITCODE -ne 0) { throw 'Native archive import failed' }
    } finally { Pop-Location }
    $version = [string](Get-Content -LiteralPath $current -Raw | ConvertFrom-Json).version
    & $node (Join-Path $PSScriptRoot '../../../scripts/check-official-payload-security.mjs') (Join-Path $portable ('app/' + $version + '/resources/app.asar')) --report-only --output (Join-Path $evidence 'official-security.json')
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the actual official ASAR' }
    $security = Get-Content -LiteralPath (Join-Path $evidence 'official-security.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $report.product = @{ version=$version; installerSha512Hex=(Get-FileHash -LiteralPath $Installer -Algorithm SHA512).Hash.ToLowerInvariant(); appAsarSha256=$security.appASARsha256; launcherSha256=(Get-FileHash -LiteralPath (Join-Path $portable 'DeepSeek Harness Portable.exe') -Algorithm SHA256).Hash.ToLowerInvariant(); securityQualificationAllowed=$security.qualificationAllowed }
    Copy-Item -LiteralPath $Origin -Destination (Join-Path $evidence 'origin.json')
    for ($round=1; $round -le 2; $round++) {
        $probePort = Free-Port
        $launcher = Start-Process -FilePath (Join-Path $portable 'DeepSeek Harness Portable.exe') -ArgumentList ('--probe-port=' + $probePort) -WorkingDirectory $portable -WindowStyle Hidden -PassThru
        $null = $launcher.Handle
        & $node (Join-Path $PSScriptRoot 'native-data.mjs') verify $portable $Origin $probePort $evidence
        if ($LASTEXITCODE -ne 0) { throw ('Native history/settings UI verification failed, round ' + $round) }
        & $node (Join-Path $PSScriptRoot 'close-app.mjs') $probePort
        if ($LASTEXITCODE -ne 0) { throw 'Browser.close failed' }
        if (-not $launcher.WaitForExit(45000)) { throw 'Launcher did not exit after Browser.close' }
        if ($launcher.ExitCode -ne 0) { throw ('Launcher exited with code ' + $launcher.ExitCode) }
        $protocolAfter = Get-ProtocolTree
        if ($protocolBefore -cne $protocolAfter) { throw 'Complete protocol tree was not restored' }
        $report.rounds += @{ round=$round; launcherExitCode=$launcher.ExitCode; protocolRestored=$true }
        $launcher.Dispose(); $launcher = $null
    }
    $report.passed = $true
} catch { $report.failure = $_.Exception.Message; throw }
finally {
    if ($launcher -and -not $launcher.HasExited) {
        try { & $node (Join-Path $PSScriptRoot 'close-app.mjs') $probePort | Out-Null } catch { }
        if (-not $launcher.WaitForExit(15000)) {
            $prefix = [IO.Path]::GetFullPath((Join-Path $portable 'app')).TrimEnd('\') + '\'
            # Only this freshly-created root's official processes are eligible.
            Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            if (-not $launcher.WaitForExit(20000)) { $launcher.Kill() }
        }
    }
    if ($launcher) { $launcher.Dispose() }
    if ($indexProcess) { if (-not $indexProcess.HasExited) { $indexProcess.Kill(); $indexProcess.WaitForExit() }; $indexProcess.Dispose() }
    [Environment]::SetEnvironmentVariable('DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED', $previousLocalFeed)
    $after = Get-ProtocolTree; $report.protocolRestored = $protocolBefore -ceq $after
    [IO.File]::WriteAllText((Join-Path $evidence 'protocol-after.json'), $after)
    $rootPrefix = [IO.Path]::GetFullPath($portable).TrimEnd('\') + '\'
    $report.ownedProcessesRemaining = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,Name,ExecutablePath)
    $report.passed = $report.passed -and $report.protocolRestored -and $report.ownedProcessesRemaining.Count -eq 0
    if (-not $report.passed -and -not $report.failure) { $report.failure = 'Final protocol/process restoration checks did not pass' }
    foreach ($file in @('launcher.log','native-import.json')) { $source = Join-Path $portable ('data/launcher/' + $file); if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $evidence $file) } }
    Save-Json 'native-data-report.json' $report
}
if (-not $report.passed) { throw $report.failure }
