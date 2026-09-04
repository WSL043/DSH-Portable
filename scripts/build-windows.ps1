[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$CacheDir,
    [string]$PreviewAppSource,
    [switch]$CoreOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot 'artifacts' }
if (-not $CacheDir) { $CacheDir = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-portable-cache' }
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$CacheDir = [System.IO.Path]::GetFullPath($CacheDir)
$Lock = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'upstream.lock.json') | ConvertFrom-Json
$DshLock = $Lock.dsh
$DefaultPluginsLock = $Lock.defaultPlugins
$PreviewReceipt = $null
if ($PreviewAppSource) {
    $PreviewAppSource = [System.IO.Path]::GetFullPath($PreviewAppSource)
    $PreviewReceiptPath = Join-Path $PreviewAppSource 'preview-runtime.json'
    $PreviewLock = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'upstream.preview.lock.json') | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath (Join-Path $PreviewAppSource 'node_modules\@deepseek-ai\dsh\package.json'))) {
        throw "Preview app source is incomplete: $PreviewAppSource"
    }
    if (-not (Test-Path -LiteralPath $PreviewReceiptPath)) {
        throw "Preview app source has no signed-off receipt: $PreviewReceiptPath"
    }
    $PreviewReceipt = Get-Content -Raw -LiteralPath $PreviewReceiptPath | ConvertFrom-Json
    if ($PreviewReceipt.dshVersion -ne $PreviewLock.dsh.version -or $PreviewReceipt.dshCommit -ne $PreviewLock.dsh.reviewedCommit) {
        throw 'Preview app receipt does not match upstream.preview.lock.json.'
    }
    $DshLock = $PreviewLock.dsh
    $DefaultPluginsLock = $PreviewLock.defaultPlugins
}
$Runtime = $Lock.node.runtimes.'win-x64'
$PortableVersion = (Get-Content -Raw (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json).version
$BuildId = [Guid]::NewGuid().ToString('N')
$StageParent = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-portable-win-" + $BuildId)
$Stage = Join-Path $StageParent 'DSH-Portable'
$Downloads = Join-Path $CacheDir 'downloads'
$Archive = Join-Path $Downloads $Runtime.archive
$Extracted = Join-Path $CacheDir ("node-$($Lock.node.version)-win-x64")
$NodeFolder = Join-Path $Extracted ("node-v$($Lock.node.version)-win-x64")
$WebView2Archive = Join-Path $Downloads ("Microsoft.Web.WebView2.$($Lock.webview2.version).nupkg")
$WebView2Extracted = Join-Path $CacheDir ("Microsoft.Web.WebView2-$($Lock.webview2.version)")
$WebView2Core = Join-Path $WebView2Extracted 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$WebView2WinForms = Join-Path $WebView2Extracted 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$WebView2Loader = Join-Path $WebView2Extracted 'runtimes\win-x64\native\WebView2Loader.dll'
$WebView2License = Join-Path $WebView2Extracted 'LICENSE.txt'
$NotificationArchive = Join-Path $Downloads ("Microsoft.Toolkit.Uwp.Notifications.$($Lock.windowsNotifications.version).nupkg")
$NotificationExtracted = Join-Path $CacheDir ("Microsoft.Toolkit.Uwp.Notifications-$($Lock.windowsNotifications.version)")
$NotificationAssembly = Join-Path $NotificationExtracted 'lib\net461\Microsoft.Toolkit.Uwp.Notifications.dll'
$NotificationLicense = Join-Path $NotificationExtracted 'License.md'
$ValueTupleArchive = Join-Path $Downloads ("System.ValueTuple.$($Lock.windowsNotifications.valueTupleVersion).nupkg")
$ValueTupleExtracted = Join-Path $CacheDir ("System.ValueTuple-$($Lock.windowsNotifications.valueTupleVersion)")
$ValueTupleAssembly = Join-Path $ValueTupleExtracted 'lib\net461\System.ValueTuple.dll'
$ValueTupleLicense = Join-Path $ValueTupleExtracted 'LICENSE.TXT'
$DefaultPlugins = @($DefaultPluginsLock.PSObject.Properties | ForEach-Object { $_.Value })

function Assert-Sha256([string]$Filename, [string]$Expected) {
    $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Filename).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Filename`nexpected: $Expected`nactual:   $Actual"
    }
}

function Copy-PortableSources([string]$Target) {
    foreach ($Directory in @('app', 'launcher', 'runtime\node', 'licenses', 'default-plugins', 'data', 'workspace')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Target $Directory) | Out-Null
    }
    Copy-Item -Recurse (Join-Path $ProjectRoot 'desktop-bridge') (Join-Path $Target 'desktop-bridge')
    Copy-Item (Join-Path $ProjectRoot 'app\package.json') (Join-Path $Target 'app\package.json')
    Copy-Item (Join-Path $ProjectRoot 'app\package-lock.json') (Join-Path $Target 'app\package-lock.json')
    Copy-Item -Recurse (Join-Path $ProjectRoot 'app\vendor') (Join-Path $Target 'app\vendor')
    foreach ($File in @('portable-core.mjs', 'portable-cli.mjs', 'portable-host.mjs', 'update-core.mjs', 'update-preflight.mjs', 'dsh-cli.mjs', 'http-readiness.mjs', 'default-plugins.mjs', 'repair-core.mjs', 'diagnostic-policy.mjs', 'data-transfer.mjs', 'data-import-preflight.mjs', 'operation-trace.mjs', 'runtime-capsule.mjs', 'runtime-entry.mjs', 'startup-trace.mjs')) {
        Copy-Item (Join-Path $ProjectRoot "launcher\$File") (Join-Path $Target "launcher\$File")
    }
    Copy-Item (Join-Path $ProjectRoot 'templates\DATA-MIGRATION.zh-CN.txt') (Join-Path $Target 'DATA-MIGRATION.zh-CN.txt')
    Copy-Item (Join-Path $ProjectRoot 'templates\DATA-MIGRATION.en.txt') (Join-Path $Target 'DATA-MIGRATION.en.txt')
    Copy-Item (Join-Path $ProjectRoot 'launcher\windows\dsh-terminal.cmd') (Join-Path $Target 'launcher\dsh-terminal.cmd')
    Copy-Item (Join-Path $ProjectRoot 'templates\USER-README.zh-CN.txt') (Join-Path $Target 'README.zh-CN.txt')
    Copy-Item (Join-Path $ProjectRoot 'templates\USER-README.en.txt') (Join-Path $Target 'README.en.txt')
    Copy-Item (Join-Path $ProjectRoot 'templates\DATA-README.txt') (Join-Path $Target 'data\README.txt')
    Copy-Item (Join-Path $ProjectRoot 'templates\WORKSPACE-README.txt') (Join-Path $Target 'workspace\README.txt')
    Copy-Item (Join-Path $ProjectRoot 'LICENSE') (Join-Path $Target 'licenses\DSH-Portable-LICENSE.txt')
    Copy-Item (Join-Path $ProjectRoot 'NOTICE.md') (Join-Path $Target 'licenses\DSH-Portable-NOTICE.md')
}

New-Item -ItemType Directory -Force -Path $OutputDir, $CacheDir, $Downloads, $Stage | Out-Null
$BuildLockPath = Join-Path $OutputDir '.build-windows.lock'
try {
    $BuildLock = [System.IO.File]::Open(
        $BuildLockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch {
    throw "Another Windows package build is writing to $OutputDir"
}

try {
    foreach ($DefaultPlugin in $DefaultPlugins) {
        $DefaultPluginArchive = Join-Path $Downloads ("$($DefaultPlugin.version)-$($DefaultPlugin.filename)")
        if (-not (Test-Path -LiteralPath $DefaultPluginArchive)) {
            Write-Host "Downloading pinned default plugin: $($DefaultPlugin.package) $($DefaultPlugin.version)"
            Invoke-WebRequest -UseBasicParsing -Uri $DefaultPlugin.url -OutFile $DefaultPluginArchive
        }
        Assert-Sha256 $DefaultPluginArchive $DefaultPlugin.sha256
    }

    if (-not (Test-Path -LiteralPath $WebView2Archive)) {
        Write-Host "Downloading pinned Microsoft WebView2 SDK: $($Lock.webview2.version)"
        Invoke-WebRequest -UseBasicParsing -Uri $Lock.webview2.url -OutFile $WebView2Archive
    }
    Assert-Sha256 $WebView2Archive $Lock.webview2.sha256
    if (-not (Test-Path -LiteralPath $WebView2Extracted)) {
        New-Item -ItemType Directory -Force -Path $WebView2Extracted | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($WebView2Archive, $WebView2Extracted)
    }
    foreach ($RequiredWebView2File in @($WebView2Core, $WebView2WinForms, $WebView2Loader, $WebView2License)) {
        if (-not (Test-Path -LiteralPath $RequiredWebView2File)) {
            throw "Pinned WebView2 SDK cache is incomplete: $RequiredWebView2File"
        }
    }

    foreach ($Dependency in @(
        @{ Name = 'Microsoft notification toolkit'; Archive = $NotificationArchive; Extracted = $NotificationExtracted; Url = $Lock.windowsNotifications.url; Sha256 = $Lock.windowsNotifications.sha256 },
        @{ Name = 'System.ValueTuple'; Archive = $ValueTupleArchive; Extracted = $ValueTupleExtracted; Url = $Lock.windowsNotifications.valueTupleUrl; Sha256 = $Lock.windowsNotifications.valueTupleSha256 }
    )) {
        if (-not (Test-Path -LiteralPath $Dependency.Archive)) {
            Write-Host "Downloading pinned $($Dependency.Name)"
            Invoke-WebRequest -UseBasicParsing -Uri $Dependency.Url -OutFile $Dependency.Archive
        }
        Assert-Sha256 $Dependency.Archive $Dependency.Sha256
        if (-not (Test-Path -LiteralPath $Dependency.Extracted)) {
            New-Item -ItemType Directory -Force -Path $Dependency.Extracted | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($Dependency.Archive, $Dependency.Extracted)
        }
    }
    foreach ($RequiredNotificationFile in @($NotificationAssembly, $NotificationLicense, $ValueTupleAssembly, $ValueTupleLicense)) {
        if (-not (Test-Path -LiteralPath $RequiredNotificationFile)) {
            throw "Pinned Windows notification dependency cache is incomplete: $RequiredNotificationFile"
        }
    }

    if (-not (Test-Path -LiteralPath $Archive)) {
        $Uri = "$($Lock.node.baseUrl)/$($Runtime.archive)"
        Write-Host "Downloading pinned Node.js runtime: $Uri"
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Archive
    }
    Assert-Sha256 $Archive $Runtime.sha256

    if (-not (Test-Path -LiteralPath (Join-Path $NodeFolder 'node.exe'))) {
        if (Test-Path -LiteralPath $Extracted) {
            throw "Pinned Node cache is incomplete. Remove only this cache directory and retry: $Extracted"
        }
        New-Item -ItemType Directory -Path $Extracted | Out-Null
        & tar.exe -x -f $Archive -C $Extracted
        if ($LASTEXITCODE -ne 0) { throw "Node archive extraction failed with exit code $LASTEXITCODE" }
    }

    $NodeExe = Join-Path $NodeFolder 'node.exe'
    $NpmCli = Join-Path $NodeFolder 'node_modules\npm\bin\npm-cli.js'
    $PackageLock = if ($PreviewAppSource) { $null } else { Join-Path $ProjectRoot 'app\package-lock.json' }
    if (-not (Test-Path -LiteralPath $NpmCli)) { throw "Pinned Node archive contains no npm CLI: $NpmCli" }
    if (-not $PreviewAppSource -and -not (Test-Path -LiteralPath $PackageLock)) { throw 'app/package-lock.json is required.' }

    $ReleasePolicy = @{}
    & $NodeExe (Join-Path $ProjectRoot 'scripts\version-policy.mjs') $PortableVersion | ForEach-Object {
        $Parts = $_ -split '=', 2
        if ($Parts.Count -eq 2) { $ReleasePolicy[$Parts[0]] = $Parts[1] }
    }
    if ($LASTEXITCODE -ne 0) { throw "product version policy failed with exit code $LASTEXITCODE" }
    $ReleaseChannel = $ReleasePolicy.channel
    $UpdateChannelTag = $ReleasePolicy.updateChannelTag
    if (-not $ReleaseChannel -or -not $UpdateChannelTag) { throw 'Product version policy returned no release channel.' }
    if ($ReleaseChannel -eq 'candidate' -and -not $PreviewAppSource) {
        throw 'Candidate builds require -PreviewAppSource; refusing to publish a stable DSH runtime behind a beta shell version.'
    }
    if ($ReleaseChannel -eq 'stable' -and $PreviewAppSource) {
        if ($PreviewReceipt.dshVersion -ne $Lock.dsh.version -or $PreviewReceipt.dshCommit -ne $Lock.dsh.reviewedCommit) {
            throw 'Stable source-pack receipt does not match upstream.lock.json.'
        }
        $DshLock = $Lock.dsh
        $DefaultPluginsLock = $Lock.defaultPlugins
    }
    $ShellFingerprint = (& $NodeExe (Join-Path $ProjectRoot 'scripts\shell-fingerprint.mjs') windows).Trim()
    if ($LASTEXITCODE -ne 0 -or $ShellFingerprint -notmatch '^[a-f0-9]{64}$') { throw 'Windows shell fingerprint generation failed.' }

    Copy-PortableSources $Stage
    if ($PreviewAppSource) {
        [System.IO.Directory]::Delete((Join-Path $Stage 'app'), $true)
        Copy-Item -Recurse -LiteralPath $PreviewAppSource -Destination (Join-Path $Stage 'app')
        $BridgeTarget = Join-Path $Stage 'app\node_modules\@wsl043\dsh-portable-desktop-bridge'
        $MarketTarget = Join-Path $Stage 'app\node_modules\@wsl043\dsh-portable-plugin-market'
        if (Test-Path -LiteralPath $BridgeTarget) { [System.IO.Directory]::Delete($BridgeTarget, $true) }
        if (Test-Path -LiteralPath $MarketTarget) { [System.IO.Directory]::Delete($MarketTarget, $true) }
        Copy-Item -Recurse -LiteralPath (Join-Path $ProjectRoot 'desktop-bridge') -Destination $BridgeTarget
        Copy-Item -Recurse -LiteralPath (Join-Path $ProjectRoot 'app\vendor\dsh-portable-plugin-market') -Destination $MarketTarget
    }
    foreach ($DefaultPlugin in $DefaultPlugins) {
        $DefaultPluginArchive = Join-Path $Downloads ("$($DefaultPlugin.version)-$($DefaultPlugin.filename)")
        Copy-Item $DefaultPluginArchive (Join-Path $Stage "default-plugins\$($DefaultPlugin.filename)")
    }
    Copy-Item $NodeExe (Join-Path $Stage 'runtime\node\node.exe')
    Copy-Item (Join-Path $NodeFolder 'LICENSE') (Join-Path $Stage 'licenses\Node.js-LICENSE.txt')

    if (-not $PreviewAppSource) {
        & $NodeExe (Join-Path $ProjectRoot 'scripts\verify-lock.mjs') $PackageLock (Join-Path $ProjectRoot 'upstream.lock.json')
        if ($LASTEXITCODE -ne 0) { throw "package-lock verification failed with exit code $LASTEXITCODE" }

        $PriorNpmCache = $env:npm_config_cache
        $PriorPath = $env:PATH
        try {
            $env:npm_config_cache = Join-Path $CacheDir 'npm'
            $env:PATH = $NodeFolder + [System.IO.Path]::PathSeparator + $PriorPath
            & $NodeExe $NpmCli ci --prefix (Join-Path $Stage 'app') --omit=dev --no-audit --no-fund --install-links
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
        } finally {
            $env:npm_config_cache = $PriorNpmCache
            $env:PATH = $PriorPath
        }
    }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\patch-session-export-ui.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "Session export UI adaptation failed with exit code $LASTEXITCODE" }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\patch-permission-localization.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "Permission localization adaptation failed with exit code $LASTEXITCODE" }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\patch-native-boot-handoff.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "Native boot handoff adaptation failed with exit code $LASTEXITCODE" }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\patch-portable-hero-context.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "Portable Hero context adaptation failed with exit code $LASTEXITCODE" }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\patch-windows-subprocess-hide.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "Windows subprocess hiding adaptation failed with exit code $LASTEXITCODE" }
    [System.IO.Directory]::Delete((Join-Path $Stage 'desktop-bridge'), $true)

    & $NodeExe (Join-Path $ProjectRoot 'scripts\prune-runtime.mjs') (Join-Path $Stage 'app') win32 x64
    if ($LASTEXITCODE -ne 0) { throw "runtime pruning failed with exit code $LASTEXITCODE" }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\verify-runtime.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "runtime verification failed with exit code $LASTEXITCODE" }

    Copy-Item (Join-Path $Stage 'app\node_modules\@deepseek-ai\dsh\LICENSE') (Join-Path $Stage 'licenses\DeepSeek-Harness-LICENSE.txt')
    Copy-Item (Join-Path $Stage 'app\node_modules\@wsl043\dsh-portable-plugin-market\LICENSE') (Join-Path $Stage 'licenses\dsh-market-LICENSE.txt')
    Copy-Item (Join-Path $Stage 'app\node_modules\pnpm\LICENSE') (Join-Path $Stage 'licenses\pnpm-LICENSE.txt')
    foreach ($DefaultPlugin in $DefaultPlugins) {
        $DefaultPluginArchive = Join-Path $Downloads ("$($DefaultPlugin.version)-$($DefaultPlugin.filename)")
        $DefaultPluginLicenseText = (& tar.exe -xOf $DefaultPluginArchive package/LICENSE) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0 -or -not $DefaultPluginLicenseText) { throw "Default plugin $($DefaultPlugin.package) contains no LICENSE." }
        [System.IO.File]::WriteAllText(
            (Join-Path $Stage "licenses\$($DefaultPlugin.package)-LICENSE.txt"),
            ($DefaultPluginLicenseText + [Environment]::NewLine),
            [System.Text.UTF8Encoding]::new($false)
        )
        $DefaultPluginNoticesText = (& tar.exe -xOf $DefaultPluginArchive package/THIRD_PARTY_NOTICES.md) -join [Environment]::NewLine
        if ($LASTEXITCODE -eq 0 -and $DefaultPluginNoticesText) {
            [System.IO.File]::WriteAllText(
                (Join-Path $Stage "licenses\$($DefaultPlugin.package)-THIRD-PARTY-NOTICES.txt"),
                ($DefaultPluginNoticesText + [Environment]::NewLine),
                [System.Text.UTF8Encoding]::new($false)
            )
        }
    }
    Copy-Item $WebView2Core (Join-Path $Stage 'Microsoft.Web.WebView2.Core.dll')
    Copy-Item $WebView2WinForms (Join-Path $Stage 'Microsoft.Web.WebView2.WinForms.dll')
    Copy-Item $WebView2Loader (Join-Path $Stage 'WebView2Loader.dll')
    Copy-Item $WebView2License (Join-Path $Stage 'licenses\WebView2-LICENSE.txt')
    Copy-Item $NotificationAssembly (Join-Path $Stage 'Microsoft.Toolkit.Uwp.Notifications.dll')
    Copy-Item $ValueTupleAssembly (Join-Path $Stage 'System.ValueTuple.dll')
    Copy-Item $NotificationLicense (Join-Path $Stage 'licenses\Windows-Notifications-LICENSE.txt')
    Copy-Item $ValueTupleLicense (Join-Path $Stage 'licenses\System.ValueTuple-LICENSE.txt')
    $Notices = Join-Path $Downloads ("DeepSeek-Harness-THIRD_PARTY_NOTICES-$($DshLock.reviewedCommit).md")
    if (-not (Test-Path -LiteralPath $Notices)) {
        Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$($DshLock.reviewedCommit)/THIRD_PARTY_NOTICES.md" -OutFile $Notices
    }
    Assert-Sha256 $Notices $DshLock.noticesSha256
    Copy-Item $Notices (Join-Path $Stage 'licenses\DeepSeek-Harness-THIRD_PARTY_NOTICES.md')

    $Components = [ordered]@{
        product = 'DSH-Portable'
        portableVersion = $PortableVersion
        releaseChannel = $ReleaseChannel
        platform = 'windows-x64'
        dshPackage = $DshLock.package
        dshVersion = $DshLock.version
        dshCommit = $DshLock.reviewedCommit
        dshChannel = if ($ReleaseChannel -eq 'candidate') { 'preview' } else { 'stable' }
        dshPackageSetSha256 = if ($PreviewReceipt) { $PreviewReceipt.packageSetSha256 } else { $null }
        pluginMarketPackage = '@wsl043/dsh-portable-plugin-market'
        pluginMarketVersion = $Lock.pluginMarket.version
        windowsNotificationRuntime = "$($Lock.windowsNotifications.package)@$($Lock.windowsNotifications.version)"
        defaultPlugins = @($DefaultPlugins | ForEach-Object { [ordered]@{ package = $_.package; version = $_.version; sha256 = $_.sha256; integrity = $_.integrity } })
        pnpmVersion = $Lock.pnpm.version
        pnpmIntegrity = $Lock.pnpm.integrity
        nodeVersion = $Lock.node.version
        nodeSha256 = $Runtime.sha256
        runtimeLayout = 'expanded-v1'
        webView2Package = $Lock.webview2.package
        webView2Version = $Lock.webview2.version
        webView2Sha256 = $Lock.webview2.sha256
        updaterSchema = 1
        shellSchema = 25
        shellFingerprint = $ShellFingerprint
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $Stage 'licenses\COMPONENTS.json'),
        (($Components | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )

    $Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $Csc)) { $Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    if (-not (Test-Path -LiteralPath $Csc)) { throw 'The Windows .NET Framework C# compiler is unavailable.' }
    $WindowsWinmd = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\UnionMetadata\Facade\Windows.winmd'
    $UniversalApiContract = Get-ChildItem (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\References') -Recurse -Filter 'Windows.Foundation.UniversalApiContract.winmd' -ErrorAction SilentlyContinue |
        Sort-Object @{ Expression = { [version]$_.Directory.Parent.Parent.Name }; Descending = $true }, @{ Expression = { [version]$_.Directory.Name }; Descending = $true } |
        Select-Object -First 1 -ExpandProperty FullName
    $WindowsRuntimeAssembly = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Runtime.WindowsRuntime.dll'
    if (-not (Test-Path -LiteralPath $WindowsRuntimeAssembly)) { $WindowsRuntimeAssembly = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\System.Runtime.WindowsRuntime.dll' }
    foreach ($RequiredNotificationReference in @($WindowsWinmd, $UniversalApiContract, $WindowsRuntimeAssembly)) {
        if (-not (Test-Path -LiteralPath $RequiredNotificationReference)) { throw "Windows notification compile reference is unavailable: $RequiredNotificationReference" }
    }
    $LauncherExe = Join-Path $Stage 'DeepSeek-Herness.exe'
    $CompilerArgs = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
        "/win32icon:$ProjectRoot\assets\DSH-Portable.ico",
        "/win32manifest:$ProjectRoot\launcher\windows\DSH-Portable.manifest",
        '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
        '/reference:System.Web.Extensions.dll',
        "/reference:$WindowsWinmd", "/reference:$UniversalApiContract", "/reference:$WindowsRuntimeAssembly",
        "/reference:$WebView2Core", "/reference:$WebView2WinForms",
        "/reference:$NotificationAssembly", "/reference:$ValueTupleAssembly",
        "/out:$LauncherExe",
        (Join-Path $ProjectRoot 'launcher\windows\DSH-Portable.cs'),
        (Join-Path $ProjectRoot 'launcher\windows\PortableProcessJob.cs')
    )
    & $Csc $CompilerArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $LauncherExe)) { throw 'Windows launcher compilation failed.' }
    $CommandExe = Join-Path $Stage 'dsh.exe'
    $CommandCompilerArgs = @(
        '/nologo', '/target:exe', '/platform:x64', '/optimize+',
        "/win32icon:$ProjectRoot\assets\DSH-Portable.ico",
        "/win32manifest:$ProjectRoot\launcher\windows\DSH-Portable.manifest",
        '/reference:System.dll', '/reference:System.Core.dll',
        "/out:$CommandExe",
        (Join-Path $ProjectRoot 'launcher\windows\DSH-Command.cs')
    )
    & $Csc $CommandCompilerArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $CommandExe)) { throw 'Windows command launcher compilation failed.' }

    $UpdateExtractor = Join-Path $Stage 'launcher\DSH-UpdateExtractor.exe'
    $UpdateExtractorCompilerArgs = @(
        '/nologo', '/target:exe', '/platform:x64', '/optimize+',
        '/reference:System.dll', '/reference:System.Core.dll',
        '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
        "/out:$UpdateExtractor",
        (Join-Path $ProjectRoot 'launcher\windows\DSH-UpdateExtractor.cs')
    )
    & $Csc $UpdateExtractorCompilerArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $UpdateExtractor)) { throw 'Windows update extractor compilation failed.' }

    $FullUpdater = Join-Path $Stage 'launcher\DSH-FullUpdater.exe'
    $FullUpdaterCompilerArgs = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
        "/win32icon:$ProjectRoot\assets\DSH-Portable.ico",
        "/win32manifest:$ProjectRoot\launcher\windows\DSH-Portable.manifest",
        '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll',
        '/reference:System.Windows.Forms.dll', '/reference:System.Net.Http.dll',
        '/reference:System.Runtime.Serialization.dll', '/reference:System.IO.Compression.dll',
        "/out:$FullUpdater",
        (Join-Path $ProjectRoot 'launcher\windows\DSH-Bootstrap.cs')
    )
    & $Csc $FullUpdaterCompilerArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $FullUpdater)) { throw 'Windows full updater compilation failed.' }
    if ((Get-Item -LiteralPath $FullUpdater).Length -ge 1MB) { throw 'Windows full updater exceeded the 1 MiB product budget.' }

    Add-Type -AssemblyName System.Drawing
    $ExtractedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($LauncherExe)
    if ($null -eq $ExtractedIcon) { throw 'The Windows launcher has no embedded application icon.' }
    $ExtractedIcon.Dispose()

    $UnexpectedData = Get-ChildItem -Recurse -Force -File (Join-Path $Stage 'data') | Where-Object Name -ne 'README.txt'
    if ($UnexpectedData) { throw "Portable data is not clean: $($UnexpectedData.FullName -join ', ')" }

    $UpdateComponent = Join-Path $OutputDir 'DSH-Portable-update-windows-x64.zip'
    $UpdateComponentCandidate = Join-Path $OutputDir (".DSH-Portable-update-windows-x64-$BuildId.zip")
    $UpdateComponentBackup = Join-Path $OutputDir (".DSH-Portable-update-windows-x64-$BuildId.previous.zip")
    & $NodeExe (Join-Path $ProjectRoot 'scripts\create-windows-capsule-update.mjs') $Stage $UpdateComponentCandidate
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $UpdateComponentCandidate)) {
        throw "compact runtime update creation failed with exit code $LASTEXITCODE"
    }
    if (Test-Path -LiteralPath $UpdateComponent) {
        [System.IO.File]::Replace($UpdateComponentCandidate, $UpdateComponent, $UpdateComponentBackup, $true)
    } else {
        [System.IO.File]::Move($UpdateComponentCandidate, $UpdateComponent)
    }
    if (Test-Path -LiteralPath $UpdateComponentBackup) { Remove-Item -LiteralPath $UpdateComponentBackup -Force }
    $UpdateComponentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $UpdateComponent).Hash.ToLowerInvariant()
    "$UpdateComponentHash  DSH-Portable-update-windows-x64.zip" | Set-Content -LiteralPath ($UpdateComponent + '.sha256') -Encoding ascii -NoNewline

    $UpdateManifest = Join-Path $OutputDir 'portable-update-windows-x64.json'
    [System.IO.File]::WriteAllText(
        $UpdateManifest,
        (([ordered]@{
            schemaVersion = 1
            portableVersion = $PortableVersion
            releaseChannel = $ReleaseChannel
            platform = 'windows-x64'
            minimumUpdaterSchema = 1
            requiredShellSchema = 25
            requiredShellFingerprint = $ShellFingerprint
            targetRuntimeLayout = 'capsule-v1'
            component = [ordered]@{
                kind = 'dsh-runtime-capsule'
                dshVersion = $DshLock.version
                dshCommit = $DshLock.reviewedCommit
                requiredNodeVersion = $Lock.node.version
                runtimeLayout = 'capsule-v1'
                bytes = (Get-Item -LiteralPath $UpdateComponent).Length
                sha256 = $UpdateComponentHash
                urls = @("https://github.com/WSL043/DSH-Portable/releases/download/$UpdateChannelTag/DSH-Portable-update-windows-x64.zip")
            }
        } | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )

    $EngineUpdateManifest = Join-Path $OutputDir 'dsh-core-update-windows-x64.json'
    [System.IO.File]::WriteAllText(
        $EngineUpdateManifest,
        (([ordered]@{
            schemaVersion = 1
            updateKind = 'engine'
            portableVersion = $PortableVersion
            releaseChannel = $ReleaseChannel
            platform = 'windows-x64'
            minimumUpdaterSchema = 1
            requiredShellSchema = 25
            requiredShellFingerprint = $ShellFingerprint
            targetRuntimeLayout = 'capsule-v1'
            component = [ordered]@{
                kind = 'dsh-runtime-capsule'
                dshVersion = $DshLock.version
                dshCommit = $DshLock.reviewedCommit
                requiredNodeVersion = $Lock.node.version
                runtimeLayout = 'capsule-v1'
                bytes = (Get-Item -LiteralPath $UpdateComponent).Length
                sha256 = $UpdateComponentHash
                urls = @("https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-$ReleaseChannel/DSH-Portable-update-windows-x64.zip")
            }
        } | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )

    if ($CoreOnly) {
        [pscustomobject]@{
            UpdateComponent = $UpdateComponent
            UpdateComponentSha256 = $UpdateComponentHash
            EngineUpdateManifest = $EngineUpdateManifest
            Stage = $Stage
            DshVersion = $DshLock.version
        }
        return
    }

    $Zip = Join-Path $OutputDir 'DSH-Portable-windows-x64-offline.zip'
    $ZipCandidate = Join-Path $OutputDir (".DSH-Portable-windows-x64-offline-$BuildId.zip")
    $ZipBackup = Join-Path $OutputDir (".DSH-Portable-windows-x64-offline-$BuildId.previous.zip")
    $Sha = $Zip + '.sha256'
    $ShaCandidate = Join-Path $OutputDir (".DSH-Portable-windows-x64-$BuildId.sha256")
    $ShaBackup = Join-Path $OutputDir (".DSH-Portable-windows-x64-$BuildId.previous.sha256")
    & $NodeExe (Join-Path $ProjectRoot 'scripts\package-windows-runtime-capsule.mjs') $Stage $ZipCandidate
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ZipCandidate)) {
        throw "runtime capsule archive creation failed with exit code $LASTEXITCODE"
    }
    Remove-Item -LiteralPath ($ZipCandidate + '.sha256') -Force -ErrorAction SilentlyContinue
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipCandidate).Hash.ToLowerInvariant()
    "$Hash  DSH-Portable-windows-x64-offline.zip" | Set-Content -LiteralPath $ShaCandidate -Encoding ascii -NoNewline
    if (Test-Path -LiteralPath $Zip) {
        [System.IO.File]::Replace($ZipCandidate, $Zip, $ZipBackup, $true)
    } else {
        [System.IO.File]::Move($ZipCandidate, $Zip)
    }
    if (Test-Path -LiteralPath $Sha) {
        [System.IO.File]::Replace($ShaCandidate, $Sha, $ShaBackup, $true)
    } else {
        [System.IO.File]::Move($ShaCandidate, $Sha)
    }
    if (Test-Path -LiteralPath $ZipBackup) { Remove-Item -LiteralPath $ZipBackup -Force }
    if (Test-Path -LiteralPath $ShaBackup) { Remove-Item -LiteralPath $ShaBackup -Force }

    $FootprintReport = Join-Path $OutputDir 'footprint-windows-x64.json'
    $FootprintBudget = if ($ReleaseChannel -eq 'candidate') {
        Join-Path $ProjectRoot 'config\footprint-budgets-preview.json'
    } else {
        Join-Path $ProjectRoot 'config\footprint-budgets.json'
    }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\report-footprint.mjs') $Stage `
        --platform windows-x64 `
        --archive $Zip `
        --budget $FootprintBudget `
        --output $FootprintReport
    if ($LASTEXITCODE -ne 0) { throw 'Windows product footprint exceeded its reviewed budget.' }

    $Manifest = Join-Path $OutputDir 'portable-manifest.json'
    $ManifestCandidate = Join-Path $OutputDir (".portable-manifest-$BuildId.json")
    $ManifestBody = [ordered]@{
        schemaVersion = 1
        version = $PortableVersion
        releaseChannel = $ReleaseChannel
        payloads = [ordered]@{
            windowsX64 = [ordered]@{
                filename = 'DSH-Portable-windows-x64-offline.zip'
                url = "https://github.com/WSL043/DSH-Portable/releases/download/v$PortableVersion/DSH-Portable-windows-x64-offline.zip"
                sha256 = $Hash
                bytes = (Get-Item -LiteralPath $Zip).Length
            }
        }
    }
    [System.IO.File]::WriteAllText(
        $ManifestCandidate,
        (($ManifestBody | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )
    if (Test-Path -LiteralPath $Manifest) {
        $ManifestBackup = Join-Path $OutputDir (".portable-manifest-$BuildId.previous.json")
        [System.IO.File]::Replace($ManifestCandidate, $Manifest, $ManifestBackup, $true)
        if (Test-Path -LiteralPath $ManifestBackup) { Remove-Item -LiteralPath $ManifestBackup -Force }
    } else {
        [System.IO.File]::Move($ManifestCandidate, $Manifest)
    }

    $Bootstrap = Join-Path $OutputDir 'DSH-Portable-windows-x64.exe'
    $BootstrapCandidate = Join-Path $OutputDir (".DSH-Portable-windows-x64-bootstrap-$BuildId.exe")
    $BootstrapCompilerArgs = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
        "/win32icon:$ProjectRoot\assets\DSH-Portable.ico",
        "/win32manifest:$ProjectRoot\launcher\windows\DSH-Portable.manifest",
        '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll',
        '/reference:System.Windows.Forms.dll', '/reference:System.Net.Http.dll',
        '/reference:System.Runtime.Serialization.dll', '/reference:System.IO.Compression.dll',
        "/out:$BootstrapCandidate",
        (Join-Path $ProjectRoot 'launcher\windows\DSH-Bootstrap.cs')
    )
    & $Csc $BootstrapCompilerArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $BootstrapCandidate)) { throw 'Windows bootstrap compilation failed.' }
    if ((Get-Item -LiteralPath $BootstrapCandidate).Length -ge 1MB) { throw 'Windows bootstrap exceeded the 1 MiB product budget.' }
    if (Test-Path -LiteralPath $Bootstrap) {
        $BootstrapBackup = Join-Path $OutputDir (".DSH-Portable-windows-x64-bootstrap-$BuildId.previous.exe")
        [System.IO.File]::Replace($BootstrapCandidate, $Bootstrap, $BootstrapBackup, $true)
        if (Test-Path -LiteralPath $BootstrapBackup) { Remove-Item -LiteralPath $BootstrapBackup -Force }
    } else {
        [System.IO.File]::Move($BootstrapCandidate, $Bootstrap)
    }
    $BootstrapHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Bootstrap).Hash.ToLowerInvariant()
    "$BootstrapHash  DSH-Portable-windows-x64.exe" | Set-Content -LiteralPath ($Bootstrap + '.sha256') -Encoding ascii -NoNewline

    [pscustomobject]@{
        Archive = $Zip
        Sha256 = $Hash
        Bootstrap = $Bootstrap
        BootstrapSha256 = $BootstrapHash
        Manifest = $Manifest
        UpdateComponent = $UpdateComponent
        UpdateComponentSha256 = $UpdateComponentHash
        UpdateManifest = $UpdateManifest
        EngineUpdateManifest = $EngineUpdateManifest
        FootprintReport = $FootprintReport
        Stage = $Stage
        DshVersion = $DshLock.version
    }
} finally {
    $BuildLock.Dispose()
}
