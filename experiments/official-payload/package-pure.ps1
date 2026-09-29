param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Output,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [Parameter(Mandatory=$true)][string]$FeedUrl,
    [Parameter(Mandatory=$true)][string]$IndexUrl,
    [string]$CacheDirName='@deepseek-aidsh-desktop-updater-portable'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$Output = [IO.Path]::GetFullPath($Output).TrimEnd('\')
Assert-PlainPath $Output
if (Test-Path -LiteralPath $Output) { throw 'Pure packaging requires a fresh output directory' }
Assert-FeedUrl $FeedUrl; Assert-FeedUrl $IndexUrl
if ($CacheDirName -notmatch '^[A-Za-z0-9._@-]{1,100}$' -or $CacheDirName -in @('.', '..')) { throw 'Invalid updater cache directory name' }
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Official installer is missing' }
$request = [Net.HttpWebRequest]::Create($IndexUrl); $request.AllowAutoRedirect = $false; $request.Timeout = 15000
$response = $request.GetResponse()
try {
    if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt 1048576) { throw 'Index response is invalid or too large' }
    $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
    try { $indexText = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $response.Dispose() }
if ($indexText.Length -gt 1048576) { throw 'Index response is too large' }
$index = $indexText | ConvertFrom-Json
if ($null -eq $index.versions -or $index.versions.Count -gt 100) { throw 'Accepted index has an invalid versions list' }
$installerHash = (Get-FileHash -LiteralPath $Installer -Algorithm SHA512).Hash
$installerSize = (Get-Item -LiteralPath $Installer).Length
$candidate = $null
foreach ($entry in $index.versions) {
    Assert-Candidate $entry
    if ([long]$entry.size -eq $installerSize -and [BitConverter]::ToString([Convert]::FromBase64String([string]$entry.sha512)).Replace('-', '') -ceq $installerHash) { $candidate = $entry }
}
if ($null -eq $candidate) { throw 'Installer identity does not match any accepted index entry' }
Assert-Installer $Installer $candidate
$appRoot = Join-Path $Output 'app'; $launcherRoot = Join-Path $Output 'launcher'; $dataRoot = Join-Path $Output 'data'
New-Item -ItemType Directory -Path $appRoot, $launcherRoot, (Join-Path $launcherRoot 'receipts'), (Join-Path $dataRoot 'dsh-home'), (Join-Path $dataRoot 'electron'), (Join-Path $dataRoot 'launcher') -Force | Out-Null
$partial = Join-Path $appRoot ($candidate.version + '.partial')
try {
    $receipt = Expand-OfficialPayload $Installer $candidate $partial $SevenZip $FeedUrl $CacheDirName
    [IO.Directory]::Move($partial, (Join-Path $appRoot $candidate.version))
    $receiptPath = Join-Path $launcherRoot ('receipts/' + $candidate.version + '.json')
    [IO.File]::WriteAllText($receiptPath, (($receipt | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))
    & (Join-Path $PSScriptRoot 'build-launcher.ps1') -Output (Join-Path $Output 'DeepSeek Harness Portable.exe')
    foreach ($file in @('apply-update.ps1', 'Payload.psm1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $launcherRoot $file) }
    foreach ($file in @('7z.exe', '7z.dll', 'License.txt')) {
        $source = Join-Path (Split-Path -Parent $SevenZip) $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required 7-Zip component is missing: $file" }
        Copy-Item -LiteralPath $source -Destination (Join-Path $launcherRoot $file)
    }
    $follow = [ordered]@{ indexUrl=$IndexUrl; feedUrl=$FeedUrl; cacheDirName=$CacheDirName }
    [IO.File]::WriteAllText((Join-Path $launcherRoot 'follow.json'), (($follow | ConvertTo-Json -Depth 4) + "`n"), (New-Object Text.UTF8Encoding($false)))
    $current = [ordered]@{ version=[string]$candidate.version; previous=$null; pendingHealth=$false; switchedAt=$null }
    [IO.File]::WriteAllText((Join-Path $appRoot 'current.json'), (($current | ConvertTo-Json -Depth 4) + "`n"), (New-Object Text.UTF8Encoding($false)))
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
    [IO.File]::WriteAllText((Join-Path $Output 'README.md'), ($readme + "`n"), (New-Object Text.UTF8Encoding($false)))
    $forbidden = @(Get-ChildItem -LiteralPath $Output -Recurse -Force | Where-Object { $_.Name -match 'adapt-asar|desktop-adapter|update-bridge|default-plugins|prepare-defaults|market' })
    if ($forbidden.Count -gt 0) { throw 'Pure package contains a forbidden adapter/plugin/marketplace artifact' }
} catch {
    if (Test-Path -LiteralPath $partial) { Remove-PortableScratch $partial $appRoot }
    throw
}
