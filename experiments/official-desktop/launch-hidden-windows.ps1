param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][string]$Arguments,
  [int]$Milliseconds = 30000
)

# Keep native Desktop probes on a private Windows desktop and in disposable data roots.
# The original signed installer is never launched by this helper.
$rootValue = $env:DSH_PORTABLE_DEVELOPMENT_ROOT
if (-not $rootValue -or $rootValue -notmatch '^[A-Za-z]:[\\/]') { throw 'An absolute, fixed-drive DSH_PORTABLE_DEVELOPMENT_ROOT is required' }
$root = [IO.Path]::GetFullPath($rootValue)
if ($root -eq [IO.Path]::GetPathRoot($root)) { throw 'The probe root cannot be a drive root' }
foreach ($name in @('APPDATA', 'LOCALAPPDATA')) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if (-not $value -or $value -notmatch '^[A-Za-z]:[\\/]') { throw "$name must be on an absolute, fixed drive" }
  $path = [IO.Path]::GetFullPath($value)
  if (-not $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "$name must stay inside the probe root" }
}
if ($Exe -notmatch '^[A-Za-z]:[\\/]' -or -not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw 'The executable must be an existing absolute path on a fixed drive' }
if ($Milliseconds -lt 1000 -or $Milliseconds -gt 120000) { throw 'Milliseconds must be between 1000 and 120000' }

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class HiddenDesktopProcess {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public int dwProcessId, dwThreadId;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr devmode, int flags, uint access, IntPtr security);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes,
    bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFO startup, out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
'@

$desktopName = 'DSHPortableProbe-' + [guid]::NewGuid().ToString('N')
$desktop = [HiddenDesktopProcess]::CreateDesktop($desktopName, [IntPtr]::Zero, [IntPtr]::Zero, 0, 0x000F01FF, [IntPtr]::Zero)
if ($desktop -eq [IntPtr]::Zero) { throw "CreateDesktop failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$job = [HiddenDesktopProcess]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { [HiddenDesktopProcess]::CloseDesktop($desktop) | Out-Null; throw "CreateJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$si = New-Object HiddenDesktopProcess+STARTUPINFO
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][HiddenDesktopProcess+STARTUPINFO])
$si.lpDesktop = 'WinSta0\' + $desktopName
$pi = New-Object HiddenDesktopProcess+PROCESS_INFORMATION
$command = New-Object Text.StringBuilder ('"' + $Exe + '" ' + $Arguments)
try {
  # Start suspended so no child process can escape before job ownership is assigned.
  $started = [HiddenDesktopProcess]::CreateProcess($Exe, $command, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0x00000204, [IntPtr]::Zero, (Split-Path -Parent $Exe), [ref]$si, [ref]$pi)
  if (-not $started) { throw "CreateProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  if (-not [HiddenDesktopProcess]::AssignProcessToJobObject($job, $pi.hProcess)) { throw "AssignProcessToJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  if ([HiddenDesktopProcess]::ResumeThread($pi.hThread) -eq [uint32]::MaxValue) { throw "ResumeThread failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  Write-Output "hidden-desktop pid=$($pi.dwProcessId) name=$desktopName"
  $wait = [HiddenDesktopProcess]::WaitForSingleObject($pi.hProcess, [uint32]$Milliseconds)
  [uint32]$exitCode = 0
  [HiddenDesktopProcess]::GetExitCodeProcess($pi.hProcess, [ref]$exitCode) | Out-Null
  Write-Output "wait=$wait exit=$exitCode"
} finally {
  [HiddenDesktopProcess]::TerminateJobObject($job, 0) | Out-Null
  if ($pi.hThread -ne [IntPtr]::Zero) { [HiddenDesktopProcess]::CloseHandle($pi.hThread) | Out-Null }
  if ($pi.hProcess -ne [IntPtr]::Zero) { [HiddenDesktopProcess]::CloseHandle($pi.hProcess) | Out-Null }
  [HiddenDesktopProcess]::CloseHandle($job) | Out-Null
  [HiddenDesktopProcess]::CloseDesktop($desktop) | Out-Null
}
