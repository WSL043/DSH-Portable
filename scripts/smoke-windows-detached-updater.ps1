param(
    [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$Launcher = Join-Path $Root 'DeepSeek-Herness.exe'
if (-not (Test-Path -LiteralPath $Launcher)) { throw "finished launcher is missing: $Launcher" }

$ProbeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-detached-update-" + [Guid]::NewGuid().ToString('N'))
$Writer = Join-Path $ProbeRoot 'detached-writer.exe'
$WriterSource = Join-Path $ProbeRoot 'detached-writer.cs'
$Sentinel = Join-Path $ProbeRoot 'survived.txt'
$Runner = Join-Path $ProbeRoot 'invoke-breakaway.ps1'
New-Item -ItemType Directory -Force -Path $ProbeRoot | Out-Null

try {
    @'
using System;
using System.IO;
using System.Threading;
public static class DetachedWriter {
    [STAThread]
    public static void Main(string[] args) {
        Thread.Sleep(1500);
        File.WriteAllText(args[0], "survived");
    }
}
'@ | Set-Content -LiteralPath $WriterSource -Encoding UTF8
    $Compiler = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $Compiler)) { throw "C# compiler is missing: $Compiler" }
    & $Compiler /nologo /target:winexe "/out:$Writer" $WriterSource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Writer)) { throw 'detached updater probe could not compile its writer' }

    @'
param([string]$Launcher, [string]$Writer, [string]$Sentinel)
$assembly = [Reflection.Assembly]::LoadFrom($Launcher)
$type = $assembly.GetType('DshPortable.PortableProcessJob', $true)
$flags = [Reflection.BindingFlags]'Static,NonPublic,Public'
$type.GetMethod('Initialize', $flags).Invoke($null, @())
$type.GetMethod('StartDetachedUpdater', $flags).Invoke($null, @($Writer, [string[]]@($Sentinel)))
$type.GetMethod('ExitOwnedTree', $flags).Invoke($null, @())
'@ | Set-Content -LiteralPath $Runner -Encoding UTF8

    $RunnerArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Launcher "{1}" -Writer "{2}" -Sentinel "{3}"' -f `
        $Runner, $Launcher, $Writer, $Sentinel
    $Process = Start-Process powershell.exe -ArgumentList $RunnerArguments -WindowStyle Hidden -PassThru -Wait
    if ($Process.ExitCode -ne 0) { throw "detached updater probe exited with code $($Process.ExitCode)" }

    $Deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $Sentinel) -and [DateTime]::UtcNow -lt $Deadline) {
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path -LiteralPath $Sentinel)) {
        throw 'the updater remained in the Portable job and was terminated with the desktop process tree'
    }
    if ((Get-Content -Raw -LiteralPath $Sentinel) -ne 'survived') { throw 'detached updater probe wrote an invalid result' }
    Write-Host 'Windows detached full-package updater smoke passed.'
}
finally {
    Remove-Item -LiteralPath $ProbeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
