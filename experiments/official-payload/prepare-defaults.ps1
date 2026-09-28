param([string]$Root,[string]$Version)
$ErrorActionPreference='Stop'
Import-Module "$PSScriptRoot/Payload.psm1" -Force
$defaults=Join-Path $Root 'launcher/default-plugins'
Assert-PlainPath $defaults
New-Item -ItemType Directory -Path $defaults -Force | Out-Null
$market=Join-Path $PSScriptRoot '../../build/official-market-plugin'
if(-not(Test-Path "$market/package.json")){throw 'Build the standalone market plugin before packaging'}
Copy-Item -LiteralPath $market -Destination "$defaults/dsh-portable-plugin-market" -Recurse
$chat=Join-Path $defaults 'dsh-chat-manager'
New-Item -ItemType Directory -Path $chat | Out-Null
$archive=Join-Path $defaults 'chat.tgz'
Invoke-WebRequest -UseBasicParsing 'https://registry.npmjs.org/dsh-chat-manager/-/dsh-chat-manager-1.5.2.tgz' -OutFile $archive
if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '5bb23c7a0296704a42ce2c0935f0ddca08db3b73504d0a9c8365c5a21b869744'){throw 'Default chat plugin integrity mismatch'}
& tar -xf $archive -C $chat --strip-components=1
if($LASTEXITCODE -ne 0){throw 'Default chat plugin extraction failed'}
Remove-Item -LiteralPath $archive
$seed=Join-Path $defaults 'seed-project'
New-Item -ItemType Directory -Path $seed | Out-Null
@{name='portable-default-seed';private=$true;dependencies=@{'dsh-chat-manager'='1.5.2';'@wsl043/dsh-portable-plugin-market'='file:../dsh-portable-plugin-market'}}|ConvertTo-Json -Depth 5|Set-Content "$seed/package.json" -Encoding UTF8
"packages:`n  - .`nautoInstallPeers: false`nnodeLinker: hoisted`n"|Set-Content "$seed/pnpm-workspace.yaml" -Encoding UTF8
$runtime=Join-Path $Root "app/$Version"
$prior=$env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE='1'
  # Offline range resolution needs registry metadata as well as content-addressed files.
  # Use a fresh package-owned cache so no runner account/cache data is shipped.
  $arguments=@((Join-Path $runtime 'resources/runtime/pnpm/bin/pnpm.mjs'),'install','--ignore-scripts','--store-dir',(Join-Path $defaults 'store'),'--cache-dir',(Join-Path $defaults 'cache'))|ForEach-Object {'"'+$_+'"'}
  $process=Start-Process -FilePath (Join-Path $runtime 'DeepSeek Harness.exe') -ArgumentList $arguments -WorkingDirectory $seed -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput "$seed/stdout.log" -RedirectStandardError "$seed/stderr.log"
  if($process.ExitCode -ne 0){Get-Content "$seed/stdout.log","$seed/stderr.log" -Tail 80;throw "Default plugin offline store preparation failed ($($process.ExitCode))"}
} finally {$env:ELECTRON_RUN_AS_NODE=$prior}
# pnpm registers its temporary seed project with a directory link in the store.
# It is build-machine bookkeeping, not offline package content. Unlink only
# that verified link before removing the seed; never follow its target.
$registrations=Join-Path $defaults 'store/v11/projects'
if(Test-Path -LiteralPath $registrations){
  Assert-PlainPath $registrations
  foreach($entry in Get-ChildItem -LiteralPath $registrations -Force){
    # pnpm prefers relative symbolic links when Windows permits them, and
    # falls back to absolute junctions otherwise (e.g. a non-admin machine).
    $linkTarget=[string]$entry.Target
    if(-not[IO.Path]::IsPathRooted($linkTarget)){$linkTarget=Join-Path $entry.Parent.FullName $linkTarget}
    if(-not($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $entry.LinkType -notin @('Junction','SymbolicLink') -or [IO.Path]::GetFullPath($linkTarget).TrimEnd('\') -ne [IO.Path]::GetFullPath($seed).TrimEnd('\')){throw "Unexpected offline-store project registration: $($entry.LinkType) $linkTarget"}
    [IO.Directory]::Delete($entry.FullName)
  }
  Remove-PortableScratch $registrations $defaults
}
Remove-PortableScratch $seed $defaults
@{schemaVersion=1;packages=@(@{name='dsh-chat-manager';version='1.5.2'},@{name='@wsl043/dsh-portable-plugin-market';version='0.2.0-alpha.1'})}|ConvertTo-Json -Depth 5|Set-Content "$defaults/manifest.json" -Encoding UTF8
