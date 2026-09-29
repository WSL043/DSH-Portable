using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Win32;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Toolkit.Uwp.Notifications;
using Windows.UI.Notifications;
namespace DshPortable
{
    internal sealed partial class LauncherWindow : Form
    {
        private enum DwmWindowCornerPreference { Default = 0, DoNotRound = 1, Round = 2, RoundSmall = 3 }
        private static string L(string chinese, string english)
        {
            return uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase) ? chinese : english;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool GetUserPreferredUILanguages(uint flags, out uint count, char[] buffer, ref uint size);

        // Default language before the user chooses one in Settings: the first language the user
        // preferred in Windows (a Chinese language pack on an English install is common), then the
        // process UI culture, then the install language. A saved Settings choice still wins later.
        private static string ResolveInitialUiLanguage()
        {
            try
            {
                const uint MuiLanguageName = 0x8;
                uint count = 0, size = 0;
                if (GetUserPreferredUILanguages(MuiLanguageName, out count, null, ref size) && size > 1)
                {
                    char[] buffer = new char[size];
                    if (GetUserPreferredUILanguages(MuiLanguageName, out count, buffer, ref size))
                    {
                        string first = new string(buffer).Split('\0')[0];
                        if (first.Length >= 2) return new CultureInfo(first).TwoLetterISOLanguageName;
                    }
                }
            }
            catch (Exception) { }
            string current = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
            return String.IsNullOrEmpty(current) ? CultureInfo.InstalledUICulture.TwoLetterISOLanguageName : current;
        }

        private static string UiLanguageTag
        {
            get { return L("zh-CN", "en-US"); }
        }

        protected override void OnFormClosing(FormClosingEventArgs eventArgs)
        {
            if (desktopReady) SaveDesktopWindowState();
            if (desktopReady && !allowClose && eventArgs.CloseReason != CloseReason.WindowsShutDown)
            {
                eventArgs.Cancel = true;
                if (closeBehavior == WindowCloseBehavior.Tray) HideToTray();
                else if (!shutdownRunning) BeginDesktopShutdown();
                return;
            }
            if (operationRunning && !allowClose && eventArgs.CloseReason == CloseReason.UserClosing)
            {
                eventArgs.Cancel = true;
                return;
            }
            base.OnFormClosing(eventArgs);
        }

        protected override bool ShowWithoutActivation
        {
            get { return hiddenForAutomation || base.ShowWithoutActivation; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                // Preserve native sizing/system-menu styles, without a second caption.
                if (desktopStart) parameters.Style &= ~0x00C00000; // WS_CAPTION
                if (hiddenForAutomation) parameters.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
                return parameters;
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (desktopStart && !fullscreen && message.Msg == 0x0085)
            {
                message.Result = IntPtr.Zero;
                return;
            }
            if (desktopStart && !fullscreen && message.Msg == 0x0086)
            {
                // Activate normally without repainting a classic non-client frame
                // over the client-drawn title row.
                message.LParam = new IntPtr(-1);
                base.WndProc(ref message);
                return;
            }
            if (desktopStart && !fullscreen && message.Msg == 0x0083 && message.WParam != IntPtr.Zero)
            {
                // Keep native sizing styles but render through the invisible
                // resize frame; otherwise its inset separates controls from DWM corners.
                int[] bounds = new int[4];
                Marshal.Copy(message.LParam, bounds, 0, bounds.Length);
                base.WndProc(ref message);
                if (IsZoomed(Handle))
                {
                    // The maximized outer rectangle includes invisible resize borders.
                    // Keep our captionless client inside the target monitor work area.
                    Rectangle proposed = Rectangle.FromLTRB(bounds[0], bounds[1], bounds[2], bounds[3]);
                    Rectangle workArea = Screen.FromRectangle(proposed).WorkingArea;
                    int[] client = new int[] { workArea.Left, workArea.Top, workArea.Right, workArea.Bottom };
                    Marshal.Copy(client, 0, message.LParam, client.Length);
                    message.Result = IntPtr.Zero;
                }
                else if (WindowState == FormWindowState.Normal)
                {
                    Marshal.Copy(bounds, 0, message.LParam, bounds.Length);
                    message.Result = IntPtr.Zero;
                }
                return;
            }
            if (desktopStart && !fullscreen && desktopMenu != null && message.Msg == 0x0084)
            {
                long position = message.LParam.ToInt64();
                Point point = desktopMenu.PointToClient(new Point((short)position, (short)(position >> 16)));
                Point clientPoint = PointToClient(new Point((short)position, (short)(position >> 16)));
                if (WindowState == FormWindowState.Normal && ClientRectangle.Contains(clientPoint))
                {
                    int border = Math.Max(4, (int)Math.Ceiling(4 * DeviceDpi / 96.0));
                    bool left = clientPoint.X < border, right = clientPoint.X >= ClientSize.Width - border;
                    bool top = clientPoint.Y < border, bottom = clientPoint.Y >= ClientSize.Height - border;
                    int edge = top ? (left ? 13 : right ? 14 : 12)
                        : bottom ? (left ? 16 : right ? 17 : 15) : left ? 10 : right ? 11 : 0;
                    if (edge != 0) { message.Result = new IntPtr(edge); return; }
                }
                if (desktopMenu.ClientRectangle.Contains(point) && desktopMenu.GetItemAt(point) == null)
                {
                    message.Result = new IntPtr(2); // Native caption drag/double-click/system menu.
                    return;
                }
                base.WndProc(ref message);
                return;
            }
            if (message.Msg == exitMessage)
            {
                if (!shutdownRunning) BeginDesktopShutdown();
                return;
            }
            if (message.Msg == restoreMessage)
            {
                RestoreFromTray();
                return;
            }
            if (message.Msg == notificationActivationMessage)
            {
                NativeTaskNotification.DrainOwnerActivations();
                return;
            }
            base.WndProc(ref message);
        }

        private void InitializeDesktopMenu()
        {
            if (desktopMenu != null) { Controls.Remove(desktopMenu); desktopMenu.Dispose(); }
            desktopShortcuts.Clear();
            desktopMenuLanguage = uiLanguage;
            desktopMenu = new DesktopTitleStrip { Dock = DockStyle.Top, GripStyle = ToolStripGripStyle.Hidden,
                AutoSize = false, Height = 36, Padding = new Padding(4, 0, 0, 0), Visible = !fullscreen };
            desktopMenu.Font = ((DesktopTitleStrip)desktopMenu).MenuFont;
            MainMenuStrip = desktopMenu;
            Controls.Add(desktopMenu);
            desktopContent.BringToFront();
            ToolStripMenuItem file = new DesktopMenuItem(L("文件", "&File"));
            ToolStripMenuItem view = new DesktopMenuItem(L("视图", "&View"));
            ToolStripMenuItem help = new DesktopMenuItem(L("帮助", "&Help"));
            file.Name = "menu-file"; view.Name = "menu-view"; help.Name = "menu-help";
            desktopMenu.Items.AddRange(new ToolStripItem[] { file, view, help });
            foreach (ToolStripMenuItem menu in desktopMenu.Items)
            {
                menu.AutoSize = false;
                menu.Size = new Size(TextRenderer.MeasureText(menu.Text, desktopMenu.Font,
                    Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine).Width + 20, 28);
                menu.Margin = new Padding(0, 4, 2, 4);
                menu.Padding = new Padding(8, 0, 8, 0);
            }
            AddNavigationCommand(0, "nav-sidebar", "toggle-sidebar", L("折叠/展开侧栏", "Toggle sidebar"), Keys.Control | Keys.B);
            AddNavigationCommand(1, "nav-back", "navigate-back", L("后退", "Back"), Keys.Alt | Keys.Left);
            AddNavigationCommand(2, "nav-forward", "navigate-forward", L("前进", "Forward"), Keys.Alt | Keys.Right);
            desktopMenu.ShowItemToolTips = true;
            AddCaptionCommand("caption-close", "\uE8BB", L("关闭窗口", "Close window"), delegate { Close(); });
            AddCaptionCommand("caption-maximize", "\uE922", L("最大化或还原", "Maximize or restore"), delegate {
                WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
            });
            AddCaptionCommand("caption-minimize", "\uE921", L("最小化", "Minimize"), delegate { WindowState = FormWindowState.Minimized; });
            AddDesktopCommand(file, "new-session", L("新会话", "New session"), Keys.Control | Keys.N,
                delegate { PostBridgeAction("new-session", null); });
            AddDesktopCommand(file, "settings", L("设置", "Settings"), Keys.Control | Keys.Oemcomma,
                delegate { PostBridgeAction("open-settings", null); });
            file.DropDownItems.Add(CreateTerminalItem());
            file.DropDownItems.Add(new ToolStripSeparator());
            AddDesktopCommand(file, "close", L("关闭窗口", "Close window"), Keys.Control | Keys.W, delegate { Close(); });
            AddDesktopCommand(file, "exit", L("退出 DeepSeek Harness", "Exit DeepSeek Harness"), Keys.Control | Keys.Q,
                delegate { if (!shutdownRunning) BeginDesktopShutdown(); });
            AddDesktopCommand(view, "reload", L("重新加载界面", "Reload interface"), Keys.Control | Keys.R,
                delegate { ScheduleWebViewRecovery(false, "desktop-menu"); });
            view.DropDownItems.Add(new ToolStripSeparator());
            AddDesktopCommand(view, "zoom-in", L("放大", "Zoom in"), Keys.Control | Keys.Oemplus,
                delegate { SetDesktopZoom(webView.ZoomFactor + 0.1); });
            AddDesktopCommand(view, "zoom-out", L("缩小", "Zoom out"), Keys.Control | Keys.OemMinus,
                delegate { SetDesktopZoom(webView.ZoomFactor - 0.1); });
            AddDesktopCommand(view, "zoom-reset", L("实际大小", "Actual size"), Keys.Control | Keys.D0,
                delegate { SetDesktopZoom(1); });
            view.DropDownItems.Add(new ToolStripSeparator());
            AddDesktopCommand(view, "maximize", L("最大化或还原（保留任务栏）", "Maximize or restore (keep taskbar visible)"), Keys.None,
                delegate { WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; });
            AddDesktopCommand(view, "fullscreen", L("全屏（遮盖任务栏，Esc 退出）", "Full screen (cover taskbar, Esc to exit)"), Keys.F11,
                delegate { SetDesktopFullscreen(!fullscreen); });
            AddDesktopCommand(help, "product-update", L("检查 Portable 更新", "Check Portable updates"), Keys.None,
                async delegate { await CheckForDesktopUpdateAsync(true, "product"); });
            AddDesktopCommand(help, "engine-update", L("检查内核更新", "Check core updates"), Keys.None,
                async delegate { await CheckForDesktopUpdateAsync(true, "engine"); });
            AddDesktopCommand(help, "logs", L("打开日志文件夹", "Open logs folder"), Keys.None,
                delegate { string directory = ResolveLauncherLogDirectory(); Directory.CreateDirectory(directory);
                    Process.Start(new ProcessStartInfo(directory) { UseShellExecute = true }); });
            help.DropDownItems.Add(new ToolStripSeparator());
            help.DropDownItems.Add(CreateExternalLinkItem(L("喜欢的话，点个 Star", "If you like it, leave a Star"),
                "https://github.com/WSL043/DSH-Portable"));
            help.DropDownItems.Add(CreateReportProblemItem());
            help.DropDownItems.Add(CreateExternalLinkItem(L("提出建议", "Suggest an idea"),
                "https://github.com/WSL043/DSH-Portable/discussions/new"));
            foreach (ToolStripMenuItem menu in desktopMenu.Items) menu.DropDownOpening += delegate { RefreshDesktopCommands(); };
            foreach (ToolStripMenuItem menu in desktopMenu.Items) AttachDesktopDropDownHandlers(menu);
            RefreshDesktopCommands();
        }

        private void AttachDesktopDropDownHandlers(ToolStripMenuItem menu)
        {
            if (menu.DropDownItems.Count == 0) return;
            ToolStripDropDown previous = menu.DropDown;
            ToolStripItem[] items = previous.Items.Cast<ToolStripItem>().ToArray();
            previous.Items.Clear();
            menu.DropDown = new DesktopDropDown();
            menu.DropDown.Items.AddRange(items);
            previous.Dispose();
            ToolStripDropDown dropDown = menu.DropDown;
            dropDown.Opened += delegate { ApplyRoundedCorners(dropDown); };
            foreach (ToolStripMenuItem child in dropDown.Items.OfType<ToolStripMenuItem>())
                AttachDesktopDropDownHandlers(child);
        }

        private void AddCaptionCommand(string name, string glyph, string label, EventHandler action)
        {
            desktopMenu.Items.Add(new ToolStripMenuItem(glyph, null, action) {
                Name = name, Alignment = ToolStripItemAlignment.Right, AutoSize = false,
                Size = new Size(46, 36), Margin = Padding.Empty, Padding = Padding.Empty,
                Font = ((DesktopTitleStrip)desktopMenu).CaptionFont, AccessibleName = label, ToolTipText = label,
            });
        }

        private void AddNavigationCommand(int index, string name, string action, string label, Keys shortcut)
        {
            ToolStripMenuItem item = new ToolStripMenuItem(" ", null, delegate { PostBridgeAction(action, null); }) {
                Name = name, AutoSize = false, Size = new Size(32, 28), Margin = new Padding(0, 4, 0, 4),
                AccessibleName = label, ToolTipText = label + " (" + new KeysConverter().ConvertToString(shortcut) + ")",
            };
            desktopMenu.Items.Insert(index, item);
            desktopShortcuts.Add(shortcut, item);
        }

        protected override void OnSizeChanged(EventArgs eventArgs)
        {
            CloseDesktopMenus();
            base.OnSizeChanged(eventArgs);
            ApplyDesktopBorder();
            if (desktopContent != null) FitWebViewToClient();
            if (desktopMenu != null && desktopMenu.Items.ContainsKey("caption-maximize"))
                desktopMenu.Items["caption-maximize"].Text = WindowState == FormWindowState.Maximized ? "\uE923" : "\uE922";
        }

        private void CloseDesktopMenus()
        {
            if (desktopMenu == null || desktopMenu.IsDisposed) return;
            foreach (ToolStripMenuItem menu in desktopMenu.Items)
                if (menu.HasDropDownItems && menu.DropDown.Visible) menu.HideDropDown();
        }

        protected override void OnDeactivate(EventArgs eventArgs)
        {
            CloseDesktopMenus();
            base.OnDeactivate(eventArgs);
            ApplyDesktopBorder();
        }

        protected override void OnMouseDown(MouseEventArgs eventArgs)
        {
            CloseDesktopMenus();
            base.OnMouseDown(eventArgs);
        }

        private void AddDesktopCommand(ToolStripMenuItem parent, string id, string title, Keys shortcut, EventHandler action)
        {
            ToolStripMenuItem item = new ToolStripMenuItem(title, null, action) { Name = id, Tag = id };
            // One dispatcher owns both native and WebView accelerator input.
            if (shortcut != Keys.None)
            {
                item.ShortcutKeyDisplayString = shortcut == (Keys.Control | Keys.Oemcomma) ? "Ctrl+,"
                    : shortcut == (Keys.Control | Keys.Oemplus) ? "Ctrl++"
                    : shortcut == (Keys.Control | Keys.OemMinus) ? "Ctrl+-"
                    : new KeysConverter().ConvertToString(shortcut);
                desktopShortcuts.Add(shortcut, item);
            }
            parent.DropDownItems.Add(item);
        }

        private void RefreshDesktopCommands()
        {
            if (desktopMenu == null) return;
            bool navigationReady = desktopReady && trayBridgeReady && !shutdownRunning && !operationRunning;
            desktopMenu.Items["nav-sidebar"].Enabled = navigationReady;
            desktopMenu.Items["nav-back"].Enabled = navigationReady && trayState != null && trayState.canGoBack;
            desktopMenu.Items["nav-forward"].Enabled = navigationReady && trayState != null && trayState.canGoForward;
            foreach (ToolStripMenuItem menu in desktopMenu.Items)
                foreach (ToolStripItem item in menu.DropDownItems)
                {
                    string id = item.Tag as string;
                    if (id == null) continue;
                    item.Enabled = !shutdownRunning;
                    if (id == "new-session" || id == "settings") item.Enabled &= desktopReady && trayBridgeReady && !operationRunning;
                    if (id == "reload" || id.StartsWith("zoom-")) item.Enabled &= desktopReady && !operationRunning && !webViewRecoveryRunning;
                    if (id == "close") item.Enabled &= desktopReady;
                    if (id == "exit") item.Enabled &= desktopReady && !operationRunning;
                    if (id.EndsWith("-update")) item.Enabled &= desktopReady && !operationRunning && !updateCheckRunning && !updateInteractionRunning;
                    if (id == "maximize") ((ToolStripMenuItem)item).Checked = !fullscreen && WindowState == FormWindowState.Maximized;
                    if (id == "fullscreen") ((ToolStripMenuItem)item).Checked = fullscreen;
                }
        }

        private bool QueueDesktopShortcut(Keys key)
        {
            if (!desktopStart) return false;
            if (!fullscreen && (key == Keys.F10 || key == (Keys.Alt | Keys.F) || key == (Keys.Alt | Keys.V) || key == (Keys.Alt | Keys.H)))
            {
                string name = key == (Keys.Alt | Keys.V) ? "menu-view" : key == (Keys.Alt | Keys.H) ? "menu-help" : "menu-file";
                BeginInvoke(new Action(delegate {
                    if (fullscreen || IsDisposed) return;
                    RefreshDesktopCommands();
                    ((ToolStripMenuItem)desktopMenu.Items[name]).ShowDropDown();
                }));
                return true;
            }
            if (key == Keys.Escape)
            {
                if (desktopMenu.Items.OfType<ToolStripMenuItem>().Any(menu => menu.HasDropDownItems && menu.DropDown.Visible))
                {
                    CloseDesktopMenus();
                    return true;
                }
                if (!fullscreen) return false;
                BeginInvoke(new Action(delegate { SetDesktopFullscreen(false); }));
                return true;
            }
            if (key == Keys.F5) key = Keys.Control | Keys.R;
            if (key == (Keys.Control | Keys.Add) || key == (Keys.Control | Keys.Shift | Keys.Oemplus)) key = Keys.Control | Keys.Oemplus;
            if (key == (Keys.Control | Keys.Subtract)) key = Keys.Control | Keys.OemMinus;
            ToolStripMenuItem item;
            if (!desktopShortcuts.TryGetValue(key, out item)) return false;
            // WebView blocks its browser during KeyDown; defer all COM/UI actions.
            BeginInvoke(new Action(delegate { RefreshDesktopCommands(); if (item.Enabled) item.PerformClick(); }));
            return true;
        }

        protected override bool ProcessCmdKey(ref Message message, Keys keyData)
        {
            return QueueDesktopShortcut(keyData) || base.ProcessCmdKey(ref message, keyData);
        }

        private void SetDesktopZoom(double value)
        {
            if (webView == null || webView.CoreWebView2 == null) return;
            webView.ZoomFactor = Math.Max(0.5, Math.Min(2.0, Math.Round(value, 2)));
        }

        private void SetDesktopFullscreen(bool enabled)
        {
            if (!desktopStart || fullscreen == enabled) return;
            foreach (ToolStripMenuItem menu in desktopMenu.Items) menu.HideDropDown();
            SuspendLayout();
            if (enabled)
            {
                SaveDesktopWindowState();
                stateBeforeFullscreen = WindowState == FormWindowState.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
                boundsBeforeFullscreen = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                Rectangle screen = Screen.FromControl(this).Bounds;
                fullscreen = true;
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                desktopMenu.Visible = false;
                Bounds = hiddenForAutomation ? new Rectangle(Location, screen.Size) : screen;
            }
            else
            {
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.Sizable;
                desktopMenu.Visible = true;
                Bounds = boundsBeforeFullscreen;
                // Restore work-area sizing before re-entering the maximized state.
                fullscreen = false;
                WindowState = stateBeforeFullscreen;
                ApplyDesktopChrome();
            }
            ResumeLayout(true);
            FitWebViewToClient();
            RefreshDesktopCommands();
            WriteLauncherLog("desktop-window", "fullscreen=" + fullscreen);
        }

        private void LoadStartupTheme()
        {
            // Read the standard settings provider before creating any visible controls.
            // The bridge snapshot also covers custom settings providers and custom themes.
            try
            {
                string cached = Path.Combine(stateRoot, "data", "window-theme.json");
                if (File.Exists(cached))
                {
                    var value = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(File.ReadAllText(cached));
                    if (value.ContainsKey("preference")) themePreference = value["preference"];
                    if (value.ContainsKey("resolved") && value["resolved"] == "dark") trayTheme = "dark";
                }
                string settings = Path.Combine(stateRoot, "data", "dsh-home", "settings.yaml");
                if (File.Exists(settings) && new FileInfo(settings).Length <= 1024 * 1024)
                {
                    bool inTheme = false;
                    foreach (string line in File.ReadLines(settings))
                    {
                        if (String.IsNullOrWhiteSpace(line) || line.TrimStart().StartsWith("#")) continue;
                        if (!Char.IsWhiteSpace(line[0]))
                            inTheme = Regex.IsMatch(line, "^[\"']?ui-theme[\"']?\\s*:\\s*(?:#.*)?$");
                        else if (inTheme)
                        {
                            Match match = Regex.Match(line, "^\\s+preference\\s*:\\s*[\"']?(light|dark|system)[\"']?\\s*(?:#.*)?$");
                            if (match.Success) { themePreference = match.Groups[1].Value; break; }
                        }
                    }
                }
            }
            catch { }
            if (themePreference == "light" || themePreference == "dark") trayTheme = themePreference;
            else if (themePreference == "system")
            {
                try
                {
                    object setting = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
                    trayTheme = Convert.ToInt32(setting, CultureInfo.InvariantCulture) == 0 ? "dark" : "light";
                }
                catch { trayTheme = "light"; }
            }
        }

        private void SaveWindowTheme()
        {
            try
            {
                string filename = Path.Combine(stateRoot, "data", "window-theme.json");
                Directory.CreateDirectory(Path.GetDirectoryName(filename));
                File.WriteAllText(filename, json.Serialize(new { preference = themePreference, resolved = trayTheme }), new UTF8Encoding(false));
            }
            catch { }
        }

        private static int MeasureDesktopDropDownWidth(ToolStripDropDown dropDown)
        {
            int desired = 260;
            foreach (ToolStripItem item in dropDown.Items)
            {
                ToolStripMenuItem menuItem = item as ToolStripMenuItem;
                if (menuItem == null) continue;
                Font font = menuItem.Font ?? dropDown.Font;
                Size title = TextRenderer.MeasureText(menuItem.Text ?? "", font, Size.Empty,
                    TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                string shortcut = menuItem.ShowShortcutKeys ? menuItem.ShortcutKeyDisplayString ?? "" : "";
                Size shortcutSize = String.IsNullOrEmpty(shortcut)
                    ? Size.Empty
                    : TextRenderer.MeasureText(shortcut, font, Size.Empty,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                int trailing = menuItem.DropDownItems.Count > 0 ? 30 : 12;
                int measured = 12 + title.Width + (shortcutSize.Width > 0 ? 24 + shortcutSize.Width : 0) + trailing + 2;
                desired = Math.Max(desired, measured);
            }
            return desired;
        }

        private static void ApplyDesktopDropDownTheme(ToolStripDropDown dropDown, DesktopTitleRenderer renderer,
            DshMenuColorTable colors)
        {
            ToolStripDropDownMenu menu = dropDown as ToolStripDropDownMenu;
            if (menu != null)
            {
                menu.ShowImageMargin = false;
                menu.ShowCheckMargin = false;
            }
            dropDown.Renderer = renderer;
            dropDown.BackColor = colors.SurfaceColor;
            dropDown.ForeColor = colors.TextColor;
            dropDown.Padding = new Padding(0, 6, 0, 6);
            dropDown.AutoSize = false;
            int width = MeasureDesktopDropDownWidth(dropDown);
            int itemWidth = Math.Max(1, width - 2);
            int height = dropDown.Padding.Vertical + 4;
            foreach (ToolStripItem item in dropDown.Items)
            {
                item.BackColor = colors.SurfaceColor;
                item.ForeColor = colors.TextColor;
                item.AutoSize = false;
                item.Margin = Padding.Empty;
                if (item is ToolStripSeparator)
                {
                    item.Padding = Padding.Empty;
                    item.Size = new Size(itemWidth, 13);
                    height += item.Height;
                    continue;
                }
                item.Padding = new Padding(12, 0, 12, 0);
                item.Size = new Size(itemWidth, 30);
                height += item.Height;
                ToolStripMenuItem menuItem = item as ToolStripMenuItem;
                if (menuItem != null && menuItem.DropDownItems.Count > 0)
                    ApplyDesktopDropDownTheme(menuItem.DropDown, renderer, colors);
            }
            dropDown.MinimumSize = new Size(width, height);
            dropDown.MaximumSize = new Size(width, height);
            dropDown.Size = new Size(width, height);
        }

        private void ApplyDesktopChrome()
        {
            bool dark = String.Equals(trayTheme, "dark", StringComparison.OrdinalIgnoreCase);
            Color background = dark ? Color.FromArgb(24, 24, 26) : Color.FromArgb(248, 248, 248);
            Color foreground = dark ? Color.FromArgb(235, 235, 235) : Color.FromArgb(35, 35, 35);
            BackColor = background;
            desktopContent.BackColor = background;
            launchPanel.BackColor = background;
            launchContent.BackColor = background;
            if (logoDark != dark && productIcon.Image != null)
            {
                using (Bitmap original = Icon.ToBitmap())
                {
                    Bitmap themed = new Bitmap(original.Width, original.Height);
                    using (Graphics graphics = Graphics.FromImage(themed))
                    using (System.Drawing.Imaging.ImageAttributes attributes = new System.Drawing.Imaging.ImageAttributes())
                    {
                        if (dark) attributes.SetColorMatrix(new System.Drawing.Imaging.ColorMatrix(new float[][] {
                            new float[] { -1, 0, 0, 0, 0 }, new float[] { 0, -1, 0, 0, 0 },
                            new float[] { 0, 0, -1, 0, 0 }, new float[] { 0, 0, 0, 1, 0 }, new float[] { 1, 1, 1, 0, 1 } }));
                        graphics.DrawImage(original, new Rectangle(Point.Empty, themed.Size), 0, 0, original.Width, original.Height, GraphicsUnit.Pixel, attributes);
                    }
                    Image retired = productIcon.Image;
                    productIcon.Image = themed;
                    retired.Dispose();
                }
                logoDark = dark;
            }
            productLabel.BackColor = background;
            productLabel.ForeColor = foreground;
            statusLabel.BackColor = background;
            statusLabel.ForeColor = dark ? Color.FromArgb(178, 178, 184) : Color.FromArgb(92, 95, 101);
            progressDetail.BackColor = background;
            progressDetail.ForeColor = statusLabel.ForeColor;
            activityRing.TrackColor = dark ? Color.FromArgb(53, 53, 57) : Color.FromArgb(226, 228, 232);
            activityRing.IndicatorColor = dark ? Color.FromArgb(242, 242, 244) : Color.FromArgb(27, 28, 30);
            if (desktopMenu != null && desktopMenuLanguage != uiLanguage) InitializeDesktopMenu();
            if (desktopMenu != null)
            {
                desktopMenu.BackColor = dark ? Color.FromArgb(30, 30, 30) : Color.FromArgb(250, 250, 250);
                desktopMenu.ForeColor = foreground;
                DesktopTitleRenderer renderer = new DesktopTitleRenderer(dark);
                DshMenuColorTable colors = renderer.Colors;
                desktopMenu.Renderer = renderer;
                foreach (ToolStripMenuItem menu in desktopMenu.Items)
                {
                    menu.ForeColor = foreground;
                    ApplyDesktopDropDownTheme(menu.DropDown, renderer, colors);
                }
            }
            if (webView != null && !webView.IsDisposed) webView.DefaultBackgroundColor = background;
            if (webView != null && webView.CoreWebView2 != null)
                webView.CoreWebView2.Profile.PreferredColorScheme = themePreference == "system"
                    ? CoreWebView2PreferredColorScheme.Auto
                    : dark ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Light;
            if (desktopStart && IsHandleCreated)
            {
                int darkMode = dark ? 1 : 0;
                uint caption = ToColorRef(background);
                uint text = ToColorRef(foreground);
                uint border = DesktopBorderColor(); // DWM owns the physical-pixel edge and corner clipping.
                try
                {
                    DwmSetWindowAttribute(Handle, DwmwaUseImmersiveDarkMode, ref darkMode, sizeof(int));
                    DwmSetWindowAttribute(Handle, DwmwaCaptionColor, ref caption, sizeof(uint));
                    DwmSetWindowAttribute(Handle, DwmwaTextColor, ref text, sizeof(uint));
                    DwmSetWindowAttribute(Handle, DwmwaBorderColor, ref border, sizeof(uint));
                }
                catch (DllNotFoundException) { }
                catch (EntryPointNotFoundException) { }
            }
        }

        protected override void OnActivated(EventArgs eventArgs)
        {
            base.OnActivated(eventArgs);
            ApplyDesktopBorder();
        }

        private uint DesktopBorderColor()
        {
            if (fullscreen || WindowState != FormWindowState.Normal) return 0xFFFFFFFE;
            bool dark = String.Equals(trayTheme, "dark", StringComparison.OrdinalIgnoreCase);
            bool active = Form.ActiveForm == this;
            int shade = dark ? (active ? 76 : 54) : (active ? 184 : 211);
            return ToColorRef(Color.FromArgb(shade, shade, shade));
        }

        private void ApplyDesktopBorder()
        {
            if (!desktopStart || !IsHandleCreated || IsDisposed) return;
            uint border = DesktopBorderColor();
            try { DwmSetWindowAttribute(Handle, DwmwaBorderColor, ref border, sizeof(uint)); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
        }

        private static uint ToColorRef(Color color)
        {
            return (uint)(color.R | (color.G << 8) | (color.B << 16));
        }

        private void CenterLaunchContent()
        {
            launchContent.Location = new Point(
                Math.Max(0, (launchPanel.ClientSize.Width - launchContent.Width) / 2),
                Math.Max(0, (launchPanel.ClientSize.Height - launchContent.Height) / 2));
        }

    }
}
