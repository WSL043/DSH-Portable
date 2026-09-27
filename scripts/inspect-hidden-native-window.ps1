param([Parameter(Mandatory=$true)][int]$HostPid)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeWindowProbe {
  public delegate bool Callback(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$rows = [Collections.Generic.List[object]]::new()
$callback = [NativeWindowProbe+Callback] {
  param($window, $parameter)
  $owner = [uint32]0
  [void][NativeWindowProbe]::GetWindowThreadProcessId($window, [ref]$owner)
  if ($owner -eq $HostPid) {
    $rectangle = New-Object NativeWindowProbe+Rect
    [void][NativeWindowProbe]::GetWindowRect($window, [ref]$rectangle)
    if ($rectangle.Right - $rectangle.Left -ge 800) {
      $rows.Add([pscustomobject]@{
        noActivate = ([NativeWindowProbe]::GetWindowLong($window, -20) -band 0x08000000) -ne 0
        foreground = [NativeWindowProbe]::GetForegroundWindow() -eq $window
        left = $rectangle.Left; top = $rectangle.Top
      })
    }
  }
  return $true
}
[void][NativeWindowProbe]::EnumWindows($callback, [IntPtr]::Zero)
ConvertTo-Json -InputObject @($rows.ToArray()) -Compress
