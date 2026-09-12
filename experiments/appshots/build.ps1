param([string]$OutputDirectory = 'build/appshots-experiment')
$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$Output = [IO.Path]::GetFullPath((Join-Path $Repo $OutputDirectory))
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$VsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$Vs = & $VsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $Vs) { throw 'MSVC x64 build tools are required.' }
$Setup = Join-Path $Vs 'VC/Auxiliary/Build/vcvars64.bat'
$Source = Join-Path $PSScriptRoot 'capture.cpp'
$Executable = Join-Path $Output 'appshot-capture.exe'
$Object = Join-Path $Output 'capture.obj'
# Compile a standalone, statically linked helper: no Node, .NET, or redistributable installation.
& $env:ComSpec /d /s /c "`"`"$Setup`" >nul && cl.exe /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE /Fo`"$Object`" /Fe`"$Executable`" `"$Source`" /link windowsapp.lib d3d11.lib dxgi.lib dwmapi.lib windowscodecs.lib crypt32.lib ole32.lib oleaut32.lib user32.lib`""
if ($LASTEXITCODE -ne 0) { throw 'Appshot helper compilation failed.' }
Get-Item -LiteralPath $Executable | Select-Object FullName,Length
