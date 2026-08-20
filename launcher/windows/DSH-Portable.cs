using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("DeepSeek-Herness")]
[assembly: AssemblyDescription("Native desktop host for DeepSeek Harness")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyProduct("DeepSeek-Herness")]
[assembly: AssemblyCopyright("Copyright © WSL043 2026")]
[assembly: AssemblyVersion("0.2.6.65534")]
[assembly: AssemblyFileVersion("0.2.6.65534")]

namespace DshPortable
{
    internal sealed class TrayBridgeSession
    {
        public string id { get; set; }
        public string title { get; set; }
        public long updatedAt { get; set; }
        public bool running { get; set; }
        public string pendingInteraction { get; set; }
        public string agentPreset { get; set; }
    }

    internal sealed class TrayBridgeState
    {
        public string type { get; set; }
        public int schemaVersion { get; set; }
        public string locale { get; set; }
        public string theme { get; set; }
        public string currentSessionId { get; set; }
        public bool hasRunningSession { get; set; }
        public List<TrayBridgeSession> sessions { get; set; }
    }

    internal sealed class DesktopWindowState
    {
        public int schemaVersion { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public bool maximized { get; set; }
    }

    internal sealed class DshMenuColorTable : ProfessionalColorTable
    {
        private readonly bool dark;

        internal DshMenuColorTable(bool isDark)
        {
            dark = isDark;
            UseSystemColors = false;
        }

        private Color Surface { get { return dark ? Color.FromArgb(31, 32, 34) : Color.FromArgb(249, 249, 249); } }
        private Color Selected { get { return dark ? Color.FromArgb(45, 47, 50) : Color.FromArgb(235, 235, 235); } }
        private Color Border { get { return dark ? Color.FromArgb(61, 63, 66) : Color.FromArgb(218, 218, 218); } }
        internal Color TextColor { get { return dark ? Color.FromArgb(238, 239, 241) : Color.FromArgb(15, 17, 21); } }
        internal Color CaptionColor { get { return dark ? Color.FromArgb(173, 178, 184) : Color.FromArgb(97, 102, 107); } }
        internal Color SurfaceColor { get { return Surface; } }
        internal Color SelectedColor { get { return Selected; } }
        internal Color BorderColor { get { return Border; } }

        public override Color ToolStripDropDownBackground { get { return Surface; } }
        public override Color ImageMarginGradientBegin { get { return Surface; } }
        public override Color ImageMarginGradientMiddle { get { return Surface; } }
        public override Color ImageMarginGradientEnd { get { return Surface; } }
        public override Color MenuBorder { get { return Border; } }
        public override Color MenuItemBorder { get { return Selected; } }
        public override Color MenuItemSelected { get { return Selected; } }
        public override Color MenuItemSelectedGradientBegin { get { return Selected; } }
        public override Color MenuItemSelectedGradientEnd { get { return Selected; } }
        public override Color MenuItemPressedGradientBegin { get { return Selected; } }
        public override Color MenuItemPressedGradientMiddle { get { return Selected; } }
        public override Color MenuItemPressedGradientEnd { get { return Selected; } }
        public override Color SeparatorDark { get { return Border; } }
        public override Color SeparatorLight { get { return Surface; } }
    }

    internal sealed class DshMenuRenderer : ToolStripProfessionalRenderer
    {
        private readonly Color selectedColor;
        private readonly Color textColor;
        private readonly Color captionColor;
        private readonly Color runningColor;
        private readonly Color borderColor;
        private readonly bool chinese;

        internal DshMenuRenderer(DshMenuColorTable colors, bool isChinese)
            : base(colors)
        {
            RoundedEdges = false;
            selectedColor = colors.SelectedColor;
            textColor = colors.TextColor;
            captionColor = colors.CaptionColor;
            runningColor = Color.FromArgb(45, 201, 111);
            borderColor = colors.BorderColor;
            chinese = isChinese;
        }

        private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs eventArgs)
        {
            ToolStripMenuItem item = eventArgs.Item as ToolStripMenuItem;
            using (Brush surface = new SolidBrush(eventArgs.ToolStrip.BackColor))
                eventArgs.Graphics.FillRectangle(surface, new Rectangle(Point.Empty, eventArgs.Item.Size));
            if (item == null || !item.Selected) return;
            Rectangle selectedBounds = new Rectangle(4, 2, Math.Max(1, eventArgs.Item.Width - 8), Math.Max(1, eventArgs.Item.Height - 4));
            eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = RoundedRectangle(selectedBounds, 5))
            using (Brush selected = new SolidBrush(selectedColor))
                eventArgs.Graphics.FillPath(selected, path);
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs eventArgs)
        {
            int y = eventArgs.Item.Height / 2;
            using (Pen pen = new Pen(borderColor))
                eventArgs.Graphics.DrawLine(pen, 8, y, Math.Max(8, eventArgs.Item.Width - 8), y);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs eventArgs)
        {
            TrayBridgeSession session = eventArgs.Item.Tag as TrayBridgeSession;
            ToolStripMenuItem menuItem = eventArgs.Item as ToolStripMenuItem;
            if (menuItem == null)
            {
                base.OnRenderItemText(eventArgs);
                return;
            }
            if (session == null)
            {
                string caption = menuItem.ShortcutKeyDisplayString ?? "";
                Size captionSize = String.IsNullOrEmpty(caption)
                    ? Size.Empty
                    : TextRenderer.MeasureText(caption, eventArgs.TextFont, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                int trailing = menuItem.DropDownItems.Count > 0 ? 28 : 12;
                int captionLeft = Math.Max(82, eventArgs.Item.Width - trailing - captionSize.Width);
                if (eventArgs.Text == menuItem.Text)
                {
                    int titleRight = String.IsNullOrEmpty(caption) ? eventArgs.Item.Width - trailing : captionLeft - 12;
                    Rectangle commandBounds = new Rectangle(14, 0, Math.Max(24, titleRight - 14), eventArgs.Item.Height);
                    TextRenderer.DrawText(
                        eventArgs.Graphics,
                        menuItem.Text,
                        eventArgs.TextFont,
                        commandBounds,
                        menuItem.ForeColor,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                    return;
                }
                if (eventArgs.Text == caption && !String.IsNullOrEmpty(caption))
                {
                    Rectangle captionBounds = new Rectangle(captionLeft, 0, captionSize.Width, eventArgs.Item.Height);
                    TextRenderer.DrawText(
                        eventArgs.Graphics,
                        caption,
                        eventArgs.TextFont,
                        captionBounds,
                        captionColor,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
                }
                return;
            }

            string status = LauncherWindow.SessionHintForLocale(session, chinese);
            Size statusSize = TextRenderer.MeasureText(
                status,
                eventArgs.TextFont,
                Size.Empty,
                TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
            int statusLeft = Math.Max(82, eventArgs.Item.Width - 12 - statusSize.Width);
            if (eventArgs.Text == menuItem.Text)
            {
                Rectangle titleBounds = new Rectangle(14, 0, Math.Max(24, statusLeft - 26), eventArgs.Item.Height);
                TextRenderer.DrawText(
                    eventArgs.Graphics,
                    menuItem.Text,
                    eventArgs.TextFont,
                    titleBounds,
                    menuItem.ForeColor,
                    TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                return;
            }
            if (eventArgs.Text != menuItem.ShortcutKeyDisplayString) return;

            Rectangle textBounds = new Rectangle(statusLeft, 0, statusSize.Width, eventArgs.Item.Height);
            if (session.running)
            {
                using (Brush dot = new SolidBrush(runningColor))
                    eventArgs.Graphics.FillEllipse(dot, Math.Max(10, statusLeft - 11), Math.Max(0, (eventArgs.Item.Height - 6) / 2), 6, 6);
            }
            TextRenderer.DrawText(
                eventArgs.Graphics,
                status,
                eventArgs.TextFont,
                textBounds,
                captionColor,
                TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs eventArgs)
        {
            Rectangle arrowBounds = new Rectangle(
                Math.Max(0, eventArgs.Item.Width - 22),
                Math.Max(0, (eventArgs.Item.Height - 12) / 2),
                12,
                12);
            ControlPaint.DrawMenuGlyph(
                eventArgs.Graphics,
                arrowBounds,
                MenuGlyph.Arrow,
                textColor,
                eventArgs.Item.Selected ? selectedColor : eventArgs.Item.Owner.BackColor);
        }
    }


    internal sealed class LauncherWindow : Form
    {
        internal const int WmPortableExit = 0x8043;
        internal const int WmPortableRestore = 0x8044;
        private enum WindowCloseBehavior { Tray, Exit }

        private static string uiLanguage = CultureInfo.InstalledUICulture.TwoLetterISOLanguageName;
        private enum DwmWindowCornerPreference { Default = 0, DoNotRound = 1, Round = 2, RoundSmall = 3 }
        private const int DwmwaWindowCornerPreference = 33;
        private const int WorkspaceNavigationTimeoutMs = 60000;

        private static string L(string chinese, string english)
        {
            return uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase) ? chinese : english;
        }

        private static string UiLanguageTag
        {
            get { return L("zh-CN", "en-US"); }
        }

        private readonly Panel launchPanel;
        private readonly Panel launchContent;
        private readonly PictureBox productIcon;
        private readonly Label productLabel;
        private readonly Label statusLabel;
        private readonly ProgressBar progress;
        private readonly Label progressDetail;
        private readonly TextBox detailsBox;
        private readonly Label updateDescription;
        private readonly Button updateButton;
        private readonly Button skipUpdateButton;
        private readonly Button laterButton;
        private readonly Button copyButton;
        private readonly Button closeButton;
        private readonly WebView2 webView;
        private readonly NotifyIcon trayIcon;
        private readonly ContextMenuStrip trayMenu;
        private readonly ToolStripMenuItem closeBehaviorItem;
        private readonly ToolStripMenuItem checkUpdateItem;
        private readonly ToolStripMenuItem automaticUpdateCheckItem;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly string root;
        private readonly string[] launcherArgs;
        private readonly bool nonInteractive;
        private readonly bool desktopStart;
        private TaskCompletionSource<int> updateChoice;
        private bool operationRunning = true;
        private bool desktopReady;
        private bool shutdownRunning;
        private bool allowClose;
        private bool backendStarted;
        private bool trayNoticeShown;
        private bool trayBridgeReady;
        private bool trayMenuOpen;
        private bool trayMenuRefreshPending;
        private bool manualUpdateRunning;
        private bool updateCheckEnabled;
        private WindowCloseBehavior closeBehavior;
        private FormWindowState windowStateBeforeHide = FormWindowState.Normal;
        private TrayBridgeState trayState;
        private string trayTheme = "light";
        private Uri applicationUri;

        internal LauncherWindow(string[] args)
        {
            root = Path.GetDirectoryName(Application.ExecutablePath);
            launcherArgs = ResolveArguments(args);
            nonInteractive = Array.Exists(launcherArgs, item =>
                string.Equals(item, "--json", StringComparison.OrdinalIgnoreCase));
            bool testHidden = String.Equals(
                Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_HIDDEN"),
                "1",
                StringComparison.Ordinal);
            desktopStart = !nonInteractive && IsStartCommand(launcherArgs);

            Text = "DeepSeek-Herness";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = desktopStart;
            ShowInTaskbar = !nonInteractive && !testHidden;
            if (nonInteractive || testHidden) Opacity = 0;
            ClientSize = desktopStart ? new Size(560, 220) : new Size(440, 160);
            MinimumSize = Size.Empty;
            BackColor = SystemColors.Window;
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

            launchPanel = new Panel { Dock = DockStyle.Fill, BackColor = SystemColors.Window };
            launchContent = new Panel { Size = new Size(504, 144), BackColor = SystemColors.Window };
            launchPanel.Resize += delegate { CenterLaunchContent(); };
            productIcon = new PictureBox
            {
                Location = new Point(24, 20),
                Size = new Size(40, 40),
                SizeMode = PictureBoxSizeMode.Zoom,
                Image = Icon == null ? null : Icon.ToBitmap(),
            };
            productLabel = new Label
            {
                AutoSize = false,
                Location = new Point(80, 18),
                Size = new Size(400, 30),
                Text = "DeepSeek Harness",
                Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold, GraphicsUnit.Point),
            };
            statusLabel = new Label
            {
                AutoEllipsis = true,
                Location = new Point(80, 53),
                Size = new Size(400, 36),
                ForeColor = Color.FromArgb(72, 72, 72),
                Text = IsStopCommand(launcherArgs)
                    ? L("正在停止 DeepSeek Harness…", "Stopping DeepSeek Harness…")
                    : L("正在启动 DeepSeek Harness…", "Starting DeepSeek Harness…"),
            };
            progress = new ProgressBar
            {
                Location = new Point(24, 108),
                Size = new Size(456, 6),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 24,
            };
            updateDescription = new Label
            {
                Location = new Point(24, 91),
                Size = new Size(456, 48),
                ForeColor = Color.FromArgb(80, 80, 80),
                Visible = false,
            };
            updateButton = new Button
            {
                Text = L("现在更新", "Update now"),
                Size = new Size(108, 34),
                Location = new Point(184, 154),
                Visible = false,
            };
            progressDetail = new Label
            {
                AutoEllipsis = true,
                Location = new Point(24, 84),
                Size = new Size(456, 20),
                ForeColor = Color.FromArgb(97, 102, 107),
                TextAlign = ContentAlignment.MiddleLeft,
                Visible = false,
            };
            updateButton.Click += delegate { if (updateChoice != null) updateChoice.TrySetResult(1); };
            skipUpdateButton = new Button
            {
                Text = L("跳过此版本", "Skip this version"),
                Size = new Size(108, 34),
                Location = new Point(304, 154),
                Visible = false,
            };
            skipUpdateButton.Click += delegate { if (updateChoice != null) updateChoice.TrySetResult(-1); };
            laterButton = new Button
            {
                Text = L("稍后", "Later"),
                Size = new Size(80, 34),
                Location = new Point(424, 154),
                Visible = false,
            };
            laterButton.Click += delegate { if (updateChoice != null) updateChoice.TrySetResult(0); };

            detailsBox = new TextBox
            {
                Location = new Point(24, 92),
                Size = new Size(536, 150),
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                WordWrap = true,
                BackColor = SystemColors.Window,
                Font = new Font("Consolas", 9F, FontStyle.Regular, GraphicsUnit.Point),
                Visible = false,
            };
            copyButton = new Button
            {
                Text = L("复制详情", "Copy details"),
                Size = new Size(116, 32),
                Location = new Point(320, 252),
                Visible = false,
            };
            copyButton.Click += delegate
            {
                if (string.IsNullOrEmpty(detailsBox.Text)) return;
                try { Clipboard.SetText(detailsBox.Text); }
                catch { copyButton.Text = L("复制失败", "Copy failed"); }
            };
            closeButton = new Button
            {
                Text = L("关闭", "Close"),
                Size = new Size(92, 32),
                Location = new Point(412, 252),
                Visible = false,
            };
            closeButton.Click += delegate { allowClose = true; Close(); };
            CancelButton = closeButton;

            launchContent.Controls.Add(productIcon);
            launchContent.Controls.Add(productLabel);
            launchContent.Controls.Add(statusLabel);
            launchContent.Controls.Add(progressDetail);
            launchContent.Controls.Add(progress);
            launchContent.Controls.Add(updateDescription);
            launchContent.Controls.Add(updateButton);
            launchContent.Controls.Add(skipUpdateButton);
            launchContent.Controls.Add(laterButton);
            launchContent.Controls.Add(detailsBox);
            launchContent.Controls.Add(copyButton);
            launchContent.Controls.Add(closeButton);
            launchPanel.Controls.Add(launchContent);

            closeBehavior = LoadCloseBehavior();
            updateCheckEnabled = LoadUpdateCheckEnabled();
            closeBehaviorItem = new ToolStripMenuItem(L("关闭窗口时", "When closing"));
            closeBehaviorItem.Click += delegate
            {
                SaveCloseBehavior(closeBehavior == WindowCloseBehavior.Tray
                    ? WindowCloseBehavior.Exit
                    : WindowCloseBehavior.Tray);
                RebuildTrayMenu();
            };
            checkUpdateItem = new ToolStripMenuItem(L("检查更新", "Check for updates"));
            checkUpdateItem.Click += async delegate { await CheckForDesktopUpdateAsync(true); };
            automaticUpdateCheckItem = new ToolStripMenuItem(L("启动时检查更新", "Check for updates at startup"))
            {
                Checked = updateCheckEnabled,
                CheckOnClick = false,
            };
            automaticUpdateCheckItem.Click += delegate
            {
                updateCheckEnabled = !updateCheckEnabled;
                RefreshAutomaticUpdateCheckItem();
                SaveLauncherSettings();
            };
            trayMenu = new ContextMenuStrip
            {
                ShowImageMargin = false,
                ShowCheckMargin = false,
                Font = new Font("Segoe UI Variable Text", 8.0F, FontStyle.Regular, GraphicsUnit.Point),
            };
            trayMenu.Opening += delegate { trayMenuOpen = true; };
            trayMenu.Opened += delegate { ApplyRoundedCorners(trayMenu); };
            trayMenu.Closed += delegate
            {
                trayMenuOpen = false;
                if (trayMenuRefreshPending)
                {
                    trayMenuRefreshPending = false;
                    RebuildTrayMenu();
                }
            };
            RebuildTrayMenu();
            trayIcon = new NotifyIcon
            {
                Icon = Icon,
                Text = "DeepSeek Harness",
                ContextMenuStrip = trayMenu,
                Visible = false,
            };
            trayIcon.MouseUp += HandleTrayMouseUp;

            webView = new WebView2 { Dock = DockStyle.Fill, Visible = false };
            Controls.Add(webView);
            Controls.Add(launchPanel);
            CenterLaunchContent();
            ResizeEnd += delegate { SaveDesktopWindowState(); };
            Shown += async delegate { await RunLauncherAsync(); };
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

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WmPortableExit)
            {
                backendStarted = false;
                allowClose = true;
                DisposeTrayIcon();
                Close();
                return;
            }
            if (message.Msg == WmPortableRestore)
            {
                RestoreFromTray();
                return;
            }
            base.WndProc(ref message);
        }

        private void CenterLaunchContent()
        {
            launchContent.Location = new Point(
                Math.Max(0, (launchPanel.ClientSize.Width - launchContent.Width) / 2),
                Math.Max(0, (launchPanel.ClientSize.Height - launchContent.Height) / 2));
        }

        private void HideToTray()
        {
            windowStateBeforeHide = WindowState == FormWindowState.Maximized
                ? FormWindowState.Maximized
                : FormWindowState.Normal;
            SaveDesktopWindowState();
            Hide();
            ShowInTaskbar = false;
            trayIcon.Visible = true;
            if (!trayNoticeShown)
            {
                trayNoticeShown = true;
                trayIcon.ShowBalloonTip(3000,
                    L("DeepSeek Harness 仍在运行", "DeepSeek Harness is still running"),
                    L("正在执行的任务会继续。右键托盘图标可以打开或退出。", "Active tasks will continue. Right-click the tray icon to open or exit."),
                    ToolTipIcon.Info);
            }
        }

        private void RestoreFromTray()
        {
            if (!desktopReady) return;
            ShowInTaskbar = true;
            Show();
            WindowState = windowStateBeforeHide;
            Activate();
        }

        internal static string MenuTitle(string value)
        {
            string text = String.IsNullOrWhiteSpace(value) ? L("未命名会话", "Untitled session") : value.Trim();
            const int limit = 28;
            int[] starts = StringInfo.ParseCombiningCharacters(text);
            if (starts.Length > limit) text = text.Substring(0, starts[limit]).TrimEnd() + "…";
            return text.Replace("&", "&&");
        }

        internal static string SessionHintForLocale(TrayBridgeSession session, bool chinese)
        {
            if (!String.IsNullOrEmpty(session.pendingInteraction)) return chinese ? "待回复" : "Needs input";
            if (session.running) return chinese ? "运行中" : "Running";
            string preset = String.IsNullOrWhiteSpace(session.agentPreset) ? "" : session.agentPreset.Trim();
            if (preset.Equals("coding", StringComparison.OrdinalIgnoreCase)) return chinese ? "编码" : "Coding";
            if (preset.Equals("plan", StringComparison.OrdinalIgnoreCase)) return chinese ? "计划" : "Plan";
            if (preset.Equals("review", StringComparison.OrdinalIgnoreCase)) return chinese ? "复核" : "Review";
            if (preset.Equals("standard", StringComparison.OrdinalIgnoreCase)) return chinese ? "标准" : "Standard";
            if (String.IsNullOrEmpty(preset)) return chinese ? "已完成" : "Completed";
            return preset;
        }

        private ToolStripMenuItem CreateSessionMenuItem(TrayBridgeSession session)
        {
            bool chinese = uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase);
            string hint = SessionHintForLocale(session, chinese);
            ToolStripMenuItem item = new ToolStripMenuItem(MenuTitle(session.title))
            {
                AutoToolTip = false,
                ShowShortcutKeys = true,
                ShortcutKeyDisplayString = hint,
                Name = session.id,
                Tag = session,
            };
            item.Click += delegate
            {
                RestoreFromTray();
                PostBridgeAction("open-session", session.id);
            };
            return item;
        }

        private ToolStripMenuItem CreateOpenItem()
        {
            return new ToolStripMenuItem(L("打开 DeepSeek Harness", "Open DeepSeek Harness"), null, delegate { RestoreFromTray(); });
        }

        private ToolStripMenuItem CreateExitItem()
        {
            return new ToolStripMenuItem(L("退出 DeepSeek Harness", "Exit DeepSeek Harness"), null, delegate
            {
                if (!shutdownRunning) BeginDesktopShutdown();
            });
        }

        private ToolStripMenuItem CreateReportProblemItem()
        {
            return new ToolStripMenuItem(L("反馈问题", "Report a problem"), null, delegate
            {
                OpenExternalUrl("https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml");
            });
        }

        private void RebuildTrayMenu()
        {
            if (trayMenuOpen)
            {
                trayMenuRefreshPending = true;
                return;
            }

            closeBehaviorItem.Text = L("关闭窗口时", "When closing");
            checkUpdateItem.Text = manualUpdateRunning
                ? L("正在检查…", "Checking…")
                : L("检查更新", "Check for updates");
            checkUpdateItem.Enabled = !manualUpdateRunning;
            RefreshAutomaticUpdateCheckItem();
            closeBehaviorItem.Checked = false;
            closeBehaviorItem.ShowShortcutKeys = true;
            closeBehaviorItem.ShortcutKeyDisplayString = closeBehavior == WindowCloseBehavior.Tray
                ? L("最小化到托盘", "Minimize to tray")
                : L("退出程序", "Exit application");
            trayMenu.Items.Clear();

            List<TrayBridgeSession> sessions = trayBridgeReady && trayState != null && trayState.sessions != null
                ? trayState.sessions.Where(item => item != null && !String.IsNullOrWhiteSpace(item.id)).Take(10).ToList()
                : new List<TrayBridgeSession>();

            trayMenu.Items.Add(CreateOpenItem());
            if (trayBridgeReady)
            {
                trayMenu.Items.Add(new ToolStripSeparator());
                foreach (TrayBridgeSession session in sessions.Take(3))
                    trayMenu.Items.Add(CreateSessionMenuItem(session));

                ToolStripMenuItem more = new ToolStripMenuItem(L("更多", "More"));
                foreach (TrayBridgeSession session in sessions.Skip(3).Take(7))
                    more.DropDownItems.Add(CreateSessionMenuItem(session));
                if (more.DropDownItems.Count > 0) more.DropDownItems.Add(new ToolStripSeparator());
                more.DropDownItems.Add(checkUpdateItem);
                more.DropDownItems.Add(automaticUpdateCheckItem);
                more.DropDownItems.Add(closeBehaviorItem);
                more.DropDownItems.Add(new ToolStripSeparator());
                more.DropDownItems.Add(CreateReportProblemItem());
                ToolStripDropDownMenu moreMenu = more.DropDown as ToolStripDropDownMenu;
                if (moreMenu != null)
                {
                    moreMenu.ShowImageMargin = false;
                    moreMenu.ShowCheckMargin = false;
                }
                more.DropDown.Opened += delegate { ApplyRoundedCorners(more.DropDown); };
                trayMenu.Items.Add(more);
                trayMenu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem fresh = new ToolStripMenuItem(L("新会话", "New session"));
                fresh.Click += delegate
                {
                    RestoreFromTray();
                    PostBridgeAction("new-session", null);
                };
                trayMenu.Items.Add(fresh);
            }
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(CreateExitItem());
            ApplyTrayTheme();
        }

        private void HandleTrayMouseUp(object sender, MouseEventArgs eventArgs)
        {
            if (eventArgs.Button == MouseButtons.Left) RestoreFromTray();
        }

        private void RefreshAutomaticUpdateCheckItem()
        {
            automaticUpdateCheckItem.Text = L("启动时检查更新", "Check for updates at startup");
            automaticUpdateCheckItem.Checked = false;
            automaticUpdateCheckItem.ShowShortcutKeys = true;
            automaticUpdateCheckItem.ShortcutKeyDisplayString = updateCheckEnabled
                ? L("已开启", "On")
                : L("已关闭", "Off");
            automaticUpdateCheckItem.Invalidate();
        }

        private void ApplyTrayTheme()
        {
            bool dark = String.Equals(trayTheme, "dark", StringComparison.OrdinalIgnoreCase);
            DshMenuColorTable colors = new DshMenuColorTable(dark);
            trayMenu.Renderer = new DshMenuRenderer(colors, uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase));
            trayMenu.BackColor = colors.SurfaceColor;
            trayMenu.ForeColor = colors.TextColor;
            trayMenu.Padding = Padding.Empty;
            int rootWidth = MeasureTrayMenuWidth(trayMenu.Items, trayMenu.Font, 220, 282);
            trayMenu.MinimumSize = new Size(rootWidth, 0);
            ApplyTrayItemTheme(trayMenu.Items, rootWidth, colors.TextColor, colors.CaptionColor, trayMenu.BackColor, colors.SelectedColor);
        }

        private static int MeasureTrayMenuWidth(ToolStripItemCollection items, Font font, int minimum, int maximum)
        {
            int desired = minimum;
            foreach (ToolStripItem item in items)
            {
                ToolStripMenuItem menuItem = item as ToolStripMenuItem;
                if (menuItem == null) continue;
                Size title = TextRenderer.MeasureText(menuItem.Text ?? "", font, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                Size status = String.IsNullOrEmpty(menuItem.ShortcutKeyDisplayString)
                    ? Size.Empty
                    : TextRenderer.MeasureText(menuItem.ShortcutKeyDisplayString, font, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                int width = 28 + title.Width;
                if (status.Width > 0) width += 18 + status.Width;
                if (menuItem.DropDownItems.Count > 0) width += 18;
                desired = Math.Max(desired, width);
            }
            return Math.Min(maximum, desired);
        }

        private static void ApplyTrayItemTheme(ToolStripItemCollection items, int menuWidth, Color foreground, Color caption, Color background, Color selected)
        {
            foreach (ToolStripItem item in items)
            {
                item.ForeColor = foreground;
                item.BackColor = background;
                item.AutoSize = false;
                item.Size = item is ToolStripSeparator ? new Size(menuWidth - 2, 6) : new Size(menuWidth - 2, 35);
                item.Padding = item is ToolStripSeparator ? Padding.Empty : new Padding(10, 5, 10, 5);
                ToolStripMenuItem menuItem = item as ToolStripMenuItem;
                if (menuItem == null) continue;
                menuItem.DropDown.BackColor = background;
                menuItem.DropDown.ForeColor = foreground;
                if (menuItem.DropDownItems.Count > 0)
                {
                    int childWidth = MeasureTrayMenuWidth(menuItem.DropDownItems, font: item.Font, minimum: 196, maximum: 264);
                    menuItem.DropDown.MinimumSize = new Size(childWidth, 0);
                    ApplyTrayItemTheme(menuItem.DropDownItems, childWidth, foreground, caption, background, selected);
                }
            }
        }

        private void PostBridgeAction(string action, string sessionId)
        {
            if (!trayBridgeReady || webView.CoreWebView2 == null) return;
            Dictionary<string, object> message = new Dictionary<string, object>
            {
                { "type", "dsh-portable/action" },
                { "action", action },
            };
            if (!String.IsNullOrEmpty(sessionId)) message["sessionId"] = sessionId;
            try { webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
            catch { trayBridgeReady = false; RebuildTrayMenu(); }
        }

        private static void ApplyRoundedCorners(ToolStripDropDown menu)
        {
            if (menu == null || menu.IsDisposed || !menu.IsHandleCreated) return;
            DwmWindowCornerPreference preference = DwmWindowCornerPreference.Round;
            try { DwmSetWindowAttribute(menu.Handle, DwmwaWindowCornerPreference, ref preference, sizeof(int)); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
        {
            Uri source;
            if (applicationUri == null
                || !Uri.TryCreate(eventArgs.Source, UriKind.Absolute, out source)
                || !source.IsLoopback
                || source.Port != applicationUri.Port) return;
            try
            {
                TrayBridgeState state = json.Deserialize<TrayBridgeState>(eventArgs.WebMessageAsJson);
                if (state == null || state.type != "dsh-portable/state" || state.schemaVersion != 1) return;
                if (state.sessions == null) state.sessions = new List<TrayBridgeSession>();
                if (state.sessions.Count > 10) state.sessions = state.sessions.Take(10).ToList();
                BeginInvoke((MethodInvoker)delegate
                {
                    trayState = state;
                    trayBridgeReady = true;
                    uiLanguage = String.Equals(state.locale, "zh", StringComparison.OrdinalIgnoreCase) ? "zh" : "en";
                    trayTheme = String.Equals(state.theme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light";
                    RebuildTrayMenu();
                });
            }
            catch
            {
                // A malformed or future bridge payload cannot remove the native Open/Exit fallback.
            }
        }

        private void DisposeTrayIcon()
        {
            trayIcon.Visible = false;
        }

        private string ResolveProductDataRoot()
        {
            if (File.Exists(Path.Combine(root, "installed-mode.json")))
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepSeek-Herness", "data");
            return Path.Combine(root, "data");
        }

        private string LauncherSettingsPath()
        {
            return Path.Combine(ResolveProductDataRoot(), "launcher-settings.json");
        }

        private string DesktopWindowStatePath()
        {
            return Path.Combine(ResolveProductDataRoot(), "window-state.json");
        }

        private static bool IsSafeDesktopBounds(Rectangle bounds)
        {
            if (bounds.Width < 900 || bounds.Height < 620) return false;
            return Screen.AllScreens.Any(screen =>
            {
                Rectangle visible = Rectangle.Intersect(screen.WorkingArea, bounds);
                return visible.Width >= 120 && visible.Height >= 80;
            });
        }

        private void RestoreDesktopWindowState()
        {
            try
            {
                DesktopWindowState state = json.Deserialize<DesktopWindowState>(
                    File.ReadAllText(DesktopWindowStatePath(), Encoding.UTF8));
                Rectangle bounds = new Rectangle(state.x, state.y, state.width, state.height);
                if (state.schemaVersion != 1 || !IsSafeDesktopBounds(bounds)) throw new InvalidDataException();
                StartPosition = FormStartPosition.Manual;
                Bounds = bounds;
                windowStateBeforeHide = state.maximized ? FormWindowState.Maximized : FormWindowState.Normal;
                WindowState = windowStateBeforeHide;
                return;
            }
            catch { }

            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 820);
            CenterToScreen();
            windowStateBeforeHide = FormWindowState.Normal;
        }

        private void SaveDesktopWindowState()
        {
            if (!desktopReady) return;
            try { SaveDesktopWindowStateCore(); }
            catch
            {
                try { File.Delete(DesktopWindowStatePath() + ".tmp"); }
                catch { }
            }
        }

        private void SaveDesktopWindowStateCore()
        {
            if (Visible && WindowState != FormWindowState.Minimized)
                windowStateBeforeHide = WindowState;
            Rectangle bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            if (!IsSafeDesktopBounds(bounds)) return;
            DesktopWindowState state = new DesktopWindowState
            {
                schemaVersion = 1,
                x = bounds.X,
                y = bounds.Y,
                width = bounds.Width,
                height = bounds.Height,
                maximized = windowStateBeforeHide == FormWindowState.Maximized,
            };
            string filename = DesktopWindowStatePath();
            string temporary = filename + ".tmp";
            Directory.CreateDirectory(Path.GetDirectoryName(filename));
            File.WriteAllText(temporary, json.Serialize(state) + "\r\n", new UTF8Encoding(false));
            if (File.Exists(filename))
            {
                try { File.Replace(temporary, filename, null, true); }
                catch
                {
                    File.Copy(temporary, filename, true);
                    File.Delete(temporary);
                }
            }
            else File.Move(temporary, filename);
        }

        private WindowCloseBehavior LoadCloseBehavior()
        {
            try
            {
                string source = File.ReadAllText(LauncherSettingsPath(), Encoding.UTF8);
                return Regex.IsMatch(source, "\\\"closeBehavior\\\"\\s*:\\s*\\\"exit\\\"", RegexOptions.IgnoreCase)
                    ? WindowCloseBehavior.Exit
                    : WindowCloseBehavior.Tray;
            }
            catch { return WindowCloseBehavior.Tray; }
        }

        private bool LoadUpdateCheckEnabled()
        {
            try
            {
                string source = File.ReadAllText(LauncherSettingsPath(), Encoding.UTF8);
                return !Regex.IsMatch(source, "\\\"updateCheckEnabled\\\"\\s*:\\s*false", RegexOptions.IgnoreCase);
            }
            catch { return true; }
        }

        private void SaveCloseBehavior(WindowCloseBehavior behavior)
        {
            closeBehavior = behavior;
            SaveLauncherSettings();
        }

        private void SaveLauncherSettings()
        {
            string filename = LauncherSettingsPath();
            string temporary = filename + ".tmp";
            Directory.CreateDirectory(Path.GetDirectoryName(filename));
            string close = closeBehavior == WindowCloseBehavior.Exit ? "exit" : "tray";
            File.WriteAllText(temporary,
                "{\"schemaVersion\":1,\"closeBehavior\":\"" + close + "\",\"updateCheckEnabled\":"
                    + (updateCheckEnabled ? "true" : "false") + "}\r\n",
                new UTF8Encoding(false));
            if (File.Exists(filename))
            {
                try { File.Replace(temporary, filename, filename + ".bak", true); }
                catch
                {
                    File.Copy(temporary, filename, true);
                    File.Delete(temporary);
                }
            }
            else File.Move(temporary, filename);
            try { File.Delete(filename + ".bak"); } catch { }
        }

        protected override void OnHandleCreated(EventArgs eventArgs)
        {
            base.OnHandleCreated(eventArgs);
            TaskbarIdentity.Apply(Handle, "io.github.wsl043.dsh-portable");
        }

        protected override void OnFormClosed(FormClosedEventArgs eventArgs)
        {
            SaveDesktopWindowState();
            DisposeTrayIcon();
            trayIcon.Dispose();
            base.OnFormClosed(eventArgs);
        }

        private void BeginDesktopShutdown()
        {
            shutdownRunning = true;
            trayIcon.Visible = true;
            webView.Enabled = false;
            Text = L("DeepSeek-Herness · 正在关闭", "DeepSeek-Herness · Closing");
            Task.Run(() => InvokePortableCli(new[] { "stop", "--no-browser", "--json" })).ContinueWith(task =>
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    Tuple<int, string> result = task.IsFaulted
                        ? Tuple.Create(1, task.Exception == null ? L("停止失败。", "Could not stop the application.") : task.Exception.GetBaseException().Message)
                        : task.Result;
                    if (result.Item1 == 0)
                    {
                        backendStarted = false;
                        allowClose = true;
                        DisposeTrayIcon();
                        Close();
                        return;
                    }
                    shutdownRunning = false;
                    webView.Enabled = true;
                    Text = "DeepSeek-Herness";
                    MessageBox.Show(this, result.Item2, L("DeepSeek Harness 停止失败", "DeepSeek Harness could not stop"), MessageBoxButtons.OK, MessageBoxIcon.Error);
                });
            });
        }

        private static string[] ResolveArguments(string[] args)
        {
            if (args != null && args.Length > 0) return args;
            string name = Path.GetFileNameWithoutExtension(Application.ExecutablePath);
            return name.StartsWith("Stop ", StringComparison.OrdinalIgnoreCase) ? new[] { "stop" } : new[] { "start" };
        }

        private static bool IsStopCommand(string[] args)
        {
            return args.Length > 0 && string.Equals(args[0], "stop", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsStartCommand(string[] args)
        {
            return args.Length > 0 && string.Equals(args[0], "start", StringComparison.OrdinalIgnoreCase);
        }

        private void CloseOwnedDesktopHost()
        {
            string expected = Path.GetFullPath(Path.Combine(root, "DeepSeek-Herness.exe"));
            int currentProcessId = Process.GetCurrentProcess().Id;
            foreach (Process process in Process.GetProcessesByName("DeepSeek-Herness"))
            {
                using (process)
                {
                    if (process.Id == currentProcessId) continue;
                    string candidate;
                    try { candidate = Path.GetFullPath(process.MainModule.FileName); }
                    catch { continue; }
                    if (!string.Equals(candidate, expected, StringComparison.OrdinalIgnoreCase)) continue;
                    bool signaled = false;
                    EnumWindows(delegate(IntPtr window, IntPtr value)
                    {
                        uint processId;
                        GetWindowThreadProcessId(window, out processId);
                        if (processId != (uint)process.Id) return true;
                        signaled = PostMessage(window, WmPortableExit, IntPtr.Zero, IntPtr.Zero) || signaled;
                        return true;
                    }, IntPtr.Zero);
                    if (!signaled)
                        throw new InvalidOperationException(L("DeepSeek-Herness 原生窗口无法接收退出请求。", "The DeepSeek-Herness window could not receive the exit request."));
                    if (!process.WaitForExit(45000))
                        throw new TimeoutException(L("DeepSeek-Herness 原生窗口未能在 45 秒内正常退出。", "DeepSeek-Herness did not exit within 45 seconds."));
                }
            }
        }

        private delegate bool EnumWindowsCallback(IntPtr window, IntPtr value);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr value);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(
            IntPtr window,
            int attribute,
            ref DwmWindowCornerPreference preference,
            int preferenceSize);

        internal static bool SignalExistingDesktopHost(int message)
        {
            string expected = Path.GetFullPath(Application.ExecutablePath);
            int currentProcessId = Process.GetCurrentProcess().Id;
            bool signaled = false;
            foreach (Process process in Process.GetProcessesByName("DeepSeek-Herness"))
            {
                using (process)
                {
                    if (process.Id == currentProcessId) continue;
                    string candidate;
                    try { candidate = Path.GetFullPath(process.MainModule.FileName); }
                    catch { continue; }
                    if (!string.Equals(candidate, expected, StringComparison.OrdinalIgnoreCase)) continue;
                    EnumWindows(delegate(IntPtr window, IntPtr value)
                    {
                        uint processId;
                        GetWindowThreadProcessId(window, out processId);
                        if (processId == (uint)process.Id)
                            signaled = PostMessage(window, message, IntPtr.Zero, IntPtr.Zero) || signaled;
                        return true;
                    }, IntPtr.Zero);
                }
            }
            return signaled;
        }

        private static string QuoteArgument(string value)
        {
            if (string.IsNullOrEmpty(value)) return "\"\"";
            StringBuilder quoted = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { backslashes += 1; continue; }
                if (character == '\"')
                {
                    quoted.Append('\\', backslashes * 2 + 1).Append('\"');
                    backslashes = 0;
                    continue;
                }
                quoted.Append('\\', backslashes).Append(character);
                backslashes = 0;
            }
            quoted.Append('\\', backslashes * 2).Append('\"');
            return quoted.ToString();
        }

        private async Task RunLauncherAsync()
        {
            Exception launchError = null;
            try
            {
                if (desktopStart)
                {
                    statusLabel.Text = L("正在启动 DeepSeek Harness…", "Starting DeepSeek Harness…");
                    Tuple<int, string> started = await Task.Run(() => InvokePortableCli(new[] { "start", "--no-browser", "--json" }));
                    if (started.Item1 != 0) { HandleFailure(started.Item1, started.Item2); return; }
                    backendStarted = true;
                    string url = JsonString(started.Item2, "url");
                    if (!IsTrustedLoopbackUrl(url))
                    {
                        HandleFailure(1, L("DeepSeek Harness 返回了无效的本地地址。\r\n", "DeepSeek Harness returned an invalid local address.\r\n") + started.Item2);
                        return;
                    }
                    int startupHold;
                    if (Int32.TryParse(Environment.GetEnvironmentVariable("DSH_PORTABLE_STARTUP_HOLD_MS"), out startupHold)
                        && startupHold > 0)
                        await Task.Delay(Math.Min(startupHold, 10000));
                    await ShowDesktopAsync(url);
                    await CheckForDesktopUpdateAsync(false);
                    return;
                }

                string[] command = launcherArgs;
                if (IsStartCommand(command) && !Array.Exists(command, item => string.Equals(item, "--no-browser", StringComparison.OrdinalIgnoreCase)))
                {
                    command = new string[launcherArgs.Length + 1];
                    Array.Copy(launcherArgs, command, launcherArgs.Length);
                    command[command.Length - 1] = "--no-browser";
                }
                Tuple<int, string> result = await Task.Run(() => InvokePortableCli(command));
                if (result.Item1 == 0)
                {
                    if (IsStopCommand(command)) await Task.Run(() => CloseOwnedDesktopHost());
                    operationRunning = false;
                    allowClose = true;
                    Close();
                    return;
                }
                HandleFailure(result.Item1, result.Item2.Length > 0
                    ? result.Item2
                    : L("DeepSeek Harness 无法完成请求的操作。", "DeepSeek Harness could not complete the requested operation."));
            }
            catch (Exception error) { launchError = error; }

            if (launchError != null)
            {
                if (desktopStart && backendStarted)
                {
                    try { await Task.Run(() => InvokePortableCli(new[] { "stop", "--no-browser", "--json" })); }
                    catch { }
                    backendStarted = false;
                }
                HandleFailure(1, launchError.Message);
            }
        }

        private async Task CheckForDesktopUpdateAsync(bool manual)
        {
            if (!manual && (!updateCheckEnabled
                || string.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_SKIP_UPDATE_CHECK"), "1", StringComparison.Ordinal))) return;
            if (manualUpdateRunning) return;
            if (manual) RestoreFromTray();
            manualUpdateRunning = true;
            RebuildTrayMenu();
            try
            {
                string[] checkArguments = manual
                    ? new[] { "check-update", "--json", "--force" }
                    : new[] { "check-update", "--json" };
                Tuple<int, string> check = await Task.Run(() => InvokePortableCli(checkArguments));
                if (check.Item1 != 0)
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("现在无法检查更新，请稍后再试。", "Updates could not be checked right now. Try again later."),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                string updateStatus = JsonString(check.Item2, "status");
                string current = JsonString(check.Item2, "productCurrent");
                string latest = JsonString(check.Item2, "latest");
                string engineCurrent = JsonString(check.Item2, "engineCurrent");
                string engineLatest = JsonString(check.Item2, "engineLatest");
                if (updateStatus == "current")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("你使用的已经是最新版。", "You're already using the latest version.")
                            + (String.IsNullOrEmpty(current) ? "" : "\r\n\r\nDSH-Portable " + current)
                            + (String.IsNullOrEmpty(engineCurrent) ? "" : "\r\n" + L("内置官方 DSH ", "Bundled official DSH ") + engineCurrent),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "unavailable")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("现在无法连接更新服务，请稍后再试。", "The update service is unavailable right now. Try again later."),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                if (updateStatus == "full-package-required")
                {
                    if (!trayBridgeReady)
                    {
                        if (!manual) return;
                        MessageBox.Show(this,
                            L("正在读取任务状态，请稍后再试。",
                              "Still reading the current task state. Try again in a moment."),
                            L("稍后更新", "Update later"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return;
                    }
                    if (trayState != null && trayState.hasRunningSession)
                    {
                        if (!manual) return;
                        MessageBox.Show(this,
                            L("任务仍在运行，本次不会中断它。任务完成后可从托盘再次检查更新。",
                              "A task is still running, so it will not be interrupted. Check again from the tray after it finishes."),
                            L("稍后更新", "Update later"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return;
                    }
                    int choice = await ShowUpdateChoiceAsync(current, latest, engineCurrent, engineLatest, true);
                    if (choice == 1) StartFullPackageUpdate();
                    else if (choice < 0) await Task.Run(() => InvokePortableCli(new[] { "ignore-update", "--json" }));
                    else await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--json" }));
                    return;
                }
                if (updateStatus != "available") return;

                if (!trayBridgeReady)
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        UpdateDescription(current, latest, engineCurrent, engineLatest, false) + "\r\n\r\n"
                            + L("为了确认不会中断任务，请稍后退出并重新打开；启动时可以选择“现在更新”或“稍后”。",
                                "To avoid interrupting work, exit and reopen when convenient; startup will offer Update now or Later."),
                        L("DSH-Portable 更新", "DSH-Portable update"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (trayState != null && trayState.hasRunningSession)
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("任务仍在运行，本次不会中断它。任务完成后退出并重新打开，启动时再选择是否更新。",
                          "A task is still running, so it will not be interrupted. When it finishes, exit and reopen the app to choose whether to update."),
                        L("稍后更新", "Update later"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                DialogResult accepted = MessageBox.Show(this,
                    UpdateDescription(current, latest, engineCurrent, engineLatest, false) + "\r\n\r\n"
                        + L("现在更新会短暂重启本地 DSH 服务。会话、设置、插件和工作区保持不变。\r\n\r\n现在更新吗？选择“否”可以稍后处理。",
                            "Updating now briefly restarts the local DSH service. Sessions, settings, plugins, and workspace stay in place.\r\n\r\nUpdate now? Choose No to do it later."),
                    L("DSH-Portable 更新", "DSH-Portable update"), MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (accepted != DialogResult.Yes)
                {
                    await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--json" }));
                    return;
                }
                await ApplyDesktopUpdateAsync();
            }
            catch (Exception error)
            {
                if (!manual) return;
                MessageBox.Show(this, error.Message,
                    L("更新失败", "Update failed"), MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                manualUpdateRunning = false;
                RebuildTrayMenu();
            }
        }

        private void ShowDesktopOperation(string message)
        {
            RestoreFromTray();
            webView.Enabled = false;
            launchContent.Size = new Size(504, 144);
            statusLabel.Location = new Point(80, 53);
            statusLabel.Size = new Size(400, 36);
            statusLabel.AutoEllipsis = true;
            statusLabel.Text = message;
            progress.Visible = true;
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 24;
            progressDetail.Text = L("正在准备…", "Preparing…");
            progressDetail.Visible = true;
            updateDescription.Visible = false;
            updateButton.Visible = false;
            skipUpdateButton.Visible = false;
            laterButton.Visible = false;
            detailsBox.Visible = false;
            copyButton.Visible = false;
            closeButton.Visible = false;
            launchPanel.Visible = true;
            launchPanel.BringToFront();
            CenterLaunchContent();
        }

        private async Task ApplyDesktopUpdateAsync()
        {
            ShowDesktopOperation(L("正在准备 DSH-Portable 更新…", "Preparing the DSH-Portable update…"));
            trayBridgeReady = false;
            Tuple<int, string> updated = await Task.Run(() => InvokePortableCli(
                new[] { "update", "--no-browser", "--json", "--progress-json" }, HandleUpdateProgress));
            if (updated.Item1 != 0)
            {
                await RestoreDesktopAfterUpdateAttemptAsync();
                throw new InvalidOperationException(updated.Item2);
            }
            string url = JsonString(updated.Item2, "url");
            if (!IsTrustedLoopbackUrl(url))
            {
                Tuple<int, string> status = await Task.Run(() => InvokePortableCli(new[] { "status", "--json" }));
                url = status.Item1 == 0 ? JsonString(status.Item2, "url") : String.Empty;
            }
            if (!IsTrustedLoopbackUrl(url)) throw new InvalidOperationException(L(
                "更新完成，但工作台没有返回可用的本地地址。请重新打开 DSH-Portable。",
                "The update finished, but the workspace did not return a usable local address. Reopen DSH-Portable."));
            await NavigateDesktopAsync(url);
            HideDesktopOperation();
            MessageBox.Show(this,
                L("DSH-Portable 更新已完成。", "The DSH-Portable update is complete."),
                L("DSH-Portable 已更新", "DSH-Portable updated"), MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void StartFullPackageUpdate()
        {
            string source = Path.Combine(root, "launcher", "DSH-FullUpdater.exe");
            if (!File.Exists(source)) throw new FileNotFoundException(L(
                "完整更新组件缺失，请重新安装当前版本后再试。",
                "The full update component is missing. Reinstall this version and try again."), source);
            string helper = Path.Combine(Path.GetTempPath(), "DSH-FullUpdater-" + Process.GetCurrentProcess().Id + ".exe");
            File.Copy(source, helper, true);
            Process.Start(new ProcessStartInfo
            {
                FileName = helper,
                Arguments = "--upgrade-existing --destination \"" + root.Replace("\"", "\\\"") + "\"",
                WorkingDirectory = Path.GetTempPath(),
                UseShellExecute = true,
            });
            allowClose = true;
            Close();
        }

        private async Task RestoreDesktopAfterUpdateAttemptAsync()
        {
            try
            {
                Tuple<int, string> status = await Task.Run(() => InvokePortableCli(new[] { "status", "--json" }));
                string url = status.Item1 == 0 ? JsonString(status.Item2, "url") : String.Empty;
                if (IsTrustedLoopbackUrl(url)) await NavigateDesktopAsync(url);
            }
            catch { }
            HideDesktopOperation();
        }

        private async Task NavigateDesktopAsync(string url)
        {
            applicationUri = new Uri(url);
            TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs> navigation =
                new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>();
            EventHandler<CoreWebView2NavigationCompletedEventArgs> completed = null;
            completed = delegate(object sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
            {
                webView.CoreWebView2.NavigationCompleted -= completed;
                navigation.TrySetResult(eventArgs);
            };
            webView.CoreWebView2.NavigationCompleted += completed;
            webView.CoreWebView2.Navigate(url);
            Task winner = await Task.WhenAny(navigation.Task, Task.Delay(WorkspaceNavigationTimeoutMs));
            if (winner != navigation.Task)
            {
                webView.CoreWebView2.NavigationCompleted -= completed;
                throw new TimeoutException(L("更新后的工作台未能在 60 秒内打开。", "The updated workspace did not open within 60 seconds."));
            }
            CoreWebView2NavigationCompletedEventArgs result = await navigation.Task;
            if (!result.IsSuccess) throw new InvalidOperationException(L("更新后的工作台加载失败：", "The updated workspace could not load: ") + result.WebErrorStatus);
            backendStarted = true;
        }

        private void HideDesktopOperation()
        {
            launchPanel.Visible = false;
            progressDetail.Visible = false;
            webView.Enabled = true;
            webView.Visible = true;
            webView.BringToFront();
        }

        private async Task ShowDesktopAsync(string url)
        {
            statusLabel.Text = L("正在打开工作台…", "Opening the workspace…");
            string userData = ResolveWebViewDataRoot();
            Directory.CreateDirectory(userData);
            try
            {
                CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions
                {
                    Language = UiLanguageTag,
                };
                string testBrowserArguments = Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS");
                if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_HIDDEN"), "1", StringComparison.Ordinal)
                    && !String.IsNullOrWhiteSpace(testBrowserArguments)
                    && Regex.IsMatch(testBrowserArguments, "^--remote-debugging-port=[0-9]{1,5}$"))
                {
                    options.AdditionalBrowserArguments = testBrowserArguments;
                }
                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userData, options);
                await webView.EnsureCoreWebView2Async(environment);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                throw new InvalidOperationException(
                    L(
                        "此电脑缺少 Microsoft Edge WebView2 Runtime。\r\n请安装官方 Evergreen Runtime 后重新打开：\r\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703",
                        "Microsoft Edge WebView2 Runtime is missing.\r\nInstall the official Evergreen Runtime, then open the app again:\r\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703"));
            }

            applicationUri = new Uri(url);
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
            webView.CoreWebView2.DownloadStarting += OnDownloadStarting;
            TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs> navigation =
                new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>();
            EventHandler<CoreWebView2NavigationCompletedEventArgs> navigationCompleted = delegate(object sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
            {
                navigation.TrySetResult(eventArgs);
            };
            webView.CoreWebView2.NavigationCompleted += navigationCompleted;
            webView.Source = applicationUri;

            Task completed = await Task.WhenAny(navigation.Task, Task.Delay(WorkspaceNavigationTimeoutMs));
            webView.CoreWebView2.NavigationCompleted -= navigationCompleted;
            if (completed != navigation.Task)
                throw new TimeoutException(L("DeepSeek Harness 工作台未能在 60 秒内打开。", "The DeepSeek Harness workspace did not open within 60 seconds."));
            CoreWebView2NavigationCompletedEventArgs result = await navigation.Task;
            if (!result.IsSuccess)
                throw new InvalidOperationException(L("DeepSeek Harness 工作台加载失败：", "The DeepSeek Harness workspace could not load: ") + result.WebErrorStatus);

            SuspendLayout();
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = true;
            MinimizeBox = true;
            MinimumSize = new Size(900, 620);
            RestoreDesktopWindowState();
            webView.Visible = true;
            webView.BringToFront();
            launchPanel.Visible = false;
            ResumeLayout(true);
            operationRunning = false;
            desktopReady = true;
            trayIcon.Visible = true;
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs eventArgs)
        {
            eventArgs.Handled = true;
            OpenExternalUrl(eventArgs.Uri);
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs eventArgs)
        {
            Uri target;
            if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out target)) { eventArgs.Cancel = true; return; }
            if (applicationUri != null && target.IsLoopback && target.Port == applicationUri.Port) return;
            eventArgs.Cancel = true;
            OpenExternalUrl(eventArgs.Uri);
        }

        private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs eventArgs)
        {
            eventArgs.Handled = true;
            string suggested = Path.GetFileName(eventArgs.ResultFilePath);
            if (String.IsNullOrWhiteSpace(suggested)) suggested = L("下载文件", "download");
            string downloads = GetDefaultDownloadFolder();
            string testDirectory = Environment.GetEnvironmentVariable("DSH_PORTABLE_DOWNLOAD_DIRECTORY");
            if (!String.IsNullOrWhiteSpace(testDirectory))
            {
                string resolved = Path.GetFullPath(testDirectory);
                if (!Directory.Exists(resolved)) throw new DirectoryNotFoundException(resolved);
                eventArgs.ResultFilePath = Path.Combine(resolved, suggested);
            }
            else using (SaveFileDialog dialog = new SaveFileDialog
            {
                AddExtension = true,
                CheckPathExists = true,
                FileName = suggested,
                Filter = L("所有文件 (*.*)|*.*", "All files (*.*)|*.*"),
                InitialDirectory = Directory.Exists(downloads) ? downloads : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                OverwritePrompt = true,
                RestoreDirectory = true,
                Title = L("保存下载文件", "Save download"),
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    eventArgs.Cancel = true;
                    PostDownloadStateSoon(eventArgs.DownloadOperation, "cancelled");
                    return;
                }
                eventArgs.ResultFilePath = dialog.FileName;
            }

            TrackDownloadOperation(eventArgs.DownloadOperation);
        }

        private void TrackDownloadOperation(CoreWebView2DownloadOperation operation)
        {
            string sessionId = QueryValue(operation.Uri, "sessionId");
            if (String.IsNullOrWhiteSpace(sessionId)) return;
            int lastPercent = -2;
            string lastState = String.Empty;
            EventHandler<object> changed = null;
            Action publish = delegate
            {
                if (IsDisposed || webView.CoreWebView2 == null) return;
                string state = "downloading";
                if (operation.State == CoreWebView2DownloadState.Completed) state = "completed";
                else if (operation.State == CoreWebView2DownloadState.Interrupted)
                    state = operation.InterruptReason == CoreWebView2DownloadInterruptReason.UserCanceled
                        ? "cancelled"
                        : "interrupted";
                ulong? total = operation.TotalBytesToReceive;
                long totalBytes = total.HasValue
                    ? (long)Math.Min(total.Value, (ulong)long.MaxValue)
                    : 0L;
                int percent = totalBytes > 0
                    ? (int)Math.Max(0, Math.Min(100, operation.BytesReceived * 100L / totalBytes))
                    : -1;
                if (state == lastState && percent == lastPercent) return;
                lastState = state;
                lastPercent = percent;
                PostDownloadState(operation, sessionId, state, percent, totalBytes);
                if (operation.State != CoreWebView2DownloadState.InProgress && changed != null)
                {
                    operation.BytesReceivedChanged -= changed;
                    operation.StateChanged -= changed;
                }
            };
            changed = delegate
            {
                if (IsDisposed) return;
                try { BeginInvoke((MethodInvoker)delegate { publish(); }); }
                catch (InvalidOperationException) { }
            };
            operation.BytesReceivedChanged += changed;
            operation.StateChanged += changed;
            BeginInvoke((MethodInvoker)delegate { publish(); });
        }

        private void PostDownloadStateSoon(CoreWebView2DownloadOperation operation, string state)
        {
            string sessionId = QueryValue(operation.Uri, "sessionId");
            if (String.IsNullOrWhiteSpace(sessionId)) return;
            Task.Delay(75).ContinueWith(delegate
            {
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate { PostDownloadState(operation, sessionId, state, -1, 0L); });
                }
                catch (InvalidOperationException) { }
            });
        }

        private void PostDownloadState(CoreWebView2DownloadOperation operation, string sessionId, string state, int percent, long totalBytes)
        {
            Dictionary<string, object> message = new Dictionary<string, object>
            {
                { "type", "dsh-portable/download" },
                { "schemaVersion", 1 },
                { "sessionId", sessionId },
                { "state", state },
                { "fileName", Path.GetFileName(operation.ResultFilePath) ?? String.Empty },
                { "bytesReceived", Math.Max(0L, operation.BytesReceived) },
                { "totalBytes", Math.Max(0L, totalBytes) },
                { "percent", percent },
                { "reason", operation.State == CoreWebView2DownloadState.Interrupted ? operation.InterruptReason.ToString() : String.Empty },
            };
            try { webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
            catch { }
        }

        private static string QueryValue(string uriText, string name)
        {
            Uri uri;
            if (!Uri.TryCreate(uriText, UriKind.Absolute, out uri)) return String.Empty;
            foreach (string pair in uri.Query.TrimStart('?').Split('&'))
            {
                if (String.IsNullOrEmpty(pair)) continue;
                string[] parts = pair.Split(new[] { '=' }, 2);
                if (!String.Equals(Uri.UnescapeDataString(parts[0].Replace('+', ' ')), name, StringComparison.Ordinal)) continue;
                return parts.Length > 1 ? Uri.UnescapeDataString(parts[1].Replace('+', ' ')) : String.Empty;
            }
            return String.Empty;
        }

        private static string GetDefaultDownloadFolder()
        {
            Guid downloadsFolder = new Guid("374DE290-123F-4565-9164-39C4925E467B");
            IntPtr path = IntPtr.Zero;
            try
            {
                if (SHGetKnownFolderPath(ref downloadsFolder, 0, IntPtr.Zero, out path) == 0 && path != IntPtr.Zero)
                {
                    string value = Marshal.PtrToStringUni(path);
                    if (!String.IsNullOrWhiteSpace(value)) return value;
                }
            }
            catch { }
            finally
            {
                if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path);
            }
            return Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SHGetKnownFolderPath(ref Guid folderId, uint flags, IntPtr token, out IntPtr path);

        private static void OpenExternalUrl(string url)
        {
            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed)) return;
            if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) return;
            Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
        }

        private string ResolveWebViewDataRoot()
        {
            if (File.Exists(Path.Combine(root, "installed-mode.json")))
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepSeek-Herness", "data", "webview2");
            return Path.Combine(root, "data", "webview2");
        }

        private static bool IsTrustedLoopbackUrl(string value)
        {
            Uri parsed;
            return Uri.TryCreate(value, UriKind.Absolute, out parsed)
                && parsed.Scheme == Uri.UriSchemeHttp && parsed.IsLoopback
                && parsed.Port >= 3080 && parsed.Port <= 3180;
        }

        private static string UpdateDescription(string current, string latest, string engineCurrent, string engineLatest, bool fullPackage)
        {
            string product = "DSH-Portable" + (String.IsNullOrEmpty(current) ? "" : " " + current)
                + (String.IsNullOrEmpty(latest) ? "" : "  →  " + latest);
            string engine;
            if (!String.IsNullOrEmpty(engineCurrent) && !String.IsNullOrEmpty(engineLatest)
                && !String.Equals(engineCurrent, engineLatest, StringComparison.Ordinal))
                engine = L("内置官方 DSH ", "Bundled official DSH ") + engineCurrent + "  →  " + engineLatest;
            else
                engine = L("内置官方 DSH ", "Bundled official DSH ")
                    + (!String.IsNullOrEmpty(engineLatest) ? engineLatest : engineCurrent)
                    + L("（本次不变）", " (unchanged)");
            string delivery = fullPackage
                ? L("交付方式：完整更新", "Delivery: complete package")
                : L("交付方式：轻量更新（仅下载已变更的 DSH 应用组件）", "Delivery: component update (only the changed DSH application component)");
            return product + "\r\n" + engine + "\r\n" + delivery;
        }

        private Task<int> ShowUpdateChoiceAsync(string current, string latest, string engineCurrent, string engineLatest, bool fullPackage)
        {
            progress.Visible = false;
            progressDetail.Visible = false;
            ClientSize = new Size(560, 280);
            launchContent.Size = new Size(504, 224);
            CenterLaunchContent();
            statusLabel.AutoEllipsis = false;
            statusLabel.Size = new Size(400, 34);
            statusLabel.Text = L("DSH-Portable 更新", "DSH-Portable update");
            updateDescription.Text = UpdateDescription(current, latest, engineCurrent, engineLatest, fullPackage);
            updateDescription.Size = new Size(456, 64);
            updateDescription.Visible = true;
            updateButton.Location = new Point(184, 174);
            skipUpdateButton.Location = new Point(304, 174);
            laterButton.Location = new Point(424, 174);
            updateButton.Text = L("现在更新", "Update now");
            updateButton.Visible = true;
            skipUpdateButton.Visible = true;
            laterButton.Visible = true;
            updateChoice = new TaskCompletionSource<int>();
            updateButton.Focus();
            return updateChoice.Task;
        }

        private void ResetOperationUi()
        {
            updateChoice = null;
            ClientSize = new Size(560, 220);
            launchContent.Size = new Size(504, 144);
            CenterLaunchContent();
            statusLabel.AutoEllipsis = true;
            statusLabel.Location = new Point(80, 53);
            statusLabel.Size = new Size(400, 36);
            statusLabel.ForeColor = Color.FromArgb(72, 72, 72);
            statusLabel.Text = IsStopCommand(launcherArgs)
                ? L("正在停止 DeepSeek Harness…", "Stopping DeepSeek Harness…")
                : L("正在启动 DeepSeek Harness…", "Starting DeepSeek Harness…");
            updateDescription.Visible = false;
            updateDescription.Size = new Size(456, 48);
            updateButton.Location = new Point(184, 154);
            skipUpdateButton.Location = new Point(304, 154);
            laterButton.Location = new Point(424, 154);
            updateButton.Visible = false;
            skipUpdateButton.Visible = false;
            laterButton.Visible = false;
            progressDetail.Visible = false;
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 24;
            progress.Value = 0;
            progress.Visible = true;
        }

        private void HandleUpdateProgress(string jsonLine)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(HandleUpdateProgress), jsonLine); return; }
            string phase = JsonString(jsonLine, "phase");
            if (phase == "downloading")
            {
                int percent = (int)Math.Max(0, Math.Min(100, JsonLong(jsonLine, "percent")));
                long current = JsonLong(jsonLine, "receivedBytes");
                long total = JsonLong(jsonLine, "totalBytes");
                statusLabel.Text = L("正在下载 DSH-Portable 更新…", "Downloading the DSH-Portable update…");
                progress.Style = ProgressBarStyle.Continuous;
                progress.MarqueeAnimationSpeed = 0;
                progress.Value = percent;
                progressDetail.Text = percent + "%  ·  " + FormatBytes(current) + " / " + FormatBytes(total);
            }
            else
            {
                progress.Style = ProgressBarStyle.Marquee;
                progress.MarqueeAnimationSpeed = 24;
                if (phase == "verifying") statusLabel.Text = L("正在验证 DSH-Portable 更新…", "Verifying the DSH-Portable update…");
                else if (phase == "installing") statusLabel.Text = L("正在安装 DSH-Portable 更新…", "Installing the DSH-Portable update…");
                else if (phase == "complete") statusLabel.Text = L("正在重新打开工作台…", "Reopening the workspace…");
                progressDetail.Text = phase == "complete" ? "100%" : L("会话、设置、插件和工作区保持不变", "Sessions, settings, plugins, and workspace stay in place");
            }
            progressDetail.Visible = true;
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes < 1024) return Math.Max(0, bytes) + " B";
            if (bytes < 1024L * 1024L) return (bytes / 1024D).ToString("0.0") + " KB";
            return (bytes / 1024D / 1024D).ToString("0.0") + " MB";
        }

        private static string JsonString(string json, string name)
        {
            Match match = Regex.Match(json ?? String.Empty, "\\\"" + Regex.Escape(name) + "\\\"\\s*:\\s*\\\"(?<value>(?:\\\\.|[^\\\"])*)\\\"");
            return match.Success ? Regex.Unescape(match.Groups["value"].Value) : String.Empty;
        }

        private static long JsonLong(string json, string name)
        {
            Match match = Regex.Match(json ?? String.Empty, "\\\"" + Regex.Escape(name) + "\\\"\\s*:\\s*(?<value>-?\\d+)");
            long value;
            return match.Success && Int64.TryParse(match.Groups["value"].Value, out value) ? value : 0;
        }

        private void HandleFailure(int exitCode, string message)
        {
            operationRunning = false;
            if (nonInteractive)
            {
                WriteNonInteractiveDiagnostic(message);
                Environment.ExitCode = exitCode != 0 ? exitCode : 1;
                allowClose = true;
                Close();
                return;
            }
            ShowFailure(message);
        }

        private static void WriteNonInteractiveDiagnostic(string message)
        {
            string filename = Environment.GetEnvironmentVariable("DSH_PORTABLE_LAUNCHER_DIAGNOSTIC");
            if (string.IsNullOrEmpty(filename)) return;
            try { File.WriteAllText(filename, message ?? string.Empty, Encoding.UTF8); }
            catch { }
        }

        private Tuple<int, string> InvokePortableCli(string[] actionArgs)
        {
            return InvokePortableCli(actionArgs, null);
        }

        private Tuple<int, string> InvokePortableCli(string[] actionArgs, Action<string> progressCallback)
        {
            string node = Path.Combine(root, "runtime", "node", "node.exe");
            string cli = Path.Combine(root, "launcher", "portable-cli.mjs");
            if (!File.Exists(node) || !File.Exists(cli))
                throw new InvalidOperationException(L(
                    "DSH-Portable 文件夹不完整。请完整解压后再启动。",
                    "This DSH-Portable folder is incomplete. Extract the entire package before starting it."));

            StringBuilder arguments = new StringBuilder(QuoteArgument(cli));
            foreach (string item in actionArgs) arguments.Append(" ").Append(QuoteArgument(item));
            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = node,
                Arguments = arguments.ToString(),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            if (File.Exists(Path.Combine(root, "installed-mode.json")) && string.IsNullOrEmpty(start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"]))
            {
                start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"] = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepSeek-Herness");
            }

            using (Process process = Process.Start(start))
            {
                Task<string> stderr = process.StandardError.ReadToEndAsync();
                List<string> stdout = new List<string>();
                string line;
                while ((line = process.StandardOutput.ReadLine()) != null)
                {
                    if (progressCallback != null && JsonString(line, "type") == "update-progress") progressCallback(line);
                    else if (!String.IsNullOrWhiteSpace(line)) stdout.Add(line);
                }
                process.WaitForExit();
                stderr.Wait();
                string message = (stderr.Result + Environment.NewLine + String.Join(Environment.NewLine, stdout)).Trim();
                return Tuple.Create(process.ExitCode, message);
            }
        }

        private void ShowFailure(string message)
        {
            operationRunning = false;
            launchPanel.Visible = true;
            webView.Visible = false;
            progress.Visible = false;
            ClientSize = new Size(640, 360);
            launchContent.Size = new Size(584, 304);
            CenterLaunchContent();
            MinimumSize = Size.Empty;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            statusLabel.AutoEllipsis = false;
            statusLabel.Location = new Point(80, 53);
            statusLabel.Size = new Size(480, 28);
            statusLabel.Text = IsStopCommand(launcherArgs)
                ? L("DeepSeek Harness 停止失败。", "DeepSeek Harness could not stop.")
                : L("DeepSeek Harness 启动失败。", "DeepSeek Harness could not start.");
            statusLabel.ForeColor = Color.FromArgb(178, 38, 38);
            detailsBox.Text = message ?? string.Empty;
            detailsBox.Visible = true;
            copyButton.Visible = true;
            closeButton.Location = new Point(468, 252);
            closeButton.Visible = true;
            AcceptButton = closeButton;
            ActiveControl = closeButton;
        }
    }

    internal static class TaskbarIdentity
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct PropertyKey
        {
            public Guid FormatId;
            public uint PropertyId;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct PropVariant
        {
            [FieldOffset(0)] public ushort VariantType;
            [FieldOffset(8)] public IntPtr PointerValue;
        }

        [ComImport]
        [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPropertyStore
        {
            [PreserveSig] int GetCount(out uint propertyCount);
            [PreserveSig] int GetAt(uint propertyIndex, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
            [PreserveSig] int Commit();
        }

        [DllImport("shell32.dll", PreserveSig = true)]
        private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid interfaceId, out IPropertyStore propertyStore);

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropVariant value);

        internal static void Apply(IntPtr window, string appId)
        {
            Guid interfaceId = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
            IPropertyStore store;
            int result = SHGetPropertyStoreForWindow(window, ref interfaceId, out store);
            if (result != 0) Marshal.ThrowExceptionForHR(result);
            PropertyKey key = new PropertyKey
            {
                FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
                PropertyId = 5,
            };
            PropVariant value = new PropVariant
            {
                VariantType = 31,
                PointerValue = Marshal.StringToCoTaskMemUni(appId),
            };
            try
            {
                result = store.SetValue(ref key, ref value);
                if (result != 0) Marshal.ThrowExceptionForHR(result);
                result = store.Commit();
                if (result != 0) Marshal.ThrowExceptionForHR(result);
            }
            finally
            {
                PropVariantClear(ref value);
                Marshal.ReleaseComObject(store);
            }
        }
    }

    internal static class Program
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

        [STAThread]
        private static void Main(string[] args)
        {
            SetCurrentProcessExplicitAppUserModelID("io.github.wsl043.dsh-portable");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if ((args == null || args.Length == 0) && LauncherWindow.SignalExistingDesktopHost(LauncherWindow.WmPortableRestore))
                return;
            Application.Run(new LauncherWindow(args));
        }
    }
}
