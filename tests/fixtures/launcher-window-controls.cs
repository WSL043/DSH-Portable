using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

internal static class WindowControlsFixture
{
    private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }

    [STAThread]
    private static void Main(string[] args)
    {
        try { Run(args); }
        catch (Exception error)
        {
            for (Exception failure = error; failure != null; failure = failure.InnerException)
                Console.Error.WriteLine(failure.GetType().FullName + ": " + failure.Message);
            Environment.ExitCode = 1;
        }
    }

    private static void Run(string[] args)
    {
        Environment.SetEnvironmentVariable("DSH_PORTABLE_TEST_HIDDEN", "1");
        Environment.SetEnvironmentVariable("DSH_PORTABLE_BASE_STATE_ROOT", args[1]);
        Environment.SetEnvironmentVariable("DSH_PORTABLE_STATE_ROOT", args[1]);
        Environment.SetEnvironmentVariable("DSH_PORTABLE_ROOT", args[1]);
        Type type = Assembly.LoadFrom(args[0]).GetType("DshPortable.LauncherWindow", true);
        // --json avoids notification registration, desktop PID ownership and host startup.
        using (Form form = (Form)Activator.CreateInstance(type, Private, null,
            new object[] { new[] { "--json" }, "default", args[1], 0, 0, 0 }, null))
        {
            // Exercise the compiled real form/layout without running its Shown backend handler.
            FieldInfo shown = typeof(Form).GetFields(BindingFlags.Static | BindingFlags.NonPublic)
                .Single(field => field.Name.IndexOf("shown", StringComparison.OrdinalIgnoreCase) >= 0);
            EventHandlerList events = (EventHandlerList)typeof(Component).GetProperty("Events", Private).GetValue(form, null);
            object key = shown.GetValue(null);
            events.RemoveHandler(key, events[key]);
            type.GetField("desktopStart", Private).SetValue(form, true);
            Action<string, object[]> invoke = (name, values) => type.GetMethod(name, Private).Invoke(form, values);
            Action<string, object> message = (name, value) => invoke("HandleWindowMessage", new object[] {
                new Dictionary<string, object> { { "type", "dsh-portable/window-" + name },
                    { name == "chrome" ? "frameless" : name == "command" ? "id" : "action", value } }
            });
            invoke("InitializeDesktopMenu", new object[0]);
            form.Show();
            Application.DoEvents();
            ToolStrip bar = (ToolStrip)type.GetField("desktopMenu", Private).GetValue(form);
            Control content = (Control)type.GetField("desktopContent", Private).GetValue(form);
            ToolStripMenuItem help = (ToolStripMenuItem)bar.Items["menu-help"];
            Check(help.DropDownItems["product-file-update"] != null && help.DropDownItems["engine-file-update"] != null,
                "offline entry remains in the native shell when switching to a core with an older page bridge");
            Check(bar.Parent == form && bar.Visible && content.Top >= bar.Bottom, "default native layout");
            message("chrome", true);
            Check(bar.Parent == form && !bar.Visible && content.Top == 0, "page handshake releases title height");
            message("chrome", "true");
            Check(!bar.Visible, "malformed handshake ignored");
            message("control", "fullscreen");
            message("control", "fullscreen");
            Check(!bar.Visible, "fullscreen exit keeps active page chrome");
            message("control", "maximize");
            Check(form.WindowState == FormWindowState.Maximized, "maximize action");
            message("command", "maximize");
            Check(form.WindowState == FormWindowState.Normal, "existing native menu command reused");
            message("control", "fullscreen");
            message("command", "maximize");
            Check(!(bool)type.GetField("fullscreen", Private).GetValue(form)
                && form.WindowState == FormWindowState.Maximized, "menu maximize exits fullscreen like window control");
            bar.Items["caption-maximize"].PerformClick();
            Check(form.WindowState == FormWindowState.Normal, "caption shares maximize behavior");
            message("control", "minimize");
            Check(form.WindowState == FormWindowState.Minimized, "minimize action");
            form.WindowState = FormWindowState.Normal;
            message("control", "arbitrary-command");
            Check(form.WindowState == FormWindowState.Normal, "unknown action is inert");
            message("chrome", false);
            Check(bar.Visible && content.Top >= bar.Bottom, "plugin unload restores native layout");
            message("chrome", true);
            message("control", "maximize");
            // Use the real recovery guards and a stale saved state so this detects
            // an accidental RestoreFromTray call on an already visible window.
            type.GetField("desktopReady", Private).SetValue(form, true);
            type.GetField("hiddenForAutomation", Private).SetValue(form, false);
            type.GetField("windowStateBeforeHide", Private).SetValue(form, FormWindowState.Normal);
            invoke("RestoreNativeWindowBar", new object[0]);
            Check(form.WindowState == FormWindowState.Maximized, "visible window keeps maximized state during native recovery");
            type.GetField("desktopReady", Private).SetValue(form, false);
            type.GetField("hiddenForAutomation", Private).SetValue(form, true);
            message("chrome", true);
            Check(bar.Visible, "manual native recovery cannot immediately be hidden again");
            invoke("ResetPageWindowChrome", new object[0]);
            message("chrome", true);
            Check(!bar.Visible, "new document permits fresh handshake");
            invoke("ResetPageWindowChrome", new object[0]);
            Check(bar.Visible, "document reset restores native layout");
            int closeRequests = 0;
            type.GetField("operationRunning", Private).SetValue(form, false);
            form.FormClosing += delegate(object sender, FormClosingEventArgs e) { closeRequests++; e.Cancel = true; };
            message("control", "close");
            Check(closeRequests == 1 && !form.IsDisposed, "close uses normal cancellable form close");
            ((NotifyIcon)type.GetField("trayIcon", Private).GetValue(form)).Dispose();
            Console.WriteLine("window-controls-composite-ok");
        }
    }
}
