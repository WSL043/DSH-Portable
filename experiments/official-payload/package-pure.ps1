param(
    [string]$Installer,
    [Parameter(Mandatory=$true)][string]$Output,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [Parameter(Mandatory=$true)][string]$FeedUrl,
    [Parameter(Mandatory=$true)][string]$IndexUrl,
    [string]$CacheDirName='@deepseek-aidsh-desktop-updater-portable',
    [string[]]$SeedPlugin=@(),
    [switch]$Bootstrap
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$Output = [IO.Path]::GetFullPath($Output).TrimEnd('\')
Assert-PlainPath $Output
if (Test-Path -LiteralPath $Output) { throw 'Pure packaging requires a fresh output directory' }
Assert-FeedUrl $FeedUrl; Assert-FeedUrl $IndexUrl
if ($CacheDirName -notmatch '^[A-Za-z0-9._@-]{1,100}$' -or $CacheDirName -in @('.', '..')) { throw 'Invalid updater cache directory name' }
if ($SeedPlugin.Count -gt 32) { throw 'At most 32 seed plugins may be included' }
$seedManifest = $null
$seedScriptSource = Join-Path $PSScriptRoot '../../launcher/seed-plugins.ps1'
$seedModuleSource = Join-Path $PSScriptRoot 'seed-plugins-core.psm1'
if ($SeedPlugin.Count -gt 0) {
    if (-not (Test-Path -LiteralPath $seedScriptSource -PathType Leaf) -or -not (Test-Path -LiteralPath $seedModuleSource -PathType Leaf)) { throw 'Seed launcher script or module is missing' }
    Import-Module (Join-Path $PSScriptRoot 'SeedPluginPackaging.psm1') -Force
    $seedManifest = New-SeedManifest -ArchivePath $SeedPlugin
}
$indexText = Read-BoundedHttpText $IndexUrl
$index = $indexText | ConvertFrom-Json
if ($null -eq $index.versions -or $index.versions.Count -gt 100) { throw 'Accepted index has an invalid versions list' }
$candidate = $null
if ($Bootstrap) {
    $candidate = Get-LatestAcceptedIndexCandidate $index
} else {
    if (-not $Installer -or -not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Official installer is missing' }
    $installerHash = (Get-FileHash -LiteralPath $Installer -Algorithm SHA512).Hash
    $installerSize = (Get-Item -LiteralPath $Installer).Length
    foreach ($entry in $index.versions) {
        Assert-Candidate $entry
        if ([long]$entry.size -eq $installerSize -and [BitConverter]::ToString([Convert]::FromBase64String([string]$entry.sha512)).Replace('-', '') -ceq $installerHash) { $candidate = $entry }
    }
    if ($null -eq $candidate) { throw 'Installer identity does not match any accepted index entry' }
    Assert-Installer $Installer $candidate
}
$appRoot = Join-Path $Output 'app'; $launcherRoot = Join-Path $Output 'launcher'; $dataRoot = Join-Path $Output 'data'
New-Item -ItemType Directory -Path $appRoot, $launcherRoot, (Join-Path $launcherRoot 'receipts'), (Join-Path $dataRoot 'dsh-home'), (Join-Path $dataRoot 'electron'), (Join-Path $dataRoot 'launcher') -Force | Out-Null
$partial = Join-Path $appRoot ($candidate.version + '.partial')
try {
    if (-not $Bootstrap) {
        $receipt = Expand-OfficialPayload $Installer $candidate $partial $SevenZip $FeedUrl $CacheDirName
        [IO.Directory]::Move($partial, (Join-Path $appRoot $candidate.version))
        $receiptPath = Join-Path $launcherRoot ('receipts/' + $candidate.version + '.json')
        [IO.File]::WriteAllText($receiptPath, (($receipt | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))
    }
    & (Join-Path $PSScriptRoot 'build-launcher.ps1') -Output (Join-Path $Output 'DeepSeek Harness Portable.exe')
    foreach ($file in @('apply-update.ps1', 'Payload.psm1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $launcherRoot $file) }
    if ($null -ne $seedManifest) {
        $seedDirectory = Join-Path $launcherRoot 'seed'
        New-Item -ItemType Directory -Path $seedDirectory -Force | Out-Null
        for ($i = 0; $i -lt $SeedPlugin.Count; $i++) { Copy-Item -LiteralPath $SeedPlugin[$i] -Destination (Join-Path $seedDirectory $seedManifest.plugins[$i].file) }
        [IO.File]::WriteAllText((Join-Path $seedDirectory 'seed.json'), (($seedManifest | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))
        Copy-Item -LiteralPath $seedScriptSource -Destination (Join-Path $launcherRoot 'seed-plugins.ps1')
        Copy-Item -LiteralPath $seedModuleSource -Destination (Join-Path $launcherRoot 'seed-plugins-core.psm1')
    }
    foreach ($file in @('7z.exe', '7z.dll', 'License.txt')) {
        $source = Join-Path (Split-Path -Parent $SevenZip) $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required 7-Zip component is missing: $file" }
        Copy-Item -LiteralPath $source -Destination (Join-Path $launcherRoot $file)
    }
    $follow = [ordered]@{ indexUrl=$IndexUrl; feedUrl=$FeedUrl; cacheDirName=$CacheDirName }
    [IO.File]::WriteAllText((Join-Path $launcherRoot 'follow.json'), (($follow | ConvertTo-Json -Depth 4) + "`n"), (New-Object Text.UTF8Encoding($false)))
    if ($Bootstrap) {
        $marker = [ordered]@{ schemaVersion=1; mode='bootstrap' }
        [IO.File]::WriteAllText((Join-Path $launcherRoot 'bootstrap.json'), (($marker | ConvertTo-Json -Depth 4) + "`n"), (New-Object Text.UTF8Encoding($false)))
    } else {
        $current = [ordered]@{ version=[string]$candidate.version; previous=$null; pendingHealth=$false; switchedAt=$null }
        [IO.File]::WriteAllText((Join-Path $appRoot 'current.json'), (($current | ConvertTo-Json -Depth 4) + "`n"), (New-Object Text.UTF8Encoding($false)))
    }
    $readme = @'
# DeepSeek Harness Portable / 纯便携版

**1.0.0-alpha.4 · Windows x64 · 解压到独立目录。** 本包使用官方桌面安装包的原始文件；唯一允许的官方文件差异是 `app/<版本>/resources/app-update.yml`。不预装插件、不带市场。

**便携数据：** `data/dsh-home/`（官方 `DSH_HOME`）、`data/electron/`（Chromium/Electron user data）、`data/launcher/`（日志、更新状态与暂存）。搬动时完全退出并移动整个根目录。

**更新：** 官方自己的更新提示与“安装并重启”按钮保持启用。点击后官方运行缓存中的本启动器副本；启动器从 `launcher/follow.json` 的已验收索引取得官方安装包，验证大小、SHA-512 和 Authenticode 发布者，再解包到版本目录。仅保留当前版和上一版；新版首次启动 20 秒异常退出时自动回退一次。

**`dsh://`：** 启动器驻留时临时接管当前用户的 `HKCU\Software\Classes\dsh\shell\open\command`，退出时还原启动前的默认命令值。外部目录写入仅包括 `%LOCALAPPDATA%\<cacheDirName>\pending`（官方更新器管理的启动器副本及其缓存）和上述用户协议注册表项；日志、应用数据、下载暂存与版本均在本目录。

**运行限制：** 固定端口 19387 不能与已安装官方版或另一 Portable 实例同时运行；启动器检测到冲突时只提示、不结束进程。使用纯便携版前请先关闭其他 DeepSeek Harness 桌面进程。启动器不修改官方 EXE、ASAR 或运行库，也不包含适配器、默认插件或市场文件。

---

**1.0.0-alpha.4 · Windows x64 · Extract to a dedicated folder.** Official desktop files are preserved byte-for-byte except `app/<version>/resources/app-update.yml`. No plugins or marketplace are bundled.

**Portable data:** `data/dsh-home/` (`DSH_HOME`), `data/electron/` (Chromium/Electron user data), and `data/launcher/` (logs, update status and staging). Exit fully before moving the complete root folder.

**Updates:** The official update prompt and Install and Restart flow remain enabled. The updater runs a cached copy of this launcher, which reads the accepted index from `launcher/follow.json`, downloads the official installer, verifies its size, SHA-512 and Authenticode publisher, and extracts a versioned app directory. Only current and previous versions are retained. A non-zero exit during the first 20 seconds triggers one rollback.

**`dsh://`:** While resident, the launcher temporarily owns `HKCU\Software\Classes\dsh\shell\open\command` and restores the original default command value on exit. Writes outside the portable root are limited to `%LOCALAPPDATA%\<cacheDirName>\pending` (the official updater-managed launcher copy/cache) and that per-user protocol key. Logs, user data, staging and version directories remain inside the root.

**Runtime limits:** Fixed port 19387 cannot be shared with an installed official app or another Portable instance. A conflict produces a bilingual message; no process is terminated. Close other DeepSeek Harness desktop processes first. The launcher does not patch the official EXE, ASAR or runtime and ships no adapters, default plugins or marketplace files.
'@
    if ($null -ne $seedManifest) {
        $readme = $readme.Replace('不预装插件、不带市场。', '预装的插件默认关闭，不带市场。首次启动创建官方 profile 后，第二次启动前完成播种。')
        $readme = $readme.Replace('No plugins or marketplace are bundled.', 'Seed plugins are preinstalled but disabled by default; the first launch creates the official profile and the seed step runs before the second launch. No marketplace is bundled.')
        $readme = $readme.Replace('也不包含适配器、默认插件或市场文件。', '也不包含适配器或市场文件。')
        $readme = $readme.Replace('and ships no adapters, default plugins or marketplace files.', 'and ships no adapters or marketplace files.')
    }
    if ($Bootstrap) {
        $readme = $readme.Replace('本包使用官方桌面安装包的原始文件；唯一允许的官方文件差异是 `app/<版本>/resources/app-update.yml`。', '轻量包不含官方桌面文件。首次启动从已验收索引选择最新版本，从官方 CDN 下载并校验安装包，再使用随包更新引擎完成解包与切换。')
        $readme = $readme.Replace('Official desktop files are preserved byte-for-byte except `app/<version>/resources/app-update.yml`.', 'This lite package excludes the official desktop payload. On first launch it selects the newest accepted version, downloads and verifies the installer from the official CDN, then installs it with the bundled update engine.')
        $readme = $readme.Replace('**便携数据：**', "**首次安装：** 下载进度和阶段写入 `data/launcher/update-status.json`；中断后使用 HTTP Range 续传，校验失败会丢弃不完整下载。`n`n**便携数据：**")
        $readme = $readme.Replace('**Portable data:**', "**First launch:** Download progress and stages are recorded in `data/launcher/update-status.json`; interrupted downloads resume with HTTP Range, while failed integrity checks discard the partial file.`n`n**Portable data:**")
    }
    [IO.File]::WriteAllText((Join-Path $Output 'README.md'), ($readme + "`n"), (New-Object Text.UTF8Encoding($false)))
    $forbidden = @(Get-ChildItem -LiteralPath $Output -Recurse -Force | Where-Object { $_.Name -match 'adapt-asar|desktop-adapter|update-bridge|default-plugins|prepare-defaults|market' })
    if ($forbidden.Count -gt 0) { throw 'Pure package contains a forbidden adapter/plugin/marketplace artifact' }
} catch {
    if (Test-Path -LiteralPath $partial) { Remove-PortableScratch $partial $appRoot }
    throw
}
