Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-PlainPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected path is not supported' }
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Assert-Candidate($Candidate) {
    if ($Candidate.schemaVersion -ne 1 -or $Candidate.version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$') { throw 'Unsupported candidate' }
    $uri = [Uri]$Candidate.url
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'download.deepseek.com' -or $uri.UserInfo -or $uri.Port -ne 443 -or -not $uri.AbsolutePath.StartsWith('/dsh-desk/bin/win-x64/')) { throw 'Untrusted download URL' }
    if ($Candidate.publisher -cne 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.') { throw 'Untrusted publisher' }
    if ([Convert]::FromBase64String($Candidate.sha512).Length -ne 64 -or $Candidate.size -lt 1000000 -or $Candidate.size -gt 2147483648) { throw 'Invalid package identity' }
}

function Assert-Publisher([string]$File, [string]$Publisher) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -cne $Publisher) { throw 'Official signature validation failed' }
}

function Assert-Installer([string]$File, $Candidate) {
    Assert-Candidate $Candidate
    if ((Get-Item -LiteralPath $File).Length -ne $Candidate.size) { throw 'Installer size mismatch' }
    $sha = [Security.Cryptography.SHA512]::Create()
    $stream = [IO.File]::OpenRead($File)
    try { $actual = [Convert]::ToBase64String($sha.ComputeHash($stream)) } finally { $stream.Dispose(); $sha.Dispose() }
    if ($actual -cne $Candidate.sha512) { throw 'Installer digest mismatch' }
    Assert-Publisher $File $Candidate.publisher
}

function Get-OfficialInstaller([string]$Destination, $Candidate) {
    Assert-Candidate $Candidate
    Assert-PlainPath $Destination
    if (Test-Path -LiteralPath $Destination) { throw 'Download destination already exists' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request = [Net.HttpWebRequest]::Create($Candidate.url)
    $request.AllowAutoRedirect = $false
    $request.Timeout = 15000
    $request.ReadWriteTimeout = 15000
    $response = $request.GetResponse()
    try {
        if ([int]$response.StatusCode -ne 200) { throw 'Unexpected download response; redirects require review' }
        $inputStream = $response.GetResponseStream()
        $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew)
        try {
            $buffer = New-Object byte[] 131072
            [long]$total = 0
            $deadline = [DateTime]::UtcNow.AddMinutes(10)
            while (($length = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $total += $length
                if ($total -gt $Candidate.size -or [DateTime]::UtcNow -gt $deadline) { throw 'Download exceeded bounds' }
                $outputStream.Write($buffer, 0, $length)
            }
            $outputStream.Flush($true)
        } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    } finally { $response.Dispose() }
    Assert-Installer $Destination $Candidate
}

function Assert-Archive([string]$Archive, [string]$SevenZip) {
    $listing = @(& $SevenZip l -slt $Archive)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect archive' }
    $started = $false
    foreach ($line in $listing) {
        if ($line -match '^-{5,}$') { $started = $true; continue }
        if (-not $started) { continue }
        if ($line -match '^(Symbolic Link|Hard Link) = .+' -or $line -match '^Attributes = .*\bl') { throw 'Linked archive entry' }
        if ($line -match '^Path = (.+)$') {
            $entry = $Matches[1]
            if ([IO.Path]::IsPathRooted($entry) -or $entry.Contains(':') -or $entry -match '(^|[\\/])\.\.([\\/]|$)' -or $entry -match '[. ]([\\/]|$)') { throw "Unsafe archive entry: $entry" }
        }
    }
}

function Expand-OfficialPayload([string]$Installer, $Candidate, [string]$Output, [string]$SevenZip) {
    Assert-Installer $Installer $Candidate
    Assert-PlainPath $Output
    if (Test-Path -LiteralPath $Output) { throw 'Use a fresh payload destination' }
    $outer = $Output + '.outer'
    if (Test-Path -LiteralPath $outer) { throw 'Outer staging already exists' }
    Assert-Archive $Installer $SevenZip
    & $SevenZip x $Installer "-o$outer" '-y' '$PLUGINSDIR/app-64.7z' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Installer format changed; update the launcher' }
    $archive = Join-Path $outer '$PLUGINSDIR/app-64.7z'
    Assert-Archive $archive $SevenZip
    & $SevenZip x $archive "-o$Output" '-y' '-x!resources/app-update.yml' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Payload extraction failed' }
    Assert-Publisher (Join-Path $Output 'DeepSeek Harness.exe') $Candidate.publisher
    if (Test-Path -LiteralPath (Join-Path $Output 'resources/app-update.yml')) { throw 'Installer update source was not excluded' }
    foreach ($entry in Get-ChildItem -LiteralPath $Output -Recurse -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected extracted reparse point' }
    }
    $asar = Join-Path $Output 'resources/app.asar'
    if (-not (Test-Path -LiteralPath $asar)) { throw 'Official ASAR missing' }
    # Reviewed rc.2 identity; a future payload needs its own qualification record.
    if ($Candidate.version -eq '0.1.7-rc.2' -and (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne '708229949f0533d6d69fca3d4d72c3ad6814fda484ea3b0a7af96b71e83a6126') { throw 'Unexpected official ASAR' }
    return @{ version=$Candidate.version; installerSha512=$Candidate.sha512; asarSha256=(Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLowerInvariant(); excluded=@('resources/app-update.yml') }
}

Export-ModuleMember -Function Assert-PlainPath,Assert-Candidate,Assert-Installer,Get-OfficialInstaller,Expand-OfficialPayload
