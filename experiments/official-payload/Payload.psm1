Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:OfficialPublisher = 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.'
$script:OfficialInstallerPrefix = '/dsh-desk/bin/win-x64/'

function Assert-PlainPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Empty path is not allowed' }
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected path is not supported' }
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Assert-FeedUrl([string]$Url) {
    $uri = $null
    if ([string]::IsNullOrWhiteSpace($Url) -or $Url -match '\s' -or $Url.Contains('"') -or $Url.Contains("'") -or $Url.Contains('#') -or -not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.UserInfo) { throw 'Invalid update feed URL' }
    if ($uri.Scheme -ceq 'https' -and $uri.Port -eq 443) { return }
    $localAllowed = $env:DSH_PORTABLE_TEST_ALLOW_LOCAL_FEED -ceq '1' -and $uri.Scheme -ceq 'http' -and $uri.Host -ceq '127.0.0.1' -and $uri.Port -gt 0
    if (-not $localAllowed) { throw 'Update feed must use HTTPS (local loopback requires the explicit test switch)' }
}

function Assert-Candidate($Candidate) {
    if ($Candidate.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$') { throw 'Unsupported official version' }
    $uri = $null
    if (-not [Uri]::TryCreate([string]$Candidate.installerUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -cne 'https' -or $uri.Host -cne 'download.deepseek.com' -or $uri.Port -ne 443 -or $uri.UserInfo -or -not $uri.AbsolutePath.StartsWith($script:OfficialInstallerPrefix, [StringComparison]::Ordinal)) { throw 'Untrusted installer URL' }
    if ([Convert]::FromBase64String([string]$Candidate.sha512).Length -ne 64 -or [long]$Candidate.size -lt 1000000 -or [long]$Candidate.size -gt 2147483648) { throw 'Invalid official package identity' }
}

function Get-AcceptedIndexCandidate($Index, [string]$RequestedVersion) {
    if ($null -eq $Index.versions -or $Index.versions.Count -gt 100) { throw 'Accepted index has an invalid versions list' }
    $seen = @{}; $found = $null
    foreach ($entry in $Index.versions) {
        Assert-Candidate $entry
        $candidateVersion = [string]$entry.version
        if ($seen.ContainsKey($candidateVersion)) { throw 'Accepted index contains duplicate versions' }
        $seen[$candidateVersion] = $true
        if ($candidateVersion -ceq $RequestedVersion) { $found = $entry }
    }
    if ($null -eq $found) { throw 'Requested version is absent from the accepted index' }
    return $found
}

function Assert-Publisher([string]$File) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -cne $script:OfficialPublisher) { throw 'Official signature validation failed' }
}

function Assert-Installer([string]$File, $Candidate) {
    Assert-Candidate $Candidate
    Assert-PlainPath $File
    if ((Get-Item -LiteralPath $File).Length -ne [long]$Candidate.size) { throw 'Installer size mismatch' }
    $actual = (Get-FileHash -LiteralPath $File -Algorithm SHA512).Hash
    $expected = [BitConverter]::ToString([Convert]::FromBase64String([string]$Candidate.sha512)).Replace('-', '')
    if ($actual -cne $expected) { throw 'Installer digest mismatch' }
    Assert-Publisher $File
}

function Get-OfficialInstaller([string]$Destination, $Candidate, [scriptblock]$Progress) {
    Assert-Candidate $Candidate
    Assert-PlainPath $Destination
    if (Test-Path -LiteralPath $Destination) { throw 'Download destination already exists' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request = [Net.HttpWebRequest]::Create([string]$Candidate.installerUrl)
    $request.AllowAutoRedirect = $false; $request.Timeout = 15000; $request.ReadWriteTimeout = 15000
    $response = $request.GetResponse()
    try {
        if ([int]$response.StatusCode -ne 200) { throw 'Unexpected installer response; redirects require review' }
        $inputStream = $response.GetResponseStream(); $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew)
        try {
            [byte[]]$buffer = New-Object byte[] 131072; [long]$total = 0; $deadline = [DateTime]::UtcNow.AddMinutes(15); $lastProgress = [DateTime]::MinValue
            while (($length = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $total += $length
                if ($total -gt [long]$Candidate.size -or [DateTime]::UtcNow -gt $deadline) { throw 'Download exceeded bounds' }
                $outputStream.Write($buffer, 0, $length)
                if ($Progress -and ([DateTime]::UtcNow - $lastProgress).TotalMilliseconds -ge 500) { & $Progress ([Math]::Floor(100 * $total / [long]$Candidate.size)); $lastProgress = [DateTime]::UtcNow }
            }
            $outputStream.Flush($true)
        } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    } finally { $response.Dispose() }
    Assert-Installer $Destination $Candidate
}

function Assert-Archive([string]$Archive, [string]$SevenZip) {
    $listing = @(& $SevenZip l -slt $Archive)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect official archive' }
    $started = $false
    foreach ($line in $listing) {
        if ($line -match '^-{5,}$') { $started = $true; continue }
        if (-not $started) { continue }
        if ($line -match '^(Symbolic Link|Hard Link) = .+' -or $line -match '^Attributes = .*\bl') { throw 'Linked archive entry' }
        if ($line -match '^Path = (.+)$') {
            $entry = $Matches[1]
            Assert-ArchiveEntryPath $entry
        }
    }
}

function Assert-ArchiveEntryPath([string]$Entry) {
    if ([string]::IsNullOrWhiteSpace($Entry) -or [IO.Path]::IsPathRooted($Entry) -or $Entry -match '^[A-Za-z]:' -or $Entry.Contains(':') -or $Entry -match '(^|[\\/])\.\.([\\/]|$)' -or $Entry -match '[. ]([\\/]|$)' -or $Entry -match '[. ]$') { throw 'Unsafe official archive entry' }
}

function Get-VersionRetentionPlan([string[]]$VersionNames, [string]$Current, [string]$Previous) {
    $keep = @($Current, $Previous) | Where-Object { $_ }
    return @($VersionNames | Where-Object { $_ -match '^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$' -and $_ -notin $keep })
}

function Assert-PlainTree([string]$Path) {
    Assert-PlainPath $Path
    foreach ($entry in Get-ChildItem -LiteralPath $Path -Recurse -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected extracted reparse point' }
        if (-not $entry.FullName.StartsWith([IO.Path]::GetFullPath($Path).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Extracted path escaped destination' }
    }
}

function Get-AsarVersion([string]$File) {
    $stream = [IO.File]::OpenRead($File); $reader = New-Object IO.BinaryReader($stream)
    try {
        if ($reader.ReadUInt32() -ne 4) { throw 'Unsupported ASAR header' }
        $headerSize = $reader.ReadUInt32(); $null = $reader.ReadUInt32(); $jsonSize = $reader.ReadUInt32()
        if ($headerSize -gt 20971520 -or $jsonSize -gt $headerSize -or $jsonSize -lt 2) { throw 'Invalid ASAR index' }
        $header = [Text.Encoding]::UTF8.GetString($reader.ReadBytes($jsonSize)) | ConvertFrom-Json
        $entry = $header.files.'package.json'
        if ($entry.size -gt 1048576 -or $entry.size -lt 2 -or [long]$entry.offset -lt 0) { throw 'Invalid ASAR package metadata' }
        $null = $stream.Seek(8 + [long]$headerSize + [long]$entry.offset, [IO.SeekOrigin]::Begin)
        $manifest = [Text.Encoding]::UTF8.GetString($reader.ReadBytes($entry.size)) | ConvertFrom-Json
        return [string]$manifest.version
    } finally { $reader.Dispose(); $stream.Dispose() }
}

function Rewrite-AppUpdateYml([string]$Source, [string]$FeedUrl, [string]$CacheDirName) {
    Assert-FeedUrl $FeedUrl
    if (-not $FeedUrl.EndsWith('/')) { throw 'Generic update feed URL must end with a slash' }
    if ($CacheDirName -notmatch '^[A-Za-z0-9._@-]{1,100}$' -or $CacheDirName -in @('.', '..')) { throw 'Invalid updater cache directory name' }
    $cacheScalar = $CacheDirName
    if ($CacheDirName.StartsWith('@')) { $cacheScalar = '"' + $CacheDirName + '"' }
    $lines = $Source -replace "`r`n?", "`n" -split "`n"; $keys = @{}
    for ($i = 0; $i -lt $lines.Length; $i++) { if ($lines[$i] -match '^([A-Za-z][A-Za-z0-9_-]*):(?:\s.*)?$') { $key = $Matches[1]; if ($keys.ContainsKey($key)) { throw 'Duplicate update configuration key' }; $keys[$key] = $i } }
    foreach ($required in @('provider', 'url', 'channel')) { if (-not $keys.ContainsKey($required)) { throw 'Official app-update.yml contract changed' } }
    if ($lines[$keys.provider] -notmatch '^provider:\s*generic\s*$') { throw 'Official update provider is not generic' }
    $output = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match '^publisherName:') { while ($i + 1 -lt $lines.Length -and $lines[$i + 1] -match '^\s+') { $i++ }; continue }
        if ($lines[$i] -match '^url:') { $output.Add('url: ' + $FeedUrl) }
        elseif ($lines[$i] -match '^updaterCacheDirName:') { $output.Add('updaterCacheDirName: ' + $cacheScalar) }
        else { $output.Add($lines[$i]) }
    }
    if (-not $keys.ContainsKey('updaterCacheDirName')) { $output.Add('updaterCacheDirName: ' + $cacheScalar) }
    $result = (($output -join "`n").TrimEnd("`n") + "`n")
    if ($result -notmatch '(?m)^provider: generic$' -or $result -notmatch ('(?m)^url: ' + [Regex]::Escape($FeedUrl) + '$') -or $result -match '(?m)^publisherName:') { throw 'Could not rewrite app-update.yml safely' }
    return $result
}

function Expand-OfficialPayload([string]$Installer, $Candidate, [string]$Output, [string]$SevenZip, [string]$FeedUrl, [string]$CacheDirName) {
    Assert-Installer $Installer $Candidate; Assert-PlainPath $Output
    if (Test-Path -LiteralPath $Output) { throw 'Use a fresh payload destination' }
    if (-not (Test-Path -LiteralPath $SevenZip -PathType Leaf)) { throw '7-Zip is required to extract the official NSIS package' }
    $outer = $Output + '.outer'; $inner = Join-Path $outer '$PLUGINSDIR/app-64.7z'; $verify = $Output + '.verify'
    if (Test-Path $outer) { throw 'Outer extraction staging already exists' }
    try {
        Assert-Archive $Installer $SevenZip
        & $SevenZip x $Installer "-o$outer" '-y' '$PLUGINSDIR/app-64.7z' | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $inner)) { throw 'Official NSIS payload layout changed' }
        Assert-Archive $inner $SevenZip
        & $SevenZip x $inner "-o$Output" '-y' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Official application extraction failed' }
        Assert-PlainTree $Output
        $exe = Join-Path $Output 'DeepSeek Harness.exe'; $asar = Join-Path $Output 'resources/app.asar'; $yml = Join-Path $Output 'resources/app-update.yml'
        foreach ($required in @($exe, $asar, $yml)) { if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'Official application payload is incomplete' } }
        Assert-Publisher $exe
        if ((Get-AsarVersion $asar) -cne [string]$Candidate.version) { throw 'Official desktop version does not match the index' }
        $asarHash = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLowerInvariant()
        New-Item -ItemType Directory -Path $verify | Out-Null
        & $SevenZip x $inner "-o$verify" '-y' 'resources/app.asar' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not independently verify the packaged ASAR' }
        $verifiedAsar = Join-Path $verify 'resources/app.asar'
        if (-not (Test-Path $verifiedAsar) -or (Get-FileHash -LiteralPath $verifiedAsar -Algorithm SHA256).Hash.ToLowerInvariant() -cne $asarHash) { throw 'Extracted ASAR differs from official installer contents' }
        $originalConfig = [IO.File]::ReadAllText($yml, [Text.Encoding]::UTF8)
        $originalConfigHash = (Get-FileHash -LiteralPath $yml -Algorithm SHA256).Hash.ToLowerInvariant()
        $rewritten = Rewrite-AppUpdateYml $originalConfig $FeedUrl $CacheDirName
        [IO.File]::WriteAllText($yml, $rewritten, (New-Object Text.UTF8Encoding($false)))
        $rewrittenHash = (Get-FileHash -LiteralPath $yml -Algorithm SHA256).Hash.ToLowerInvariant()
        return [pscustomobject]@{ version=[string]$Candidate.version; installerSha512=[string]$Candidate.sha512; installerSize=[long]$Candidate.size; appAsarSha256=$asarHash; officialExeSha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant(); appUpdateYmlOriginalSha256=$originalConfigHash; appUpdateYmlPortableSha256=$rewrittenHash; allowedModifiedFiles=@('resources/app-update.yml') }
    } finally {
        $scratchBoundary = Split-Path -Parent $Output
        foreach ($scratch in @($outer, $verify)) { if (Test-Path -LiteralPath $scratch) { Remove-PortableScratch $scratch $scratchBoundary } }
    }
}

function Remove-PortableScratch([string]$Path, [string]$Boundary) {
    $resolved = [IO.Path]::GetFullPath($Path); $parent = [IO.Path]::GetFullPath($Boundary).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped managed directory' }
    Assert-PlainPath $resolved
    if (-not (Test-Path -LiteralPath $resolved)) { return }
    foreach ($entry in Get-ChildItem -LiteralPath $resolved -Recurse -Force) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cleanup encountered a reparse point' } }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

Export-ModuleMember -Function Assert-PlainPath,Assert-FeedUrl,Assert-Candidate,Get-AcceptedIndexCandidate,Assert-Installer,Get-OfficialInstaller,Assert-Archive,Assert-ArchiveEntryPath,Get-VersionRetentionPlan,Get-AsarVersion,Rewrite-AppUpdateYml,Expand-OfficialPayload,Remove-PortableScratch
