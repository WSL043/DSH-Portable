param(
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [Parameter(Mandatory = $true)][ValidateSet(27, 122)][int]$KeyCode
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WebViewKeyProbe {
    private delegate bool Visitor(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor visitor, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, Visitor visitor, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code, uint kind);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr key, IntPtr data);
    public static bool Send(int process, int key) {
        IntPtr target = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr state) {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner != process) return true;
            EnumChildWindows(window, delegate(IntPtr child, IntPtr unused) {
                GetWindowThreadProcessId(child, out owner);
                StringBuilder name = new StringBuilder(128);
                GetClassName(child, name, name.Capacity);
                if (owner != process || name.ToString() != "Chrome_WidgetWin_0") return true;
                target = child; return false;
            }, IntPtr.Zero);
            return target == IntPtr.Zero;
        }, IntPtr.Zero);
        if (target == IntPtr.Zero) return false;
        long down = 1L | ((long)MapVirtualKey((uint)key, 0) << 16);
        return PostMessage(target, 0x100, new IntPtr(key), new IntPtr(down))
            && PostMessage(target, 0x101, new IntPtr(key), new IntPtr(down | 0xC0000000L));
    }
}
'@
# Targeted HWND messages only: no foreground activation or global input state.
if (-not [WebViewKeyProbe]::Send($TargetProcessId, $KeyCode)) { throw 'WebView key delivery failed' }
