[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$CacheDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot 'artifacts' }
if (-not $CacheDir) { $CacheDir = Join-Path $ProjectRoot '.cache' }
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$CacheDir = [System.IO.Path]::GetFullPath($CacheDir)
$Lock = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'upstream.lock.json') | ConvertFrom-Json

function Assert-Sha256([string]$Filename, [string]$Expected) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Filename).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Filename`nexpected: $Expected`nactual:   $actual"
    }
}

$Downloads = Join-Path $CacheDir 'downloads'
$Extracted = Join-Path $CacheDir ("node-" + $Lock.node.version)
# Native dependency install scripts still hit legacy Win32 path limits. Keep the
# disposable build root short; only the completed archive is written to OutputDir.
$StagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-portable-build'
$BuildId = [Guid]::NewGuid().ToString('N')
$StagingParent = Join-Path $StagingRoot $BuildId
$ReleaseSuffix = 'community.1'
$FolderName = "DSH-Portable-$($Lock.dsh.version)-$ReleaseSuffix"
$Stage = Join-Path $StagingParent $FolderName
$Archive = Join-Path $Downloads $Lock.node.archive

New-Item -ItemType Directory -Force -Path $Downloads, $OutputDir, $StagingRoot, $StagingParent | Out-Null
$BuildLockPath = Join-Path $OutputDir '.build.lock'
try {
    $BuildLock = [System.IO.File]::Open(
        $BuildLockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch {
    throw "Another portable build is already writing to $OutputDir"
}
if (-not (Test-Path -LiteralPath $Archive)) {
    $uri = "$($Lock.node.baseUrl)/$($Lock.node.archive)"
    Write-Host "Downloading pinned Node.js runtime: $uri"
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $Archive
}
Assert-Sha256 $Archive $Lock.node.sha256

$NodeFolder = Join-Path $Extracted ("node-v$($Lock.node.version)-win-x64")
if (-not (Test-Path -LiteralPath (Join-Path $NodeFolder 'node.exe'))) {
    if (Test-Path -LiteralPath $Extracted) {
        throw "Pinned Node cache is incomplete. Remove this exact cache directory and retry: $Extracted"
    }
    New-Item -ItemType Directory -Path $Extracted | Out-Null
    Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted
}
$NodeExe = Join-Path $NodeFolder 'node.exe'
$NpmCli = Join-Path $NodeFolder 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $NpmCli)) { throw "Pinned Node archive contains no npm CLI: $NpmCli" }

$PackageLock = Join-Path $ProjectRoot 'app\package-lock.json'
if (-not (Test-Path -LiteralPath $PackageLock)) {
    throw 'app/package-lock.json is required. Regenerate and review it before building.'
}

New-Item -ItemType Directory -Path $Stage | Out-Null
foreach ($dir in @('app', 'launcher', 'runtime\node', 'licenses', 'data', 'workspace')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Stage $dir) | Out-Null
}

Copy-Item -LiteralPath (Join-Path $ProjectRoot 'app\package.json') -Destination (Join-Path $Stage 'app\package.json')
Copy-Item -LiteralPath $PackageLock -Destination (Join-Path $Stage 'app\package-lock.json')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'launcher\portable-core.mjs') -Destination (Join-Path $Stage 'launcher\portable-core.mjs')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'launcher\portable-cli.mjs') -Destination (Join-Path $Stage 'launcher\portable-cli.mjs')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'launcher\portable-host.mjs') -Destination (Join-Path $Stage 'launcher\portable-host.mjs')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'templates\DeepSeek Harness.cmd') -Destination (Join-Path $Stage 'DeepSeek Harness.cmd')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'templates\Stop DeepSeek Harness.cmd') -Destination (Join-Path $Stage 'Stop DeepSeek Harness.cmd')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'templates\DSH Status.cmd') -Destination (Join-Path $Stage 'DSH Status.cmd')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'templates\DATA-README.txt') -Destination (Join-Path $Stage 'data\README.txt')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'templates\WORKSPACE-README.txt') -Destination (Join-Path $Stage 'workspace\README.txt')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'README.md') -Destination (Join-Path $Stage 'README.md')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE') -Destination (Join-Path $Stage 'LICENSE')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'upstream.lock.json') -Destination (Join-Path $Stage 'upstream.lock.json')
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $Stage 'runtime\node\node.exe')
Copy-Item -LiteralPath (Join-Path $NodeFolder 'LICENSE') -Destination (Join-Path $Stage 'licenses\Node.js-LICENSE.txt')

& $NodeExe (Join-Path $ProjectRoot 'scripts\verify-lock.mjs') $PackageLock (Join-Path $ProjectRoot 'upstream.lock.json')
if ($LASTEXITCODE -ne 0) { throw "package-lock verification failed with exit code $LASTEXITCODE" }

$PriorNpmCache = $env:npm_config_cache
$PriorPath = $env:PATH
try {
    $env:npm_config_cache = Join-Path $CacheDir 'npm'
    $env:PATH = $NodeFolder + [System.IO.Path]::PathSeparator + $PriorPath
    & $NodeExe $NpmCli ci --prefix (Join-Path $Stage 'app') --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
} finally {
    $env:npm_config_cache = $PriorNpmCache
    $env:PATH = $PriorPath
}

$InstalledManifest = Get-Content -Raw -LiteralPath (Join-Path $Stage 'app\node_modules\@deepseek-ai\dsh\package.json') | ConvertFrom-Json
if ($InstalledManifest.version -ne $Lock.dsh.version) {
    throw "Installed DSH version mismatch: $($InstalledManifest.version)"
}
& $NodeExe (Join-Path $ProjectRoot 'scripts\verify-runtime.mjs') (Join-Path $Stage 'app')
if ($LASTEXITCODE -ne 0) { throw "runtime smoke verification failed with exit code $LASTEXITCODE" }
& $NodeExe (Join-Path $ProjectRoot 'scripts\verify-lock.mjs') (Join-Path $Stage 'app\package-lock.json') (Join-Path $Stage 'upstream.lock.json')
if ($LASTEXITCODE -ne 0) { throw "staged package-lock verification failed with exit code $LASTEXITCODE" }

$RuntimeManifest = Get-Content -Raw -LiteralPath (Join-Path $Stage 'app\package.json')
foreach ($forbidden in @('@yanxu', 'openai-codex', 'opencode-zen', 'GenericAgent')) {
    if ($RuntimeManifest.Contains($forbidden)) { throw "Forbidden non-official integration in runtime manifest: $forbidden" }
}

Copy-Item -LiteralPath (Join-Path $Stage 'app\node_modules\@deepseek-ai\dsh\LICENSE') -Destination (Join-Path $Stage 'licenses\DeepSeek-Harness-LICENSE.txt')
$Notices = Join-Path $Downloads ("DeepSeek-Harness-THIRD_PARTY_NOTICES-$($Lock.dsh.reviewedCommit).md")
if (-not (Test-Path -LiteralPath $Notices)) {
    $noticeUri = "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$($Lock.dsh.reviewedCommit)/THIRD_PARTY_NOTICES.md"
    Invoke-WebRequest -UseBasicParsing -Uri $noticeUri -OutFile $Notices
}
Assert-Sha256 $Notices '61f68731049dbea19ba91ad8cf363dd2778c5f7b1f9a63496a6a62c1129eefee'
Copy-Item -LiteralPath $Notices -Destination (Join-Path $Stage 'licenses\DeepSeek-Harness-THIRD_PARTY_NOTICES.md')

$Metadata = [ordered]@{
    schemaVersion = 1
    distribution = $FolderName
    unofficialCommunityPackaging = $true
    dshPackage = $Lock.dsh.package
    dshVersion = $Lock.dsh.version
    dshIntegrity = $Lock.dsh.integrity
    reviewedCommit = $Lock.dsh.reviewedCommit
    nodeVersion = $Lock.node.version
    nodeSha256 = $Lock.node.sha256
    architecture = 'win-x64'
    thirdPartyPlugins = @()
}
$MetadataJson = ($Metadata | ConvertTo-Json -Depth 4) + [Environment]::NewLine
[System.IO.File]::WriteAllText(
    (Join-Path $Stage 'RELEASE-METADATA.json'),
    $MetadataJson,
    [System.Text.UTF8Encoding]::new($false)
)

$ForbiddenFiles = Get-ChildItem -Recurse -Force -File (Join-Path $Stage 'data') | Where-Object { $_.Name -ne 'README.txt' }
if ($ForbiddenFiles) { throw "Portable data is not clean: $($ForbiddenFiles.FullName -join ', ')" }

$Zip = Join-Path $OutputDir ($FolderName + '.zip')
$Sha = $Zip + '.sha256'
$ZipCandidate = Join-Path $OutputDir ('.' + $FolderName + '.' + $BuildId + '.candidate.zip')
$ShaCandidate = $ZipCandidate + '.sha256'
$ZipBackup = $Zip + '.' + $BuildId + '.previous'
$ShaBackup = $Sha + '.' + $BuildId + '.previous'
& tar.exe -a -c -f $ZipCandidate -C $StagingParent $FolderName
if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE" }
$ZipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipCandidate).Hash.ToLowerInvariant()
"$ZipHash  $([System.IO.Path]::GetFileName($Zip))" | Set-Content -Encoding ascii -NoNewline -LiteralPath $ShaCandidate

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

[pscustomobject]@{
    Archive = $Zip
    Sha256 = $ZipHash
    Size = (Get-Item -LiteralPath $Zip).Length
    Stage = $Stage
    DshVersion = $Lock.dsh.version
    NodeVersion = $Lock.node.version
} | Format-List

$BuildLock.Dispose()
