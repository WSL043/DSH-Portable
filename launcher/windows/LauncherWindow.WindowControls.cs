using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace DshPortable
{
    internal sealed partial class LauncherWindow : Form
    {
        private bool pageWindowChrome;
        private bool nativeChromeForced;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();
        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        // The native bar stays attached: a new document or failed renderer can always restore it.
        private void SetPageWindowChrome(bool frameless)
        {
            if (!desktopStart || desktopMenu == null) return;
            pageWindowChrome = frameless && !nativeChromeForced;
            CloseDesktopMenus();
            desktopMenu.Visible = !pageWindowChrome && !fullscreen;
            FitWebViewToClient();
            PostWindowState();
        }

        private void ResetPageWindowChrome()
        {
            nativeChromeForced = false;
            SetPageWindowChrome(false);
        }

        private void RestoreNativeWindowBar()
        {
            nativeChromeForced = true;
            if (fullscreen) SetDesktopFullscreen(false);
            SetPageWindowChrome(false);
            RestoreFromTray();
        }

        private void PostWindowState()
        {
            if (!desktopStart || webView == null || webView.IsDisposed || webView.CoreWebView2 == null) return;
            try { webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {
                type = "dsh-portable/window-state", frameless = pageWindowChrome,
                maximized = WindowState == FormWindowState.Maximized,
                minimized = WindowState == FormWindowState.Minimized, fullscreen = fullscreen,
                menuVisible = desktopMenu != null && desktopMenu.Visible, nativeChromeForced = nativeChromeForced
            })); } catch (InvalidOperationException) { /* The renderer may be leaving this document. */ }
        }

        private void PerformWindowControl(string action)
        {
            if (!desktopStart || shutdownRunning) return;
            switch (action)
            {
                case "minimize": WindowState = FormWindowState.Minimized; break;
                case "maximize":
                    if (fullscreen) SetDesktopFullscreen(false);
                    WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                    break;
                case "fullscreen": SetDesktopFullscreen(!fullscreen); break;
                case "close": Close(); break;
                default: return;
            }
            PostWindowState();
        }

        private bool HandleWindowMessage(Dictionary<string, object> message)
        {
            object value;
            if (message == null || !message.TryGetValue("type", out value)) return false;
            string type = Convert.ToString(value);
            if (!desktopStart) return false;
            switch (type)
            {
                case "dsh-portable/window-chrome":
                    if (message.TryGetValue("frameless", out value) && value is bool) SetPageWindowChrome((bool)value);
                    break;
                case "dsh-portable/window-state": PostWindowState(); break;
                case "dsh-portable/window-control":
                    if (message.TryGetValue("action", out value)) PerformWindowControl(Convert.ToString(value));
                    break;
                case "dsh-portable/window-drag":
                    if (pageWindowChrome && !fullscreen && IsHandleCreated && !shutdownRunning)
                    {
                        ReleaseCapture();
                        SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
                    }
                    break;
                case "dsh-portable/window-menu":
                    if (!message.TryGetValue("menu", out value) || desktopMenu == null) break;
                    string group = Convert.ToString(value);
                    if (group != "file" && group != "view" && group != "help") break;
                    RefreshDesktopCommands();
                    ToolStripMenuItem menu = desktopMenu.Items["menu-" + group] as ToolStripMenuItem;
                    if (menu != null) { CloseDesktopMenus(); menu.DropDown.Show(Cursor.Position); }
                    break;
                case "dsh-portable/window-command":
                    if (!message.TryGetValue("id", out value) || desktopMenu == null) break;
                    string id = Convert.ToString(value);
                    if (String.IsNullOrEmpty(id) || id.Length > 64) break;
                    RefreshDesktopCommands();
                    ToolStripItem[] commands = desktopMenu.Items.Find(id, true);
                    if (commands.Length == 1 && commands[0].Enabled) commands[0].PerformClick();
                    break;
                default: return false;
            }
            return true;
        }
    }
}
