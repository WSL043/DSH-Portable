using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class CtrlChord
{
    private bool left, right, armed, invalid;
    public bool Latch { get; private set; }
    public bool Released { get; private set; }
    public bool Update(int key, bool down) {
        Latch = Released = false;
        if (key != 0xA2 && key != 0xA3) { if (down && (left || right)) invalid = true; return false; }
        bool wasPressed = left || right;
        if (key == 0xA2) left = down; else right = down;
        if (left && right && !armed && !invalid) { armed = true; Latch = true; }
        if (!left && !right) { Released = wasPressed; bool fire = armed && !invalid; armed = invalid = false; return fire; }
        return false;
    }
}

internal static class AppshotHotkey
{
    private delegate IntPtr Keyboard(int code, IntPtr wparam, IntPtr lparam);
    private static Keyboard callback = Hook;
    private static IntPtr hook, target;
    private static uint targetPid;
    private static CtrlChord chord = new CtrlChord();
    private static string root;
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Keyboard callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder title, int size);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    private static void Emit(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); Console.Out.Flush(); }
    private static IntPtr Hook(int code, IntPtr wparam, IntPtr lparam) {
        if (code >= 0) {
            int msg = wparam.ToInt32(), key = Marshal.ReadInt32(lparam);
            int flags = Marshal.ReadInt32(lparam, 8);
            // Ignore injected keys and retain normal Ctrl shortcuts. Nothing is swallowed.
            if ((flags & 0x10) == 0 && (msg == 0x100 || msg == 0x101 || msg == 0x104 || msg == 0x105)) {
                bool fire = chord.Update(key, msg == 0x100 || msg == 0x104);
                if (chord.Latch) {
                    target = GetForegroundWindow(); GetWindowThreadProcessId(target, out targetPid);
                    if ((GetAsyncKeyState(0x12) & 0x8000) != 0 || (GetAsyncKeyState(0x10) & 0x8000) != 0 || (GetAsyncKeyState(0x5B) & 0x8000) != 0 || (GetAsyncKeyState(0x5C) & 0x8000) != 0) target = IntPtr.Zero;
                    if (target != IntPtr.Zero) {
                        var title = new StringBuilder(512); GetWindowText(target, title, title.Capacity);
                        Emit(new { type = "target", window = target.ToInt64().ToString(), pid = targetPid, title = title.ToString() });
                    }
                }
                if (chord.Released && target != IntPtr.Zero) {
                    Emit(new { type = fire ? "released" : "cancel" });
                    target = IntPtr.Zero;
                }
            }
        }
        return CallNextHookEx(hook, code, wparam, lparam);
    }
    private static void FocusPortable() {
        foreach (var process in Process.GetProcessesByName("DeepSeek-Herness")) {
            using (process) try {
                if (!String.Equals(Path.GetDirectoryName(process.MainModule.FileName), root, StringComparison.OrdinalIgnoreCase)) continue;
                IntPtr window = process.MainWindowHandle;
                if (window != IntPtr.Zero) { if (IsIconic(window)) ShowWindow(window, 9); SetForegroundWindow(window); }
            } catch { }
        }
    }
    [STAThread] public static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--test") {
            var c = new CtrlChord();
            if (c.Update(0xA2,true) || c.Latch || c.Update(0xA3,true) || !c.Latch || c.Update(0xA3,true) || c.Latch || c.Update(0xA2,false) || !c.Update(0xA3,false) || c.Update(0xA3,false)) return 1;
            c.Update(0xA2,true); c.Update(0x43,true); c.Update(0xA3,true); c.Update(0xA2,false); if(c.Update(0xA3,false)) return 2;
            c.Update(0xA3,true); c.Update(0xA2,true); c.Update(0xA3,false); if(!c.Update(0xA2,false)) return 3;
            Emit(new { passed = true, repeat = false, ordinaryCtrlShortcutPreserved = true }); return 0;
        }
        if (args.Length != 2) return 2;
        root = Path.GetFullPath(args[1]);
        var owner = Process.GetProcessById(Int32.Parse(args[0]));
        hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Emit(new { type="error", error="Keyboard hook unavailable" }); return 1; }
        var timer = new Timer { Interval = 2000 };
        timer.Tick += delegate { if (owner.HasExited) Application.ExitThread(); };
        var ui = new Control(); ui.CreateControl();
        // Focus only after the parent has received the screenshot, never before capture.
        System.Threading.Tasks.Task.Run(() => {
            string line; while ((line = Console.ReadLine()) != null) if (line == "focus") try { ui.BeginInvoke((Action)FocusPortable); } catch { }
            try { ui.BeginInvoke((Action)Application.ExitThread); } catch { }
        });
        Emit(new { type="ready", shortcut="Ctrl+Ctrl" }); timer.Start();
        try { Application.Run(); } finally { UnhookWindowsHookEx(hook); timer.Dispose(); ui.Dispose(); owner.Dispose(); }
        return 0;
    }
}
