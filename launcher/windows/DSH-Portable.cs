using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("DeepSeek-Herness")]
[assembly: AssemblyDescription("Native desktop host for DeepSeek Harness")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyProduct("DeepSeek-Herness")]
[assembly: AssemblyCopyright("Copyright © WSL043 2026")]
[assembly: AssemblyVersion("0.2.0.4")]
[assembly: AssemblyFileVersion("0.2.0.4")]

namespace DshPortable
{
    internal sealed class LauncherWindow : Form
    {
        internal const int WmPortableExit = 0x8043;
        internal const int WmPortableRestore = 0x8044;
        private enum WindowCloseBehavior { Tray, Exit }

        private readonly Panel launchPanel;
        private readonly Panel launchContent;
        private readonly PictureBox productIcon;
        private readonly Label productLabel;
        private readonly Label statusLabel;
        private readonly ProgressBar progress;
        private readonly TextBox detailsBox;
        private readonly Label updateDescription;
        private readonly Button updateButton;
        private readonly Button laterButton;
        private readonly Button copyButton;
        private readonly Button closeButton;
        private readonly WebView2 webView;
        private readonly NotifyIcon trayIcon;
        private readonly ToolStripMenuItem closeToTrayItem;
        private readonly ToolStripMenuItem closeToExitItem;
        private readonly string root;
        private readonly string[] launcherArgs;
        private readonly bool nonInteractive;
        private readonly bool desktopStart;
        private TaskCompletionSource<bool> updateChoice;
        private bool operationRunning = true;
        private bool desktopReady;
        private bool shutdownRunning;
        private bool allowClose;
        private bool backendStarted;
        private bool trayNoticeShown;
        private WindowCloseBehavior closeBehavior;
        private Uri applicationUri;

        internal LauncherWindow(string[] args)
        {
            root = Path.GetDirectoryName(Application.ExecutablePath);
            launcherArgs = ResolveArguments(args);
            nonInteractive = Array.Exists(launcherArgs, item =>
                string.Equals(item, "--json", StringComparison.OrdinalIgnoreCase));
            desktopStart = !nonInteractive && IsStartCommand(launcherArgs);

            Text = "DeepSeek-Herness";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = desktopStart;
            ShowInTaskbar = !nonInteractive;
            if (nonInteractive) Opacity = 0;
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
                Text = IsStopCommand(launcherArgs) ? "正在停止 DeepSeek Harness…" : "正在启动 DeepSeek Harness…",
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
                Text = "现在更新",
                Size = new Size(112, 34),
                Location = new Point(264, 154),
                Visible = false,
            };
            updateButton.Click += delegate { if (updateChoice != null) updateChoice.TrySetResult(true); };
            laterButton = new Button
            {
                Text = "稍后",
                Size = new Size(96, 34),
                Location = new Point(388, 154),
                Visible = false,
            };
            laterButton.Click += delegate { if (updateChoice != null) updateChoice.TrySetResult(false); };

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
                Text = "复制详情",
                Size = new Size(116, 32),
                Location = new Point(320, 252),
                Visible = false,
            };
            copyButton.Click += delegate
            {
                if (string.IsNullOrEmpty(detailsBox.Text)) return;
                try { Clipboard.SetText(detailsBox.Text); }
                catch { copyButton.Text = "复制失败"; }
            };
            closeButton = new Button
            {
                Text = "关闭",
                Size = new Size(92, 32),
                Location = new Point(412, 252),
                Visible = false,
            };
            closeButton.Click += delegate { allowClose = true; Close(); };
            CancelButton = closeButton;

            launchContent.Controls.Add(productIcon);
            launchContent.Controls.Add(productLabel);
            launchContent.Controls.Add(statusLabel);
            launchContent.Controls.Add(progress);
            launchContent.Controls.Add(updateDescription);
            launchContent.Controls.Add(updateButton);
            launchContent.Controls.Add(laterButton);
            launchContent.Controls.Add(detailsBox);
            launchContent.Controls.Add(copyButton);
            launchContent.Controls.Add(closeButton);
            launchPanel.Controls.Add(launchContent);

            closeBehavior = LoadCloseBehavior();
            closeToTrayItem = new ToolStripMenuItem("最小化到托盘") { Checked = closeBehavior == WindowCloseBehavior.Tray };
            closeToExitItem = new ToolStripMenuItem("退出程序") { Checked = closeBehavior == WindowCloseBehavior.Exit };
            closeToTrayItem.Click += delegate { SaveCloseBehavior(WindowCloseBehavior.Tray); };
            closeToExitItem.Click += delegate { SaveCloseBehavior(WindowCloseBehavior.Exit); };
            ToolStripMenuItem closeBehaviorMenu = new ToolStripMenuItem("关闭窗口时");
            closeBehaviorMenu.DropDownItems.Add(closeToTrayItem);
            closeBehaviorMenu.DropDownItems.Add(closeToExitItem);
            ContextMenuStrip trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("打开 DeepSeek Harness", null, delegate { RestoreFromTray(); });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(closeBehaviorMenu);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("退出 DeepSeek Harness", null, delegate { if (!shutdownRunning) BeginDesktopShutdown(); });
            trayIcon = new NotifyIcon
            {
                Icon = Icon,
                Text = "DeepSeek Harness",
                ContextMenuStrip = trayMenu,
                Visible = false,
            };
            trayIcon.DoubleClick += delegate { RestoreFromTray(); };

            webView = new WebView2 { Dock = DockStyle.Fill, Visible = false };
            Controls.Add(webView);
            Controls.Add(launchPanel);
            CenterLaunchContent();
            Shown += async delegate { await RunLauncherAsync(); };
        }

        protected override void OnFormClosing(FormClosingEventArgs eventArgs)
        {
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
            Hide();
            ShowInTaskbar = false;
            trayIcon.Visible = true;
            if (!trayNoticeShown)
            {
                trayNoticeShown = true;
                trayIcon.ShowBalloonTip(3000, "DeepSeek Harness 仍在运行", "正在执行的任务会继续。右键托盘图标可以打开或退出。", ToolTipIcon.Info);
            }
        }

        private void RestoreFromTray()
        {
            if (!desktopReady) return;
            ShowInTaskbar = true;
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
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

        private void SaveCloseBehavior(WindowCloseBehavior behavior)
        {
            closeBehavior = behavior;
            closeToTrayItem.Checked = behavior == WindowCloseBehavior.Tray;
            closeToExitItem.Checked = behavior == WindowCloseBehavior.Exit;
            string filename = LauncherSettingsPath();
            string temporary = filename + ".tmp";
            Directory.CreateDirectory(Path.GetDirectoryName(filename));
            File.WriteAllText(temporary, behavior == WindowCloseBehavior.Exit
                ? "{\"schemaVersion\":1,\"closeBehavior\":\"exit\"}\r\n"
                : "{\"schemaVersion\":1,\"closeBehavior\":\"tray\"}\r\n", new UTF8Encoding(false));
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
            DisposeTrayIcon();
            trayIcon.Dispose();
            base.OnFormClosed(eventArgs);
        }

        private void BeginDesktopShutdown()
        {
            shutdownRunning = true;
            trayIcon.Visible = true;
            webView.Enabled = false;
            Text = "DeepSeek-Herness · 正在关闭";
            Task.Run(() => InvokePortableCli(new[] { "stop", "--no-browser", "--json" })).ContinueWith(task =>
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    Tuple<int, string> result = task.IsFaulted
                        ? Tuple.Create(1, task.Exception == null ? "停止失败。" : task.Exception.GetBaseException().Message)
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
                    MessageBox.Show(this, result.Item2, "DeepSeek Harness 停止失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
                        throw new InvalidOperationException("DeepSeek-Herness 原生窗口无法接收退出请求。");
                    if (!process.WaitForExit(45000))
                        throw new TimeoutException("DeepSeek-Herness 原生窗口未能在 45 秒内正常退出。");
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
                    await CheckAndApplyUpdateAsync();
                    statusLabel.Text = "正在启动 DeepSeek Harness…";
                    Tuple<int, string> started = await Task.Run(() => InvokePortableCli(new[] { "start", "--no-browser", "--json" }));
                    if (started.Item1 != 0) { HandleFailure(started.Item1, started.Item2); return; }
                    backendStarted = true;
                    string url = JsonString(started.Item2, "url");
                    if (!IsTrustedLoopbackUrl(url))
                    {
                        HandleFailure(1, "DeepSeek Harness 返回了无效的本地地址。\r\n" + started.Item2);
                        return;
                    }
                    int startupHold;
                    if (Int32.TryParse(Environment.GetEnvironmentVariable("DSH_PORTABLE_STARTUP_HOLD_MS"), out startupHold)
                        && startupHold > 0)
                        await Task.Delay(Math.Min(startupHold, 10000));
                    await ShowDesktopAsync(url);
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
                HandleFailure(result.Item1, result.Item2.Length > 0 ? result.Item2 : "DeepSeek Harness 无法完成请求的操作。");
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

        private async Task CheckAndApplyUpdateAsync()
        {
            if (string.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_SKIP_UPDATE_CHECK"), "1", StringComparison.Ordinal))
            {
                ResetOperationUi();
                return;
            }
            statusLabel.Text = "正在检查更新…";
            Tuple<int, string> check = await Task.Run(() => InvokePortableCli(new[] { "check-update", "--json" }));
            if (check.Item1 != 0) { ResetOperationUi(); return; }
            string updateStatus = JsonString(check.Item2, "status");
            string latest = JsonString(check.Item2, "latest");
            if (updateStatus == "available")
            {
                bool accepted = await ShowUpdateChoiceAsync(latest, false);
                if (accepted)
                {
                    statusLabel.Text = "正在安全更新 DeepSeek Harness…";
                    progress.Visible = true;
                    Tuple<int, string> updated = await Task.Run(() => InvokePortableCli(new[] { "update", "--no-browser", "--json" }));
                    if (updated.Item1 != 0) throw new InvalidOperationException(updated.Item2);
                }
                else await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--json" }));
            }
            else if (updateStatus == "full-package-required")
            {
                bool openDownload = await ShowUpdateChoiceAsync(latest, true);
                await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--json" }));
                if (openDownload)
                    Process.Start(new ProcessStartInfo("https://github.com/WSL043/DSH-Portable/releases/latest") { UseShellExecute = true });
            }
            ResetOperationUi();
        }

        private async Task ShowDesktopAsync(string url)
        {
            statusLabel.Text = "正在打开工作台…";
            string userData = ResolveWebViewDataRoot();
            Directory.CreateDirectory(userData);
            try
            {
                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userData);
                await webView.EnsureCoreWebView2Async(environment);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                throw new InvalidOperationException(
                    "此电脑缺少 Microsoft Edge WebView2 Runtime。\r\n请安装官方 Evergreen Runtime 后重新打开：\r\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703");
            }

            applicationUri = new Uri(url);
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
            TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs> navigation =
                new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>();
            EventHandler<CoreWebView2NavigationCompletedEventArgs> navigationCompleted = delegate(object sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
            {
                navigation.TrySetResult(eventArgs);
            };
            webView.CoreWebView2.NavigationCompleted += navigationCompleted;
            webView.Source = applicationUri;

            Task completed = await Task.WhenAny(navigation.Task, Task.Delay(30000));
            webView.CoreWebView2.NavigationCompleted -= navigationCompleted;
            if (completed != navigation.Task)
                throw new TimeoutException("DeepSeek Harness 工作台未能在 30 秒内打开。");
            CoreWebView2NavigationCompletedEventArgs result = await navigation.Task;
            if (!result.IsSuccess)
                throw new InvalidOperationException("DeepSeek Harness 工作台加载失败：" + result.WebErrorStatus);

            SuspendLayout();
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = true;
            MinimizeBox = true;
            ClientSize = new Size(1280, 820);
            MinimumSize = new Size(900, 620);
            CenterToScreen();
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

        private Task<bool> ShowUpdateChoiceAsync(string latest, bool fullPackage)
        {
            progress.Visible = false;
            ClientSize = new Size(560, 260);
            launchContent.Size = new Size(504, 208);
            CenterLaunchContent();
            statusLabel.AutoEllipsis = false;
            statusLabel.Size = new Size(400, 34);
            statusLabel.Text = fullPackage
                ? "此版本需要完整升级" + (String.IsNullOrEmpty(latest) ? "" : " · " + latest)
                : "发现新版" + (String.IsNullOrEmpty(latest) ? "" : " · " + latest);
            updateDescription.Text = fullPackage
                ? "运行环境或启动器兼容边界已变化。当前版本仍可继续使用。"
                : "仅下载已变更的 DSH 应用组件；设置、会话和工作区保持原位。";
            updateDescription.Visible = true;
            updateButton.Text = fullPackage ? "打开下载页" : "现在更新";
            updateButton.Visible = true;
            laterButton.Visible = true;
            updateChoice = new TaskCompletionSource<bool>();
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
            statusLabel.Text = IsStopCommand(launcherArgs) ? "正在停止 DeepSeek Harness…" : "正在启动 DeepSeek Harness…";
            updateDescription.Visible = false;
            updateButton.Visible = false;
            laterButton.Visible = false;
            progress.Visible = true;
        }

        private static string JsonString(string json, string name)
        {
            Match match = Regex.Match(json ?? String.Empty, "\\\"" + Regex.Escape(name) + "\\\"\\s*:\\s*\\\"(?<value>(?:\\\\.|[^\\\"])*)\\\"");
            return match.Success ? Regex.Unescape(match.Groups["value"].Value) : String.Empty;
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
            string node = Path.Combine(root, "runtime", "node", "node.exe");
            string cli = Path.Combine(root, "launcher", "portable-cli.mjs");
            if (!File.Exists(node) || !File.Exists(cli))
                throw new InvalidOperationException("This DSH-Portable folder is incomplete. Extract the entire package before starting it.");

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
                Task<string> stdout = process.StandardOutput.ReadToEndAsync();
                Task<string> stderr = process.StandardError.ReadToEndAsync();
                process.WaitForExit();
                Task.WaitAll(stdout, stderr);
                string message = (stderr.Result + Environment.NewLine + stdout.Result).Trim();
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
            statusLabel.Text = IsStopCommand(launcherArgs) ? "DeepSeek Harness 停止失败。" : "DeepSeek Harness 启动失败。";
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
