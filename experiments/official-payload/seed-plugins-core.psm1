$ErrorActionPreference = 'Stop'

function Get-SeedReadiness {
    param([Parameter(Mandatory=$true)][string]$Root)
    $profilePackage = Join-Path $Root 'data/dsh-home/profiles/desktop/package.json'
    if (-not (Test-Path -LiteralPath $profilePackage -PathType Leaf)) { return 'missing-profile' }
    return 'ready'
}

function Get-SeedSha512 {
    param([Parameter(Mandatory=$true)][string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA512]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Test-SeedRecordedName {
    param($Seeded, [Parameter(Mandatory=$true)][string]$Name)
    foreach ($plugin in @($Seeded.plugins)) {
        if ($plugin -is [string]) {
            if ($plugin -eq $Name -or $plugin.StartsWith("$Name@", [StringComparison]::Ordinal)) { return $true }
        } elseif ($null -ne $plugin -and $plugin.name -eq $Name) {
            return $true
        }
    }
    return $false
}

function Merge-SeedCordisPatch {
    param(
        [AllowEmptyString()][string]$Content,
        [Parameter(Mandatory=$true)][string]$EntryId
    )
    $idPattern = '(?m)^\s*-\s*id\s*:\s*(?:"(?<double>[^"]+)"|''(?<single>[^'']+)''|(?<plain>[A-Za-z0-9._:-]+))\s*(?:#.*)?$'
    foreach ($match in [Regex]::Matches($Content, $idPattern)) {
        $value = if ($match.Groups['double'].Success) { $match.Groups['double'].Value } elseif ($match.Groups['single'].Success) { $match.Groups['single'].Value } else { $match.Groups['plain'].Value }
        if ($value -ceq $EntryId) { return [pscustomobject]@{ content=$Content; existed=$true } }
    }
    $newline = if ($Content.Contains("`r`n")) { "`r`n" } else { "`n" }
    $separator = if ($Content.Length -eq 0 -or $Content.EndsWith("`n") -or $Content.EndsWith("`r")) { '' } else { $newline }
    $addition = "- id: $EntryId${newline}  disabled: true${newline}"
    return [pscustomobject]@{ content=($Content + $separator + $addition); existed=$false }
}

function Add-SeedBundleName {
    param($Package, [Parameter(Mandatory=$true)][string]$Name)
    if ($null -eq $Package.dsh) { $Package | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
    if ($null -eq $Package.dsh.profile) { $Package.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
    $bundles = @($Package.dsh.profile.bundles | Where-Object { $null -ne $_ })
    if ($bundles -cnotcontains $Name) { $bundles += $Name }
    if ($null -eq $Package.dsh.profile.PSObject.Properties['bundles']) {
        $Package.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles
    } else {
        $Package.dsh.profile.bundles = $bundles
    }
    return $Package
}

function Get-SeedRelativeDependencyPath {
    param(
        [Parameter(Mandatory=$true)][string]$ProfileDirectory,
        [Parameter(Mandatory=$true)][string]$SeedPackagePath
    )
    $profilePath = [IO.Path]::GetFullPath($ProfileDirectory).TrimEnd('\') + '\'
    $packagePath = [IO.Path]::GetFullPath($SeedPackagePath)
    $profileUri = [Uri]::new($profilePath)
    $packageUri = [Uri]::new($packagePath)
    return [Uri]::UnescapeDataString($profileUri.MakeRelativeUri($packageUri).ToString())
}

function Get-SeedNodeModulesSnapshot {
    param([Parameter(Mandatory=$true)][string]$NodeModulesPath)
    $exists = Test-Path -LiteralPath $NodeModulesPath -PathType Container
    if ($exists -and (([IO.File]::GetAttributes($NodeModulesPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Profile node_modules is redirected; refusing to seed through it.' }
    $top = @(); $pnpm = @(); $scopes = @{}; $files = @{}; $bin = @()
    if ($exists) {
        $top = @(Get-ChildItem -LiteralPath $NodeModulesPath -Force | ForEach-Object { $_.Name })
        $pnpmPath = Join-Path $NodeModulesPath '.pnpm'
        if (Test-Path -LiteralPath $pnpmPath -PathType Container) {
            if (([IO.File]::GetAttributes($pnpmPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Profile node_modules/.pnpm is redirected; refusing to seed through it.' }
            $pnpm = @(Get-ChildItem -LiteralPath $pnpmPath -Force | ForEach-Object { $_.Name })
        }
        foreach ($scope in @(Get-ChildItem -LiteralPath $NodeModulesPath -Directory -Force | Where-Object { $_.Name.StartsWith('@', [StringComparison]::Ordinal) })) {
            if (([IO.File]::GetAttributes($scope.FullName) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Scoped node_modules directory is redirected: $($scope.Name)" }
            $scopes[$scope.Name] = @(Get-ChildItem -LiteralPath $scope.FullName -Force | ForEach-Object { $_.Name })
        }
        $binPath = Join-Path $NodeModulesPath '.bin'
        if (Test-Path -LiteralPath $binPath -PathType Container) {
            if (([IO.File]::GetAttributes($binPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Profile node_modules/.bin is redirected; refusing to seed through it.' }
            $bin = @(Get-ChildItem -LiteralPath $binPath -Force | ForEach-Object { $_.Name })
        }
        foreach ($relative in @('.modules.yaml', '.pnpm-workspace-state-v1.json', '.pnpm/lock.yaml')) {
            $file = Join-Path $NodeModulesPath $relative
            if (Test-Path -LiteralPath $file -PathType Leaf) {
                if (([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Profile node_modules metadata is redirected: $relative" }
                $files[$relative] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))
            } else { $files[$relative] = $null }
        }
    }
    return [pscustomobject]@{ exists=$exists; top=$top; pnpm=$pnpm; scopes=$scopes; bin=$bin; files=$files }
}

function Remove-SeedPath {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $attributes = [IO.File]::GetAttributes($Path)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Remove-Item -LiteralPath $Path -Force }
    elseif (($attributes -band [IO.FileAttributes]::Directory) -ne 0) { Remove-Item -LiteralPath $Path -Recurse -Force }
    else { Remove-Item -LiteralPath $Path -Force }
}

function Restore-SeedNodeModules {
    param(
        [Parameter(Mandatory=$true)][string]$NodeModulesPath,
        [Parameter(Mandatory=$true)]$Snapshot,
        [Parameter(Mandatory=$true)][string]$PluginModulePath,
        [Parameter(Mandatory=$true)][string]$BackupModulePath
    )
    if (-not $Snapshot.exists) {
        Remove-SeedPath -Path $NodeModulesPath
        return
    }
    foreach ($entry in @(Get-ChildItem -LiteralPath $NodeModulesPath -Force -ErrorAction SilentlyContinue)) {
        if ($Snapshot.top -cnotcontains $entry.Name) { Remove-SeedPath -Path $entry.FullName }
    }
    if (Test-Path -LiteralPath $PluginModulePath) { Remove-SeedPath -Path $PluginModulePath }
    foreach ($scopeName in @($Snapshot.scopes.Keys)) {
        $scopePath = Join-Path $NodeModulesPath $scopeName
        if (Test-Path -LiteralPath $scopePath -PathType Container) {
            foreach ($entry in @(Get-ChildItem -LiteralPath $scopePath -Force)) {
                if ($Snapshot.scopes[$scopeName] -cnotcontains $entry.Name) { Remove-SeedPath -Path $entry.FullName }
            }
        }
    }
    $pnpmPath = Join-Path $NodeModulesPath '.pnpm'
    if (Test-Path -LiteralPath $pnpmPath -PathType Container) {
        foreach ($entry in @(Get-ChildItem -LiteralPath $pnpmPath -Force)) {
            if ($Snapshot.pnpm -cnotcontains $entry.Name) { Remove-SeedPath -Path $entry.FullName }
        }
    }
    $binPath = Join-Path $NodeModulesPath '.bin'
    if (Test-Path -LiteralPath $binPath -PathType Container) {
        foreach ($entry in @(Get-ChildItem -LiteralPath $binPath -Force)) {
            if ($Snapshot.bin -cnotcontains $entry.Name) { Remove-SeedPath -Path $entry.FullName }
        }
    }
    foreach ($relative in @($Snapshot.files.Keys)) {
        $file = Join-Path $NodeModulesPath $relative
        $original = $Snapshot.files[$relative]
        if ($null -eq $original) {
            if (Test-Path -LiteralPath $file) { Remove-SeedPath -Path $file }
        } else {
            $parent = Split-Path -Parent $file
            if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            [IO.File]::WriteAllBytes($file, [Convert]::FromBase64String($original))
        }
    }
    if (Test-Path -LiteralPath $BackupModulePath) {
        $parent = Split-Path -Parent $PluginModulePath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Move-Item -LiteralPath $BackupModulePath -Destination $PluginModulePath
    }
}

function Write-SeedJsonAtomic {
    param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)]$Value)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $temp = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    $backup = "$Path.$([Guid]::NewGuid().ToString('N')).bak"
    try {
        $json = ($Value | ConvertTo-Json -Depth 100) + "`n"
        [IO.File]::WriteAllText($temp, $json, [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $Path -PathType Leaf) { [IO.File]::Replace($temp, $Path, $backup); if (Test-Path -LiteralPath $backup) { [IO.File]::Delete($backup) } }
        else { [IO.File]::Move($temp, $Path) }
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

Export-ModuleMember -Function Get-SeedReadiness, Get-SeedSha512, Test-SeedRecordedName, Merge-SeedCordisPatch, Add-SeedBundleName, Get-SeedRelativeDependencyPath, Get-SeedNodeModulesSnapshot, Restore-SeedNodeModules, Remove-SeedPath, Write-SeedJsonAtomic
