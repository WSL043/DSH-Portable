param([ValidateSet('Start','Stop')][string]$Mode, [string]$Evidence, [string]$PortableRoot)

# Procmon exports Process Create on the parent PID and Process Start/Exit on the
# child PID. Retire only the exiting lifetime: live children remain attributable.
function Update-TraceOwnership([hashtable]$State, $Row, [long]$Sequence) {
    $processId = [string]$Row.PID
    $name = [string]$Row.'Process Name'
    $operation = [string]$Row.Operation
    $imagePath = [string]$Row.Path
    $detail = [string]$Row.Detail
    $current = $State.active[$processId]
    $parentId = $null
    if ($operation -eq 'Process Start' -and $detail -match '(?:^|,\s*)Parent PID: (\d+)') { $parentId = $Matches[1] }
    if ($operation -eq 'Process Start') {
        # Create and Start describe one lifetime, even if its parent already exited.
        $pairedCreate = $null -ne $current -and $current.pendingStart -and
            (-not $parentId -or -not $current.parentPid -or $parentId -eq $current.parentPid) -and
            (-not $imagePath -or -not $current.path -or $current.path.Equals($imagePath, [StringComparison]::OrdinalIgnoreCase))
        if ($pairedCreate) {
            $current.pendingStart = $false
            if ($parentId) { $current.parentPid = $parentId }
        } else {
            $State.generation++
            $parent = if ($parentId) { $State.active[$parentId] } else { $null }
            $current = @{ owned=($name -eq 'DeepSeek Harness.exe' -or ($null -ne $parent -and $parent.owned)); generation=$State.generation; parentPid=$parentId; path=$imagePath; name=$name; pendingStart=$false }
            $State.active[$processId] = $current
        }
    } elseif ($null -eq $current -or ($current.name -and $name -and $current.name -ne $name)) {
        $State.generation++
        $current = @{ owned=($name -eq 'DeepSeek Harness.exe'); generation=$State.generation; parentPid=$null; path=$null; name=$name; pendingStart=$false }
        $State.active[$processId] = $current
    }
    if ($current.owned) { [void]$State.everOwned.Add($processId) }
    $childId = $null
    if ($operation -eq 'Process Create' -and [string]$Row.Result -eq 'SUCCESS' -and $detail -match '^PID: (\d+)') {
        $childId = $Matches[1]
        $State.generation++
        $child = @{ owned=($current.owned -or $imagePath -match '(?:^|[\\/])DeepSeek Harness\.exe$'); generation=$State.generation; parentPid=$processId; path=$imagePath; name=[IO.Path]::GetFileName($imagePath); pendingStart=$true }
        # A new Create is a new lifetime, including reuse by an unrelated parent.
        $State.active[$childId] = $child
        if ($child.owned) { [void]$State.everOwned.Add($childId) }
    }
    $result = [pscustomobject]@{ owned=[bool]$current.owned; generation=$current.generation; parentPid=$current.parentPid; imagePath=$current.path; childPid=$childId; childGeneration=if ($childId) { $State.active[$childId].generation } else { $null } }
    if ($operation -eq 'Process Exit') { $State.active.Remove($processId) }
    return $result
}

function New-TraceContextEvent($Row, [long]$Sequence, $Ownership) {
    # Keep the original field strings; missing Procmon fields stay empty rather
    # than being inferred as proof of a parent or executable identity.
    $fieldTruncated = $false
    # Procmon appends the child's environment to Create/Start Detail. Preserve
    # parent/command-line context, but never upload that environment block.
    $contextDetail = [string]$Row.Detail
    $environment = [regex]::Match($contextDetail, '(?is)(?:^|,\s*|[\r\n]+\s*)Environment:.*\z')
    $environmentOmitted = $environment.Success
    if ($environmentOmitted) { $contextDetail = $contextDetail.Substring(0, $environment.Index) }
    $fields = @{}
    foreach ($field in @('Time of Day','Process Name','PID','Operation','Path','Result','Detail')) {
        $text = if ($field -eq 'Detail') { $contextDetail } else { [string]$Row.$field }
        if ($text.Length -gt 2048) { $text = $text.Substring(0,2048); $fieldTruncated = $true }
        $fields[$field] = $text
    }
    $contextImagePath = [string]$Ownership.imagePath
    if ($contextImagePath.Length -gt 2048) { $contextImagePath = $contextImagePath.Substring(0,2048); $fieldTruncated = $true }
    return [pscustomobject]@{
        fieldTruncated=$fieldTruncated; environmentOmitted=$environmentOmitted
        sequence=$Sequence; time=$fields['Time of Day']; process=$fields['Process Name']; pid=$fields['PID']
        operation=$fields['Operation']; path=$fields['Path']; result=$fields['Result']; detail=$fields['Detail']
        generation=$Ownership.generation; parentPid=$Ownership.parentPid; imagePath=$contextImagePath
        owned=$Ownership.owned; childPid=$Ownership.childPid; childGeneration=$Ownership.childGeneration
    }
}

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
$ownership = @{ active=@{}; everOwned=(New-Object 'System.Collections.Generic.HashSet[string]'); generation=0 }
$contextEvents = New-Object 'System.Collections.Generic.List[object]'
$contextPids = New-Object 'System.Collections.Generic.HashSet[string]'
$contextWrites = New-Object 'System.Collections.Generic.HashSet[string]'
$contextTruncated = $false
$sequence = 0
$findings = New-Object 'System.Collections.Generic.List[object]'
$operations = @('WriteFile','SetEndOfFileInformationFile','SetRenameInformationFile','SetDispositionInformationFile','RegSetValue','RegDeleteValue','RegDeleteKey','RegCreateKey')
$root = [IO.Path]::GetFullPath($PortableRoot).TrimEnd('\') + '\'
Import-Csv -LiteralPath $csv | ForEach-Object {
    $sequence++
    $owner = Update-TraceOwnership $ownership $_ $sequence
    $everOwned = $ownership.everOwned.Contains([string]$_.PID)
    if ($_.Operation -in @('Process Create','Process Start','Process Exit') -and
        ($everOwned -or ($owner.childPid -and $ownership.everOwned.Contains([string]$owner.childPid)))) {
        if ($contextEvents.Count -lt 512) { $contextEvents.Add((New-TraceContextEvent $_ $sequence $owner)) } else { $contextTruncated = $true }
    }
    if ($owner.owned -or $everOwned) {
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
            if ($owner.owned) { $findings.Add([pscustomobject]@{process=$_.'Process Name';pid=$_.PID;operation=$_.Operation;path=$_.Path;category=$category}) }
            if ($category -eq 'needs-review') {
                [void]$contextPids.Add([string]$_.PID)
                $writeKey = ([string]$_.PID) + '|' + $owner.generation + '|' + $_.Operation + '|' + $_.Path
                if ($contextWrites.Add($writeKey)) {
                    if ($contextEvents.Count -lt 512) { $contextEvents.Add((New-TraceContextEvent $_ $sequence $owner)) } else { $contextTruncated = $true }
                }
            }
        }
    }
}
$findings | Sort-Object process,operation,path -Unique | ConvertTo-Json -Depth 4 | Set-Content "$Evidence/outside-writes.json"
$relevantContext = @($contextEvents | Where-Object { $contextPids.Contains([string]$_.pid) -or ($_.childPid -and $contextPids.Contains([string]$_.childPid)) })
@{ schemaVersion=1; sourceCsv=$csv; sourcePml=$pml; maxEvents=512; truncated=($contextTruncated -or @($relevantContext | Where-Object fieldTruncated).Count -gt 0); events=$relevantContext } | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 "$Evidence/write-trace-context.json"
@{ captured=$true; ownedProcesses=$ownership.everOwned.Count; ownedProcessesStillActive=@($ownership.active.Values | Where-Object owned).Count; outsideWriteEvents=$findings.Count; unclassifiedEvents=@($findings|Where-Object category -eq 'needs-review').Count; contextTruncated=$contextTruncated } | ConvertTo-Json | Set-Content "$Evidence/write-trace-summary.json"
if ($ownership.everOwned.Count -eq 0) { throw 'Procmon captured no official processes' }
