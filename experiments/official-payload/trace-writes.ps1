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
        if ($_.Result -eq 'SUCCESS' -and $_.Operation -in $operations -and -not $_.Path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) {
            $category = 'needs-review'
            if ($_.Path.StartsWith($env:TEMP.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith('C:\Windows\Temp\',[StringComparison]::OrdinalIgnoreCase)) { $category='temporary' }
            if ($_.Path -match '^HKCU\\Software\\Classes\\dsh(\\|$)') { $category='known-protocol-registration' }
            $findings.Add([pscustomobject]@{process=$_.'Process Name';pid=$_.PID;operation=$_.Operation;path=$_.Path;category=$category})
        }
    }
}
$findings | Sort-Object process,operation,path -Unique | ConvertTo-Json -Depth 4 | Set-Content "$Evidence/outside-writes.json"
@{ captured=$true; ownedProcesses=$owned.Count; outsideWriteEvents=$findings.Count; unclassifiedEvents=@($findings|Where-Object category -eq 'needs-review').Count } | ConvertTo-Json | Set-Content "$Evidence/write-trace-summary.json"
if ($owned.Count -eq 0) { throw 'Procmon captured no official processes' }
