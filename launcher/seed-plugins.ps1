param(
    [string]$Root,
    [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'
$coreModule = Join-Path $PSScriptRoot 'seed-plugins-core.psm1'
if (-not (Test-Path -LiteralPath $coreModule -PathType Leaf)) { $coreModule = Join-Path $PSScriptRoot '../experiments/official-payload/seed-plugins-core.psm1' }
Import-Module $coreModule -Force

function Write-SeedStatus {
    param([string]$Root, $Status)
    try { Write-SeedJsonAtomic -Path (Join-Path $Root 'data/launcher/seed-status.json') -Value $Status }
    catch { try { [Console]::Error.WriteLine('seed-status write failed: ' + $_.Exception.Message) } catch { } }
}

function Test-SeedOfficialProcess {
    try { return (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -gt 0) }
    catch { throw "Could not safely check for an official DSH process: $($_.Exception.Message)" }
}

function Get-SeedModulePath {
    param([string]$ProfileDirectory, [string]$Name)
    $path = Join-Path $ProfileDirectory (Join-Path 'node_modules' $Name)
    $full = [IO.Path]::GetFullPath($path)
    $nodeModules = [IO.Path]::GetFullPath((Join-Path $ProfileDirectory 'node_modules')).TrimEnd('\') + '\'
    if (-not $full.StartsWith($nodeModules, [StringComparison]::OrdinalIgnoreCase)) { throw 'Plugin module path escaped the desktop profile.' }
    return $full
}

function Invoke-SeedPluginAdd {
    param([string]$Root, [string]$ProfileDirectory, [string]$DshCmd, [string]$RelativePackage)
    $commandShell = Join-Path $env:SystemRoot 'System32/cmd.exe'
    if (-not (Test-Path -LiteralPath $commandShell -PathType Leaf)) { throw 'Windows command processor is missing.' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $commandShell
    $start.Arguments = '/d /s /c ""' + $DshCmd + '" plugin --profile desktop add "' + $RelativePackage + '""'
    $start.WorkingDirectory = $ProfileDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.EnvironmentVariables['DSH_HOME'] = Join-Path $Root 'data/dsh-home'
    $process = [Diagnostics.Process]::Start($start)
    try {
        if (-not $process.WaitForExit(25000)) {
            $killer = Join-Path $env:SystemRoot 'System32/taskkill.exe'
            if (Test-Path -LiteralPath $killer -PathType Leaf) { & $killer /PID $process.Id /T /F 2>$null | Out-Null }
            try { $process.WaitForExit(5000) | Out-Null } catch { }
            throw 'Official plugin add exceeded the 25 second seed limit.'
        }
        if ($process.ExitCode -ne 0) { throw "Official plugin add returned exit code $($process.ExitCode)." }
    } finally { $process.Dispose() }
}

function Invoke-SeedPlugin {
    param(
        [string]$Root,
        [string]$ProfileDirectory,
        [string]$DshCmd,
        [string]$SeedDirectory,
        $Plugin,
        $Seeded
    )
    $name = [string]$Plugin.name
    if ($name -notmatch '^(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9][A-Za-z0-9._-]*$' -or [string]$Plugin.file -notmatch '^[A-Za-z0-9+._-]+\.tgz$' -or [string]$Plugin.entryId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]*$' -or [string]$Plugin.sha512 -notmatch '^[0-9a-fA-F]{128}$') { throw 'Seed manifest contains an invalid plugin record.' }
    if (Test-SeedRecordedName -Seeded $Seeded -Name $name) { return [pscustomobject]@{ name=$name; status='already-recorded' } }
    $seedFile = Join-Path $SeedDirectory $Plugin.file
    if (-not (Test-Path -LiteralPath $seedFile -PathType Leaf)) { throw "Seed archive is missing: $($Plugin.file)" }
    $hash = Get-SeedSha512 -Path $seedFile
    if (-not [String]::Equals($hash, [string]$Plugin.sha512, [StringComparison]::OrdinalIgnoreCase)) { throw "Seed archive SHA-512 mismatch: $($Plugin.file)" }

    $packagePath = Join-Path $ProfileDirectory 'package.json'
    $patchPath = Join-Path $ProfileDirectory 'cordis.patch.yml'
    $packageBytes = [IO.File]::ReadAllBytes($packagePath)
    $patchExisted = Test-Path -LiteralPath $patchPath -PathType Leaf
    $patchBytes = if ($patchExisted) { [IO.File]::ReadAllBytes($patchPath) } else { $null }
    $lockPath = Join-Path $ProfileDirectory 'pnpm-lock.yaml'
    $lockExisted = Test-Path -LiteralPath $lockPath -PathType Leaf
    if ($lockExisted -and (([IO.File]::GetAttributes($lockPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Profile pnpm-lock.yaml is redirected; refusing to seed through it.' }
    $lockBytes = if ($lockExisted) { [IO.File]::ReadAllBytes($lockPath) } else { $null }
    $profileSeedDirectory = Join-Path $ProfileDirectory 'seed'
    $profileSeedDirectoryExisted = Test-Path -LiteralPath $profileSeedDirectory -PathType Container
    if ($profileSeedDirectoryExisted -and (([IO.File]::GetAttributes($profileSeedDirectory) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Profile seed directory is redirected; refusing to seed through it.' }
    $profileSeedFile = Join-Path $profileSeedDirectory $Plugin.file
    $profileSeedFileExisted = Test-Path -LiteralPath $profileSeedFile -PathType Leaf
    if ($profileSeedFileExisted -and (([IO.File]::GetAttributes($profileSeedFile) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Profile seed archive is redirected; refusing to seed through it.' }
    $nodeModulesPath = Join-Path $ProfileDirectory 'node_modules'
    $snapshot = Get-SeedNodeModulesSnapshot -NodeModulesPath $nodeModulesPath
    $modulePath = Get-SeedModulePath -ProfileDirectory $ProfileDirectory -Name $name
    $backupDirectory = Join-Path (Join-Path $Root 'data/launcher') ('.seed-rollback-' + [Guid]::NewGuid().ToString('N'))
    $backupModule = Join-Path $backupDirectory 'previous-module'
    $seededPath = Join-Path $Root 'data/launcher/seeded.json'
    $seededBytesExisted = Test-Path -LiteralPath $seededPath -PathType Leaf
    $seededBytes = if ($seededBytesExisted) { [IO.File]::ReadAllBytes($seededPath) } else { $null }
    $seededPluginsBefore = @($Seeded.plugins)
    $profileSeedDirectoryCreated = $false
    $profileSeedFileCreated = $false
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    try {
        if (Test-Path -LiteralPath $modulePath) { Move-Item -LiteralPath $modulePath -Destination $backupModule }
        if (-not $profileSeedDirectoryExisted) { New-Item -ItemType Directory -Path $profileSeedDirectory -Force | Out-Null; $profileSeedDirectoryCreated = $true }
        if ($profileSeedFileExisted) {
            if (-not [String]::Equals((Get-SeedSha512 -Path $profileSeedFile), [string]$Plugin.sha512, [StringComparison]::OrdinalIgnoreCase)) { throw "Profile seed archive already exists with different contents: $($Plugin.file)" }
        } else {
            Copy-Item -LiteralPath $seedFile -Destination $profileSeedFile
            $profileSeedFileCreated = $true
        }
        $relativePackage = './seed/' + [string]$Plugin.file
        if (Test-SeedOfficialProcess) { throw 'An official DSH process started while plugins were being seeded.' }
        Invoke-SeedPluginAdd -Root $Root -ProfileDirectory $ProfileDirectory -DshCmd $DshCmd -RelativePackage $relativePackage

        $package = [IO.File]::ReadAllText($packagePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($null -eq $package.dependencies) { throw "Official plugin add did not add dependency '$name'." }
        $dependency = $package.dependencies.PSObject.Properties[$name]
        if ($null -eq $dependency) { throw "Official plugin add did not add dependency '$name'." }
        if ($null -eq $package.dsh -or $null -eq $package.dsh.profile -or @($package.dsh.profile.bundles) -cnotcontains $name) { throw "Official plugin add did not add '$name' to profile bundles." }
        $dependencyPath = [string]$dependency.Value
        if (-not $dependencyPath.StartsWith('file:', [StringComparison]::OrdinalIgnoreCase)) { throw "Official plugin add wrote an unexpected dependency for '$name'." }
        $dependencyPath = $dependencyPath.Substring(5)
        $resolvedDependencyPath = if ([IO.Path]::IsPathRooted($dependencyPath)) { [IO.Path]::GetFullPath($dependencyPath) } else { [IO.Path]::GetFullPath((Join-Path $ProfileDirectory $dependencyPath)) }
        if (-not [String]::Equals($resolvedDependencyPath, [IO.Path]::GetFullPath($profileSeedFile), [StringComparison]::OrdinalIgnoreCase)) { throw "Official plugin add referenced an unexpected archive for '$name'." }
        $dependency.Value = 'file:' + $relativePackage
        # Ship it installed but off, exactly as the official Plugins page records "off": the package stays a
        # dependency and leaves dsh.profile.bundles. The page then shows it disabled and one click enables it.
        $package.dsh.profile.bundles = @(@($package.dsh.profile.bundles) | Where-Object { $_ -cne $name })
        Write-SeedJsonAtomic -Path $packagePath -Value $package
        if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
            $lockContent = [IO.File]::ReadAllText($lockPath, [Text.Encoding]::UTF8)
            $rewrittenLock = Rewrite-SeedLockfilePackagePath -Content $lockContent -AbsolutePackagePath $profileSeedFile -RelativePackagePath $relativePackage
            Write-SeedTextAtomic -Path $lockPath -Value $rewrittenLock.content
        }
        $modulesMetadataPath = Join-Path $nodeModulesPath '.modules.yaml'
        if (Test-Path -LiteralPath $modulesMetadataPath -PathType Leaf) {
            $modulesContent = [IO.File]::ReadAllText($modulesMetadataPath, [Text.Encoding]::UTF8)
            $rewrittenModules = Rewrite-SeedVirtualStorePath -Content $modulesContent
            Write-SeedTextAtomic -Path $modulesMetadataPath -Value $rewrittenModules.content
        }

        $installedPackagePath = Join-Path $modulePath 'package.json'
        if (-not (Test-Path -LiteralPath $installedPackagePath -PathType Leaf)) { throw "Official plugin add did not materialize node_modules/$name." }
        $installed = [IO.File]::ReadAllText($installedPackagePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($installed.name -cne $name -or $installed.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw "Installed plugin metadata does not match '$name'." }

        $records = @($Seeded.plugins)
        $records += [pscustomobject]@{ name=$name; version=[string]$installed.version; nameVersion=($name + '@' + $installed.version); entryId=[string]$Plugin.entryId }
        $Seeded.plugins = $records
        Write-SeedJsonAtomic -Path $seededPath -Value $Seeded
        Remove-SeedPath -Path $backupDirectory
        return [pscustomobject]@{ name=$name; version=[string]$installed.version; status='seeded'; disabledBy='profile-bundles' }
    } catch {
        $failure = $_.Exception.Message
        try {
            [IO.File]::WriteAllBytes($packagePath, $packageBytes)
            if ($patchExisted) { [IO.File]::WriteAllBytes($patchPath, $patchBytes) } elseif (Test-Path -LiteralPath $patchPath) { Remove-Item -LiteralPath $patchPath -Force }
            if ($lockExisted) { [IO.File]::WriteAllBytes($lockPath, $lockBytes) } elseif (Test-Path -LiteralPath $lockPath) { Remove-Item -LiteralPath $lockPath -Force }
            Restore-SeedNodeModules -NodeModulesPath $nodeModulesPath -Snapshot $snapshot -PluginModulePath $modulePath -BackupModulePath $backupModule
            if ($profileSeedFileCreated -and (Test-Path -LiteralPath $profileSeedFile)) { Remove-Item -LiteralPath $profileSeedFile -Force }
            if ($profileSeedDirectoryCreated -and (Test-Path -LiteralPath $profileSeedDirectory) -and @(Get-ChildItem -LiteralPath $profileSeedDirectory -Force).Count -eq 0) { Remove-Item -LiteralPath $profileSeedDirectory -Force }
            if ($seededBytesExisted) { [IO.File]::WriteAllBytes($seededPath, $seededBytes) } elseif (Test-Path -LiteralPath $seededPath) { Remove-Item -LiteralPath $seededPath -Force }
            $Seeded.plugins = $seededPluginsBefore
        } catch { $failure += '; rollback error: ' + $_.Exception.Message }
        throw $failure
    } finally {
        if (Test-Path -LiteralPath $backupDirectory) { Remove-SeedPath -Path $backupDirectory }
    }
}

function Invoke-SeedPlugins {
    param([Parameter(Mandatory=$true)][string]$Root)
    $Root = [IO.Path]::GetFullPath($Root)
    $readiness = Get-SeedReadiness -Root $Root
    if ($readiness -ne 'ready') { return 0 }
    $seedDirectory = Join-Path $Root 'launcher/seed'
    $manifestPath = Join-Path $seedDirectory 'seed.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return 0 }
    $results = New-Object System.Collections.Generic.List[object]
    $status = [ordered]@{ schemaVersion=1; status='running'; plugins=@(); completedAt=$null }
    $exitCode = 0
    try {
        if (Test-SeedOfficialProcess) {
            $status.status = 'official-process-running'
            return 0
        }
        $manifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($manifest.schemaVersion -ne 1 -or @($manifest.plugins).Count -gt 32) { throw 'Seed manifest schema is invalid.' }
        $appStatePath = Join-Path $Root 'app/current.json'
        $appState = [IO.File]::ReadAllText($appStatePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ([string]$appState.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Current official application version is invalid.' }
        $dshCmd = Join-Path $Root ("app/$($appState.version)/resources/runtime/cli/bin/dsh.cmd")
        if (-not (Test-Path -LiteralPath $dshCmd -PathType Leaf)) { throw 'Official dsh.cmd is missing from the current application.' }
        $profileDirectory = Join-Path $Root 'data/dsh-home/profiles/desktop'
        $seededPath = Join-Path $Root 'data/launcher/seeded.json'
        if (Test-Path -LiteralPath $seededPath -PathType Leaf) {
            $seeded = [IO.File]::ReadAllText($seededPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
            if ($seeded.schemaVersion -ne 1 -or $null -eq $seeded.plugins) { throw 'Seeded marker schema is invalid.' }
        } else { $seeded = [pscustomobject]@{ schemaVersion=1; plugins=@() } }

        foreach ($plugin in @($manifest.plugins)) {
            try { $results.Add((Invoke-SeedPlugin -Root $Root -ProfileDirectory $profileDirectory -DshCmd $dshCmd -SeedDirectory $seedDirectory -Plugin $plugin -Seeded $seeded)) }
            catch { $exitCode = 1; $results.Add([pscustomobject]@{ name=[string]$plugin.name; status='failed'; error=$_.Exception.Message }) }
        }
        $status.status = if ($exitCode -eq 0) { 'complete' } else { 'partial-failure' }
    } catch {
        $exitCode = 1
        $status.status = 'failed'
        $results.Add([pscustomobject]@{ status='failed'; error=$_.Exception.Message })
    } finally {
        $status.plugins = @($results.ToArray())
        $status.completedAt = [DateTime]::UtcNow.ToString('o')
        Write-SeedStatus -Root $Root -Status $status
    }
    return $exitCode
}

if ($LibraryOnly) { return }
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$exitCode = Invoke-SeedPlugins -Root $Root
exit $exitCode
