using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed class AppshotFixture : Form
{
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { var p = base.CreateParams; p.ExStyle |= 0x08000000; return p; }
    }
    [STAThread] public static void Main(string[] args) {
        Application.EnableVisualStyles();
        using (var window = new AppshotFixture()) {
            window.Text = "Portable Appshot acceptance";
            window.StartPosition = FormStartPosition.Manual;
            window.Bounds = new Rectangle(100, 120, 760, 520);
            window.BackColor = Color.FromArgb(24, 24, 24);
            window.ShowInTaskbar = false;
            var heading = new Label { Text = "Appshot / native window", ForeColor = Color.White, Font = new Font("Segoe UI", 22), Bounds = new Rectangle(28, 24, 680, 50) };
            var text = new TextBox { Multiline = true, ScrollBars = ScrollBars.Vertical, Bounds = new Rectangle(28, 95, 680, 260), AccessibleName = "Acceptance text" };
            text.Text = "Visible acceptance text\r\n" + string.Join("\r\n", System.Linq.Enumerable.Repeat("Ordinary application content", 35)) + "\r\nOFFSCREEN_TEXT_SENTINEL";
            var password = new TextBox { UseSystemPasswordChar = true, Text = "PASSWORD_MUST_NOT_APPEAR", Bounds = new Rectangle(28, 380, 320, 32) };
            window.Controls.AddRange(new Control[] { heading, text, password });
            var ready = new Timer { Interval = 750 };
            ready.Tick += delegate { ready.Stop(); window.Refresh(); File.WriteAllText(args[0], "{\"window\":\"" + window.Handle.ToInt64() + "\",\"pid\":" + Process.GetCurrentProcess().Id + "}"); };
            window.Shown += delegate { SetWindowPos(window.Handle, new IntPtr(1), 0, 0, 0, 0, 0x0013); ready.Start(); };
            var deadline = new Timer { Interval = 60000 }; deadline.Tick += delegate { window.Close(); }; deadline.Start();
            Application.Run(window); ready.Dispose(); deadline.Dispose();
        }
    }
}
