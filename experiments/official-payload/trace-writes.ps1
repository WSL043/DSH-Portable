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
    $result = @{ owned=[bool]$current.owned; generation=$current.generation; parentPid=$current.parentPid; imagePath=$current.path; childPid=$childId; childGeneration=if ($childId) { $State.active[$childId].generation } else { $null } }
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

function Write-TraceProgress([string]$Stage, [string]$State, [long]$ElapsedMs, [long]$Rows = 0) {
    $pmlBytes = if (Test-Path -LiteralPath $pml -PathType Leaf) { (Get-Item -LiteralPath $pml).Length } else { 0 }
    $csvBytes = if (Test-Path -LiteralPath $csv -PathType Leaf) { (Get-Item -LiteralPath $csv).Length } else { 0 }
    Write-Host ('[write-trace] stage={0} state={1} utc={2:o} elapsedMs={3} rows={4} pmlBytes={5} csvBytes={6}' -f $Stage, $State, [DateTime]::UtcNow, $ElapsedMs, $Rows, $pmlBytes, $csvBytes)
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
$csv = Join-Path $tools 'writes.csv'
$stageWatch = [Diagnostics.Stopwatch]::StartNew()
Write-TraceProgress 'Terminate' 'started' 0
Start-Process -FilePath $exe -ArgumentList '/Terminate' -WindowStyle Hidden -Wait | Out-Null
Write-TraceProgress 'Terminate' 'completed' $stageWatch.ElapsedMilliseconds
$stageWatch.Restart()
Write-TraceProgress 'Export' 'started' 0
Start-Process -FilePath $exe -ArgumentList @('/Quiet','/OpenLog',"`"$pml`"",'/SaveAs',"`"$csv`"") -WindowStyle Hidden -Wait | Out-Null
Write-TraceProgress 'Export' 'completed' $stageWatch.ElapsedMilliseconds
if (-not (Test-Path $csv)) { throw 'Procmon export missing' }
$parseWatch = [Diagnostics.Stopwatch]::StartNew()
Write-TraceProgress 'Parse' 'started' 0
$ownership = @{ active=@{}; everOwned=(New-Object 'System.Collections.Generic.HashSet[string]'); generation=0 }
$contextEvents = New-Object 'System.Collections.Generic.List[object]'
$contextPids = New-Object 'System.Collections.Generic.HashSet[string]'
$contextWrites = New-Object 'System.Collections.Generic.HashSet[string]'
$contextTruncated = $false
$sequence = 0
$findings = New-Object 'System.Collections.Generic.List[object]'
$findingKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$outsideWriteEvents = [long]0
$unclassifiedEvents = [long]0
$operations = @('WriteFile','SetEndOfFileInformationFile','SetRenameInformationFile','SetDispositionInformationFile','RegSetValue','RegDeleteValue','RegDeleteKey','RegCreateKey')
$root = [IO.Path]::GetFullPath($PortableRoot).TrimEnd('\') + '\'
$systemPowerShell = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$extractorPath = Join-Path $PortableRoot 'launcher\7z.exe'
$directoryMetadataPath = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($PortableRoot)).TrimEnd('\') + '\$Directory'
$tempRoot = $env:TEMP.TrimEnd('\')+'\'
$localTempRoot = (Join-Path $env:LOCALAPPDATA 'Temp')+'\'
$shaderRoot = (Join-Path $env:LOCALAPPDATA 'D3DSCache')+'\'
$documentsRoot = [Environment]::GetFolderPath('MyDocuments')
$externalWorkspaceRoot = if ($documentsRoot) { Join-Path $documentsRoot 'deepseek-harness' } else { $null }
Import-Csv -LiteralPath $csv | ForEach-Object {
    $sequence++
    if ($sequence % 100000 -eq 0) { Write-TraceProgress 'Parse' 'heartbeat' $parseWatch.ElapsedMilliseconds $sequence }
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
            if ($_.Path.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith('C:\Windows\Temp\',[StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith($localTempRoot,[StringComparison]::OrdinalIgnoreCase)) { $category='temporary' }
            if ($_.Path -match '^HKCU\\Software\\Classes\\dsh(\\|$)') { $category='known-protocol-registration' }
            if ($_.Path -match '^\\Device\\NamedPipe(\\|$)') { $category='ipc-not-a-disk-file' }
            if ($_.Path -match '^[A-Z]:$|^[A-Z]:\\\$(LogFile|Mft)$|^HKLM\\System\\CurrentControlSet\\Services\\bam\\') { $category='windows-system-record' }
            # Reviewed in run 40577937354: the root extractor's directory-index paging I/O.
            # The $Directory FILE_OBJECT is parsed as INDX pages by the original researcher:
            # https://github.com/ufrisk/MemProcFS/blob/b3dee6a22f935e56cd54bc207ec0a0552e5d6bf3/vmm/modules/m_fc_ntfs.c#L634-L651
            if ($owner.owned -and $_.'Process Name' -eq '7z.exe' -and $_.Operation -eq 'WriteFile' -and
                [string]::Equals([string]$owner.imagePath, $extractorPath, [StringComparison]::OrdinalIgnoreCase) -and
                [string]::Equals([string]$_.Path, $directoryMetadataPath, [StringComparison]::OrdinalIgnoreCase) -and
                $_.Detail -match '(?:^|,\s*)Paging I/O(?:,|$)') { $category='reviewed-extractor-directory-paging' }
            # Reviewed in alpha3 run 36404975086: paired .NET process registration
            # writes/deletes, not portable account, profile or application data.
            if ($_.'Process Name' -in @('DeepSeek Harness Portable.exe','powershell.exe') -and $_.Operation -in @('RegSetValue','RegDeleteValue') -and $_.Path -match '^HKLM\\System\\CurrentControlSet\\Services\\ASP\.NET_4\.0\.30319\\Names\\[A-Za-z0-9]+$') { $category='reviewed-dotnet-system-registration' }
            # Reviewed in hosted run 40568630750: this exact system PowerShell
            # REG_BINARY state is WNF_WIL_FEATURE_DEVICE_USAGE_TRACKING_1.
            # https://github.com/ionescu007/wnfun/blob/5e7ae991ee8a9557c63c841d67b57cd1e36c617d/script_python/WellKnownWnfNames.py#L1008
            if ($owner.owned -and $_.'Process Name' -eq 'powershell.exe' -and $_.Operation -eq 'RegSetValue' -and
                [string]::Equals([string]$owner.imagePath, $systemPowerShell, [StringComparison]::OrdinalIgnoreCase) -and
                [string]::Equals([string]$_.Path, 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Notifications\Data\418A073AA3BC1C75', [StringComparison]::OrdinalIgnoreCase) -and
                $_.Detail -match '^Type: REG_BINARY(?:,|$)') { $category='reviewed-windows-feature-usage' }
            if ($_.Path -match '\\Microsoft\\Spelling\\|^HKCU\\Software\\Microsoft\\Spelling') { $category='windows-shared-spelling' }
            # Reviewed in native run 36409052501: DirectX shader cache files,
            # https://microsoft.github.io/DirectX-Specs/d3d/ShaderCache.html
            # Retain them in evidence; do not classify other LocalAppData writes here.
            if ($_.'Process Name' -eq 'DeepSeek Harness.exe' -and $_.Path.StartsWith($shaderRoot,[StringComparison]::OrdinalIgnoreCase) -and $_.Path.Substring($shaderRoot.Length) -match '^[a-f0-9]+(?:\\[a-f0-9-]+\.dxcache(?:-journal|-shm|-wal)?)?$') { $category='windows-directx-shader-cache' }
            if ($_.Path -match '\\Microsoft\\Windows\\PowerShell\\StartupProfileData-NonInteractive$') { $category='windows-powershell-startup-cache' }
            if ($externalWorkspaceRoot -and $_.Path.StartsWith($externalWorkspaceRoot,[StringComparison]::OrdinalIgnoreCase)) { $category='official-external-workspace' }
            if ($owner.owned) {
                $outsideWriteEvents++
                if ($category -eq 'needs-review') { $unclassifiedEvents++ }
                $findingKey = ([string]$_.'Process Name') + [char]0 + ([string]$_.Operation) + [char]0 + ([string]$_.Path) + [char]0 + $category
                if ($findingKeys.Add($findingKey)) {
                    $findings.Add([pscustomobject]@{process=$_.'Process Name';pid=$_.PID;operation=$_.Operation;path=$_.Path;category=$category})
                }
            }
            if ($category -in @('needs-review','reviewed-windows-feature-usage','reviewed-extractor-directory-paging')) {
                [void]$contextPids.Add([string]$_.PID)
                $writeKey = ([string]$_.PID) + '|' + $owner.generation + '|' + $_.Operation + '|' + $_.Path
                if ($contextWrites.Add($writeKey)) {
                    if ($contextEvents.Count -lt 512) { $contextEvents.Add((New-TraceContextEvent $_ $sequence $owner)) } else { $contextTruncated = $true }
                }
            }
        }
    }
}
$findings | Sort-Object process,operation,path,category -Unique | ConvertTo-Json -Depth 4 | Set-Content "$Evidence/outside-writes.json"
$relevantContext = @($contextEvents | Where-Object { $contextPids.Contains([string]$_.pid) -or ($_.childPid -and $contextPids.Contains([string]$_.childPid)) })
@{ schemaVersion=1; sourceCsv=$csv; sourcePml=$pml; maxEvents=512; truncated=($contextTruncated -or @($relevantContext | Where-Object fieldTruncated).Count -gt 0); events=$relevantContext } | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 "$Evidence/write-trace-context.json"
@{ captured=$true; ownedProcesses=$ownership.everOwned.Count; ownedProcessesStillActive=@($ownership.active.Values | Where-Object owned).Count; outsideWriteEvents=$outsideWriteEvents; unclassifiedEvents=$unclassifiedEvents; contextTruncated=$contextTruncated } | ConvertTo-Json | Set-Content "$Evidence/write-trace-summary.json"
Write-TraceProgress 'Parse' 'completed' $parseWatch.ElapsedMilliseconds $sequence
Write-Host ('[write-trace] outsideWriteEvents={0} unclassifiedEvents={1} storedFindings={2}' -f $outsideWriteEvents, $unclassifiedEvents, $findings.Count)
if ($ownership.everOwned.Count -eq 0) { throw 'Procmon captured no official processes' }
