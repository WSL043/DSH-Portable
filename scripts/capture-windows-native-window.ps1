param(
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeWindowCapture {
    public delegate bool Visitor(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor visitor, IntPtr state);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    public static IntPtr Find(int process) {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr state) {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner != process || !IsWindowVisible(window)) return true;
            Rect rect; GetWindowRect(window, out rect);
            if (rect.Right - rect.Left < 400) return true;
            result = window; return false;
        }, IntPtr.Zero);
        return result;
    }
}
'@
$window = [NativeWindowCapture]::Find($TargetProcessId)
if ($window -eq [IntPtr]::Zero) { throw 'Native test window was not found' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
# WM_PRINT captures only the target HWND; it never activates or moves a window.
# Off-screen windows do not receive normal compositor paints, so request them.
for ($frame = 0; $frame -lt 12; $frame++) {
    $rect = New-Object NativeWindowCapture+Rect
    if (-not [NativeWindowCapture]::GetWindowRect($window, [ref]$rect)) { throw 'GetWindowRect failed' }
    $bitmap = New-Object Drawing.Bitmap ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $dc = $graphics.GetHdc()
    try {
        if (-not [NativeWindowCapture]::PrintWindow($window, $dc, 0)) { throw 'PrintWindow failed' }
    } finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
    try {
        if ($frame -eq 0 -or $frame -eq 11) {
            $bitmap.Save((Join-Path $OutputDirectory "native-$frame.png"))
        }
    } finally { $bitmap.Dispose() }
    Start-Sleep -Milliseconds 100
}
