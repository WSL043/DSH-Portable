$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$Output = Join-Path $Repo 'build/appshots-plugin'
$Package = Join-Path $Output 'package'
New-Item -ItemType Directory -Force -Path (Join-Path $Package 'native'),(Join-Path $Package 'lib') | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'plugin/*') -Destination $Package -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'capture.mjs') -Destination (Join-Path $Package 'lib/capture.mjs')
Copy-Item -LiteralPath (Join-Path $Repo 'build/appshots-experiment/appshot-capture.exe') -Destination (Join-Path $Package 'native')
$Compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $Compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.Drawing.dll "/out:$Package/native/appshot-hotkey.exe" (Join-Path $PSScriptRoot 'hotkey.cs')
if ($LASTEXITCODE -ne 0) { throw 'Hotkey compilation failed.' }
& (Join-Path $Package 'native/appshot-hotkey.exe') --test
if ($LASTEXITCODE -ne 0) { throw 'Ctrl chord test failed.' }
$Version = (Get-Content -Raw (Join-Path $Package 'package.json') | ConvertFrom-Json).version
$Archive = Join-Path $Output "dsh-portable-appshots-$Version.tgz"
& tar.exe -czf $Archive -C $Output package
if ($LASTEXITCODE -ne 0) { throw 'Plugin packaging failed.' }
Get-Item -LiteralPath $Archive | Select-Object FullName,Length
