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
        private const int WmClose = 0x0010;
        private const uint GwOwner = 4;
        private static string uiLanguage = CultureInfo.InstalledUICulture.TwoLetterISOLanguageName;
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
        private const int WebViewUnresponsivePromptThreshold = 2;

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
        private readonly Dictionary<string, string> taskInteractionState = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly HashSet<string> unreadCompletedSessions = new HashSet<string>(StringComparer.Ordinal);
        private readonly Queue<Tuple<string, string, string, string, string>> pendingNotificationActions = new Queue<Tuple<string, string, string, string, string>>();
        private readonly string root;
        private readonly string environmentId;
        private readonly string stateRoot;
        private readonly string startupId;
        private readonly long startupStartedAt;
        private readonly int restoreMessage;
        private readonly int exitMessage;
        private readonly int notificationActivationMessage;
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
        private string themePreference = "system";
        private string notificationSessionId;
        private readonly Panel desktopContent = new DesktopContentPanel { Dock = DockStyle.Fill };
        private bool logoDark;
        private string desktopMenuLanguage;
        private MenuStrip desktopMenu;
        private bool fullscreen;
        private Rectangle boundsBeforeFullscreen;
        private FormWindowState stateBeforeFullscreen;
        private readonly Dictionary<Keys, ToolStripMenuItem> desktopShortcuts = new Dictionary<Keys, ToolStripMenuItem>();

        private Uri applicationUri;
        private readonly List<string> webViewStartupTrace = new List<string>();
        private Stopwatch webViewStartupClock;
        private TaskCompletionSource<string> webViewProcessFailure;
        private TaskCompletionSource<string> workspaceSurfaceReady;
        private CoreWebView2Environment webViewEnvironment;
        private TaskCompletionSource<CoreWebView2BrowserProcessExitedEventArgs> webViewBrowserExited;
        private int ownedWebViewBrowserProcessId;
        private bool bundledWebViewLeaseRequired;
        private bool testWebViewBusyInjected;
        private bool testWebViewCrashInjected;
        private bool webViewRecoveryRunning;
        private bool webViewUnresponsivePromptVisible;
        private int webViewUnresponsiveCount;
        private System.Threading.Timer desktopHealthTimer;
        private readonly object desktopHealthGate = new object();
        private long desktopHealthAck;
        private int desktopHealthPending;
        private volatile bool desktopHealthStopped;
        private long desktopHealthLastWrite;
        private long desktopHealthLastSample;
        private double desktopHealthCpu;
        private bool desktopHealthWasDelayed;

        private bool webCacheCleanupRunning;

        internal LauncherWindow(string[] args, string selectedEnvironmentId, string selectedStateRoot, int environmentRestoreMessage, int environmentExitMessage, int environmentActivationMessage)
        {
            root = Path.GetDirectoryName(Application.ExecutablePath);
            environmentId = selectedEnvironmentId;
            stateRoot = selectedStateRoot;
            LoadStartupTheme();
            restoreMessage = environmentRestoreMessage;
            exitMessage = environmentExitMessage;
            notificationActivationMessage = environmentActivationMessage;
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
            if (desktopStart)
            {
                NativeTaskNotification.ConfigureOwner(root, environmentId,
                    ResolveEnvironmentInstanceKey(root, environmentId));
                NativeTaskNotification.ActionRequested += HandleNativeNotificationAction;
                NativeTaskNotification.Register();
            }
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
            // Keep the executable-owned DSH icon on the native frame so the
            // taskbar never falls back to the hosted WebView/Node identity.
            ShowIcon = true;
            StartPosition = testHidden ? FormStartPosition.Manual : FormStartPosition.CenterScreen;
            if (testHidden) Location = new Point(-32000, -32000);
            FormBorderStyle = desktopStart ? FormBorderStyle.Sizable : FormBorderStyle.FixedSingle;
            MaximizeBox = desktopStart;
            MinimizeBox = desktopStart;
            // Show a responsive native loading surface immediately. The real
            // DSH WebView replaces it only after its boot surface is ready.
            ShowInTaskbar = !nonInteractive && !testHidden;
            if (nonInteractive) Opacity = 0;
            else if (testHidden) Opacity = 1;
            ClientSize = desktopStart ? new Size(1280, 820) : new Size(440, 160);
            MinimumSize = desktopStart ? new Size(900, 620) : Size.Empty;
            BackColor = trayTheme == "dark" ? Color.FromArgb(24, 24, 26) : Color.FromArgb(248, 248, 248);
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

            launchPanel = new Panel { Dock = DockStyle.Fill, BackColor = BackColor };
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
                ConfigureDesktopLoadingSurface(L("正在加载插件…", "Loading plugins…"), false);

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
            taskNotificationsItem = new ToolStripMenuItem(L("任务通知", "Task notifications"))
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
            Controls.Add(desktopContent);
            desktopContent.Controls.Add(webView);
            desktopContent.Controls.Add(launchPanel);
            if (desktopStart) InitializeDesktopMenu();
            activityRing.FramePainted += delegate
            {
                if (!desktopStart || desktopReady) return;
                AppendStartupTrace("native-host", activityRing.PaintedFrames == 1 ? "native-loading-ready" : "native-loading-animation",
                    new Dictionary<string, object> { { "theme", trayTheme }, { "background", BackColor.ToArgb() },
                        { "paintedFrames", activityRing.PaintedFrames }, { "rotation", activityRing.Rotation } });
            };
            launchPanel.Visible = true;
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

    }
}
