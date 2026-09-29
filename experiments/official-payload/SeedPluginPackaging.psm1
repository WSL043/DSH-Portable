$ErrorActionPreference = 'Stop'

function Read-SeedTarEntry {
    param(
        [Parameter(Mandatory=$true)][string]$ArchivePath,
        [Parameter(Mandatory=$true)][string]$EntryName
    )
    $file = [IO.File]::Open($ArchivePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $gzip = $null
    try {
        $gzip = [IO.Compression.GzipStream]::new($file, [IO.Compression.CompressionMode]::Decompress)
        $header = New-Object byte[] 512
        while ($true) {
            $offset = 0
            while ($offset -lt 512) {
                $count = $gzip.Read($header, $offset, 512 - $offset)
                if ($count -eq 0) { break }
                $offset += $count
            }
            if ($offset -eq 0) { break }
            if ($offset -ne 512) { throw "Invalid tar header in $ArchivePath" }
            $isZero = $true
            for ($i = 0; $i -lt 512; $i++) { if ($header[$i] -ne 0) { $isZero = $false; break } }
            if ($isZero) { break }

            $nameLength = 100
            for ($i = 0; $i -lt 100; $i++) { if ($header[$i] -eq 0) { $nameLength = $i; break } }
            $name = [Text.Encoding]::UTF8.GetString($header, 0, $nameLength)
            $prefixLength = 155
            for ($i = 345; $i -lt 500; $i++) { if ($header[$i] -eq 0) { $prefixLength = $i - 345; break } }
            $prefix = [Text.Encoding]::UTF8.GetString($header, 345, $prefixLength)
            if ($prefix) { $name = "$prefix/$name" }

            $sizeText = [Text.Encoding]::ASCII.GetString($header, 124, 12).Trim([char]0).Trim()
            if (-not $sizeText -or $sizeText -notmatch '^[0-7]+$') { throw "Invalid tar entry size in $ArchivePath" }
            $size = [Convert]::ToInt64($sizeText, 8)
            if ($size -gt 67108864) { throw "Seed metadata entry is unexpectedly large: $name" }

            if ($name -ceq $EntryName) {
                $content = New-Object byte[] ([int]$size)
                $read = 0
                while ($read -lt $content.Length) {
                    $count = $gzip.Read($content, $read, $content.Length - $read)
                    if ($count -eq 0) { throw "Truncated tar entry $EntryName" }
                    $read += $count
                }
                return [Text.UTF8Encoding]::new($false, $true).GetString($content).TrimStart([char]0xFEFF)
            }

            $remaining = $size + ((512 - ($size % 512)) % 512)
            $skip = New-Object byte[] 8192
            while ($remaining -gt 0) {
                $count = $gzip.Read($skip, 0, [int][Math]::Min($skip.Length, $remaining))
                if ($count -eq 0) { throw "Truncated tar archive while reading $name" }
                $remaining -= $count
            }
        }
        throw "Required entry '$EntryName' is missing from $ArchivePath"
    } finally {
        if ($null -ne $gzip) { $gzip.Dispose() } else { $file.Dispose() }
    }
}

function New-SeedManifest {
    param([Parameter(Mandatory=$true)][string[]]$ArchivePath)
    if ($ArchivePath.Count -gt 32) { throw 'At most 32 seed plugins may be included' }
    $plugins = New-Object System.Collections.Generic.List[object]
    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($inputPath in $ArchivePath) {
        $path = [IO.Path]::GetFullPath($inputPath)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or [IO.Path]::GetExtension($path) -cne '.tgz') { throw "Seed plugin must be an existing .tgz file: $inputPath" }
        $package = Read-SeedTarEntry -ArchivePath $path -EntryName 'package/package.json' | ConvertFrom-Json
        if ($package.name -isnot [string] -or $package.name -notmatch '^(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "Seed archive has an invalid package name: $inputPath" }
        if ($package.version -isnot [string] -or $package.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw "Seed archive has an invalid package version: $inputPath" }
        if (-not $names.Add($package.name)) { throw "Duplicate seed plugin name: $($package.name)" }
        $patch = Read-SeedTarEntry -ArchivePath $path -EntryName 'package/cordis.patch.yml'
        $insertBlocks = [Regex]::Matches($patch, '(?m)^[ \t]*-[ \t]*insert[ \t]*:[^\r\n]*\r?\n(?<body>(?:[ \t]+[^\r\n]*(?:\r?\n|$))*)')
        $insertBody = (@($insertBlocks | ForEach-Object { $_.Groups['body'].Value }) -join "`n")
        $idMatches = [Regex]::Matches($insertBody, '(?m)^[ \t]+-[ \t]*id\s*:\s*(?:"(?<double>[^"]+)"|''(?<single>[^'']+)''|(?<plain>[A-Za-z0-9._:-]+))\s*(?:#.*)?$')
        if ($idMatches.Count -ne 1) { throw "Seed archive must contain exactly one Cordis insert id: $inputPath" }
        $idMatch = $idMatches[0]
        $entryId = if ($idMatch.Groups['double'].Success) { $idMatch.Groups['double'].Value } elseif ($idMatch.Groups['single'].Success) { $idMatch.Groups['single'].Value } else { $idMatch.Groups['plain'].Value }
        if ($entryId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]*$') { throw "Seed archive has an invalid Cordis entry id: $inputPath" }
        $safeName = $package.name.TrimStart('@').Replace('/', '+')
        $fileName = "$safeName-$($package.version).tgz"
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA512).Hash.ToLowerInvariant()
        $plugins.Add([ordered]@{ name=$package.name; file=$fileName; entryId=$entryId; sha512=$hash })
    }
    return [ordered]@{ schemaVersion=1; plugins=@($plugins.ToArray()) }
}

Export-ModuleMember -Function Read-SeedTarEntry, New-SeedManifest
