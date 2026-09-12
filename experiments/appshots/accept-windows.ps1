param([string]$RunName = 'run-1')
$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$BuildOutput = Join-Path $Repo 'build/appshots-experiment'
if ($RunName -notmatch '^run-[0-9]+$') { throw 'Invalid acceptance run name.' }
$Output = Join-Path $BuildOutput $RunName
New-Item -ItemType Directory -Force -Path $Output | Out-Null
Copy-Item -LiteralPath (Join-Path $BuildOutput 'appshot-capture.exe') -Destination $Output
$Compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$FixtureExe = Join-Path $Output 'fixture.exe'
$Ready = Join-Path $Output 'fixture.json'
if (Test-Path -LiteralPath $Ready) { throw 'Existing acceptance ready marker; inspect previous fixture before another run.' }
& $Compiler /nologo /target:winexe /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "/out:$FixtureExe" (Join-Path $PSScriptRoot 'fixture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed.' }
$Fixture = Start-Process -FilePath $FixtureExe -ArgumentList ('"' + $Ready + '"') -WindowStyle Hidden -PassThru
try {
    $Deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $Ready) -and [DateTime]::UtcNow -lt $Deadline) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $Ready)) { throw 'Fixture did not initialize.' }
    & node (Join-Path $PSScriptRoot 'accept.mjs') $Output
    if ($LASTEXITCODE -ne 0) { throw 'Native Appshot acceptance failed; evidence retained.' }
} finally {
    if (-not $Fixture.HasExited) { $Fixture.Kill(); $Fixture.WaitForExit() }
}
