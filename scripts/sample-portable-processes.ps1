param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$productRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$hostExe = Join-Path $productRoot 'DeepSeek-Herness.exe'
$processes = @(Get-CimInstance Win32_Process)
$owned = [Collections.Generic.HashSet[int]]::new()
foreach ($process in $processes) {
  if ($process.ExecutablePath -eq $hostExe -or
      ($process.Name -eq 'node.exe' -and $process.CommandLine -like '*portable-host.mjs*' -and
       $process.CommandLine.IndexOf($productRoot + '\', [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
    [void]$owned.Add([int]$process.ProcessId)
  }
}
do {
  $previousCount = $owned.Count
  foreach ($process in $processes) {
    if ($owned.Contains([int]$process.ParentProcessId)) { [void]$owned.Add([int]$process.ProcessId) }
  }
} while ($owned.Count -gt $previousCount)
$rows = @()
foreach ($idValue in $owned) {
  $item = Get-Process -Id $idValue -ErrorAction SilentlyContinue
  if ($null -ne $item) {
    $rows += [pscustomobject]@{
      pid = $item.Id; name = $item.ProcessName
      privateBytes = $item.PrivateMemorySize64; workingSetBytes = $item.WorkingSet64
      handles = $item.HandleCount; cpuSeconds = $item.CPU
      startedAt = $item.StartTime.ToUniversalTime().ToString('o')
    }
  }
}
[pscustomobject]@{ timestamp = [DateTime]::UtcNow.ToString('o'); processes = $rows } | ConvertTo-Json -Depth 4 -Compress
