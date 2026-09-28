param([ValidateSet('Start','Stop')][string]$Mode, [string]$Evidence, [string]$PortableRoot)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Trace only on disposable hosted runners' }
$tools = Join-Path $env:RUNNER_TEMP 'portable-procmon'
$exe = Join-Path $tools 'Procmon64.exe'
$pml = Join-Path $tools 'writes.pml'
if ($Mode -eq 'Start') {
    New-Item -ItemType Directory -Path $tools -Force | Out-Null
    Invoke-WebRequest 'https://download.sysinternals.com/files/ProcessMonitor.zip' -OutFile "$tools/procmon.zip"
    Expand-Archive "$tools/procmon.zip" $tools -Force
    if ((Get-AuthenticodeSignature $exe).Status -ne 'Valid') { throw 'Procmon signature invalid' }
    Start-Process -FilePath $exe -ArgumentList @('/AcceptEula','/Quiet','/Minimized','/BackingFile',"`"$pml`"") -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 2
    return
}
Start-Process -FilePath $exe -ArgumentList '/Terminate' -WindowStyle Hidden -Wait | Out-Null
$csv = Join-Path $tools 'writes.csv'
Start-Process -FilePath $exe -ArgumentList @('/Quiet','/OpenLog',"`"$pml`"",'/SaveAs',"`"$csv`"") -WindowStyle Hidden -Wait | Out-Null
if (-not (Test-Path $csv)) { throw 'Procmon export missing' }
$owned = New-Object 'System.Collections.Generic.HashSet[string]'
$findings = New-Object 'System.Collections.Generic.List[object]'
$operations = @('WriteFile','SetEndOfFileInformationFile','SetRenameInformationFile','SetDispositionInformationFile','RegSetValue','RegDeleteValue','RegDeleteKey','RegCreateKey')
$root = [IO.Path]::GetFullPath($PortableRoot).TrimEnd('\') + '\'
Import-Csv -LiteralPath $csv | ForEach-Object {
    if ($_.'Process Name' -eq 'DeepSeek Harness.exe') { [void]$owned.Add([string]$_.PID) }
    if ($owned.Contains([string]$_.PID)) {
        if ($_.Operation -eq 'Process Create' -and $_.Detail -match '^PID: (\d+)') { [void]$owned.Add($Matches[1]) }
        $write = $_.Operation -in $operations -or ($_.Operation -eq 'CreateFile' -and $_.Detail -match 'OpenResult: Created')
        if ($_.Operation -eq 'RegCreateKey' -and $_.Detail -match 'REG_OPENED_EXISTING_KEY') { $write=$false }
        if ($_.Result -eq 'SUCCESS' -and $write -and -not $_.Path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) {
            $category = 'needs-review'
            if ($_.Path.StartsWith($env:TEMP.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith('C:\Windows\Temp\',[StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith((Join-Path $env:LOCALAPPDATA 'Temp')+'\',[StringComparison]::OrdinalIgnoreCase)) { $category='temporary' }
            if ($_.Path -match '^HKCU\\Software\\Classes\\dsh(\\|$)') { $category='known-protocol-registration' }
            if ($_.Path -match '^\\Device\\NamedPipe(\\|$)') { $category='ipc-not-a-disk-file' }
            if ($_.Path -match '^[A-Z]:$|^[A-Z]:\\\$(LogFile|Mft)$|^HKLM\\System\\CurrentControlSet\\Services\\bam\\') { $category='windows-system-record' }
            # Reviewed in alpha3 run 36404975086: paired .NET process registration
            # writes/deletes, not portable account, profile or application data.
            if ($_.'Process Name' -in @('DeepSeek Harness Portable.exe','powershell.exe') -and $_.Operation -in @('RegSetValue','RegDeleteValue') -and $_.Path -match '^HKLM\\System\\CurrentControlSet\\Services\\ASP\.NET_4\.0\.30319\\Names\\[A-Za-z0-9]+$') { $category='reviewed-dotnet-system-registration' }
            if ($_.Path -match '\\Microsoft\\Spelling\\|^HKCU\\Software\\Microsoft\\Spelling') { $category='windows-shared-spelling' }
            # Reviewed in native run 36409052501: DirectX shader cache files,
            # https://microsoft.github.io/DirectX-Specs/d3d/ShaderCache.html
            # Retain them in evidence; do not classify other LocalAppData writes here.
            $shaderRoot=(Join-Path $env:LOCALAPPDATA 'D3DSCache')+'\'
            if ($_.'Process Name' -eq 'DeepSeek Harness.exe' -and $_.Path.StartsWith($shaderRoot,[StringComparison]::OrdinalIgnoreCase) -and $_.Path.Substring($shaderRoot.Length) -match '^[a-f0-9]+(?:\\[a-f0-9-]+\.dxcache(?:-journal|-shm|-wal)?)?$') { $category='windows-directx-shader-cache' }
            if ($_.Path -match '\\Microsoft\\Windows\\PowerShell\\StartupProfileData-NonInteractive$') { $category='windows-powershell-startup-cache' }
            if ($_.Path.StartsWith((Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'deepseek-harness'),[StringComparison]::OrdinalIgnoreCase)) { $category='official-external-workspace' }
            $findings.Add([pscustomobject]@{process=$_.'Process Name';pid=$_.PID;operation=$_.Operation;path=$_.Path;category=$category})
        }
    }
}
$findings | Sort-Object process,operation,path -Unique | ConvertTo-Json -Depth 4 | Set-Content "$Evidence/outside-writes.json"
@{ captured=$true; ownedProcesses=$owned.Count; outsideWriteEvents=$findings.Count; unclassifiedEvents=@($findings|Where-Object category -eq 'needs-review').Count } | ConvertTo-Json | Set-Content "$Evidence/write-trace-summary.json"
if ($owned.Count -eq 0) { throw 'Procmon captured no official processes' }
