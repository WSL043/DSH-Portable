[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$CacheDir,
    [switch]$BuildInstaller,
    [string]$IsccPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot 'artifacts' }
if (-not $CacheDir) { $CacheDir = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-portable-cache' }
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$CacheDir = [System.IO.Path]::GetFullPath($CacheDir)
$Lock = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'upstream.lock.json') | ConvertFrom-Json
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

function Assert-Sha256([string]$Filename, [string]$Expected) {
    $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Filename).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Filename`nexpected: $Expected`nactual:   $Actual"
    }
}

function Copy-PortableSources([string]$Target) {
    foreach ($Directory in @('app', 'launcher', 'runtime\node', 'licenses', 'data', 'workspace')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Target $Directory) | Out-Null
    }
    Copy-Item -Recurse (Join-Path $ProjectRoot 'desktop-bridge') (Join-Path $Target 'desktop-bridge')
    Copy-Item (Join-Path $ProjectRoot 'app\package.json') (Join-Path $Target 'app\package.json')
    Copy-Item (Join-Path $ProjectRoot 'app\package-lock.json') (Join-Path $Target 'app\package-lock.json')
    foreach ($File in @('portable-core.mjs', 'portable-cli.mjs', 'portable-host.mjs', 'update-core.mjs', 'dsh-cli.mjs', 'http-readiness.mjs')) {
        Copy-Item (Join-Path $ProjectRoot "launcher\$File") (Join-Path $Target "launcher\$File")
    }
    Copy-Item (Join-Path $ProjectRoot 'templates\USER-README.txt') (Join-Path $Target 'README.txt')
    Copy-Item (Join-Path $ProjectRoot 'templates\DATA-README.txt') (Join-Path $Target 'data\README.txt')
    Copy-Item (Join-Path $ProjectRoot 'templates\WORKSPACE-README.txt') (Join-Path $Target 'workspace\README.txt')
    Copy-Item (Join-Path $ProjectRoot 'LICENSE') (Join-Path $Target 'licenses\DSH-Portable-LICENSE.txt')
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
    $PackageLock = Join-Path $ProjectRoot 'app\package-lock.json'
    if (-not (Test-Path -LiteralPath $NpmCli)) { throw "Pinned Node archive contains no npm CLI: $NpmCli" }
    if (-not (Test-Path -LiteralPath $PackageLock)) { throw 'app/package-lock.json is required.' }

    Copy-PortableSources $Stage
    Copy-Item $NodeExe (Join-Path $Stage 'runtime\node\node.exe')
    Copy-Item (Join-Path $NodeFolder 'LICENSE') (Join-Path $Stage 'licenses\Node.js-LICENSE.txt')

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
    & $NodeExe (Join-Path $ProjectRoot 'scripts\patch-session-export-ui.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "Session export UI adaptation failed with exit code $LASTEXITCODE" }
    [System.IO.Directory]::Delete((Join-Path $Stage 'desktop-bridge'), $true)

    & $NodeExe (Join-Path $ProjectRoot 'scripts\prune-runtime.mjs') (Join-Path $Stage 'app') win32 x64
    if ($LASTEXITCODE -ne 0) { throw "runtime pruning failed with exit code $LASTEXITCODE" }
    & $NodeExe (Join-Path $ProjectRoot 'scripts\verify-runtime.mjs') (Join-Path $Stage 'app')
    if ($LASTEXITCODE -ne 0) { throw "runtime verification failed with exit code $LASTEXITCODE" }

    Copy-Item (Join-Path $Stage 'app\node_modules\@deepseek-ai\dsh\LICENSE') (Join-Path $Stage 'licenses\DeepSeek-Harness-LICENSE.txt')
    Copy-Item (Join-Path $Stage 'app\node_modules\dshmarket\LICENSE') (Join-Path $Stage 'licenses\dsh-market-LICENSE.txt')
    Copy-Item (Join-Path $Stage 'app\node_modules\pnpm\LICENSE') (Join-Path $Stage 'licenses\pnpm-LICENSE.txt')
    Copy-Item $WebView2Core (Join-Path $Stage 'Microsoft.Web.WebView2.Core.dll')
    Copy-Item $WebView2WinForms (Join-Path $Stage 'Microsoft.Web.WebView2.WinForms.dll')
    Copy-Item $WebView2Loader (Join-Path $Stage 'WebView2Loader.dll')
    Copy-Item $WebView2License (Join-Path $Stage 'licenses\WebView2-LICENSE.txt')
    $Notices = Join-Path $Downloads ("DeepSeek-Harness-THIRD_PARTY_NOTICES-$($Lock.dsh.reviewedCommit).md")
    if (-not (Test-Path -LiteralPath $Notices)) {
        Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$($Lock.dsh.reviewedCommit)/THIRD_PARTY_NOTICES.md" -OutFile $Notices
    }
    Assert-Sha256 $Notices $Lock.dsh.noticesSha256
    Copy-Item $Notices (Join-Path $Stage 'licenses\DeepSeek-Harness-THIRD_PARTY_NOTICES.md')

    $Components = [ordered]@{
        product = 'DSH-Portable'
        portableVersion = $PortableVersion
        platform = 'windows-x64'
        dshPackage = $Lock.dsh.package
        dshVersion = $Lock.dsh.version
        dshCommit = $Lock.dsh.reviewedCommit
        pluginMarketPackage = 'dshmarket'
        pluginMarketVersion = '1.15.0'
        pnpmVersion = $Lock.pnpm.version
        pnpmIntegrity = $Lock.pnpm.integrity
        nodeVersion = $Lock.node.version
        nodeSha256 = $Runtime.sha256
        webView2Package = $Lock.webview2.package
        webView2Version = $Lock.webview2.version
        webView2Sha256 = $Lock.webview2.sha256
        updaterSchema = 1
        shellSchema = 13
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $Stage 'licenses\COMPONENTS.json'),
        (($Components | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )

    $Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $Csc)) { $Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    if (-not (Test-Path -LiteralPath $Csc)) { throw 'The Windows .NET Framework C# compiler is unavailable.' }
    $LauncherExe = Join-Path $Stage 'DeepSeek-Herness.exe'
    $CompilerArgs = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
        "/win32icon:$ProjectRoot\assets\DSH-Portable.ico",
        "/win32manifest:$ProjectRoot\launcher\windows\DSH-Portable.manifest",
        '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
        '/reference:System.Web.Extensions.dll',
        "/reference:$WebView2Core", "/reference:$WebView2WinForms",
        "/out:$LauncherExe",
        (Join-Path $ProjectRoot 'launcher\windows\DSH-Portable.cs')
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
    $ComponentMetadata = Join-Path $Stage 'component.json'
    [System.IO.File]::WriteAllText(
        $ComponentMetadata,
        (([ordered]@{
            schemaVersion = 1
            kind = 'dsh-app'
            portableVersion = $PortableVersion
            dshVersion = $Lock.dsh.version
            dshCommit = $Lock.dsh.reviewedCommit
        } | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )
    try {
        & tar.exe -a -c -f $UpdateComponentCandidate -C $Stage `
            'component.json' 'app' 'licenses/COMPONENTS.json' `
            'licenses/DeepSeek-Harness-LICENSE.txt' 'licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md' `
            'licenses/dsh-market-LICENSE.txt' 'licenses/pnpm-LICENSE.txt'
        if ($LASTEXITCODE -ne 0) { throw "update component creation failed with exit code $LASTEXITCODE" }
    } finally {
        Remove-Item -LiteralPath $ComponentMetadata -Force -ErrorAction SilentlyContinue
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
            platform = 'windows-x64'
            minimumUpdaterSchema = 1
            requiredShellSchema = 13
            component = [ordered]@{
                kind = 'dsh-app'
                dshVersion = $Lock.dsh.version
                dshCommit = $Lock.dsh.reviewedCommit
                requiredNodeVersion = $Lock.node.version
                bytes = (Get-Item -LiteralPath $UpdateComponent).Length
                sha256 = $UpdateComponentHash
                urls = @('https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/DSH-Portable-update-windows-x64.zip')
            }
        } | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )

    $Zip = Join-Path $OutputDir 'DSH-Portable-windows-x64-offline.zip'
    $ZipCandidate = Join-Path $OutputDir (".DSH-Portable-windows-x64-offline-$BuildId.zip")
    $ZipBackup = Join-Path $OutputDir (".DSH-Portable-windows-x64-offline-$BuildId.previous.zip")
    $Sha = $Zip + '.sha256'
    $ShaCandidate = Join-Path $OutputDir (".DSH-Portable-windows-x64-$BuildId.sha256")
    $ShaBackup = Join-Path $OutputDir (".DSH-Portable-windows-x64-$BuildId.previous.sha256")
    & tar.exe -a -c -f $ZipCandidate -C $StageParent 'DSH-Portable'
    if ($LASTEXITCODE -ne 0) { throw "archive creation failed with exit code $LASTEXITCODE" }
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

    $Manifest = Join-Path $OutputDir 'portable-manifest.json'
    $ManifestCandidate = Join-Path $OutputDir (".portable-manifest-$BuildId.json")
    $ManifestBody = [ordered]@{
        schemaVersion = 1
        version = $PortableVersion
        payloads = [ordered]@{
            windowsX64 = [ordered]@{
                filename = 'DSH-Portable-windows-x64-offline.zip'
                url = 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/DSH-Portable-windows-x64-offline.zip'
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

    $PortableExtractor = $null
    $PortableExtractorHash = $null
    $Installer = $null
    $InstallerHash = $null
    if ($BuildInstaller) {
        if (-not $IsccPath) {
            $Command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
            if ($Command) { $IsccPath = $Command.Source }
        }
        if (-not $IsccPath) {
            foreach ($Candidate in @(
                (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
                (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 7\ISCC.exe')
            )) {
                if ($Candidate -and (Test-Path -LiteralPath $Candidate)) {
                    $IsccPath = $Candidate
                    break
                }
            }
        }
        if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath)) {
            throw 'BuildInstaller requires Inno Setup 7 or newer (ISCC.exe).'
        }
        $IsccVersion = [string]((& $IsccPath '/?' 2>&1 | Select-Object -First 1))
        $IsccVersionMatch = [regex]::Match($IsccVersion.Trim(), '^Inno Setup (?<major>\d+) Command-Line Compiler$')
        if (-not $IsccVersionMatch.Success -or [int]$IsccVersionMatch.Groups['major'].Value -lt 7) {
            throw "BuildInstaller requires Inno Setup 7 or newer; found '$IsccVersion'."
        }

        $PortableExtractorBuildDir = Join-Path $StageParent 'portable-extractor-output'
        $InstallerBuildDir = Join-Path $StageParent 'installer-output'
        New-Item -ItemType Directory -Force -Path $PortableExtractorBuildDir, $InstallerBuildDir | Out-Null
        $PortableSetupScript = Join-Path $ProjectRoot 'installer\windows\DSH-Portable.iss'
        $SetupScript = Join-Path $ProjectRoot 'installer\windows\DeepSeek-Herness.iss'
        $InstallerDrive = $null
        $InstallerDriveMounted = $false
        try {
            foreach ($Letter in @('R', 'Q', 'P', 'O', 'N', 'M')) {
                $CandidateDrive = "${Letter}:"
                if (-not (Test-Path -LiteralPath ($CandidateDrive + '\'))) {
                    $InstallerDrive = $CandidateDrive
                    break
                }
            }
            if (-not $InstallerDrive) { throw 'No unused drive letter is available for the installer build.' }

            # Inno Setup still encounters legacy source-path limits while walking
            # deeply nested node_modules. Map only this private staging root to a
            # short temporary drive and always release it below.
            & subst.exe $InstallerDrive $StageParent
            if ($LASTEXITCODE -ne 0) { throw "Could not map the installer staging drive ($InstallerDrive)." }
            $InstallerDriveMounted = $true
            $InstallerDriveRoot = $InstallerDrive + '\'
            $ShortStage = Join-Path $InstallerDriveRoot 'DSH-Portable'
            $ShortPortableOutputDir = Join-Path $InstallerDriveRoot 'portable-extractor-output'
            $ShortOutputDir = Join-Path $InstallerDriveRoot 'installer-output'

            $PortableIsccArguments = @(
                "/DStage=$ShortStage",
                "/DOutputDir=$ShortPortableOutputDir",
                "/DProjectRoot=$ProjectRoot",
                "/DAppVersion=$PortableVersion",
                $PortableSetupScript
            )
            & $IsccPath $PortableIsccArguments
            $PortableIsccExitCode = $LASTEXITCODE
            if ($null -ne $PortableIsccExitCode -and $PortableIsccExitCode -ne 0) {
                throw "Portable self-extractor build failed with exit code $PortableIsccExitCode"
            }

            # Only the installed package receives an external state root. The
            # portable self-extractor above is compiled from the clean movable
            # stage, including its local data and workspace directories.
            Copy-Item -Force (Join-Path $ProjectRoot 'templates\INSTALLED-README.txt') (Join-Path $Stage 'README.txt')
            [System.IO.File]::WriteAllText(
                (Join-Path $Stage 'installed-mode.json'),
                (([ordered]@{ stateRoot = '%LOCALAPPDATA%\DeepSeek-Herness'; schemaVersion = 1 } | ConvertTo-Json) + [Environment]::NewLine),
                [System.Text.UTF8Encoding]::new($false)
            )

            $IsccArguments = @(
                "/DStage=$ShortStage",
                "/DOutputDir=$ShortOutputDir",
                "/DProjectRoot=$ProjectRoot",
                "/DAppVersion=$PortableVersion",
                $SetupScript
            )
            & $IsccPath $IsccArguments
            $InstallerIsccExitCode = $LASTEXITCODE
            if ($null -ne $InstallerIsccExitCode -and $InstallerIsccExitCode -ne 0) {
                throw "Inno Setup failed with exit code $InstallerIsccExitCode"
            }
        } finally {
            if ($InstallerDriveMounted) {
                & subst.exe $InstallerDrive /D
                if ($LASTEXITCODE -ne 0) { Write-Warning "Could not release temporary installer drive $InstallerDrive" }
            }
        }

        $PortableExtractorCandidate = Join-Path $PortableExtractorBuildDir 'DSH-Portable-windows-x64-offline.exe'
        if (-not (Test-Path -LiteralPath $PortableExtractorCandidate)) { throw 'Inno Setup did not produce DSH-Portable-windows-x64-offline.exe.' }
        $PortableExtractor = Join-Path $OutputDir 'DSH-Portable-windows-x64-offline.exe'
        $PortableExtractorBackup = Join-Path $OutputDir (".DSH-Portable-windows-x64-offline-$BuildId.previous.exe")
        if (Test-Path -LiteralPath $PortableExtractor) {
            [System.IO.File]::Replace($PortableExtractorCandidate, $PortableExtractor, $PortableExtractorBackup, $true)
        } else {
            [System.IO.File]::Move($PortableExtractorCandidate, $PortableExtractor)
        }
        if (Test-Path -LiteralPath $PortableExtractorBackup) { Remove-Item -LiteralPath $PortableExtractorBackup -Force }
        $PortableExtractorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PortableExtractor).Hash.ToLowerInvariant()
        "$PortableExtractorHash  DSH-Portable-windows-x64-offline.exe" | Set-Content -LiteralPath ($PortableExtractor + '.sha256') -Encoding ascii -NoNewline

        $InstallerCandidate = Join-Path $InstallerBuildDir 'DeepSeek-Herness-Setup.exe'
        if (-not (Test-Path -LiteralPath $InstallerCandidate)) { throw 'Inno Setup did not produce DeepSeek-Herness-Setup.exe.' }
        $Installer = Join-Path $OutputDir 'DeepSeek-Herness-Setup.exe'
        $InstallerBackup = Join-Path $OutputDir (".DeepSeek-Herness-Setup-$BuildId.previous.exe")
        if (Test-Path -LiteralPath $Installer) {
            [System.IO.File]::Replace($InstallerCandidate, $Installer, $InstallerBackup, $true)
        } else {
            [System.IO.File]::Move($InstallerCandidate, $Installer)
        }
        if (Test-Path -LiteralPath $InstallerBackup) { Remove-Item -LiteralPath $InstallerBackup -Force }
        $InstallerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Installer).Hash.ToLowerInvariant()
        "$InstallerHash  DeepSeek-Herness-Setup.exe" | Set-Content -LiteralPath ($Installer + '.sha256') -Encoding ascii -NoNewline
    }

    [pscustomobject]@{
        Archive = $Zip
        Sha256 = $Hash
        Bootstrap = $Bootstrap
        BootstrapSha256 = $BootstrapHash
        Manifest = $Manifest
        UpdateComponent = $UpdateComponent
        UpdateComponentSha256 = $UpdateComponentHash
        UpdateManifest = $UpdateManifest
        PortableExtractor = $PortableExtractor
        PortableExtractorSha256 = $PortableExtractorHash
        Installer = $Installer
        InstallerSha256 = $InstallerHash
        Stage = $Stage
        DshVersion = $Lock.dsh.version
    }
} finally {
    $BuildLock.Dispose()
}
