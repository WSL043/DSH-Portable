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

function Get-OfficialInstaller([string]$Destination, $Candidate, [scriptblock]$Progress) {
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
            $lastProgress = [DateTime]::MinValue
            while (($length = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $total += $length
                if ($total -gt $Candidate.size -or [DateTime]::UtcNow -gt $deadline) { throw 'Download exceeded bounds' }
                $outputStream.Write($buffer, 0, $length)
                if ($Progress -and ([DateTime]::UtcNow-$lastProgress).TotalMilliseconds -ge 500) { & $Progress ([Math]::Floor(100*$total/$Candidate.size)); $lastProgress=[DateTime]::UtcNow }
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
    if ((Get-AsarVersion $asar) -cne $Candidate.version) { throw 'Desktop version does not match candidate' }
    # Reviewed rc.2 identity; a future payload needs its own qualification record.
    if ($Candidate.version -eq '0.1.7-rc.2' -and (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne '708229949f0533d6d69fca3d4d72c3ad6814fda484ea3b0a7af96b71e83a6126') { throw 'Unexpected official ASAR' }
    $originalHash=(Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLowerInvariant()
    $adaptation=Join-Path $Output 'resources/portable-adaptation.json'
    $previousRunAsNode=$env:ELECTRON_RUN_AS_NODE
    try {
        $env:ELECTRON_RUN_AS_NODE='1'
        # GUI-subsystem executables do not reliably block PowerShell invocation.
        # Wait for the receipt writer before reading or launching the payload.
        $adapterArgs = @((Join-Path $PSScriptRoot 'adapt-asar.cjs'), $asar, $adaptation) | ForEach-Object { '"' + $_ + '"' }
        $adapter = Start-Process -FilePath (Join-Path $Output 'DeepSeek Harness.exe') -ArgumentList $adapterArgs -WindowStyle Hidden -PassThru -Wait
        if($adapter.ExitCode -ne 0){throw "Official desktop adapter contract failed ($($adapter.ExitCode))"}
    } finally { $env:ELECTRON_RUN_AS_NODE=$previousRunAsNode }
    $record=Get-Content -LiteralPath $adaptation -Raw|ConvertFrom-Json
    if($record.originalAsarSha256 -ne $originalHash -or $record.adapterProtocol -ne 2){throw 'Adapter identity mismatch'}
    return @{ version=$Candidate.version; installerSha512=$Candidate.sha512; originalAsarSha256=$originalHash; asarSha256=$record.asarSha256; adapterProtocol=2; excluded=@('resources/app-update.yml'); adapted=@('lib/main.js: protocol, updater and first-profile defaults boundary') }
}

function Get-AsarVersion([string]$File) {
    $stream = [IO.File]::OpenRead($File)
    $reader = New-Object IO.BinaryReader($stream)
    try {
        if ($reader.ReadUInt32() -ne 4) { throw 'Unsupported ASAR header' }
        $headerSize = $reader.ReadUInt32()
        $null = $reader.ReadUInt32()
        $jsonSize = $reader.ReadUInt32()
        if ($headerSize -gt 20971520 -or $jsonSize -gt $headerSize -or $jsonSize -lt 2) { throw 'Invalid ASAR index' }
        $header = [Text.Encoding]::UTF8.GetString($reader.ReadBytes($jsonSize)) | ConvertFrom-Json
        $entry = $header.files.'package.json'
        if ($entry.size -gt 1048576 -or $entry.size -lt 2 -or [long]$entry.offset -lt 0) { throw 'Invalid ASAR package metadata' }
        $null = $stream.Seek(8 + [long]$headerSize + [long]$entry.offset, [IO.SeekOrigin]::Begin)
        $manifest = [Text.Encoding]::UTF8.GetString($reader.ReadBytes($entry.size)) | ConvertFrom-Json
        return $manifest.version
    } finally { $reader.Dispose(); $stream.Dispose() }
}

function Remove-PortableScratch([string]$Path, [string]$AppRoot) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $parent = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped managed application root' }
    Assert-PlainPath $resolved
    if (-not (Test-Path -LiteralPath $resolved)) { return }
    if (@(Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Cleanup encountered a reparse point' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

Export-ModuleMember -Function Assert-PlainPath,Assert-Candidate,Assert-Installer,Get-OfficialInstaller,Expand-OfficialPayload,Get-AsarVersion,Remove-PortableScratch
