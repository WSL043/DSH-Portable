[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('portable')]
    [string]$Kind,
    [Parameter(Mandatory = $true)]
    [string]$Archive,
    [string]$OutputDir,
    [string]$IsccPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Archive = [System.IO.Path]::GetFullPath($Archive)
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot 'artifacts' }
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "Windows base archive is missing: $Archive" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (-not $IsccPath) {
    $Command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($Command) { $IsccPath = $Command.Source }
}
if (-not $IsccPath) {
    foreach ($Candidate in @(
        (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Inno Setup 7\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 7\ISCC.exe')
    )) {
        if ($Candidate -and (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
            $IsccPath = $Candidate
            break
        }
    }
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) {
    throw 'An Inno Setup 7 compiler (ISCC.exe) is required.'
}
$IsccHelp = @(& $IsccPath '/?' 2>&1 | Select-Object -First 8) -join "`n"
$IsccVersionMatch = [regex]::Match($IsccHelp, '(?m)^Inno Setup (?<major>\d+) Command-Line Compiler\s*$')
if (-not $IsccVersionMatch.Success -or [int]$IsccVersionMatch.Groups['major'].Value -lt 7) {
    throw "Inno Setup 7 or newer is required; its version header was not found in the compiler help output."
}

$PortableVersion = (Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json).version
$BuildId = [Guid]::NewGuid().ToString('N')
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$WorkRoot = [System.IO.Path]::GetFullPath((Join-Path $TempRoot ("dsh-inno-$Kind-$BuildId")))
if (-not $WorkRoot.StartsWith($TempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe installer staging directory: $WorkRoot"
}
$Stage = Join-Path $WorkRoot 'DSH-Portable'
$CompilerOutput = Join-Path $WorkRoot 'output'
$MappedDrive = $null
$Mapped = $false

try {
    New-Item -ItemType Directory -Force -Path $WorkRoot, $CompilerOutput | Out-Null
    & tar.exe -x -f $Archive -C $WorkRoot
    if ($LASTEXITCODE -ne 0) { throw "Windows base archive extraction failed with exit code $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath (Join-Path $Stage 'DeepSeek-Herness.exe') -PathType Leaf)) {
        throw 'The Windows base archive does not contain a complete DSH-Portable stage.'
    }

    foreach ($Letter in @('R', 'Q', 'P', 'O', 'N', 'M')) {
        $CandidateDrive = "${Letter}:"
        if (-not (Test-Path -LiteralPath ($CandidateDrive + '\'))) {
            $MappedDrive = $CandidateDrive
            break
        }
    }
    if (-not $MappedDrive) { throw 'No unused drive letter is available for the installer build.' }
    & subst.exe $MappedDrive $WorkRoot
    if ($LASTEXITCODE -ne 0) { throw "Could not map the installer staging drive ($MappedDrive)." }
    $Mapped = $true

    $MappedRoot = $MappedDrive + '\'
    $MappedStage = Join-Path $MappedRoot 'DSH-Portable'
    $MappedOutput = Join-Path $MappedRoot 'output'
    $SetupScript = Join-Path $ProjectRoot 'installer\windows\DSH-Portable.iss'
    $OutputName = 'DSH-Portable-windows-x64-offline.exe'

    $Arguments = @(
        '--quiet',
        "/DStage=$MappedStage",
        "/DOutputDir=$MappedOutput",
        "/DProjectRoot=$ProjectRoot",
        "/DAppVersion=$PortableVersion",
        $SetupScript
    )
    & $IsccPath $Arguments
    $CompilerExitCode = $LASTEXITCODE
    if ($null -ne $CompilerExitCode -and $CompilerExitCode -ne 0) {
        throw "Inno Setup $Kind build failed with exit code $CompilerExitCode"
    }

    $Candidate = Join-Path $CompilerOutput $OutputName
    if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { throw "Inno Setup did not produce $OutputName." }
    $Destination = Join-Path $OutputDir $OutputName
    Copy-Item -Force -LiteralPath $Candidate -Destination $Destination
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
    "$Hash  $OutputName" | Set-Content -LiteralPath ($Destination + '.sha256') -Encoding ascii -NoNewline

    [pscustomobject]@{ Kind = $Kind; Artifact = $Destination; Sha256 = $Hash }
} finally {
    if ($Mapped) {
        & subst.exe $MappedDrive /D
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not release temporary installer drive $MappedDrive" }
    }
    if (Test-Path -LiteralPath $WorkRoot) {
        Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
