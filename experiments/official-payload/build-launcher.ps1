param(
    [Parameter(Mandatory=$true)][string]$Output,
    [ValidatePattern('\A1\.0\.0(?:-alpha\.(?:0|[1-9][0-9]{0,2})|-rc\.1)?\z')]
    [string]$PortableVersion='1.0.0-alpha.5'
)
$ErrorActionPreference = 'Stop'
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Use a fresh output executable' }
New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$icon = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../assets/DSH-Portable.ico'))
$revision = if ($PortableVersion -eq '1.0.0') { 65534 } elseif ($PortableVersion -eq '1.0.0-rc.1') { 65001 } else { ($PortableVersion -split '\.')[-1] }
$windowsVersion = "1.0.0.$revision"
$assemblyInfo = Join-Path (Split-Path -Parent $Output) ('launcher-version-' + [Guid]::NewGuid().ToString('N') + '.cs')
try {
    [IO.File]::WriteAllLines($assemblyInfo, @(
        ('[assembly: System.Reflection.AssemblyVersion("{0}")]' -f $windowsVersion)
        ('[assembly: System.Reflection.AssemblyFileVersion("{0}")]' -f $windowsVersion)
        ('[assembly: System.Reflection.AssemblyInformationalVersion("{0}")]' -f $PortableVersion)
    ), [Text.Encoding]::ASCII)
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll "/win32icon:$icon" "/out:$Output" (Join-Path $PSScriptRoot 'Launcher.cs') $assemblyInfo
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
    $fileVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($Output)
    if ($fileVersion.ProductVersion -cne $PortableVersion -or $fileVersion.FileVersion -cne $windowsVersion) { throw 'Launcher version does not match the requested package' }
} finally {
    [IO.File]::Delete($assemblyInfo)
}
