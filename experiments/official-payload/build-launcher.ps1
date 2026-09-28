param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Use a fresh output executable' }
New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$icon = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../assets/DSH-Portable.ico'))
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll "/win32icon:$icon" "/out:$Output" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
