param(
    [Parameter(Mandatory = $true)][string]$PackageRoot,
    [ValidateSet('cold', 'warm')][string]$Kind = 'cold',
    [ValidateSet('normal', 'slow', 'both')][string]$Profile = 'both',
    [int]$Runs = 3,
    # Share of ALL logical CPUs the whole process tree may use in the slow profile. 60 / cores is about 0.6 of one
    # modern core, roughly a low-power 2-core laptop CPU. Antivirus scanning stays whatever this PC has; disk speed is
    # not throttled, so very slow disks are not modelled.
    [double]$SlowCoreEquivalent = 0.6
)
# Emulates a slow PC for the CLI start path with a Windows job-object hard CPU cap and prints per-phase times from
# data/logs/startup-latest.jsonl. Use a scratch copy of a package: it deletes data/ (cold) and the runtime cache.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public static class CpuJob {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, int l);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] struct CPU_RATE { public uint ControlFlags; public uint CpuRate; }
  public static IntPtr Create(uint percentOfAllCpus) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    CPU_RATE info = new CPU_RATE(); info.ControlFlags = 0x1 | 0x4; info.CpuRate = percentOfAllCpus * 100;
    IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(info)); Marshal.StructureToPtr(info, p, false);
    if (!SetInformationJobObject(job, 15, p, Marshal.SizeOf(info))) throw new Exception("SetInformationJobObject " + Marshal.GetLastWin32Error());
    return job;
  }
  public static void Assign(IntPtr job, Process proc) { if (!AssignProcessToJobObject(job, proc.Handle)) throw new Exception("Assign " + Marshal.GetLastWin32Error()); }
}
'@

$root = (Resolve-Path -LiteralPath $PackageRoot).Path
$node = Join-Path $root 'runtime\node\node.exe'
$scratchCache = Join-Path ([IO.Path]::GetTempPath()) ('dsh-startup-slow-' + [guid]::NewGuid().ToString('N'))
$env:DSH_PORTABLE_RUNTIME_CACHE = $scratchCache
$env:UV_THREADPOOL_SIZE = '16' # what the native host sets for the preparation process

function Stop-PackageProcesses {
    Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

function Invoke-Start([string]$Mode) {
    Stop-PackageProcesses
    if ($Kind -eq 'cold') {
        Remove-Item -LiteralPath (Join-Path $root 'data') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $scratchCache -Recurse -Force -ErrorAction SilentlyContinue
    }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $node -PassThru -WindowStyle Hidden `
        -ArgumentList ('"' + (Join-Path $root 'launcher\runtime-entry.mjs') + '"'), 'portable-cli.mjs', 'start', '--no-browser', '--json'
    if ($Mode -eq 'slow') {
        $percent = [uint32][math]::Max(1, [math]::Round(100.0 * $SlowCoreEquivalent / [Environment]::ProcessorCount))
        [CpuJob]::Assign([CpuJob]::Create($percent), $process)
    }
    if (-not $process.WaitForExit(600000)) { $process.Kill() }
    $total = $watch.ElapsedMilliseconds
    $events = Get-Content (Join-Path $root 'data\logs\startup-latest.jsonl') -ErrorAction SilentlyContinue | ForEach-Object { $_ | ConvertFrom-Json }
    $at = { param($name) ($events | Where-Object { $_.phase -eq $name } | Select-Object -First 1).elapsedMs }
    Stop-PackageProcesses
    [pscustomobject]@{
        Mode = $Mode; Kind = $Kind; TotalMs = $total
        CapsuleReady = & $at 'runtime-capsule-ready'; ProfileResolver = & $at 'profile-resolver-ready'
        PluginsReady = & $at 'default-plugins-ready'; CoreImported = & $at 'official-dsh-import-complete'; HostReady = & $at 'host-ready'
    }
}

$modes = if ($Profile -eq 'both') { @('normal', 'slow') } else { @($Profile) }
if ($Kind -eq 'warm') { Invoke-Start 'normal' | Out-Null } # build the runtime cache and the learned module pack once
$rows = foreach ($i in 1..$Runs) { foreach ($mode in $modes) { Invoke-Start $mode } }
$rows | Format-Table -AutoSize
foreach ($mode in $modes) {
    $values = @($rows | Where-Object Mode -eq $mode | ForEach-Object TotalMs | Sort-Object)
    '{0,-6} median total {1} ms' -f $mode, $values[[int][math]::Floor($values.Count / 2)]
}
Remove-Item -LiteralPath $scratchCache -Recurse -Force -ErrorAction SilentlyContinue
