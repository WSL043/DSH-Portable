param(
    [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw "C# compiler not found: $compiler" }
$output = [IO.Path]::GetFullPath($OutputPath)
$null = New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output))
$source = Join-Path $PSScriptRoot 'Stub.cs'
& $compiler '/nologo' '/target:exe' "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw "Stub compilation failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $output)) { throw 'Stub compiler did not create the executable' }
Write-Output $output
