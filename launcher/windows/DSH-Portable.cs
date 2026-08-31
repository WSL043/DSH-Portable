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

[assembly: AssemblyTitle("DeepSeek-Herness")]
[assembly: AssemblyDescription("Native desktop host for DeepSeek Harness")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyProduct("DeepSeek-Herness")]
[assembly: AssemblyCopyright("Copyright © WSL043 2026")]
[assembly: AssemblyVersion("0.6.0.2")]
[assembly: AssemblyFileVersion("0.6.0.2")]

namespace DshPortable
{
    internal sealed class TrayBridgeSession
    {
        public string id { get; set; }
        public string title { get; set; }
        public long updatedAt { get; set; }
        public bool running { get; set; }
        public bool completed { get; set; }
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


    internal sealed class DshActivityRing : Control
    {
        private readonly System.Windows.Forms.Timer animationTimer;
        private bool indeterminate = true;
        private int progressValue;
        private int rotation;

        internal DshActivityRing()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            TrackColor = Color.FromArgb(226, 228, 232);
            IndicatorColor = Color.FromArgb(27, 28, 30);
            animationTimer = new System.Windows.Forms.Timer { Interval = 16, Enabled = true };
            animationTimer.Tick += delegate
            {
                rotation = (rotation + 7) % 360;
                Invalidate();
            };
        }

        internal Color TrackColor { get; set; }
        internal Color IndicatorColor { get; set; }

        internal bool Indeterminate
        {
            get { return indeterminate; }
            set
            {
                indeterminate = value;
                animationTimer.Enabled = value && Visible;
                Invalidate();
            }
        }

        internal int Value
        {
            get { return progressValue; }
            set { progressValue = Math.Max(0, Math.Min(100, value)); Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs eventArgs)
        {
            base.OnPaint(eventArgs);
            eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float stroke = 2F;
            float diameter = Math.Max(2F, Math.Min(Width, Height) - stroke - 1F);
            RectangleF bounds = new RectangleF(
                (Width - diameter) / 2F,
                (Height - diameter) / 2F,
                diameter,
                diameter);
            using (Pen track = new Pen(TrackColor, stroke))
                eventArgs.Graphics.DrawEllipse(track, bounds);
            float sweep = indeterminate
                ? 72F
                : progressValue >= 100 ? 359.9F : Math.Max(0F, 360F * progressValue / 100F);
            if (sweep > 0F)
            {
                using (Pen indicator = new Pen(IndicatorColor, stroke))
                {
                    indicator.StartCap = LineCap.Round;
                    indicator.EndCap = LineCap.Round;
                    eventArgs.Graphics.DrawArc(indicator, bounds, indeterminate ? rotation - 90F : -90F, sweep);
                }
            }
        }

        protected override void OnVisibleChanged(EventArgs eventArgs)
        {
            base.OnVisibleChanged(eventArgs);
            animationTimer.Enabled = Visible && indeterminate;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) animationTimer.Dispose();
            base.Dispose(disposing);
        }
    }

    internal sealed class LauncherWindow : Form
    {
        private const int WmClose = 0x0010;
        private const uint GwOwner = 4;
        private enum WindowCloseBehavior { Tray, Exit }

        private static string uiLanguage = CultureInfo.InstalledUICulture.TwoLetterISOLanguageName;
        private enum DwmWindowCornerPreference { Default = 0, DoNotRound = 1, Round = 2, RoundSmall = 3 }
        private const int DwmwaUseImmersiveDarkMode = 20;
        private const int DwmwaWindowCornerPreference = 33;
        private const int DwmwaBorderColor = 34;
        private const int DwmwaCaptionColor = 35;
        private const int DwmwaTextColor = 36;
        private const int WorkspaceNavigationTimeoutMs = 60000;
        private const int WebViewShutdownTimeoutMs = 10000;
        private const int WebViewGracefulShutdownMs = 1500;
        private const int WebViewResourceInUseHResult = unchecked((int)0x800700AA);
        private const int WebViewInitializationMaxAttempts = 4;

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
        private readonly DshActivityRing activityRing;
        private readonly Label progressDetail;
        private readonly TextBox detailsBox;
        private readonly Button copyButton;
        private readonly Button closeButton;
        private WebView2 webView;
        private readonly NotifyIcon trayIcon;
        private readonly ContextMenuStrip trayMenu;
        private readonly ToolStripMenuItem closeBehaviorItem;
        private readonly ToolStripMenuItem checkUpdateItem;
        private readonly ToolStripMenuItem checkEngineUpdateItem;
        private readonly ToolStripMenuItem automaticUpdateCheckItem;
        private readonly ToolStripMenuItem taskNotificationsItem;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Dictionary<string, bool> taskCompletionState = new Dictionary<string, bool>(StringComparer.Ordinal);
        private readonly string root;
        private readonly string environmentId;
        private readonly string stateRoot;
        private readonly string startupId;
        private readonly long startupStartedAt;
        private readonly int restoreMessage;
        private readonly int exitMessage;
        private readonly string[] launcherArgs;
        private readonly bool nonInteractive;
        private readonly bool desktopStart;
        private readonly bool hiddenForAutomation;
        private bool operationRunning = true;
        private bool desktopReady;
        private bool startupTraceActive;
        private bool shutdownRunning;
        private bool restartAfterShutdown;
        private bool allowClose;
        private bool backendStarted;
        private bool trayNoticeShown;
        private bool trayBridgeReady;
        private bool trayMenuOpen;
        private bool trayMenuRefreshPending;
        private bool updateCheckRunning;
        private bool updateInteractionRunning;
        private bool updateCheckEnabled;
        private bool engineUpdateCheckEnabled;
        private string updateChannel;
        private bool taskNotificationsEnabled;
        private bool taskCompletionBaselineReady;
        private WindowCloseBehavior closeBehavior;
        private FormWindowState windowStateBeforeHide = FormWindowState.Normal;
        private TrayBridgeState trayState;
        private string trayTheme = "light";
        private string notificationSessionId;
        private Uri applicationUri;
        private readonly List<string> webViewStartupTrace = new List<string>();
        private Stopwatch webViewStartupClock;
        private TaskCompletionSource<string> webViewProcessFailure;
        private TaskCompletionSource<string> workspaceSurfaceReady;
        private CoreWebView2Environment webViewEnvironment;
        private TaskCompletionSource<CoreWebView2BrowserProcessExitedEventArgs> webViewBrowserExited;
        private int ownedWebViewBrowserProcessId;
        private bool testWebViewBusyInjected;

        internal LauncherWindow(string[] args, string selectedEnvironmentId, string selectedStateRoot, int environmentRestoreMessage, int environmentExitMessage)
        {
            root = Path.GetDirectoryName(Application.ExecutablePath);
            environmentId = selectedEnvironmentId;
            stateRoot = selectedStateRoot;
            restoreMessage = environmentRestoreMessage;
            exitMessage = environmentExitMessage;
            launcherArgs = ResolveArguments(args);
            nonInteractive = Array.Exists(launcherArgs, item =>
                string.Equals(item, "--json", StringComparison.OrdinalIgnoreCase)
                || string.Equals(item, "--diagnostic-root-json", StringComparison.OrdinalIgnoreCase));
            bool testHidden = String.Equals(
                Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_HIDDEN"),
                "1",
                StringComparison.Ordinal);
            hiddenForAutomation = testHidden;
            desktopStart = !nonInteractive && IsStartCommand(launcherArgs);
            startupId = Guid.NewGuid().ToString("N");
            startupStartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            startupTraceActive = desktopStart;
            if (desktopStart)
            {
                BeginStartupTrace();
                AppendStartupTrace("native-host", "process-start", null);
            }

            // The workspace already carries the product identity. Keep the native
            // caption visually quiet instead of repeating it above the DSH shell.
            Text = desktopStart ? String.Empty : "DeepSeek-Herness";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            ShowIcon = false;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = desktopStart ? FormBorderStyle.Sizable : FormBorderStyle.FixedSingle;
            MaximizeBox = desktopStart;
            MinimizeBox = desktopStart;
            // Reveal the desktop only after the official DSH WebView boot
            // surface is ready, so startup remains one continuous surface.
            ShowInTaskbar = !nonInteractive && !testHidden && !desktopStart;
            if (nonInteractive) Opacity = 0;
            else if (testHidden) Opacity = 1;
            else if (desktopStart) Opacity = 0;
            ClientSize = desktopStart ? new Size(1280, 820) : new Size(440, 160);
            MinimumSize = desktopStart ? new Size(900, 620) : Size.Empty;
            BackColor = SystemColors.Window;
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

            launchPanel = new Panel { Dock = DockStyle.Fill, BackColor = SystemColors.Window };
            launchContent = new Panel
            {
                Size = desktopStart ? new Size(360, 112) : new Size(504, 144),
                BackColor = SystemColors.Window,
            };
            launchPanel.Resize += delegate { CenterLaunchContent(); };
            productIcon = new PictureBox
            {
                Location = desktopStart ? new Point(0, 8) : new Point(24, 20),
                Size = desktopStart ? new Size(36, 36) : new Size(40, 40),
                SizeMode = PictureBoxSizeMode.Zoom,
                Image = Icon == null ? null : Icon.ToBitmap(),
            };
            productLabel = new Label
            {
                AutoSize = false,
                Location = desktopStart ? new Point(52, 4) : new Point(80, 18),
                Size = desktopStart ? new Size(308, 30) : new Size(400, 30),
                Text = "DeepSeek Harness",
                Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold, GraphicsUnit.Point),
            };
            statusLabel = new Label
            {
                AutoEllipsis = true,
                Location = desktopStart ? new Point(52, 36) : new Point(80, 53),
                Size = desktopStart ? new Size(308, 28) : new Size(400, 36),
                ForeColor = Color.FromArgb(72, 72, 72),
                Text = IsStopCommand(launcherArgs)
                    ? L("正在停止 DeepSeek Harness…", "Stopping DeepSeek Harness…")
                    : L("正在启动 DeepSeek Harness…", "Starting DeepSeek Harness…"),
            };
            activityRing = new DshActivityRing
            {
                Location = desktopStart ? new Point(170, 40) : new Point(268, 108),
                Size = new Size(20, 20),
                Indeterminate = true,
            };
            progressDetail = new Label
            {
                AutoEllipsis = true,
                Location = desktopStart ? new Point(0, 64) : new Point(24, 84),
                Size = desktopStart ? new Size(360, 20) : new Size(456, 20),
                ForeColor = Color.FromArgb(97, 102, 107),
                TextAlign = ContentAlignment.MiddleLeft,
                Visible = false,
            };
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
            launchContent.Controls.Add(activityRing);
            launchContent.Controls.Add(detailsBox);
            launchContent.Controls.Add(copyButton);
            launchContent.Controls.Add(closeButton);
            launchPanel.Controls.Add(launchContent);
            if (desktopStart)
                ConfigureDesktopLoadingSurface("Loading plugins…", false);

            closeBehavior = LoadCloseBehavior();
            updateCheckEnabled = LoadUpdateCheckEnabled("productUpdateCheckEnabled");
            engineUpdateCheckEnabled = LoadUpdateCheckEnabled("engineUpdateCheckEnabled");
            updateChannel = LoadUpdateChannel();
            taskNotificationsEnabled = LoadTaskNotificationsEnabled();
            closeBehaviorItem = new ToolStripMenuItem(L("关闭窗口时", "When closing"));
            closeBehaviorItem.Click += delegate
            {
                SaveCloseBehavior(closeBehavior == WindowCloseBehavior.Tray
                    ? WindowCloseBehavior.Exit
                    : WindowCloseBehavior.Tray);
                RebuildTrayMenu();
            };
            checkUpdateItem = new ToolStripMenuItem(L("检查 DSH-Portable 更新", "Check DSH-Portable updates"));
            checkUpdateItem.Click += async delegate { await CheckForDesktopUpdateAsync(true, "product"); };
            checkEngineUpdateItem = new ToolStripMenuItem(L("检查 DSH 内核更新", "Check DSH core updates"));
            checkEngineUpdateItem.Click += async delegate { await CheckForDesktopUpdateAsync(true, "engine"); };
            automaticUpdateCheckItem = new ToolStripMenuItem(L("启动时检查更新", "Check for updates at startup"))
            {
                Checked = updateCheckEnabled,
                CheckOnClick = false,
            };
            automaticUpdateCheckItem.Click += delegate
            {
                bool enabled = !(updateCheckEnabled && engineUpdateCheckEnabled);
                updateCheckEnabled = enabled;
                engineUpdateCheckEnabled = enabled;
                RefreshAutomaticUpdateCheckItem();
                SaveLauncherSettings();
            };
            taskNotificationsItem = new ToolStripMenuItem(L("任务完成通知", "Task completion notifications"))
            {
                Checked = taskNotificationsEnabled,
                CheckOnClick = false,
            };
            taskNotificationsItem.Click += delegate
            {
                taskNotificationsEnabled = !taskNotificationsEnabled;
                RefreshTaskNotificationsItem();
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
            trayIcon.BalloonTipClicked += delegate
            {
                string sessionId = notificationSessionId;
                notificationSessionId = null;
                RestoreFromTray();
                if (!String.IsNullOrEmpty(sessionId)) PostBridgeAction("open-session", sessionId);
            };

            webView = CreateDesktopWebView();
            Controls.Add(webView);
            Controls.Add(launchPanel);
            launchPanel.Visible = !desktopStart;
            if (launchPanel.Visible) launchPanel.BringToFront();
            if (desktopStart)
            {
                RestoreDesktopWindowState();
                if (testHidden) Location = new Point(-32000, -32000);
                FitWebViewToClient();
                ApplyDesktopWindowCorners();
                ApplyDesktopChrome();
            }
            CenterLaunchContent();
            ResizeEnd += delegate { SaveDesktopWindowState(); };
            Shown += async delegate
            {
                if (desktopStart)
                {
                    FitWebViewToClient();
                    ApplyDesktopWindowCorners();
                    ApplyDesktopChrome();
                }
                await RunLauncherAsync();
            };
            if (desktopStart) RegisterDesktopHostProcess();
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
            base.WndProc(ref message);
        }

        private void ApplyDesktopChrome()
        {
            bool dark = String.Equals(trayTheme, "dark", StringComparison.OrdinalIgnoreCase);
            Color background = dark ? Color.FromArgb(24, 24, 26) : Color.FromArgb(248, 248, 248);
            Color foreground = dark ? Color.FromArgb(235, 235, 235) : Color.FromArgb(35, 35, 35);
            BackColor = background;
            launchPanel.BackColor = background;
            launchContent.BackColor = background;
            productLabel.BackColor = background;
            productLabel.ForeColor = foreground;
            statusLabel.BackColor = background;
            statusLabel.ForeColor = dark ? Color.FromArgb(178, 178, 184) : Color.FromArgb(92, 95, 101);
            progressDetail.BackColor = background;
            progressDetail.ForeColor = statusLabel.ForeColor;
            activityRing.TrackColor = dark ? Color.FromArgb(53, 53, 57) : Color.FromArgb(226, 228, 232);
            activityRing.IndicatorColor = dark ? Color.FromArgb(242, 242, 244) : Color.FromArgb(27, 28, 30);
            if (webView != null && !webView.IsDisposed) webView.DefaultBackgroundColor = background;
            if (desktopStart && IsHandleCreated)
            {
                int darkMode = dark ? 1 : 0;
                uint caption = ToColorRef(background);
                uint text = ToColorRef(foreground);
                uint border = caption;
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
                notificationSessionId = null;
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

        private void ConfigureDesktopLoadingSurface(string message, bool showDetail)
        {
            launchContent.Size = new Size(360, showDetail ? 164 : 140);
            productIcon.Location = new Point(162, 0);
            productIcon.Size = new Size(36, 36);
            productIcon.Visible = true;
            productLabel.Text = "HARNESS";
            productLabel.Location = new Point(0, 44);
            productLabel.Size = new Size(360, 24);
            productLabel.TextAlign = ContentAlignment.MiddleCenter;
            productLabel.Font = new Font("Segoe UI Semibold", 12F, FontStyle.Bold, GraphicsUnit.Point);
            activityRing.Location = new Point(170, 80);
            activityRing.Size = new Size(20, 20);
            activityRing.Indeterminate = true;
            activityRing.Value = 0;
            activityRing.Visible = true;
            statusLabel.Location = new Point(0, 112);
            statusLabel.Size = new Size(360, 20);
            statusLabel.AutoEllipsis = true;
            statusLabel.TextAlign = ContentAlignment.MiddleCenter;
            statusLabel.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            statusLabel.Text = message;
            progressDetail.Location = new Point(0, 140);
            progressDetail.Size = new Size(360, 20);
            progressDetail.TextAlign = ContentAlignment.MiddleCenter;
            progressDetail.Visible = showDetail;
            detailsBox.Visible = false;
            copyButton.Visible = false;
            closeButton.Visible = false;
            CenterLaunchContent();
        }

        private ToolStripMenuItem CreateTerminalItem()
        {
            return new ToolStripMenuItem(L("DSH 终端", "DSH Terminal"), null, delegate
            {
                try
                {
                    string root = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
                    string command = Path.Combine(root, "dsh.exe");
                    if (!File.Exists(command)) throw new FileNotFoundException("DSH command launcher is missing.", command);
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = command,
                        Arguments = "--terminal --environment " + QuoteArgument(environmentId),
                        WorkingDirectory = root,
                        UseShellExecute = true,
                        WindowStyle = ProcessWindowStyle.Normal,
                    });
                }
                catch (Exception error)
                {
                    MessageBox.Show(
                        this,
                        L("无法打开 DSH 终端。\n\n", "Could not open DSH Terminal.\n\n") + error.Message,
                        "DeepSeek-Herness",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
            });
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
            checkUpdateItem.Text = updateCheckRunning
                ? L("正在检查…", "Checking…")
                : L("检查 DSH-Portable 更新", "Check DSH-Portable updates");
            checkUpdateItem.Enabled = !updateCheckRunning && !updateInteractionRunning;
            checkEngineUpdateItem.Text = updateCheckRunning
                ? L("正在检查…", "Checking…")
                : L("检查 DSH 内核更新", "Check DSH core updates");
            checkEngineUpdateItem.Enabled = !updateCheckRunning && !updateInteractionRunning;
            RefreshAutomaticUpdateCheckItem();
            RefreshTaskNotificationsItem();
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
                more.DropDownItems.Add(checkEngineUpdateItem);
                more.DropDownItems.Add(automaticUpdateCheckItem);
                more.DropDownItems.Add(taskNotificationsItem);
                more.DropDownItems.Add(closeBehaviorItem);
                more.DropDownItems.Add(new ToolStripSeparator());
                more.DropDownItems.Add(CreateTerminalItem());
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
            automaticUpdateCheckItem.ShortcutKeyDisplayString = updateCheckEnabled && engineUpdateCheckEnabled
                ? L("已开启", "On")
                : !updateCheckEnabled && !engineUpdateCheckEnabled
                    ? L("已关闭", "Off")
                    : L("部分开启", "Custom");
            automaticUpdateCheckItem.Invalidate();
        }

        private void RefreshTaskNotificationsItem()
        {
            taskNotificationsItem.Text = L("任务完成通知", "Task completion notifications");
            taskNotificationsItem.Checked = false;
            taskNotificationsItem.ShowShortcutKeys = true;
            taskNotificationsItem.ShortcutKeyDisplayString = taskNotificationsEnabled
                ? L("已开启", "On")
                : L("已关闭", "Off");
            taskNotificationsItem.Invalidate();
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
            ApplyTrayItemTheme(trayMenu.Items, rootWidth, colors.TextColor, colors.CaptionColor, trayMenu.BackColor, colors.SelectedColor);
            FixTrayDropDownSize(trayMenu, rootWidth);
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
                    ApplyTrayItemTheme(menuItem.DropDownItems, childWidth, foreground, caption, background, selected);
                    FixTrayDropDownSize(menuItem.DropDown, childWidth);
                }
            }
        }

        private static void FixTrayDropDownSize(ToolStripDropDown dropDown, int width)
        {
            int preferredHeight = dropDown.Padding.Vertical + 4;
            foreach (ToolStripItem item in dropDown.Items)
            {
                if (item.Available) preferredHeight += item.Height;
            }
            dropDown.AutoSize = false;
            dropDown.MinimumSize = new Size(width, preferredHeight);
            dropDown.MaximumSize = new Size(width, preferredHeight);
            dropDown.Size = new Size(width, preferredHeight);
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

        private void HandleTaskCompletionNotifications(TrayBridgeState state)
        {
            List<TrayBridgeSession> sessions = state.sessions ?? new List<TrayBridgeSession>();
            List<TrayBridgeSession> completedThisFrame = new List<TrayBridgeSession>();
            if (!taskCompletionBaselineReady)
            {
                taskCompletionState.Clear();
                foreach (TrayBridgeSession session in sessions)
                {
                    if (session != null && !String.IsNullOrWhiteSpace(session.id))
                        taskCompletionState[session.id] = session.completed;
                }
                taskCompletionBaselineReady = true;
                return;
            }

            foreach (TrayBridgeSession session in sessions)
            {
                if (session == null || String.IsNullOrWhiteSpace(session.id)) continue;
                bool previouslyCompleted;
                bool wasCompleted = taskCompletionState.TryGetValue(session.id, out previouslyCompleted) && previouslyCompleted;
                if (session.completed && !wasCompleted && taskNotificationsEnabled)
                    completedThisFrame.Add(session);
            }

            if (completedThisFrame.Count > 0) ShowTaskCompletionNotifications(completedThisFrame);

            taskCompletionState.Clear();
            foreach (TrayBridgeSession session in sessions)
            {
                if (session != null && !String.IsNullOrWhiteSpace(session.id))
                    taskCompletionState[session.id] = session.completed;
            }
        }

        private void ShowTaskCompletionNotifications(List<TrayBridgeSession> sessions)
        {
            if (sessions == null || sessions.Count == 0) return;
            trayIcon.Visible = true;
            if (sessions.Count == 1)
            {
                TrayBridgeSession session = sessions[0];
                notificationSessionId = session.id;
                trayIcon.ShowBalloonTip(5000,
                    L("任务已完成", "Task completed"),
                    MenuTitle(session.title).Replace("&&", "&"),
                    ToolTipIcon.Info);
                return;
            }

            notificationSessionId = null;
            trayIcon.ShowBalloonTip(5000,
                L("多个任务已完成", "Tasks completed"),
                L("已完成 " + sessions.Count.ToString() + " 个任务。", sessions.Count.ToString() + " tasks completed."),
                ToolTipIcon.Info);
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
            bool trustedSource = applicationUri != null
                && Uri.TryCreate(eventArgs.Source, UriKind.Absolute, out source)
                && source.IsLoopback
                && source.Port == applicationUri.Port;
            if (!trustedSource)
            {
                if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION"), "1", StringComparison.Ordinal))
                    WriteLauncherLog("workspace-picker", "web-message-rejected source=" + eventArgs.Source
                        + " expected=" + (applicationUri == null ? "" : SafeWorkspaceUrl(applicationUri.AbsoluteUri)));
                return;
            }
            try
            {
                Dictionary<string, object> message = json.Deserialize<Dictionary<string, object>>(eventArgs.WebMessageAsJson);
                object messageType;
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/boot-visible", StringComparison.Ordinal))
                {
                    RecordWebViewPhase("boot-visible-message");
                    BeginInvoke((MethodInvoker)RevealDesktopBootSurface);
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/surface-ready", StringComparison.Ordinal))
                {
                    RecordWebViewPhase("surface-ready-message");
                    if (workspaceSurfaceReady != null) workspaceSurfaceReady.TrySetResult("native-bridge");
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/preferences", StringComparison.Ordinal))
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        object value;
                        bool hasProduct = message.TryGetValue("productUpdateCheckEnabled", out value) && value is bool;
                        if (hasProduct) updateCheckEnabled = (bool)value;
                        if (message.TryGetValue("engineUpdateCheckEnabled", out value) && value is bool)
                            engineUpdateCheckEnabled = (bool)value;
                        if (message.TryGetValue("updateChannel", out value))
                        {
                            string requestedChannel = Convert.ToString(value);
                            if (String.Equals(requestedChannel, "stable", StringComparison.OrdinalIgnoreCase)
                                || String.Equals(requestedChannel, "candidate", StringComparison.OrdinalIgnoreCase))
                                updateChannel = requestedChannel.ToLowerInvariant();
                        }
                        if (!hasProduct && message.TryGetValue("updateCheckEnabled", out value) && value is bool)
                            updateCheckEnabled = engineUpdateCheckEnabled = (bool)value;
                        if (message.TryGetValue("taskNotificationsEnabled", out value) && value is bool)
                            taskNotificationsEnabled = (bool)value;
                        if (message.TryGetValue("closeBehavior", out value))
                            closeBehavior = String.Equals(Convert.ToString(value), "exit", StringComparison.OrdinalIgnoreCase)
                                ? WindowCloseBehavior.Exit : WindowCloseBehavior.Tray;
                        SaveLauncherSettings();
                        RebuildTrayMenu();
                    });
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/open-environment", StringComparison.Ordinal))
                {
                    object requestValue;
                    object environmentValue;
                    string requestId = message.TryGetValue("requestId", out requestValue)
                        ? Convert.ToString(requestValue)
                        : String.Empty;
                    string requestedEnvironment = message.TryGetValue("environment", out environmentValue)
                        ? Convert.ToString(environmentValue)
                        : String.Empty;
                    if (!Regex.IsMatch(requestId ?? String.Empty, "^environment-open-[A-Za-z0-9-]{1,96}$")) return;
                    BeginInvoke((MethodInvoker)delegate { OpenPortableEnvironment(requestId, requestedEnvironment); });
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/pick-directory", StringComparison.Ordinal))
                {
                    if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION"), "1", StringComparison.Ordinal))
                        WriteLauncherLog("workspace-picker", "web-message-received");
                    object requestValue;
                    string requestId = message.TryGetValue("requestId", out requestValue)
                        ? Convert.ToString(requestValue)
                        : String.Empty;
                    if (!Regex.IsMatch(requestId ?? String.Empty, "^workspace-[A-Za-z0-9-]{1,96}$")) return;
                    BeginInvoke((MethodInvoker)delegate { ShowWorkspaceDirectoryPicker(requestId); });
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/pick-data-export", StringComparison.Ordinal))
                {
                    object requestValue;
                    object kindValue;
                    string requestId = message.TryGetValue("requestId", out requestValue)
                        ? Convert.ToString(requestValue)
                        : String.Empty;
                    string kind = message.TryGetValue("kind", out kindValue) ? Convert.ToString(kindValue) : String.Empty;
                    if (!Regex.IsMatch(requestId ?? String.Empty, "^data-export-[A-Za-z0-9-]{1,96}$")) return;
                    if (!String.Equals(kind, "standard", StringComparison.Ordinal)
                        && !String.Equals(kind, "private", StringComparison.Ordinal)
                        && !String.Equals(kind, "support", StringComparison.Ordinal)) return;
                    BeginInvoke((MethodInvoker)delegate { ShowDataPackageSaveDialog(requestId, kind); });
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/pick-data-import", StringComparison.Ordinal))
                {
                    object requestValue;
                    string requestId = message.TryGetValue("requestId", out requestValue)
                        ? Convert.ToString(requestValue)
                        : String.Empty;
                    if (!Regex.IsMatch(requestId ?? String.Empty, "^data-import-[A-Za-z0-9-]{1,96}$")) return;
                    BeginInvoke((MethodInvoker)delegate { ShowDataPackageOpenDialog(requestId); });
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/import-data", StringComparison.Ordinal))
                {
                    object inputValue;
                    object passwordValue;
                    object conflictValue;
                    string input = message.TryGetValue("input", out inputValue) ? Convert.ToString(inputValue) : String.Empty;
                    string password = message.TryGetValue("password", out passwordValue) ? Convert.ToString(passwordValue) : String.Empty;
                    string conflict = message.TryGetValue("conflict", out conflictValue) ? Convert.ToString(conflictValue) : String.Empty;
                    if (!Path.IsPathRooted(input ?? String.Empty) || !File.Exists(input)) return;
                    if (!String.IsNullOrEmpty(password) && password.Length < 8) return;
                    if (!String.Equals(conflict, "keep", StringComparison.Ordinal)
                        && !String.Equals(conflict, "replace", StringComparison.Ordinal)) return;
                    BeginInvoke((MethodInvoker)delegate { BeginDataImport(input, password, conflict); });
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/restart-host", StringComparison.Ordinal))
                {
                    object requestValue;
                    string requestId = message.TryGetValue("requestId", out requestValue)
                        ? Convert.ToString(requestValue)
                        : String.Empty;
                    if (!Regex.IsMatch(requestId ?? String.Empty, "^host-restart-[A-Za-z0-9-]{1,96}$")) return;
                    BeginInvoke((MethodInvoker)delegate { HandleDesktopRestartRequest(requestId); });
                    return;
                }
                TrayBridgeState state = json.Deserialize<TrayBridgeState>(eventArgs.WebMessageAsJson);
                if (state == null || state.type != "dsh-portable/state" || state.schemaVersion != 1) return;
                if (state.sessions == null) state.sessions = new List<TrayBridgeSession>();
                if (state.sessions.Count > 10) state.sessions = state.sessions.Take(10).ToList();
                BeginInvoke((MethodInvoker)delegate
                {
                    uiLanguage = String.Equals(state.locale, "zh", StringComparison.OrdinalIgnoreCase) ? "zh" : "en";
                    trayTheme = String.Equals(state.theme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light";
                    ApplyDesktopChrome();
                    HandleTaskCompletionNotifications(state);
                    trayState = state;
                    trayBridgeReady = true;
                    RebuildTrayMenu();
                });
            }
            catch
            {
                // A malformed or future bridge payload cannot remove the native Open/Exit fallback.
            }
        }

        private void HandleDesktopRestartRequest(string requestId)
        {
            WriteLauncherLog("restart-host", "request-received id=" + requestId);
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "type", "dsh-portable/restart-host-result" },
                { "schemaVersion", 1 },
                { "requestId", requestId },
            };
            if (shutdownRunning)
            {
                result["ok"] = false;
                result["error"] = L("正在关闭，请稍候。", "The app is already closing.");
                WriteLauncherLog("restart-host", "request-refused id=" + requestId + " reason=shutdown-running");
            }
            else if (trayState != null && trayState.hasRunningSession)
            {
                result["ok"] = false;
                result["error"] = L("任务仍在运行；完成后再重启即可，当前任务不会被中断。",
                    "A task is still running. Restart after it finishes; the current task was not interrupted.");
                WriteLauncherLog("restart-host", "request-refused id=" + requestId + " reason=running-session");
            }
            else
            {
                result["ok"] = true;
                restartAfterShutdown = true;
                WriteLauncherLog("restart-host", "request-accepted id=" + requestId);
            }
            try
            {
                if (webView != null && webView.CoreWebView2 != null)
                {
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(result));
                    WriteLauncherLog("restart-host", "reply-posted id=" + requestId + " ok=" + Convert.ToString(result["ok"], CultureInfo.InvariantCulture).ToLowerInvariant());
                }
            }
            catch (Exception error)
            {
                WriteLauncherLog("restart-host", "reply-failed id=" + requestId + " error=" + error.GetType().Name);
            }
            if (restartAfterShutdown) BeginDesktopShutdown();
        }

        private void OpenPortableEnvironment(string requestId, string requestedEnvironment)
        {
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "type", "dsh-portable/open-environment-result" },
                { "schemaVersion", 1 },
                { "requestId", requestId },
            };
            string selected;
            try
            {
                selected = ResolveEnvironmentId(new[] { "--environment", requestedEnvironment });
                if (String.Equals(selected, environmentId, StringComparison.Ordinal)) RestoreFromTray();
                else
                {
                    string targetStateRoot = ResolveStateRoot(root, selected);
                    if (!String.Equals(selected, "default", StringComparison.Ordinal) && !Directory.Exists(targetStateRoot))
                        throw new DirectoryNotFoundException(L("这个环境已不存在。", "This environment no longer exists."));
                    PortableProcessJob.StartDetachedProcess(Application.ExecutablePath, new[] { "--environment", selected });
                }
                result["ok"] = true;
                result["environment"] = selected;
            }
            catch (Exception error)
            {
                result["ok"] = false;
                result["error"] = error.GetBaseException().Message;
            }
            try
            {
                if (webView != null && webView.CoreWebView2 != null)
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(result));
            }
            catch { }
        }

        private void ShowWorkspaceDirectoryPicker(string requestId)
        {
            if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION"), "1", StringComparison.Ordinal))
                WriteLauncherLog("workspace-picker", "dialog-open-requested");
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "type", "dsh-portable/pick-directory-result" },
                { "schemaVersion", 1 },
                { "requestId", requestId },
            };
            try
            {
                RestoreFromTray();
                Activate();
                BringToFront();
                using (FolderBrowserDialog dialog = new FolderBrowserDialog())
                {
                    dialog.Description = L("选择工作区文件夹", "Select a workspace folder");
                    dialog.ShowNewFolderButton = true;
                    string portableWorkspace = Path.Combine(stateRoot, "workspace");
                    if (Directory.Exists(portableWorkspace)) dialog.SelectedPath = portableWorkspace;
                    using (System.Threading.Timer automation = ArmOwnedDialogCancellationAutomation(Handle, "workspace-picker"))
                    {
                        DialogResult selection = dialog.ShowDialog(this);
                        if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION"), "1", StringComparison.Ordinal))
                            WriteLauncherLog("workspace-picker", "dialog-closed result=" + selection.ToString());
                        if (selection == DialogResult.OK && Directory.Exists(dialog.SelectedPath))
                            result["path"] = Path.GetFullPath(dialog.SelectedPath);
                        else
                            result["cancelled"] = true;
                    }
                }
            }
            catch (Exception error)
            {
                result["error"] = error.Message;
            }
            try
            {
                if (webView != null && webView.CoreWebView2 != null)
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(result));
            }
            catch { }
        }

        private System.Threading.Timer ArmOwnedDialogCancellationAutomation(IntPtr ownerHandle, string category)
        {
            if (!String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION"), "1", StringComparison.Ordinal))
                return null;
            int processId = Process.GetCurrentProcess().Id;
            int closeRequested = 0;
            return new System.Threading.Timer(delegate
            {
                if (System.Threading.Interlocked.CompareExchange(ref closeRequested, 0, 0) != 0) return;
                EnumWindows(delegate(IntPtr window, IntPtr ignored)
                {
                    if (window == ownerHandle || !IsWindowVisible(window)) return true;
                    uint windowProcessId;
                    GetWindowThreadProcessId(window, out windowProcessId);
                    if (windowProcessId != (uint)processId) return true;
                    IntPtr owner = GetWindow(window, GwOwner);
                    uint ownerProcessId;
                    GetWindowThreadProcessId(owner, out ownerProcessId);
                    if (owner == IntPtr.Zero || ownerProcessId != (uint)processId) return true;
                    if (System.Threading.Interlocked.CompareExchange(ref closeRequested, 1, 0) != 0) return false;
                    StringBuilder className = new StringBuilder(256);
                    GetClassName(window, className, className.Capacity);
                    WriteLauncherLog(category, "dialog-detected hwnd=" + window.ToInt64().ToString(CultureInfo.InvariantCulture)
                        + " owner=" + owner.ToInt64().ToString(CultureInfo.InvariantCulture)
                        + " class=" + className.ToString());
                    PostMessage(window, WmClose, IntPtr.Zero, IntPtr.Zero);
                    return false;
                }, IntPtr.Zero);
            }, null, 100, 100);
        }

        private void ShowDataPackageSaveDialog(string requestId, string kind)
        {
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "type", "dsh-portable/pick-data-export-result" },
                { "schemaVersion", 1 },
                { "requestId", requestId },
            };
            try
            {
                RestoreFromTray();
                Activate();
                BringToFront();
                string stamp = DateTime.Now.ToString("yyyy-MM-dd-HHmm", CultureInfo.InvariantCulture);
                bool support = String.Equals(kind, "support", StringComparison.Ordinal);
                string prefix = support
                    ? "DSH-Portable-support-"
                    : String.Equals(kind, "private", StringComparison.Ordinal)
                        ? "DSH-Portable-private-"
                        : "DSH-Portable-data-";
                string extension = support ? ".json" : ".dshdata";
                string automationDirectory = Environment.GetEnvironmentVariable("DSH_PORTABLE_DATA_EXPORT_DIRECTORY");
                if (!String.IsNullOrWhiteSpace(automationDirectory))
                {
                    string directory = Path.GetFullPath(automationDirectory);
                    Directory.CreateDirectory(directory);
                    result["path"] = Path.Combine(directory, prefix + stamp + extension);
                }
                else using (SaveFileDialog dialog = new SaveFileDialog
                {
                    AddExtension = true,
                    CheckPathExists = true,
                    DefaultExt = support ? "json" : "dshdata",
                    FileName = prefix + stamp + extension,
                    Filter = support
                        ? L("JSON 支持报告 (*.json)|*.json", "JSON support report (*.json)|*.json")
                        : L("DSH-Portable 数据包 (*.dshdata)|*.dshdata", "DSH-Portable data package (*.dshdata)|*.dshdata"),
                    InitialDirectory = GetDefaultDownloadFolder(),
                    OverwritePrompt = true,
                    RestoreDirectory = true,
                    Title = support
                        ? L("选择支持报告保存位置", "Choose where to save the support report")
                        : L("选择数据包保存位置", "Choose where to save the data package"),
                })
                {
                    using (System.Threading.Timer automation = ArmOwnedDialogCancellationAutomation(Handle, "data-export-dialog"))
                    {
                        DialogResult selection = dialog.ShowDialog(this);
                        if (selection == DialogResult.OK) result["path"] = Path.GetFullPath(dialog.FileName);
                        else result["cancelled"] = true;
                    }
                }
            }
            catch (Exception error)
            {
                result["error"] = error.Message;
            }
            try
            {
                if (webView != null && webView.CoreWebView2 != null)
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(result));
            }
            catch { }
        }

        private void ShowDataPackageOpenDialog(string requestId)
        {
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "type", "dsh-portable/pick-data-import-result" },
                { "schemaVersion", 1 },
                { "requestId", requestId },
            };
            try
            {
                RestoreFromTray();
                Activate();
                BringToFront();
                string automationFile = Environment.GetEnvironmentVariable("DSH_PORTABLE_DATA_IMPORT_FILE");
                if (!String.IsNullOrWhiteSpace(automationFile))
                {
                    string input = Path.GetFullPath(automationFile);
                    if (!File.Exists(input)) throw new FileNotFoundException("The data package does not exist.", input);
                    result["path"] = input;
                }
                else using (OpenFileDialog dialog = new OpenFileDialog
                {
                    AddExtension = true,
                    CheckFileExists = true,
                    CheckPathExists = true,
                    DefaultExt = "dshdata",
                    Filter = L("DSH-Portable 数据包 (*.dshdata)|*.dshdata", "DSH-Portable data package (*.dshdata)|*.dshdata"),
                    InitialDirectory = GetDefaultDownloadFolder(),
                    Multiselect = false,
                    RestoreDirectory = true,
                    Title = L("选择要导入的数据包", "Choose a data package to import"),
                })
                {
                    using (System.Threading.Timer automation = ArmOwnedDialogCancellationAutomation(Handle, "data-import-dialog"))
                    {
                        DialogResult selection = dialog.ShowDialog(this);
                        if (selection == DialogResult.OK) result["path"] = Path.GetFullPath(dialog.FileName);
                        else result["cancelled"] = true;
                    }
                }
            }
            catch (Exception error) { result["error"] = error.Message; }
            try
            {
                if (webView != null && webView.CoreWebView2 != null)
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(result));
            }
            catch { }
        }

        private async void BeginDataImport(string input, string password, string conflict)
        {
            if (shutdownRunning) return;
            shutdownRunning = true;
            operationRunning = true;
            ShowDesktopOperation(L("正在导入数据…", "Importing data…"));
            Tuple<int, string> stopped;
            try { stopped = await Task.Run(() => InvokePortableCli(new[] { "stop", "--no-browser", "--json" })); }
            catch (Exception error) { stopped = Tuple.Create(1, error.GetBaseException().Message); }
            if (stopped.Item1 != 0)
            {
                shutdownRunning = false;
                HideDesktopOperation();
                MessageBox.Show(this, stopped.Item2, L("无法开始导入", "Import could not start"), MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            backendStarted = false;
            string passwordFile = String.Empty;
            try
            {
                await WaitForWebViewExitAsync(WebViewShutdownTimeoutMs);
                List<string> args = new List<string> { "restore-data", "--input", Path.GetFullPath(input), "--conflict", conflict, "--json" };
                if (!String.IsNullOrEmpty(password))
                {
                    string runtime = Path.Combine(ResolveProductDataRoot(), "runtime");
                    Directory.CreateDirectory(runtime);
                    passwordFile = Path.Combine(runtime, "import-password-" + Guid.NewGuid().ToString("N") + ".txt");
                    File.WriteAllText(passwordFile, password, new UTF8Encoding(false));
                    args.Add("--password-file");
                    args.Add(passwordFile);
                }
                Tuple<int, string> imported = await Task.Run(() => InvokePortableCli(args.ToArray()));
                if (imported.Item1 != 0) throw new InvalidOperationException(imported.Item2);
                RestartAfterDataImport();
            }
            catch (Exception error)
            {
                string failure = L("数据导入失败。\r\n", "Data import failed.\r\n") + error.GetBaseException().Message;
                try
                {
                    MessageBox.Show(this, failure, L("数据导入失败", "Data import failed"), MessageBoxButtons.OK, MessageBoxIcon.Error);
                    RestartAfterDataImport();
                }
                catch (Exception restartError)
                {
                    ShowFailure(failure + Environment.NewLine + restartError.GetBaseException().Message);
                }
            }
            finally
            {
                if (!String.IsNullOrEmpty(passwordFile)) try { File.Delete(passwordFile); } catch { }
            }
        }

        private void RestartAfterDataImport()
        {
            PortableProcessJob.StartDetachedUpdater(Application.ExecutablePath, RestartArguments());
            allowClose = true;
            DisposeTrayIcon();
            Close();
        }

        private string[] RestartArguments()
        {
            List<string> result = new List<string>
            {
                "--dsh-restart-after-pid",
                Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture),
            };
            if (!String.Equals(environmentId, "default", StringComparison.Ordinal))
            {
                result.Add("--environment");
                result.Add(environmentId);
            }
            return result.ToArray();
        }

        private void DisposeTrayIcon()
        {
            trayIcon.Visible = false;
        }

        private string ResolveProductDataRoot()
        {
            return Path.Combine(stateRoot, "data");
        }

        private string LauncherSettingsPath()
        {
            string settingsRoot = String.Equals(environmentId, "default", StringComparison.Ordinal)
                ? stateRoot
                : Directory.GetParent(Directory.GetParent(stateRoot).FullName).FullName;
            return Path.Combine(settingsRoot, "data", "launcher-settings.json");
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

        private bool LoadUpdateCheckEnabled(string key)
        {
            try
            {
                string source = File.ReadAllText(LauncherSettingsPath(), Encoding.UTF8);
                Match explicitValue = Regex.Match(source, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
                if (explicitValue.Success) return String.Equals(explicitValue.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
                return Regex.IsMatch(source, "\\\"updateCheckEnabled\\\"\\s*:\\s*true", RegexOptions.IgnoreCase);
            }
            catch { return false; }
        }

        private bool LoadTaskNotificationsEnabled()
        {
            try
            {
                string source = File.ReadAllText(LauncherSettingsPath(), Encoding.UTF8);
                return !Regex.IsMatch(source, "\\\"taskNotificationsEnabled\\\"\\s*:\\s*false", RegexOptions.IgnoreCase);
            }
            catch { return true; }
        }

        private string LoadUpdateChannel()
        {
            try
            {
                string source = File.ReadAllText(LauncherSettingsPath(), Encoding.UTF8);
                Match explicitValue = Regex.Match(source, "\\\"updateChannel\\\"\\s*:\\s*\\\"(stable|candidate)\\\"", RegexOptions.IgnoreCase);
                if (explicitValue.Success) return explicitValue.Groups[1].Value.ToLowerInvariant();
            }
            catch { }
            try
            {
                string source = File.ReadAllText(Path.Combine(root, "licenses", "COMPONENTS.json"), Encoding.UTF8);
                if (Regex.IsMatch(source, "\\\"releaseChannel\\\"\\s*:\\s*\\\"candidate\\\"", RegexOptions.IgnoreCase)) return "candidate";
            }
            catch { }
            return "stable";
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
                "{\"schemaVersion\":2,\"closeBehavior\":\"" + close + "\",\"updateChannel\":\""
                    + (String.Equals(updateChannel, "candidate", StringComparison.OrdinalIgnoreCase) ? "candidate" : "stable")
                    + "\",\"updateCheckEnabled\":"
                    + (updateCheckEnabled ? "true" : "false") + ",\"productUpdateCheckEnabled\":"
                    + (updateCheckEnabled ? "true" : "false") + ",\"engineUpdateCheckEnabled\":"
                    + (engineUpdateCheckEnabled ? "true" : "false") + ",\"taskNotificationsEnabled\":"
                    + (taskNotificationsEnabled ? "true" : "false") + "}\r\n",
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
            UnregisterDesktopHostProcess();
            DisposeTrayIcon();
            trayIcon.Dispose();
            base.OnFormClosed(eventArgs);
        }

        private async void BeginDesktopShutdown()
        {
            if (shutdownRunning) return;
            shutdownRunning = true;
            WriteLauncherLog("shutdown", "begin hostPid="
                + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture)
                + " browserPid=" + ownedWebViewBrowserProcessId.ToString(CultureInfo.InvariantCulture)
                + " executable=" + Application.ExecutablePath
                + " processJob=" + PortableProcessJob.Status);
            trayIcon.Visible = true;
            webView.Enabled = false;
            Text = L("DeepSeek-Herness · 正在关闭", "DeepSeek-Herness · Closing");
            Tuple<int, string> result;
            try
            {
                result = await Task.Run(() => InvokePortableCli(new[] { "stop", "--no-browser", "--json" }));
            }
            catch (Exception error)
            {
                result = Tuple.Create(1, error.GetBaseException().Message);
            }
            if (result.Item1 != 0)
            {
                shutdownRunning = false;
                restartAfterShutdown = false;
                webView.Enabled = true;
                Text = "DeepSeek-Herness";
                MessageBox.Show(this, result.Item2, L("DeepSeek Harness 停止失败", "DeepSeek Harness could not stop"), MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            backendStarted = false;
            try
            {
                await WaitForWebViewExitAsync(WebViewShutdownTimeoutMs);
            }
            catch (Exception error)
            {
                Environment.ExitCode = 1;
                restartAfterShutdown = false;
                WriteLauncherLog("shutdown", "failed " + error.GetBaseException().Message.Replace("\r", " ").Replace("\n", " | "));
                ShowShutdownFailure(error.GetBaseException().Message);
                return;
            }

            allowClose = true;
            if (restartAfterShutdown)
            {
                WriteLauncherLog("restart-host", "relaunch-scheduled afterPid="
                    + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
                PortableProcessJob.StartDetachedUpdater(Application.ExecutablePath, RestartArguments());
            }
            DisposeTrayIcon();
            WriteLauncherLog("shutdown", "complete");
            Close();
        }

        private void OnWebViewBrowserProcessExited(object sender, CoreWebView2BrowserProcessExitedEventArgs eventArgs)
        {
            RecordWebViewPhase("browser-exited:" + eventArgs.BrowserProcessExitKind);
            if (webViewBrowserExited != null) webViewBrowserExited.TrySetResult(eventArgs);
        }

        private async Task WaitForWebViewExitAsync(int timeoutMs)
        {
            if (webViewEnvironment == null) return;
            CoreWebView2Environment closingEnvironment = webViewEnvironment;
            Task exited = webViewBrowserExited == null
                ? (Task)Task.FromResult<object>(null)
                : webViewBrowserExited.Task;

            WebView2 closingWebView = webView;
            webView = null;
            applicationUri = null;
            Exception controllerCloseError = null;
            if (closingWebView != null && !closingWebView.IsDisposed)
            {
                try
                {
                    closingWebView.Visible = false;
                    if (closingWebView.CoreWebView2 != null)
                    {
                        closingWebView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                        closingWebView.CoreWebView2.NewWindowRequested -= OnNewWindowRequested;
                        closingWebView.CoreWebView2.NavigationStarting -= OnNavigationStarting;
                        closingWebView.CoreWebView2.DownloadStarting -= OnDownloadStarting;
                        closingWebView.CoreWebView2.ProcessFailed -= OnWebViewProcessFailed;
                        closingWebView.CoreWebView2.Stop();
                    }
                    WriteLauncherLog("shutdown-webview", "controller-close-requested runtime="
                        + closingEnvironment.BrowserVersionString
                        + " browserPid=" + ownedWebViewBrowserProcessId.ToString(CultureInfo.InvariantCulture));
                    Controls.Remove(closingWebView);
                    closingWebView.Dispose();
                }
                catch (Exception error)
                {
                    controllerCloseError = error.GetBaseException();
                    WriteLauncherLog("shutdown-webview", "controller-close-error="
                        + controllerCloseError.GetType().Name + ":" + controllerCloseError.Message.Replace("\r", " ").Replace("\n", " | "));
                }
            }
            webViewProcessFailure = null;

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            DateTime gracefulDeadline = DateTime.UtcNow.AddMilliseconds(Math.Min(WebViewGracefulShutdownMs, timeoutMs));
            bool exitEventObserved = exited.IsCompleted;
            bool forceAttempted = false;
            List<string> remaining = new List<string>();
            while (DateTime.UtcNow < deadline)
            {
                remaining = await Task.Run(() => OwnedWebViewProcessDiagnostics());
                if (remaining.Count == 0)
                {
                    closingEnvironment.BrowserProcessExited -= OnWebViewBrowserProcessExited;
                    webViewEnvironment = null;
                    webViewBrowserExited = null;
                    ownedWebViewBrowserProcessId = 0;
                    WriteLauncherLog("shutdown-webview", exitEventObserved
                        ? "browser-process-exited"
                        : "process-tree-empty-without-event");
                    return;
                }

                if (!forceAttempted && DateTime.UtcNow >= gracefulDeadline)
                {
                    forceAttempted = true;
                    bool forced = await Task.Run(() => TryForceReleaseOwnedWebViewProcesses(remaining));
                    WriteLauncherLog("shutdown-webview", forced
                        ? "verified-owned-browser-force-requested"
                        : "verified-owned-browser-force-refused");

                    await Task.Delay(250);
                    remaining = await Task.Run(() => OwnedWebViewProcessDiagnostics());
                    if (remaining.Count > 0 && PortableProcessJob.IsActive)
                    {
                        WriteLauncherLog("shutdown-webview", "job-close-requested remaining="
                            + String.Join(";", remaining));
                        PortableProcessJob.ExitOwnedTree();
                        Environment.Exit(0);
                        return;
                    }
                }

                int pollDelayMs = Math.Max(1, Math.Min(100, (int)(deadline - DateTime.UtcNow).TotalMilliseconds));
                if (exitEventObserved) await Task.Delay(pollDelayMs);
                else
                {
                    Task winner = await Task.WhenAny(exited, Task.Delay(pollDelayMs));
                    exitEventObserved = winner == exited;
                }
            }

            string details = L(
                "WebView2 未能在限定时间内释放便携目录。程序只会结束经 PID、父进程和便携数据目录确认的自有浏览器树；本次未能完成安全释放，也没有删除用户数据目录。请重启 Windows 后重试移动、更新或卸载。",
                "WebView2 did not release the portable folder within the allowed time. The app only terminates its browser tree after verifying its PID, parent process, and portable data folder; safe release did not complete and the user data folder was not deleted. Restart Windows before moving, updating, or uninstalling.")
                + (controllerCloseError == null ? "" : "\r\ncontroller-close-error=" + controllerCloseError.Message)
                + "\r\n\r\nOwned WebView2 processes still hold the portable folder:\r\n"
                + String.Join("\r\n", remaining);
            throw new TimeoutException(details);
        }

        private bool TryForceReleaseOwnedWebViewProcesses(List<string> remaining)
        {
            if (ownedWebViewBrowserProcessId <= 0 || remaining == null || remaining.Count == 0) return false;
            int hostProcessId = Process.GetCurrentProcess().Id;
            string expected = "pid=" + ownedWebViewBrowserProcessId.ToString(CultureInfo.InvariantCulture)
                + " ppid=" + hostProcessId.ToString(CultureInfo.InvariantCulture) + " name=msedgewebview2.exe";
            List<OwnedWebViewProcessRecord> records = ParseOwnedWebViewProcessDiagnostics(remaining);
            if (!records.Any(record => record.ProcessId == ownedWebViewBrowserProcessId
                && record.ParentProcessId == hostProcessId
                && String.Equals(record.Name, "msedgewebview2.exe", StringComparison.OrdinalIgnoreCase)))
            {
                WriteLauncherLog("shutdown-webview", "force-refused ownership-mismatch expected=" + expected);
                return false;
            }
            records = SelectOwnedWebViewProcessTree(records, ownedWebViewBrowserProcessId);

            Dictionary<int, OwnedWebViewProcessRecord> byProcessId = records
                .GroupBy(record => record.ProcessId)
                .ToDictionary(group => group.Key, group => group.First());
            List<OwnedWebViewProcessRecord> childFirst = records
                .OrderByDescending(record => OwnedWebViewProcessDepth(record, byProcessId))
                .ThenByDescending(record => record.ProcessId)
                .ToList();
            bool requested = false;
            foreach (OwnedWebViewProcessRecord record in childFirst)
            {
                try
                {
                    using (Process process = Process.GetProcessById(record.ProcessId))
                    {
                        if (!String.Equals(process.ProcessName, "msedgewebview2", StringComparison.OrdinalIgnoreCase))
                        {
                            WriteLauncherLog("shutdown-webview", "kill-skipped pid="
                                + record.ProcessId.ToString(CultureInfo.InvariantCulture)
                                + " process-name=" + process.ProcessName);
                            continue;
                        }
                        process.Kill();
                        requested = true;
                        WriteLauncherLog("shutdown-webview", "kill-requested pid="
                            + record.ProcessId.ToString(CultureInfo.InvariantCulture)
                            + " ppid=" + record.ParentProcessId.ToString(CultureInfo.InvariantCulture)
                            + " depth=" + OwnedWebViewProcessDepth(record, byProcessId).ToString(CultureInfo.InvariantCulture));
                    }
                }
                catch (ArgumentException)
                {
                    WriteLauncherLog("shutdown-webview", "kill-already-exited pid="
                        + record.ProcessId.ToString(CultureInfo.InvariantCulture));
                }
                catch (InvalidOperationException)
                {
                    WriteLauncherLog("shutdown-webview", "kill-already-exited pid="
                        + record.ProcessId.ToString(CultureInfo.InvariantCulture));
                }
                catch (Exception error)
                {
                    WriteLauncherLog("shutdown-webview", "kill-error pid="
                        + record.ProcessId.ToString(CultureInfo.InvariantCulture) + " "
                        + error.GetBaseException().GetType().Name + ":"
                        + error.GetBaseException().Message.Replace("\r", " ").Replace("\n", " | "));
                }
            }
            return requested || childFirst.Count > 0;
        }

        private sealed class OwnedWebViewProcessRecord
        {
            internal int ProcessId;
            internal int ParentProcessId;
            internal string Name;
        }

        private static List<OwnedWebViewProcessRecord> ParseOwnedWebViewProcessDiagnostics(IEnumerable<string> lines)
        {
            List<OwnedWebViewProcessRecord> records = new List<OwnedWebViewProcessRecord>();
            foreach (string line in lines ?? Enumerable.Empty<string>())
            {
                Match match = Regex.Match(line == null ? String.Empty : line.Trim(),
                    "^pid=(?<pid>[0-9]+) ppid=(?<ppid>[0-9]+) name=(?<name>[^ ]+)$",
                    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
                int processId;
                int parentProcessId;
                if (!match.Success
                    || !Int32.TryParse(match.Groups["pid"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out processId)
                    || !Int32.TryParse(match.Groups["ppid"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out parentProcessId))
                    continue;
                records.Add(new OwnedWebViewProcessRecord
                {
                    ProcessId = processId,
                    ParentProcessId = parentProcessId,
                    Name = match.Groups["name"].Value,
                });
            }
            return records;
        }

        private static List<OwnedWebViewProcessRecord> SelectOwnedWebViewProcessTree(
            IEnumerable<OwnedWebViewProcessRecord> records,
            int rootProcessId)
        {
            List<OwnedWebViewProcessRecord> snapshot = records.ToList();
            HashSet<int> selected = new HashSet<int> { rootProcessId };
            bool changed;
            do
            {
                changed = false;
                foreach (OwnedWebViewProcessRecord record in snapshot)
                {
                    if (selected.Contains(record.ParentProcessId) && selected.Add(record.ProcessId)) changed = true;
                }
            } while (changed);
            return snapshot.Where(record => selected.Contains(record.ProcessId)).ToList();
        }

        private static int OwnedWebViewProcessDepth(
            OwnedWebViewProcessRecord record,
            IDictionary<int, OwnedWebViewProcessRecord> byProcessId)
        {
            int depth = 0;
            int parentProcessId = record.ParentProcessId;
            HashSet<int> visited = new HashSet<int> { record.ProcessId };
            OwnedWebViewProcessRecord parent;
            while (byProcessId.TryGetValue(parentProcessId, out parent) && visited.Add(parent.ProcessId))
            {
                depth += 1;
                parentProcessId = parent.ParentProcessId;
            }
            return depth;
        }

        private void WriteLauncherLog(string category, string message)
        {
            try
            {
                string directory = ResolveLauncherLogDirectory();
                Directory.CreateDirectory(directory);
                string filename = Path.Combine(directory, "launcher.log");
                if (File.Exists(filename) && new FileInfo(filename).Length > 1024 * 1024)
                {
                    try { File.Delete(filename + ".previous"); } catch { }
                    File.Move(filename, filename + ".previous");
                }
                File.AppendAllText(filename,
                    DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " [" + category + "] " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch { }
        }

        private void BeginStartupTrace()
        {
            try
            {
                string directory = ResolveLauncherLogDirectory();
                Directory.CreateDirectory(directory);
                string latest = Path.Combine(directory, "startup-latest.jsonl");
                string previous = Path.Combine(directory, "startup-previous.jsonl");
                if (File.Exists(previous)) File.Delete(previous);
                if (File.Exists(latest)) File.Move(latest, previous);
            }
            catch { }
        }

        private void AppendStartupTrace(string component, string phase, IDictionary<string, object> fields)
        {
            if (!startupTraceActive) return;
            try
            {
                Dictionary<string, object> entry = new Dictionary<string, object>();
                entry["timestamp"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                entry["startupId"] = startupId;
                entry["elapsedMs"] = Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - startupStartedAt);
                string safeComponent = (component ?? String.Empty).Replace("\r", " ").Replace("\n", " ");
                string safePhase = (phase ?? String.Empty).Replace("\r", " ").Replace("\n", " ");
                safePhase = Regex.Replace(
                    safePhase,
                    "(?i)(api[_-]?key|token|password|secret|authorization|cookie)=[^\\s]+",
                    "$1=[REDACTED]");
                entry["component"] = safeComponent.Substring(0, Math.Min(80, safeComponent.Length));
                entry["phase"] = safePhase.Substring(0, Math.Min(160, safePhase.Length));
                if (fields != null)
                {
                    foreach (KeyValuePair<string, object> field in fields) entry[field.Key] = field.Value;
                }
                string directory = ResolveLauncherLogDirectory();
                Directory.CreateDirectory(directory);
                File.AppendAllText(
                    Path.Combine(directory, "startup-latest.jsonl"),
                    json.Serialize(entry) + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch { }
        }

        private List<string> OwnedWebViewProcessDiagnostics()
        {
            string dataRoot = ResolveWebViewDataRoot();
            const string script =
                "$root=$env:DSH_PORTABLE_WEBVIEW_ROOT; " +
                "@(Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" -ErrorAction Stop | " +
                "Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | " +
                "ForEach-Object { \"pid=$($_.ProcessId) ppid=$($_.ParentProcessId) name=$($_.Name)\" })";
            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -Command " + QuoteArgument(script),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            start.EnvironmentVariables["DSH_PORTABLE_WEBVIEW_ROOT"] = dataRoot;
            using (Process process = Process.Start(start))
            {
                Task<string> output = process.StandardOutput.ReadToEndAsync();
                Task<string> error = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(5000))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("Could not inspect owned WebView2 processes within 5 seconds.");
                }
                Task.WaitAll(output, error);
                if (process.ExitCode != 0)
                    throw new InvalidOperationException("Could not inspect owned WebView2 processes. " + error.Result.Trim());
                return output.Result.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries).ToList();
            }
        }

        private static string[] ResolveArguments(string[] args)
        {
            if (args != null && args.Length > 0) return args;
            string name = Path.GetFileNameWithoutExtension(Application.ExecutablePath);
            return name.StartsWith("Stop ", StringComparison.OrdinalIgnoreCase) ? new[] { "stop" } : new[] { "start" };
        }

        private static string ResolveCommand(string[] args)
        {
            string[] commands = new[]
            {
                "start", "stop", "status", "open", "doctor", "repair", "support-report",
                "backup-data", "inspect-data", "restore-data", "runtime-cache-status",
                "runtime-cache-clean", "check-update", "defer-update", "ignore-update", "update",
            };
            string[] valuedOptions = new[]
            {
                "--environment", "--wait-for-lock-ms", "--update-manifest", "--scope", "--channel", "--output",
                "--input", "--password-file", "--categories", "--conflict",
            };
            string[] source = args ?? new string[0];
            for (int index = 0; index < source.Length; index += 1)
            {
                string item = source[index];
                if (valuedOptions.Contains(item, StringComparer.OrdinalIgnoreCase))
                {
                    index += 1;
                    continue;
                }
                string command = commands.FirstOrDefault(value => String.Equals(value, item, StringComparison.OrdinalIgnoreCase));
                if (command != null) return command;
            }
            return "start";
        }

        internal static string ResolveEnvironmentId(string[] args)
        {
            string value = "default";
            string[] source = args ?? new string[0];
            for (int index = 0; index < source.Length; index += 1)
            {
                if (!String.Equals(source[index], "--environment", StringComparison.OrdinalIgnoreCase)) continue;
                if (index + 1 >= source.Length) throw new ArgumentException("--environment requires a value.");
                value = source[index + 1].Trim().ToLowerInvariant();
                break;
            }
            if (!Regex.IsMatch(value, "^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$", RegexOptions.CultureInvariant)
                || Regex.IsMatch(value, "^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                throw new ArgumentException("Portable environment must be a 1-32 character slug using letters, numbers, dots, dashes, or underscores.");
            return value;
        }

        internal static string ResolveStateRoot(string executableRoot, string selectedEnvironmentId)
        {
            string configuredRoot = Environment.GetEnvironmentVariable("DSH_PORTABLE_STATE_ROOT");
            string baseRoot = !String.IsNullOrWhiteSpace(configuredRoot)
                ? Path.GetFullPath(configuredRoot)
                : File.Exists(Path.Combine(executableRoot, "installed-mode.json"))
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepSeek-Herness")
                    : executableRoot;
            return String.Equals(selectedEnvironmentId, "default", StringComparison.Ordinal)
                ? baseRoot
                : Path.Combine(baseRoot, "environments", selectedEnvironmentId);
        }

        internal static string ResolveEnvironmentInstanceKey(string executableRoot, string selectedEnvironmentId)
        {
            string identity = Path.GetFullPath(executableRoot).ToUpperInvariant() + "\n" + selectedEnvironmentId;
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(identity)), 0, 16).Replace("-", "").ToLowerInvariant();
        }

        internal static int RegisterEnvironmentRestoreMessage(string instanceKey)
        {
            uint message = RegisterWindowMessage("DSHPortable.Restore." + instanceKey);
            if (message == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not register the Portable restore message.");
            return unchecked((int)message);
        }

        internal static int RegisterEnvironmentExitMessage(string instanceKey)
        {
            uint message = RegisterWindowMessage("DSHPortable.Exit." + instanceKey);
            if (message == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not register the Portable exit message.");
            return unchecked((int)message);
        }

        internal static bool IsStartInvocation(string[] args)
        {
            return String.Equals(ResolveCommand(args), "start", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsStopCommand(string[] args)
        {
            return String.Equals(ResolveCommand(args), "stop", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsStartCommand(string[] args)
        {
            return IsStartInvocation(args);
        }

        private void CloseOwnedDesktopHost()
        {
            string expected = Path.GetFullPath(Path.Combine(root, "DeepSeek-Herness.exe"));
            int currentProcessId = Process.GetCurrentProcess().Id;
            int targetProcessId;
            try
            {
                if (!Int32.TryParse(File.ReadAllText(DesktopHostStatePath(), Encoding.ASCII).Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out targetProcessId))
                    throw new InvalidDataException();
            }
            catch (FileNotFoundException) { return; }
            catch (DirectoryNotFoundException) { return; }
            catch
            {
                throw new InvalidOperationException(L("DeepSeek-Herness 原生窗口状态无效。", "The DeepSeek-Herness window state is invalid."));
            }
            if (targetProcessId == currentProcessId) return;
            Process process;
            try { process = Process.GetProcessById(targetProcessId); }
            catch (ArgumentException)
            {
                try { File.Delete(DesktopHostStatePath()); } catch { }
                return;
            }
            using (process)
            {
                string candidate;
                try { candidate = Path.GetFullPath(process.MainModule.FileName); }
                catch { throw new InvalidOperationException(L("无法验证 DeepSeek-Herness 原生窗口。", "Could not verify the DeepSeek-Herness window.")); }
                if (!string.Equals(candidate, expected, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(L("DeepSeek-Herness 原生窗口身份不匹配。", "The DeepSeek-Herness window identity does not match."));
                bool signaled = false;
                EnumWindows(delegate(IntPtr window, IntPtr value)
                {
                    uint processId;
                    GetWindowThreadProcessId(window, out processId);
                    if (processId != (uint)process.Id) return true;
                    signaled = PostMessage(window, exitMessage, IntPtr.Zero, IntPtr.Zero) || signaled;
                    return true;
                }, IntPtr.Zero);
                if (!signaled)
                    throw new InvalidOperationException(L("DeepSeek-Herness 原生窗口无法接收退出请求。", "The DeepSeek-Herness window could not receive the exit request."));
                if (!process.WaitForExit(45000))
                {
                    string details = String.Join("\r\n", OwnedWebViewProcessDiagnostics());
                    throw new TimeoutException(L("DeepSeek-Herness 原生窗口未能在 45 秒内正常退出。", "DeepSeek-Herness did not exit within 45 seconds.")
                        + (String.IsNullOrEmpty(details) ? "" : "\r\n" + details));
                }
            }
        }

        private string DesktopHostStatePath()
        {
            return Path.Combine(stateRoot, "data", "runtime", "desktop-host.pid");
        }

        private void RegisterDesktopHostProcess()
        {
            string filename = DesktopHostStatePath();
            Directory.CreateDirectory(Path.GetDirectoryName(filename));
            File.WriteAllText(filename, Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture), Encoding.ASCII);
        }

        private void UnregisterDesktopHostProcess()
        {
            if (!desktopStart) return;
            string filename = DesktopHostStatePath();
            try
            {
                int recorded;
                if (Int32.TryParse(File.ReadAllText(filename, Encoding.ASCII).Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out recorded)
                    && recorded == Process.GetCurrentProcess().Id)
                    File.Delete(filename);
            }
            catch { }
        }

        private delegate bool EnumWindowsCallback(IntPtr window, IntPtr value);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr value);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetWindow(IntPtr window, uint command);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr window, StringBuilder className, int maximum);

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint RegisterWindowMessage(string message);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(
            IntPtr window,
            int attribute,
            ref DwmWindowCornerPreference preference,
            int preferenceSize);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(
            IntPtr window,
            int attribute,
            ref int value,
            int valueSize);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(
            IntPtr window,
            int attribute,
            ref uint value,
            int valueSize);

        [DllImport("dwmapi.dll")]
        private static extern int DwmFlush();

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
                    statusLabel.Text = L("正在准备便携运行环境…", "Preparing the portable runtime…");
                    Task webViewInitialization = InitializeWebViewAsync();
                    AppendStartupTrace("native-host", "portable-cli-begin", null);
                    Tuple<int, string> started = await Task.Run(() => InvokePortableCli(new[] { "start", "--no-browser", "--json", "--progress-json" }, HandleStartupProgress));
                    AppendStartupTrace("native-host", "portable-cli-complete", new Dictionary<string, object> { { "exitCode", started.Item1 } });
                    if (started.Item1 != 0)
                    {
                        Task ignoredInitializationFailure = webViewInitialization.ContinueWith(
                            task => { var ignored = task.Exception; },
                            TaskContinuationOptions.OnlyOnFaulted);
                        HandleFailure(started.Item1, started.Item2);
                        return;
                    }
                    backendStarted = true;
                    await webViewInitialization;
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
                    if (updateCheckEnabled) await CheckForDesktopUpdateAsync(false, "product");
                    if (engineUpdateCheckEnabled) await CheckForDesktopUpdateAsync(false, "engine");
                    AppendStartupTrace("native-host", "startup-complete", null);
                    startupTraceActive = false;
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
                    try
                    {
                        Tuple<int, string> stopped = await Task.Run(() => InvokePortableCli(new[] { "stop", "--no-browser", "--json" }));
                        if (stopped.Item1 == 0) backendStarted = false;
                        else launchError = new InvalidOperationException(
                            launchError.Message + "\r\n" + L("启动失败后的后台清理也失败：", "Background cleanup after startup failure also failed: ") + stopped.Item2,
                            launchError);
                    }
                    catch (Exception cleanupError)
                    {
                        launchError = new InvalidOperationException(
                            launchError.Message + "\r\n" + L("启动失败后的后台清理也失败：", "Background cleanup after startup failure also failed: ") + cleanupError.Message,
                            launchError);
                    }
                }
                HandleFailure(1, launchError.Message);
            }
        }

        private async Task CheckForDesktopUpdateAsync(bool manual, string scope)
        {
            bool engineScope = String.Equals(scope, "engine", StringComparison.Ordinal);
            string targetName = engineScope ? "DeepSeek Harness" : "DSH-Portable";
            bool scopeEnabled = String.Equals(scope, "engine", StringComparison.Ordinal)
                ? engineUpdateCheckEnabled : updateCheckEnabled;
            if (!manual && (!scopeEnabled
                || string.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_SKIP_UPDATE_CHECK"), "1", StringComparison.Ordinal))) return;
            if (updateCheckRunning || updateInteractionRunning) return;
            if (manual) RestoreFromTray();
            updateCheckRunning = true;
            RebuildTrayMenu();
            try
            {
                string[] checkArguments = manual
                    ? new[] { "check-update", "--scope", scope, "--json", "--force" }
                    : new[] { "check-update", "--scope", scope, "--json" };
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
                string fullPackageManifestUrl = JsonString(check.Item2, "fullPackageManifestUrl");
                FinishUpdateCheckPhase();
                if (updateStatus == "current")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("你使用的已经是最新版。", "You're already using the latest version.")
                            + (engineScope
                                ? (String.IsNullOrEmpty(engineCurrent) ? "" : "\r\n\r\nDeepSeek Harness " + engineCurrent)
                                : (String.IsNullOrEmpty(current) ? "" : "\r\n\r\nDSH-Portable " + current)),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "core-incompatible")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("这项 DeepSeek Harness 更新需要较新的 DSH-Portable。请先更新 DSH-Portable，再重新检查内核更新。",
                          "This DeepSeek Harness update needs a newer DSH-Portable. Update DSH-Portable first, then check the engine again."),
                        L("需要先更新 DSH-Portable", "Update DSH-Portable first"), MessageBoxButtons.OK, MessageBoxIcon.Information);
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
                if (updateStatus == "channel-unpublished")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("此预览版尚未发布更新通道。", "No update channel has been published for this preview yet."),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "engine-follows-product")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("预览版内核随 DSH-Portable 更新。", "Preview core updates are delivered with DSH-Portable."),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Information);
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
                    if (!EnsureNoOtherRunningEnvironmentHosts(manual)) return;
                    int choice = ShowUpdateChoiceDialog(current, latest, engineCurrent, engineLatest, true);
                    if (choice == 1) StartFullPackageUpdate(fullPackageManifestUrl);
                    else if (choice < 0) await Task.Run(() => InvokePortableCli(new[] { "ignore-update", "--scope", scope, "--json" }));
                    else await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--scope", scope, "--json" }));
                    return;
                }
                if (updateStatus != "available") return;

                if (!trayBridgeReady)
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        UpdateDescription(current, latest, engineCurrent, engineLatest, false, scope) + "\r\n\r\n"
                            + L("为了确认不会中断任务，请稍后退出并重新打开；启动时可以选择“现在更新”或“稍后”。",
                                "To avoid interrupting work, exit and reopen when convenient; startup will offer Update now or Later."),
                        targetName + L(" 更新", " update"), MessageBoxButtons.OK, MessageBoxIcon.Information);
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
                if (!EnsureNoOtherRunningEnvironmentHosts(manual)) return;

                DialogResult accepted = MessageBox.Show(this,
                    UpdateDescription(current, latest, engineCurrent, engineLatest, false, scope) + "\r\n\r\n"
                        + L("现在更新会短暂重启本地 DSH 服务。会话、设置、插件和工作区保持不变。\r\n\r\n现在更新吗？选择“否”可以稍后处理。",
                            "Updating now briefly restarts the local DSH service. Sessions, settings, plugins, and workspace stay in place.\r\n\r\nUpdate now? Choose No to do it later."),
                    targetName + L(" 更新", " update"), MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (accepted != DialogResult.Yes)
                {
                    await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--scope", scope, "--json" }));
                    return;
                }
                await ApplyDesktopUpdateAsync(scope);
            }
            catch (Exception error)
            {
                if (!manual) return;
                MessageBox.Show(this, error.Message,
                    L("更新失败", "Update failed"), MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                updateCheckRunning = false;
                updateInteractionRunning = false;
                RebuildTrayMenu();
            }
        }

        private void FinishUpdateCheckPhase()
        {
            updateCheckRunning = false;
            updateInteractionRunning = true;
            RebuildTrayMenu();
        }

        private void ShowDesktopOperation(string message)
        {
            RestoreFromTray();
            webView.Enabled = false;
            ConfigureDesktopLoadingSurface(message, true);
            activityRing.Indeterminate = true;
            progressDetail.Text = L("正在准备…", "Preparing…");
            launchPanel.Visible = true;
            launchPanel.BringToFront();
            CenterLaunchContent();
        }

        private async Task ApplyDesktopUpdateAsync(string scope)
        {
            bool engineScope = String.Equals(scope, "engine", StringComparison.Ordinal);
            string targetName = engineScope ? "DeepSeek Harness" : "DSH-Portable";
            ShowDesktopOperation(engineScope
                ? L("正在准备 DeepSeek Harness 更新…", "Preparing the DeepSeek Harness update…")
                : L("正在准备 DSH-Portable 更新…", "Preparing the DSH-Portable update…"));
            trayBridgeReady = false;
            Tuple<int, string> updated = await Task.Run(() => InvokePortableCli(
                new[] { "update", "--scope", scope, "--no-browser", "--json", "--progress-json" }, HandleUpdateProgress));
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
                targetName + L(" 更新已完成。", " update is complete."),
                targetName + L(" 已更新", " updated"), MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void StartFullPackageUpdate(string manifestUrl)
        {
            Uri manifest;
            if (!Uri.TryCreate(manifestUrl, UriKind.Absolute, out manifest)
                || manifest.Scheme != Uri.UriSchemeHttps
                || !String.Equals(manifest.Host, "github.com", StringComparison.OrdinalIgnoreCase)
                || !manifest.AbsolutePath.StartsWith("/WSL043/DSH-Portable/releases/download/v", StringComparison.Ordinal)
                || !manifest.AbsolutePath.EndsWith("/portable-manifest.json", StringComparison.Ordinal))
                throw new InvalidOperationException(L(
                    "更新清单地址无效，请重新检查更新。",
                    "The update manifest target is invalid. Check for updates again."));
            string source = Path.Combine(root, "launcher", "DSH-FullUpdater.exe");
            if (!File.Exists(source)) throw new FileNotFoundException(L(
                "完整更新组件缺失，请重新安装当前版本后再试。",
                "The full update component is missing. Reinstall this version and try again."), source);
            string helper = Path.Combine(Path.GetTempPath(), "DSH-FullUpdater-" + Process.GetCurrentProcess().Id + ".exe");
            File.Copy(source, helper, true);
            PortableProcessJob.StartDetachedUpdater(helper, new[]
            {
                "--upgrade-existing",
                "--destination", root,
                "--manifest", manifest.AbsoluteUri,
            });
            ShowDesktopOperation(L(
                "正在交给独立更新器，当前窗口将安全关闭…",
                "Handing off to the updater; this window will close safely…"));
            BeginDesktopShutdown();
        }

        private List<string> OtherRunningEnvironmentHosts()
        {
            string baseRoot = File.Exists(Path.Combine(root, "installed-mode.json"))
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepSeek-Herness")
                : root;
            List<Tuple<string, string>> candidates = new List<Tuple<string, string>>
            {
                Tuple.Create("default", baseRoot),
            };
            string environmentsRoot = Path.Combine(baseRoot, "environments");
            if (Directory.Exists(environmentsRoot))
            {
                foreach (string directory in Directory.GetDirectories(environmentsRoot))
                {
                    string id = Path.GetFileName(directory).ToLowerInvariant();
                    if (!Regex.IsMatch(id, "^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$", RegexOptions.CultureInvariant)
                        || Regex.IsMatch(id, "^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) continue;
                    candidates.Add(Tuple.Create(id, directory));
                }
            }

            string expected = Path.GetFullPath(Path.Combine(root, "DeepSeek-Herness.exe"));
            string currentStateRoot = Path.GetFullPath(stateRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            List<string> running = new List<string>();
            foreach (Tuple<string, string> candidate in candidates)
            {
                string candidateRoot = Path.GetFullPath(candidate.Item2).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (String.Equals(candidateRoot, currentStateRoot, StringComparison.OrdinalIgnoreCase)) continue;
                string stateFile = Path.Combine(candidateRoot, "data", "runtime", "desktop-host.pid");
                int pid;
                try
                {
                    if (!Int32.TryParse(File.ReadAllText(stateFile, Encoding.ASCII).Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out pid)) continue;
                }
                catch (FileNotFoundException) { continue; }
                catch (DirectoryNotFoundException) { continue; }
                catch { running.Add(candidate.Item1); continue; }
                if (pid == Process.GetCurrentProcess().Id) continue;
                try
                {
                    using (Process process = Process.GetProcessById(pid))
                    {
                        string executable = Path.GetFullPath(process.MainModule.FileName);
                        if (String.Equals(executable, expected, StringComparison.OrdinalIgnoreCase)) running.Add(candidate.Item1);
                    }
                }
                catch (ArgumentException)
                {
                    try { File.Delete(stateFile); } catch { }
                }
                catch { running.Add(candidate.Item1); }
            }
            return running.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToList();
        }

        private bool EnsureNoOtherRunningEnvironmentHosts(bool manual)
        {
            List<string> running = OtherRunningEnvironmentHosts();
            if (running.Count == 0) return true;
            if (manual)
            {
                MessageBox.Show(this,
                    L("其他便携环境仍在运行。请先关闭后再更新：", "Other Portable environments are still running. Close them before updating: ")
                        + String.Join(", ", running),
                    L("稍后更新", "Update later"), MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return false;
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
            await NavigateWorkspaceAsync(url, true);
            backendStarted = true;
        }

        private void RecordWebViewPhase(string phase)
        {
            long elapsed = webViewStartupClock == null ? 0 : webViewStartupClock.ElapsedMilliseconds;
            lock (webViewStartupTrace)
            {
                if (webViewStartupTrace.Count < 32) webViewStartupTrace.Add(elapsed + "ms " + phase);
            }
            WriteLauncherLog("startup", elapsed + "ms " + phase);
            AppendStartupTrace("webview", phase, null);
        }

        private static string WorkspaceOriginPath(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)) return String.Empty;
            return (uri.GetLeftPart(UriPartial.Authority) + uri.AbsolutePath)
                .TrimEnd('/');
        }

        private static string SafeWorkspaceUrl(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri)
                ? uri.GetLeftPart(UriPartial.Path)
                : String.Empty;
        }

        private void OnWebViewProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs eventArgs)
        {
            string failure = eventArgs.ProcessFailedKind + "/" + eventArgs.Reason
                + " exit=" + eventArgs.ExitCode
                + (String.IsNullOrWhiteSpace(eventArgs.ProcessDescription) ? "" : " " + eventArgs.ProcessDescription);
            RecordWebViewPhase("process-failed:" + failure);
            if (webViewProcessFailure != null) webViewProcessFailure.TrySetResult(failure);
        }

        private async Task NavigateWorkspaceAsync(string url, bool updated)
        {
            TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs> navigation =
                new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>();
            TaskCompletionSource<bool> workspaceUsable = new TaskCompletionSource<bool>();
            workspaceSurfaceReady = new TaskCompletionSource<string>();
            webViewProcessFailure = new TaskCompletionSource<string>();
            EventHandler<CoreWebView2NavigationCompletedEventArgs> completed = null;
            EventHandler<CoreWebView2DOMContentLoadedEventArgs> domLoaded = null;
            completed = delegate(object sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
            {
                RecordWebViewPhase("navigation-completed:" + eventArgs.IsSuccess + "/" + eventArgs.WebErrorStatus);
                navigation.TrySetResult(eventArgs);
            };
            domLoaded = async delegate(object sender, CoreWebView2DOMContentLoadedEventArgs eventArgs)
            {
                RecordWebViewPhase("dom-content-loaded:" + eventArgs.NavigationId);
                bool usable = await ProbeWorkspaceDomAsync(url);
                RecordWebViewPhase("dom-probe:" + usable);
                string handoff = usable ? await WaitForWorkspaceHandoffAsync(url, workspaceSurfaceReady.Task) : String.Empty;
                RecordWebViewPhase("surface-handoff:" + (String.IsNullOrEmpty(handoff) ? "unavailable" : handoff));
                if (!String.IsNullOrEmpty(handoff))
                {
                    RevealDesktopSurface();
                    workspaceUsable.TrySetResult(true);
                }
            };
            webView.CoreWebView2.NavigationCompleted += completed;
            webView.CoreWebView2.DOMContentLoaded += domLoaded;
            webView.Visible = true;
            if (desktopStart)
            {
                // Native operations such as an update may already own this
                // surface. Normal startup reveals the official DSH boot overlay.
                if (launchPanel.Visible) launchPanel.BringToFront();
            }
            else launchPanel.BringToFront();
            RecordWebViewPhase("navigation-start:" + SafeWorkspaceUrl(url));
            webView.CoreWebView2.Navigate(url);
            Task timeout = Task.Delay(WorkspaceNavigationTimeoutMs);
            Task winner = await Task.WhenAny(workspaceUsable.Task, navigation.Task, webViewProcessFailure.Task, timeout);
            if (winner == navigation.Task)
            {
                CoreWebView2NavigationCompletedEventArgs navigationResult = await navigation.Task;
                if (!navigationResult.IsSuccess)
                {
                    webView.CoreWebView2.NavigationCompleted -= completed;
                    webView.CoreWebView2.DOMContentLoaded -= domLoaded;
                    string webViewSnapshot = WebViewEnvironmentSnapshot();
                    string diagnostics = await Task.Run(() => WorkspaceFailureDiagnostics(url, webViewSnapshot));
                    throw new InvalidOperationException((updated
                        ? L("更新后的工作台加载失败：", "The updated workspace could not load: ")
                        : L("DeepSeek Harness 工作台加载失败：", "The DeepSeek Harness workspace could not load: "))
                        + navigationResult.WebErrorStatus + "\r\n" + diagnostics);
                }
                winner = await Task.WhenAny(workspaceUsable.Task, webViewProcessFailure.Task, timeout);
            }
            webView.CoreWebView2.NavigationCompleted -= completed;
            webView.CoreWebView2.DOMContentLoaded -= domLoaded;
            if (winner == webViewProcessFailure.Task)
            {
                string webViewSnapshot = WebViewEnvironmentSnapshot();
                string diagnostics = await Task.Run(() => WorkspaceFailureDiagnostics(url, webViewSnapshot));
                throw new InvalidOperationException(L(
                    "WebView2 进程在打开工作台时失败。",
                    "A WebView2 process failed while opening the workspace.") + "\r\n" + diagnostics);
            }
            if (winner == timeout)
            {
                RecordWebViewPhase("navigation-timeout");
                string webViewSnapshot = WebViewEnvironmentSnapshot();
                string diagnostics = await Task.Run(() => WorkspaceFailureDiagnostics(url, webViewSnapshot));
                throw new TimeoutException((updated
                    ? L("更新后的工作台未能在 60 秒内打开。", "The updated workspace did not open within 60 seconds.")
                    : L("DeepSeek Harness 工作台未能在 60 秒内打开。", "The DeepSeek Harness workspace did not open within 60 seconds."))
                    + "\r\n" + diagnostics);
            }
            if (winner == workspaceUsable.Task)
            {
                webViewProcessFailure = null;
                return;
            }
            if (!await ProbeWorkspaceDomAsync(url))
            {
                string webViewSnapshot = WebViewEnvironmentSnapshot();
                string diagnostics = await Task.Run(() => WorkspaceFailureDiagnostics(url, webViewSnapshot));
                throw new InvalidOperationException(L(
                    "DeepSeek Harness 工作台页面未达到可用状态。",
                    "The DeepSeek Harness workspace did not reach a usable state.") + "\r\n" + diagnostics);
            }
            webViewProcessFailure = null;
        }

        private void RevealDesktopSurface()
        {
            if (!desktopStart) return;
            webView.Visible = true;
            webView.BringToFront();
            webView.Update();
            try { DwmFlush(); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            launchPanel.Visible = false;
            WriteLauncherLog("startup", "dsh-first-paint-ready");
            AppendStartupTrace("native-host", "interactive-ready", null);
            bool updateHealthReady = WriteUpdateHealthMarker();
            if (updateHealthReady && String.Equals(
                Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_PREFLIGHT"),
                "1",
                StringComparison.Ordinal))
            {
                BeginInvoke(new Action(BeginDesktopShutdown));
            }
            if (!hiddenForAutomation)
            {
                ShowInTaskbar = true;
                if (Opacity < 1) Opacity = 1;
            }
        }

        private bool WriteUpdateHealthMarker()
        {
            string filename = Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_HEALTH_FILE");
            string token = Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_HEALTH_TOKEN");
            if (String.IsNullOrWhiteSpace(filename) || !Regex.IsMatch(token ?? String.Empty, "^[0-9a-f]{32}$", RegexOptions.IgnoreCase)) return false;
            try
            {
                string full = Path.GetFullPath(filename);
                string runtime = Path.GetFullPath(Path.Combine(ResolveProductDataRoot(), "runtime"))
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (!full.StartsWith(runtime, StringComparison.OrdinalIgnoreCase)) return false;
                string temporary = full + ".tmp";
                Directory.CreateDirectory(Path.GetDirectoryName(full));
                File.WriteAllText(temporary, token + "\r\n", new UTF8Encoding(false));
                if (File.Exists(full)) File.Replace(temporary, full, null, true);
                else File.Move(temporary, full);
                WriteLauncherLog("update-health", "workspace-ready");
                return true;
            }
            catch (Exception error)
            {
                WriteLauncherLog("update-health", "marker-failed " + error.GetBaseException().Message);
                return false;
            }
        }

        private void RevealDesktopBootSurface()
        {
            if (!desktopStart || webView == null || webView.IsDisposed) return;
            webView.Visible = true;
            webView.BringToFront();
            webView.Update();
            try { DwmFlush(); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            launchPanel.Visible = false;
            WriteLauncherLog("startup", "dsh-boot-surface-visible");
            if (!hiddenForAutomation)
            {
                ShowInTaskbar = true;
                if (Opacity < 1) Opacity = 1;
            }
        }

        private async Task<string> WaitForWorkspaceHandoffAsync(string expectedUrl, Task<string> nativeHandoff)
        {
            string expected = json.Serialize(WorkspaceOriginPath(expectedUrl));
            string script = "(function(){try{"
                + "var expected=" + expected + ";"
                + "var current=String(location.origin||'')+String(location.pathname||'');current=current.replace(/\\/$/,'');"
                + "if(current!==expected||!document.body)return 0;"
                + "var key='__dshPortableStartupGate';"
                + "var root=document.querySelector('#root');if(!root)return 0;"
                + "var rootRect=root.getBoundingClientRect();var rootStyle=getComputedStyle(root);"
                + "var rootVisible=rootRect.width>=Math.max(320,innerWidth*.8)&&rootRect.height>=Math.max(240,innerHeight*.8)"
                + "&&rootStyle.display!=='none'&&rootStyle.visibility!=='hidden'&&rootStyle.opacity!=='0';"
                + "if(!rootVisible)return 0;"
                + "var now=performance.now();var gate=window[key];"
                + "if(!gate){gate={since:now,lastMutation:now,lastSignature:'',stablePolls:0};"
                + "gate.observer=new MutationObserver(function(records){"
                + "for(var i=0;i<records.length;i++){var record=records[i];"
                + "if(record.type==='childList'||record.type==='characterData'){gate.lastMutation=performance.now();gate.stablePolls=0;break;}}});"
                + "gate.observer.observe(root,{subtree:true,childList:true,characterData:true});window[key]=gate;}"
                + "var visibleControls=0;var controls=root.querySelectorAll('button,input,textarea,[contenteditable=true],[role=button]');"
                + "for(var index=0;index<controls.length;index++){var node=controls[index];var rect=node.getBoundingClientRect();var style=getComputedStyle(node);"
                + "if(rect.width>=20&&rect.height>=20&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0')visibleControls++;}"
                + "var text=String(root.innerText||'').replace(/\\s+/g,' ').trim();"
                + "var signature=[root.children.length,root.querySelectorAll('*').length,visibleControls,text.length].join(':');"
                + "if(signature!==gate.lastSignature){gate.lastSignature=signature;gate.since=now;gate.stablePolls=0;return 0;}"
                + "gate.stablePolls++;"
                + "var fontsReady=!document.fonts||document.fonts.status==='loaded';"
                + "return fontsReady&&visibleControls>=2&&text.length>0&&gate.stablePolls>=3"
                + "&&now-gate.since>=300&&now-gate.lastMutation>=300?2:0;"
                + "}catch(_){return 0;}})()";
            await Task.Delay(50);
            // The official DSH boot overlay remains in the WebView while the
            // workspace mounts behind it. The native host waits for that same
            // surface to report readiness instead of introducing another page.
            for (int attempt = 0; attempt < 560; attempt++)
            {
                if (nativeHandoff.IsCompleted) return await nativeHandoff;
                try
                {
                    string result = await webView.CoreWebView2.ExecuteScriptAsync(script);
                    if (String.Equals(result, "2", StringComparison.Ordinal)) return "stable-workspace";
                }
                catch (Exception error)
                {
                    RecordWebViewPhase("first-paint-probe-failed:" + error.GetType().Name);
                }
                Task delay = Task.Delay(100);
                Task winner = await Task.WhenAny(nativeHandoff, delay);
                if (winner == nativeHandoff) return await nativeHandoff;
            }
            try
            {
                string diagnostics = await webView.CoreWebView2.ExecuteScriptAsync(
                    "(function(){try{var body=document.body;return {url:String(location.href||''),ready:document.readyState,"
                    + "children:body?body.querySelectorAll('*').length:0,text:body?String(body.innerText||'').length:0,"
                    + "width:body?body.getBoundingClientRect().width:0,height:body?body.getBoundingClientRect().height:0};}"
                    + "catch(error){return {error:String(error&&error.message||error)}}})()");
                RecordWebViewPhase("first-paint-timeout:" + diagnostics);
            }
            catch (Exception error) { RecordWebViewPhase("first-paint-timeout-probe-failed:" + error.GetType().Name); }
            return String.Empty;
        }

        private async Task<bool> ProbeWorkspaceDomAsync(string expectedUrl)
        {
            try
            {
                string expected = json.Serialize(WorkspaceOriginPath(expectedUrl));
                string script = "(function(){try{"
                    + "var expected=" + expected + ";"
                    + "var current=String(location.origin||'')+String(location.pathname||'');current=current.replace(/\\/$/,'');"
                    + "var ready=document.readyState==='interactive'||document.readyState==='complete';"
                    + "var errorPage=current.indexOf('chrome-error://')===0||!!document.querySelector('#main-frame-error');"
                    + "return current===expected&&ready&&!!document.body&&!errorPage;"
                    + "}catch(_){return false;}})()";
                string result = await webView.CoreWebView2.ExecuteScriptAsync(script);
                return String.Equals(result, "true", StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception error)
            {
                RecordWebViewPhase("dom-probe-failed:" + error.GetType().Name);
                return false;
            }
        }

        private string ProbeWorkspaceDocument(string url)
        {
            Stopwatch probeBudget = Stopwatch.StartNew();
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.AllowAutoRedirect = true;
                request.Proxy = null;
                request.Timeout = 5000;
                request.ReadWriteTimeout = 5000;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (Stream stream = response.GetResponseStream())
                {
                    byte[] buffer = new byte[16384];
                    int total = 0;
                    int read;
                    while (true)
                    {
                        int remaining = 5000 - (int)probeBudget.ElapsedMilliseconds;
                        if (remaining <= 0) return "host-probe-timeout";
                        if (stream.CanTimeout) stream.ReadTimeout = Math.Max(1, remaining);
                        read = stream.Read(buffer, 0, buffer.Length);
                        if (read <= 0) break;
                        total += read;
                        if (total > 2 * 1024 * 1024) return "host-body-too-large";
                    }
                    return "host=" + (int)response.StatusCode + " " + response.ContentType + " bytes=" + total;
                }
            }
            catch (Exception error)
            {
                return "host-probe-failed=" + error.GetType().Name + ": " + error.Message;
            }
        }

        private string WebViewEnvironmentSnapshot()
        {
            try
            {
                return "webview2=" + webView.CoreWebView2.Environment.BrowserVersionString + "\r\n"
                    + "webview2-data=" + webView.CoreWebView2.Environment.UserDataFolder + "\r\n"
                    + "webview2-reports=" + webView.CoreWebView2.Environment.FailureReportFolderPath;
            }
            catch { return "webview2=unavailable"; }
        }

        private static string TailLog(string filename, int maximumCharacters)
        {
            try
            {
                using (FileStream stream = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    long start = Math.Max(0, stream.Length - maximumCharacters * 4L);
                    stream.Seek(start, SeekOrigin.Begin);
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true))
                    {
                        string text = reader.ReadToEnd();
                        return text.Length <= maximumCharacters ? text : text.Substring(text.Length - maximumCharacters);
                    }
                }
            }
            catch { return String.Empty; }
        }

        private string WorkspaceFailureDiagnostics(string url, string webViewSnapshot)
        {
            StringBuilder details = new StringBuilder();
            details.AppendLine("diagnostic=workspace-navigation-v1");
            details.AppendLine(ProbeWorkspaceDocument(url));
            details.AppendLine(webViewSnapshot);
            lock (webViewStartupTrace)
                details.AppendLine("phases=" + String.Join(" | ", webViewStartupTrace.ToArray()));
            string logDirectory = ResolveLauncherLogDirectory();
            foreach (string name in new[] { "dsh.stderr.log", "dsh.stdout.log" })
            {
                string tail = TailLog(Path.Combine(logDirectory, name), 2000).Trim();
                if (!String.IsNullOrEmpty(tail)) details.AppendLine(name + ":\r\n" + tail);
            }
            return details.ToString().Trim();
        }

        private void HideDesktopOperation()
        {
            launchPanel.Visible = false;
            progressDetail.Visible = false;
            webView.Enabled = true;
            webView.Visible = true;
            webView.BringToFront();
        }

        private async Task InitializeWebViewAsync()
        {
            webViewStartupClock = Stopwatch.StartNew();
            RecordWebViewPhase("environment-start");
            string userData = ResolveWebViewDataRoot();
            Directory.CreateDirectory(userData);
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions
            {
                Language = UiLanguageTag,
            };
            string testBrowserArguments = Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_WEBVIEW2_ARGUMENTS");
            if ((String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_HIDDEN"), "1", StringComparison.Ordinal)
                || String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION"), "1", StringComparison.Ordinal))
                && !String.IsNullOrWhiteSpace(testBrowserArguments)
                && Regex.IsMatch(testBrowserArguments, "^--remote-debugging-port=[0-9]{1,5}$"))
            {
                options.AdditionalBrowserArguments = testBrowserArguments;
            }

            for (int attempt = 1; attempt <= WebViewInitializationMaxAttempts; attempt += 1)
            {
                bool retryBusyInitialization = false;
                try
                {
                    await InitializeWebViewAttemptAsync(userData, options);
                    break;
                }
                catch (WebView2RuntimeNotFoundException)
                {
                    throw new InvalidOperationException(
                        L(
                            "此电脑缺少 Microsoft Edge WebView2 Runtime。\r\n请安装官方 Evergreen Runtime 后重新打开：\r\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703",
                            "Microsoft Edge WebView2 Runtime is missing.\r\nInstall the official Evergreen Runtime, then open the app again:\r\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703"));
                }
                catch (Exception error)
                {
                    if (!IsWebViewResourceInUse(error) || attempt >= WebViewInitializationMaxAttempts) throw;
                    retryBusyInitialization = true;
                }
                if (!retryBusyInitialization) continue;
                RecordWebViewPhase("environment-busy-retry:" + attempt.ToString(CultureInfo.InvariantCulture));
                ResetWebViewAfterInitializationFailure();
                await WaitForWebViewDataFolderReleaseAsync(attempt * 2000);
            }

            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            string testStalledResource = Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_STALLED_RESOURCE_URL");
            Uri stalledResourceUri;
            if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_HIDDEN"), "1", StringComparison.Ordinal)
                && Uri.TryCreate(testStalledResource, UriKind.Absolute, out stalledResourceUri)
                && stalledResourceUri.IsLoopback)
            {
                string resource = json.Serialize(stalledResourceUri.AbsoluteUri);
                await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    "document.addEventListener('DOMContentLoaded',function(){"
                    + "var image=document.createElement('img');image.hidden=true;image.src=" + resource + ";document.body.appendChild(image);"
                    + "},{once:true});");
            }
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
            webView.CoreWebView2.DownloadStarting += OnDownloadStarting;
            webView.CoreWebView2.ContentLoading += delegate(object sender, CoreWebView2ContentLoadingEventArgs eventArgs)
            {
                RecordWebViewPhase("content-loading:" + eventArgs.NavigationId);
            };
            webView.CoreWebView2.ProcessFailed += OnWebViewProcessFailed;
        }

        private async Task InitializeWebViewAttemptAsync(string userData, CoreWebView2EnvironmentOptions options)
        {
            if (!testWebViewBusyInjected
                && String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_WEBVIEW2_BUSY_ONCE"), "1", StringComparison.Ordinal))
            {
                testWebViewBusyInjected = true;
                throw new COMException("The requested resource is in use.", WebViewResourceInUseHResult);
            }

            webViewEnvironment = await CoreWebView2Environment.CreateAsync(null, userData, options);
            webViewBrowserExited = new TaskCompletionSource<CoreWebView2BrowserProcessExitedEventArgs>();
            webViewEnvironment.BrowserProcessExited += OnWebViewBrowserProcessExited;
            await webView.EnsureCoreWebView2Async(webViewEnvironment);
            ownedWebViewBrowserProcessId = unchecked((int)webView.CoreWebView2.BrowserProcessId);
            RecordWebViewPhase("environment-ready:" + webViewEnvironment.BrowserVersionString);
        }

        private static bool IsWebViewResourceInUse(Exception error)
        {
            Exception current = error;
            while (current != null)
            {
                if (current.HResult == WebViewResourceInUseHResult) return true;
                current = current.InnerException;
            }
            return false;
        }

        private WebView2 CreateDesktopWebView()
        {
            return new WebView2
            {
                Dock = DockStyle.Fill,
                Location = Point.Empty,
                DefaultBackgroundColor = BackColor,
                Visible = true,
            };
        }

        private void ResetWebViewAfterInitializationFailure()
        {
            CoreWebView2Environment failedEnvironment = webViewEnvironment;
            if (failedEnvironment != null)
            {
                try { failedEnvironment.BrowserProcessExited -= OnWebViewBrowserProcessExited; }
                catch { }
            }
            WebView2 failedWebView = webView;
            if (failedWebView != null)
            {
                try { Controls.Remove(failedWebView); }
                catch { }
                try { failedWebView.Dispose(); }
                catch { }
            }
            webViewEnvironment = null;
            webViewBrowserExited = null;
            ownedWebViewBrowserProcessId = 0;
            webView = CreateDesktopWebView();
            Controls.Add(webView);
            webView.SendToBack();
            FitWebViewToClient();
        }

        private async Task WaitForWebViewDataFolderReleaseAsync(int timeoutMs)
        {
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(250, timeoutMs));
            List<string> remaining = new List<string>();
            do
            {
                bool diagnosticFailed = false;
                try
                {
                    remaining = await Task.Run(() => OwnedWebViewProcessDiagnostics());
                    if (remaining.Count == 0) return;
                }
                catch (Exception diagnosticError)
                {
                    WriteLauncherLog("startup", "environment-busy-diagnostic="
                        + diagnosticError.GetBaseException().Message.Replace("\r", " ").Replace("\n", " | "));
                    diagnosticFailed = true;
                }
                if (diagnosticFailed)
                {
                    await Task.Delay(Math.Min(500, Math.Max(1, timeoutMs)));
                    return;
                }
                await Task.Delay(250);
            }
            while (DateTime.UtcNow < deadline);

            WriteLauncherLog("startup", "environment-busy-processes-remain=" + String.Join(";", remaining));
        }

        private async Task ShowDesktopAsync(string url)
        {
            statusLabel.Text = L("正在打开工作台…", "Opening the workspace…");
            applicationUri = new Uri(url);
            await NavigateWorkspaceAsync(url, false);

            SuspendLayout();
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = true;
            MinimizeBox = true;
            MinimumSize = new Size(900, 620);
            FitWebViewToClient();
            webView.Visible = true;
            webView.BringToFront();
            ApplyDesktopWindowCorners();
            ApplyDesktopChrome();
            launchPanel.Visible = false;
            ResumeLayout(true);
            FitWebViewToClient();
            BeginInvoke(new Action(FitWebViewToClient));
            operationRunning = false;
            desktopReady = true;
            trayIcon.Visible = true;
        }

        private void FitWebViewToClient()
        {
            if (webView == null || webView.IsDisposed) return;
            if (webView.Dock != DockStyle.Fill) webView.Dock = DockStyle.Fill;
            PerformLayout();
        }

        private void ApplyDesktopWindowCorners()
        {
            if (!IsHandleCreated) return;
            DwmWindowCornerPreference preference = DwmWindowCornerPreference.Round;
            try { DwmSetWindowAttribute(Handle, DwmwaWindowCornerPreference, ref preference, sizeof(int)); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
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
            {
                string installedWebView = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DeepSeek-Herness", "data", "webview2");
                return String.Equals(environmentId, "default", StringComparison.Ordinal)
                    ? installedWebView
                    : Path.Combine(installedWebView, "environments", environmentId);
            }
            string portableWebView = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DSH-Portable",
                "webview2",
                ResolvePortableInstanceId(),
                ResolvePortableLocationKey());
            return String.Equals(environmentId, "default", StringComparison.Ordinal)
                ? portableWebView
                : Path.Combine(portableWebView, "environments", environmentId);
        }

        private string ResolveLauncherLogDirectory()
        {
            return Path.Combine(stateRoot, "data", "logs");
        }

        private string ResolvePortableInstanceId()
        {
            string dataDirectory = Path.Combine(root, "data");
            string identityPath = Path.Combine(dataDirectory, "portable-instance.id");
            try
            {
                if (File.Exists(identityPath))
                {
                    string existing = File.ReadAllText(identityPath, Encoding.ASCII).Trim();
                    if (Regex.IsMatch(existing, "^[0-9a-f]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                        return existing.ToLowerInvariant();
                }

                Directory.CreateDirectory(dataDirectory);
                string created = Guid.NewGuid().ToString("N");
                try
                {
                    using (FileStream stream = new FileStream(identityPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
                    using (StreamWriter writer = new StreamWriter(stream, Encoding.ASCII))
                        writer.Write(created);
                    return created;
                }
                catch (IOException)
                {
                    string raced = File.ReadAllText(identityPath, Encoding.ASCII).Trim();
                    if (Regex.IsMatch(raced, "^[0-9a-f]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                        return raced.ToLowerInvariant();
                }
            }
            catch { }

            return ResolvePortableLocationKey();
        }

        private string ResolvePortableLocationKey()
        {
            using (SHA256 hash = SHA256.Create())
            {
                byte[] digest = hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).ToUpperInvariant()));
                return BitConverter.ToString(digest, 0, 16).Replace("-", "").ToLowerInvariant();
            }
        }

        private static bool IsTrustedLoopbackUrl(string value)
        {
            Uri parsed;
            return Uri.TryCreate(value, UriKind.Absolute, out parsed)
                && parsed.Scheme == Uri.UriSchemeHttp && parsed.IsLoopback
                && parsed.Port >= 3080 && parsed.Port <= 3180;
        }

        private static string UpdateDescription(string current, string latest, string engineCurrent, string engineLatest, bool fullPackage, string scope = "product")
        {
            if (String.Equals(scope, "engine", StringComparison.Ordinal))
            {
                return "DeepSeek Harness"
                    + (String.IsNullOrEmpty(engineCurrent) ? "" : " " + engineCurrent)
                    + (String.IsNullOrEmpty(engineLatest) ? "" : "  →  " + engineLatest)
                    + "\r\n"
                    + L("交付方式：轻量内核更新", "Delivery: lightweight engine update");
            }
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

        private int ShowUpdateChoiceDialog(string current, string latest, string engineCurrent, string engineLatest, bool fullPackage)
        {
            using (Form dialog = new Form())
            using (Label title = new Label())
            using (Label description = new Label())
            using (Button updateNow = new Button())
            using (Button skip = new Button())
            using (Button later = new Button())
            {
                dialog.Text = L("DSH-Portable 更新", "DSH-Portable update");
                dialog.FormBorderStyle = FormBorderStyle.FixedDialog;
                dialog.StartPosition = FormStartPosition.CenterParent;
                dialog.ClientSize = new Size(520, 230);
                dialog.MinimizeBox = false;
                dialog.MaximizeBox = false;
                dialog.ShowInTaskbar = false;
                dialog.Font = Font;

                title.AutoSize = false;
                title.Font = new Font(dialog.Font, FontStyle.Bold);
                title.Location = new Point(28, 24);
                title.Size = new Size(464, 28);
                title.Text = L("发现可用更新", "An update is available");

                description.AutoSize = false;
                description.Location = new Point(28, 64);
                description.Size = new Size(464, 86);
                description.Text = UpdateDescription(current, latest, engineCurrent, engineLatest, fullPackage);

                updateNow.DialogResult = DialogResult.Yes;
                updateNow.Location = new Point(160, 174);
                updateNow.Size = new Size(104, 34);
                updateNow.Text = L("现在更新", "Update now");

                skip.DialogResult = DialogResult.No;
                skip.Location = new Point(274, 174);
                skip.Size = new Size(104, 34);
                skip.Text = L("跳过此版本", "Skip version");

                later.DialogResult = DialogResult.Cancel;
                later.Location = new Point(388, 174);
                later.Size = new Size(104, 34);
                later.Text = L("稍后", "Later");

                dialog.AcceptButton = updateNow;
                dialog.CancelButton = later;
                dialog.Controls.Add(title);
                dialog.Controls.Add(description);
                dialog.Controls.Add(updateNow);
                dialog.Controls.Add(skip);
                dialog.Controls.Add(later);
                DialogResult result = dialog.ShowDialog(this);
                if (result == DialogResult.Yes) return 1;
                if (result == DialogResult.No) return -1;
                return 0;
            }
        }

        private void ResetOperationUi()
        {
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
            progressDetail.Visible = false;
            activityRing.Indeterminate = true;
            activityRing.Value = 0;
            activityRing.Visible = true;
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
                activityRing.Indeterminate = false;
                activityRing.Value = percent;
                progressDetail.Text = percent + "%  ·  " + FormatBytes(current) + " / " + FormatBytes(total);
            }
            else
            {
                activityRing.Indeterminate = true;
                if (phase == "verifying") statusLabel.Text = L("正在验证 DSH-Portable 更新…", "Verifying the DSH-Portable update…");
                else if (phase == "installing") statusLabel.Text = L("正在安装 DSH-Portable 更新…", "Installing the DSH-Portable update…");
                else if (phase == "complete") statusLabel.Text = L("正在重新打开工作台…", "Reopening the workspace…");
                progressDetail.Text = phase == "complete" ? "100%" : L("会话、设置、插件和工作区保持不变", "Sessions, settings, plugins, and workspace stay in place");
            }
            progressDetail.Visible = true;
        }

        private void HandleStartupProgress(string jsonLine)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(HandleStartupProgress), jsonLine); return; }
            string phase = JsonString(jsonLine, "phase");
            if (phase == "runtime-preparing")
                statusLabel.Text = L("正在准备便携运行环境…", "Preparing the portable runtime…");
            else if (phase == "runtime-ready")
                statusLabel.Text = L("正在加载插件和会话…", "Loading plugins and sessions…");
            else if (phase == "plugins-ready" || phase == "workspace-starting")
                statusLabel.Text = L("正在启动本地工作台…", "Starting the local workspace…");
            else if (phase == "workspace-ready")
                statusLabel.Text = L("正在打开工作台…", "Opening the workspace…");
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
            AppendStartupTrace("native-host", "startup-failed", new Dictionary<string, object> { { "exitCode", exitCode } });
            startupTraceActive = false;
            operationRunning = false;
            if (String.Equals(
                Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_PREFLIGHT"),
                "1",
                StringComparison.Ordinal))
            {
                WriteNonInteractiveDiagnostic(message);
                Environment.ExitCode = exitCode != 0 ? exitCode : 1;
                allowClose = true;
                DisposeTrayIcon();
                Close();
                return;
            }
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
            string runtimeEntry = Path.Combine(root, "launcher", "runtime-entry.mjs");
            string cli = Path.Combine(root, "launcher", "portable-cli.mjs");
            if (!File.Exists(node) || !File.Exists(runtimeEntry) || !File.Exists(cli))
                throw new InvalidOperationException(L(
                    "DSH-Portable 文件夹不完整。请完整解压后再启动。",
                    "This DSH-Portable folder is incomplete. Extract the entire package before starting it."));

            StringBuilder arguments = new StringBuilder(QuoteArgument(runtimeEntry));
            arguments.Append(" ").Append(QuoteArgument(Path.GetFileName(cli)));
            foreach (string item in actionArgs) arguments.Append(" ").Append(QuoteArgument(item));
            if (!String.Equals(environmentId, "default", StringComparison.Ordinal)
                && !actionArgs.Any(item => String.Equals(item, "--environment", StringComparison.OrdinalIgnoreCase)))
                arguments.Append(" --environment ").Append(QuoteArgument(environmentId));
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
            string baseStateRoot = String.Equals(environmentId, "default", StringComparison.Ordinal)
                ? stateRoot
                : Directory.GetParent(Directory.GetParent(stateRoot).FullName).FullName;
            start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"] = baseStateRoot;
            if (startupTraceActive)
            {
                start.EnvironmentVariables["DSH_PORTABLE_STARTUP_ID"] = startupId;
                start.EnvironmentVariables["DSH_PORTABLE_STARTUP_STARTED_AT"] = startupStartedAt.ToString(CultureInfo.InvariantCulture);
            }

            using (Process process = Process.Start(start))
            {
                Task<string> stderr = process.StandardError.ReadToEndAsync();
                List<string> stdout = new List<string>();
                string line;
                while ((line = process.StandardOutput.ReadLine()) != null)
                {
                    string progressType = JsonString(line, "type");
                    if (progressCallback != null && (progressType == "update-progress" || progressType == "startup-progress")) progressCallback(line);
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
            if (!hiddenForAutomation)
            {
                ShowInTaskbar = true;
                Opacity = 1;
            }
            launchPanel.Visible = true;
            webView.Visible = false;
            activityRing.Visible = false;
            RestoreFailureIdentity();
            if (!desktopStart) ClientSize = new Size(640, 360);
            launchContent.Size = new Size(584, 304);
            CenterLaunchContent();
            MinimumSize = desktopStart ? new Size(900, 620) : Size.Empty;
            FormBorderStyle = desktopStart ? FormBorderStyle.Sizable : FormBorderStyle.FixedDialog;
            MaximizeBox = desktopStart;
            MinimizeBox = desktopStart;
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

        private void ShowShutdownFailure(string message)
        {
            operationRunning = false;
            launchPanel.Visible = true;
            launchPanel.BringToFront();
            activityRing.Visible = false;
            RestoreFailureIdentity();
            if (!desktopStart) ClientSize = new Size(640, 360);
            launchContent.Size = new Size(584, 304);
            CenterLaunchContent();
            MinimumSize = desktopStart ? new Size(900, 620) : Size.Empty;
            FormBorderStyle = desktopStart ? FormBorderStyle.Sizable : FormBorderStyle.FixedDialog;
            MaximizeBox = desktopStart;
            MinimizeBox = desktopStart;
            statusLabel.AutoEllipsis = false;
            statusLabel.Location = new Point(80, 53);
            statusLabel.Size = new Size(480, 28);
            statusLabel.Text = L("DeepSeek Harness 停止失败。", "DeepSeek Harness could not stop.");
            statusLabel.ForeColor = Color.FromArgb(178, 38, 38);
            string launcherLog = Path.Combine(ResolveLauncherLogDirectory(), "launcher.log");
            detailsBox.Text = (message ?? string.Empty) + "\r\n\r\n" + L("日志 / Log: ", "Log: ") + launcherLog;
            detailsBox.Visible = true;
            copyButton.Visible = true;
            closeButton.Location = new Point(468, 252);
            closeButton.Visible = true;
            AcceptButton = closeButton;
            ActiveControl = closeButton;
        }

        private void RestoreFailureIdentity()
        {
            productIcon.Visible = true;
            productIcon.Location = new Point(24, 20);
            productIcon.Size = new Size(40, 40);
            productLabel.Text = "DeepSeek Harness";
            productLabel.Location = new Point(80, 18);
            productLabel.Size = new Size(480, 30);
            productLabel.TextAlign = ContentAlignment.MiddleLeft;
            productLabel.Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold, GraphicsUnit.Point);
            statusLabel.TextAlign = ContentAlignment.MiddleLeft;
            statusLabel.Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
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
        private const string AppUserModelId = "io.github.wsl043.dsh-portable";

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

        private static void RegisterNotificationIdentity()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(
                    @"Software\Classes\AppUserModelId\" + AppUserModelId))
                {
                    if (key == null) return;
                    key.SetValue("DisplayName", "DeepSeek Harness", RegistryValueKind.ExpandString);
                    key.SetValue("IconUri", Application.ExecutablePath, RegistryValueKind.ExpandString);
                    key.SetValue("IconBackgroundColor", "00000000", RegistryValueKind.String);
                }
            }
            catch { }
        }

        private static string[] WaitForRestartHandoff(string[] args)
        {
            if (args == null || args.Length < 2
                || !String.Equals(args[0], "--dsh-restart-after-pid", StringComparison.Ordinal))
                return args ?? new string[0];
            int processId;
            if (!Int32.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out processId)
                || processId <= 0)
                throw new ArgumentException("The restart handoff process id is invalid.");
            try
            {
                using (Process previous = Process.GetProcessById(processId))
                {
                    if (!previous.WaitForExit(60000))
                        throw new TimeoutException("The previous DeepSeek Harness window did not finish closing.");
                }
            }
            catch (ArgumentException)
            {
                // The previous process already exited between launch and lookup.
            }
            return args.Skip(2).ToArray();
        }

        [STAThread]
        private static void Main(string[] args)
        {
            args = WaitForRestartHandoff(args);
            string executableRoot = Path.GetDirectoryName(Application.ExecutablePath);
            string environmentId = LauncherWindow.ResolveEnvironmentId(args);
            string stateRoot = LauncherWindow.ResolveStateRoot(executableRoot, environmentId);
            string instanceKey = LauncherWindow.ResolveEnvironmentInstanceKey(executableRoot, environmentId);
            int restoreMessage = LauncherWindow.RegisterEnvironmentRestoreMessage(instanceKey);
            int exitMessage = LauncherWindow.RegisterEnvironmentExitMessage(instanceKey);
            Mutex environmentMutex = null;
            bool ownsEnvironmentMutex = false;
            if (LauncherWindow.IsStartInvocation(args))
            {
                environmentMutex = new Mutex(true, @"Local\DSHPortable." + instanceKey, out ownsEnvironmentMutex);
                if (!ownsEnvironmentMutex)
                {
                    LauncherWindow.SignalExistingDesktopHost(restoreMessage);
                    environmentMutex.Dispose();
                    return;
                }
            }
            PortableProcessJob.Initialize();
            RegisterNotificationIdentity();
            SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Application.Run(new LauncherWindow(args, environmentId, stateRoot, restoreMessage, exitMessage));
            }
            finally
            {
                if (environmentMutex != null)
                {
                    if (ownsEnvironmentMutex) environmentMutex.ReleaseMutex();
                    environmentMutex.Dispose();
                }
            }
        }
    }
}
