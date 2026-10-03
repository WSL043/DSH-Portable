// Pure portable Windows entry: launch, supervise, own dsh://, and apply updates.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
[assembly: System.Reflection.AssemblyTitle("DeepSeek Harness Portable")]
[assembly: System.Reflection.AssemblyProduct("DSH-Portable official-payload")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.5")]
[assembly: System.Reflection.AssemblyInformationalVersion("1.0.0-alpha.5")]

internal static class PortableLauncher {
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly Regex VersionPattern = new Regex(@"^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$", RegexOptions.CultureInvariant);
    private static readonly Regex UpdatedName = new Regex(@"^deepseek-harness-(\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?)-win-x64\.exe$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private const string ProtocolKey = @"Software\Classes\dsh\shell\open\command";
    private static RegistrySnapshot ProtocolBefore;
    private static string Root, AppRoot, DataRoot, LauncherData;

    // Chinese UI on Chinese Windows, English elsewhere; diagnostics stay in English.
    private static readonly bool Chinese = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh";
    private static string T(string zh, string en) { return Chinese ? zh : en; }

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

    [STAThread]
    private static int Main(string[] args) {
        // Without this, Windows bitmap-stretches the dialogs on scaled displays and the text turns blurry.
        try { SetProcessDPIAware(); } catch { }
        try {
            string updateVersion;
            if (TryUpdatedVersion(Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName), args, out updateVersion))
                return ApplyUpdatedCopy(updateVersion);
            return Run(args);
        } catch (Exception error) {
            try { Log("fatal: " + SafeMessage(error.Message)); } catch { }
            MessageBox.Show(error.Message + "\r\n\r\n" + T("便携启动失败。", "Portable could not start."), "DeepSeek Harness Portable", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int ApplyUpdatedCopy(string version) {
        // This mode intentionally writes only through the root-owned update engine.
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string selfPath = Process.GetCurrentProcess().MainModule.FileName;
        string pending = Path.GetDirectoryName(selfPath);
        if (!String.Equals(Path.GetFileName(pending), "pending", StringComparison.OrdinalIgnoreCase)) throw new IOException("Updated launcher is not under the updater pending directory.");
        string cache = Directory.GetParent(pending).FullName;
        if (!cache.StartsWith(Path.GetFullPath(local).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Updated launcher cache is outside LocalAppData.");
        string pointer = Path.Combine(cache, "portable-root.txt");
        if (!File.Exists(pointer)) throw new IOException("Portable root pointer is missing; update was not applied.");
        string root = Path.GetFullPath(File.ReadAllText(pointer, Encoding.UTF8).Trim());
        if (root.Length <= 3 || !File.Exists(Path.Combine(root, "launcher", "apply-update.ps1"))) throw new IOException("Portable update root is invalid.");
        string engine = Path.Combine(root, "launcher", "apply-update.ps1");
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        var ps = new ProcessStartInfo(powershell) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        // A parent PowerShell 7 shell leaks its module path, which breaks core cmdlets in Windows PowerShell 5.1.
        ps.EnvironmentVariables.Remove("PSModulePath");
        ps.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(engine) + " -Root " + Quote(root) + " -Version " + Quote(version) + " -SelfPath " + Quote(selfPath);
        int code = 1;
        try { using (Process child = Process.Start(ps)) { child.WaitForExit(); code = child.ExitCode; } }
        finally {
            string launcher = Path.Combine(root, "DeepSeek Harness Portable.exe");
            if (File.Exists(launcher)) Process.Start(new ProcessStartInfo(launcher) { UseShellExecute = false, WorkingDirectory = root });
        }
        return code == 0 ? 0 : 1;
    }

    private static bool TryUpdatedVersion(string filename, string[] args, out string version) {
        version = null;
        Match match = UpdatedName.Match(filename ?? "");
        if (!match.Success || !args.Contains("--updated", StringComparer.OrdinalIgnoreCase)) return false;
        version = match.Groups[1].Value;
        if (!VersionPattern.IsMatch(version)) throw new IOException("Updated launcher filename has an invalid version.");
        return true;
    }

    private static int Run(string[] args) {
        Root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
        if (Root.Length <= 3) throw new IOException("Extract into a folder, not a drive root. / 请解压到独立文件夹。");
        CheckPath(Root);
        AppRoot = Path.Combine(Root, "app"); DataRoot = Path.Combine(Root, "data"); LauncherData = Path.Combine(DataRoot, "launcher");
        string link = null, probe = null; int restartPid = 0;
        for (int i = 0; i < args.Length; i++) {
            string arg = args[i]; int value;
            if (arg.StartsWith("--probe-port=") && probe == null && Int32.TryParse(arg.Substring(13), out value) && value >= 1024 && value <= 65535) probe = value.ToString();
            else if (arg.StartsWith("--restart-after=") && restartPid == 0 && Int32.TryParse(arg.Substring(16), out value) && value > 0) restartPid = value;
            // The protocol handler registered by this launcher passes the link as the token after --open.
            else if (arg == "--open") {
                if (link != null || i + 1 >= args.Length || !IsValidLink(args[i + 1])) throw new IOException("Invalid dsh:// link.");
                link = args[++i];
            }
            else if (arg.StartsWith("dsh://", StringComparison.OrdinalIgnoreCase) && link == null && IsValidLink(arg)) link = arg;
            else throw new IOException("Unsupported portable launch argument. / 不支持此启动参数。");
        }

        CheckPath(LauncherData); Directory.CreateDirectory(LauncherData);
        bool created;
        using (var mutex = new Mutex(true, MutexName(Root), out created)) {
            if (!created) {
                if (link != null) { StartOfficial(link, probe, false); return 0; }
                return 0;
            }
            try {
                if (NeedsBootstrap() && !RunBootstrapInstall()) return 1;
                return Supervise(link, probe, restartPid);
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static bool NeedsBootstrap() {
        string marker = Path.Combine(Root, "launcher", "bootstrap.json");
        if (!File.Exists(marker)) return false;
        Dictionary<string, object> bootstrap = ReadJson(marker);
        if (GetString(bootstrap, "mode") != "bootstrap") throw new IOException("Portable bootstrap marker is invalid.");
        string current = Path.Combine(AppRoot, "current.json");
        if (!File.Exists(current)) return true;
        Dictionary<string, object> state = ReadJson(current);
        string version = GetString(state, "version");
        if (!VersionPattern.IsMatch(version)) throw new IOException("Invalid app/current.json version.");
        return !Directory.Exists(Path.Combine(AppRoot, version));
    }

    private static bool RunBootstrapInstall() {
        string selfPath = Process.GetCurrentProcess().MainModule.FileName;
        string cancelPath = Path.Combine(LauncherData, "bootstrap-cancel.request");
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var form = new BootstrapInstallForm(Root, selfPath, cancelPath)) {
            Application.Run(form);
            return form.Installed;
        }
    }

    private static int Supervise(string initialLink, string probe, int restartPid) {
        if (restartPid > 0) WaitForRestartProcess(restartPid);
        Dictionary<string, object> state = ReadJson(Path.Combine(AppRoot, "current.json"));
        string version = GetString(state, "version"), previous = GetString(state, "previous");
        bool pendingHealth = GetBool(state, "pendingHealth");
        if (!VersionPattern.IsMatch(version)) throw new IOException("Invalid app/current.json version.");
        string executable = AppExecutable(version);
        EnsureApplication(executable);
        CheckExternalOfficialOrPort(executable);
        RunSeedPluginsBeforeLaunch();
        // Only one official desktop can run at a time (fixed port), so the root whose launcher passed these checks
        // is the only possible requester of an update. Writing the pointer earlier let a second Portable copy that
        // failed to start redirect another root's update to itself.
        WritePortableRootPointer(ReadCacheName());

        ProtocolBefore = CaptureProtocol();
        bool protocolChanged = false;
        try {
            protocolChanged = true; RegisterProtocol();
            Log("starting version=" + version);
            Process app = StartOfficialProcess(executable, initialLink, probe);
            if (pendingHealth) {
                if (app.WaitForExit(20000)) {
                    int exitCode = app.ExitCode;
                    if (ShouldRollback(true, exitCode) && !String.IsNullOrEmpty(previous) && VersionPattern.IsMatch(previous) && previous != version) {
                        state["version"] = previous; state["previous"] = ""; state["pendingHealth"] = false; state["switchedAt"] = DateTime.UtcNow.ToString("o");
                        // The failed version must never become the rollback target, and the update engine must not retry it right away.
                        state["rejected"] = new Dictionary<string, object> { { "version", version }, { "at", DateTime.UtcNow.ToString("o") } };
                        WriteJsonAtomic(Path.Combine(AppRoot, "current.json"), state);
                        try { CheckPath(Path.Combine(AppRoot, version)); Directory.Delete(Path.Combine(AppRoot, version), true); } catch (Exception cleanupError) { Log("could not remove the rejected version: " + SafeMessage(cleanupError.Message)); }
                        WriteJsonAtomic(Path.Combine(LauncherData, "update-status.json"), new Dictionary<string, object> { { "status", "rolled-back" }, { "version", version }, { "error", "New version exited before the 20-second health window." } });
                        Log("health rollback version=" + version + " exit=" + exitCode);
                        version = previous; executable = AppExecutable(previous); EnsureApplication(executable);
                        app = StartOfficialProcess(executable, null, probe);
                    } else {
                        Log("health process exited early with code=" + exitCode + "; no previous version available");
                    }
                } else {
                    state["pendingHealth"] = false;
                    WriteJsonAtomic(Path.Combine(AppRoot, "current.json"), state);
                    Log("health window passed version=" + version);
                }
            }
            while (!app.WaitForExit(1000)) {
                EnsureProtocolOwned();
            }
            // The official app may relaunch itself (settings restart, protocol hand-off); keep supervising while any of its processes remain.
            DateTime relaunchGrace = DateTime.UtcNow.AddSeconds(10);
            while (HasOwnedProcesses(AppRoot, false) || DateTime.UtcNow < relaunchGrace) {
                EnsureProtocolOwned();
                Thread.Sleep(1000);
                if (HasOwnedProcesses(AppRoot, false)) relaunchGrace = DateTime.UtcNow.AddSeconds(3);
            }
            Log("desktop exited version=" + version + " code=" + app.ExitCode);
            return app.ExitCode;
        } finally {
            if (protocolChanged) RestoreProtocol(ProtocolBefore);
        }
    }

    private static bool ShouldRollback(bool pendingHealth, int exitCode) { return pendingHealth && exitCode != 0; }

    private static void WaitForRestartProcess(int pid) {
        try {
            using (Process previous = Process.GetProcessById(pid)) {
                try {
                    if (!previous.HasExited) {
                        string path = previous.MainModule.FileName;
                        if (path == null || !path.StartsWith(AppRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Restart process is not owned by this Portable.");
                        if (!previous.WaitForExit(120000)) throw new IOException("The previous desktop has not exited.");
                    }
                } catch (System.ComponentModel.Win32Exception) { if (!previous.HasExited) throw; }
            }
        } catch (ArgumentException) { }
        DateTime deadline = DateTime.UtcNow.AddSeconds(30);
        while (HasOwnedProcesses(AppRoot) && DateTime.UtcNow < deadline) Thread.Sleep(100);
        if (HasOwnedProcesses(AppRoot)) throw new IOException("Desktop runtimes have not exited.");
    }

    private static void CheckExternalOfficialOrPort(string executable) {
        // A previous run's processes can still be exiting (Windows reports an unreadable path meanwhile), for example when the
        // user quits and relaunches at once, so give a genuine leftover a short time to disappear before refusing.
        DateTime deadline = DateTime.UtcNow.AddSeconds(20);
        string conflict;
        while ((conflict = FindOfficialConflict()) != null) {
            if (DateTime.UtcNow >= deadline) throw new IOException(conflict);
            Thread.Sleep(500);
        }
    }

    private static void RunSeedPluginsBeforeLaunch() {
        string manifest = Path.Combine(Root, "launcher", "seed", "seed.json");
        string profile = Path.Combine(DataRoot, "dsh-home", "profiles", "desktop", "package.json");
        string script = Path.Combine(Root, "launcher", "seed-plugins.ps1");
        if (!File.Exists(manifest) || !File.Exists(profile) || !File.Exists(script)) return;
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        var start = new ProcessStartInfo(powershell) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = Root };
        start.EnvironmentVariables.Remove("PSModulePath");
        start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script) + " -Root " + Quote(Root);
        try {
            using (Process child = Process.Start(start)) {
                if (!child.WaitForExit(30000)) {
                    try { child.Kill(); child.WaitForExit(5000); } catch { }
                    SeedLog("plugin seed timed out; continuing official app startup");
                } else if (child.ExitCode != 0) {
                    SeedLog("plugin seed failed exit=" + child.ExitCode + "; continuing official app startup");
                } else {
                    SeedLog("plugin seed completed; continuing official app startup");
                }
            }
        } catch (Exception error) {
            SeedLog("plugin seed could not run: " + SafeMessage(error.Message) + "; continuing official app startup");
        }
    }
    private static void SeedLog(string message) { try { Log(message); } catch { } }

    private sealed class BootstrapInstallForm : Form {
        private readonly string _root, _selfPath, _cancelPath, _statusPath;
        private readonly Label _stage, _detail;
        private readonly ProgressBar _progress;
        private readonly Button _retry, _cancel;
        private readonly System.Windows.Forms.Timer _timer;
        private Process _engine;
        private bool _allowClose, _cancelRequested;
        public bool Installed { get; private set; }

        public BootstrapInstallForm(string root, string selfPath, string cancelPath) {
            _root = root; _selfPath = selfPath; _cancelPath = cancelPath;
            _statusPath = Path.Combine(root, "data", "launcher", "update-status.json");
            Text = "DeepSeek Harness Portable - " + T("首次安装", "First-time setup");
            // Lay out at 96 DPI in the system UI font, then let WinForms scale to the display.
            SuspendLayout();
            Font = SystemFonts.MessageBoxFont;
            AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(470, 154); FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen; MaximizeBox = false; MinimizeBox = false;
            _stage = new Label { AutoSize = false, Location = new Point(18, 16), Size = new Size(434, 24), Text = T("正在准备首次安装...", "Preparing first-time setup...") };
            _detail = new Label { AutoSize = false, Location = new Point(18, 43), Size = new Size(434, 38), Text = T("首次启动将从官方 CDN 下载并验证官方桌面端。", "The official desktop app is downloaded from the official CDN and verified on first launch.") };
            _progress = new ProgressBar { Location = new Point(18, 88), Size = new Size(434, 18), Minimum = 0, Maximum = 100, Style = ProgressBarStyle.Continuous };
            _retry = new Button { Location = new Point(282, 116), Size = new Size(80, 26), Text = T("重试", "Retry"), Visible = false, Enabled = false };
            _cancel = new Button { Location = new Point(372, 116), Size = new Size(80, 26), Text = T("取消", "Cancel") };
            _stage.Font = new Font(Font, FontStyle.Bold);
            Controls.AddRange(new Control[] { _stage, _detail, _progress, _retry, _cancel });
            ResumeLayout(false);
            _retry.Click += delegate { StartAttempt(); };
            _cancel.Click += delegate { RequestCancel(); };
            _timer = new System.Windows.Forms.Timer { Interval = 350 };
            _timer.Tick += delegate { PollEngine(); };
            Load += delegate { StartAttempt(); _timer.Start(); };
            FormClosing += OnFormClosing;
        }

        private void StartAttempt() {
            if (_engine != null) { _engine.Dispose(); _engine = null; }
            try {
                if (File.Exists(_cancelPath)) File.Delete(_cancelPath);
                _cancelRequested = false; _retry.Visible = false; _retry.Enabled = false;
                _cancel.Visible = true; _cancel.Enabled = true; _cancel.Text = T("取消", "Cancel");
                _stage.Text = T("正在读取已验收版本索引...", "Reading the accepted version index...");
                _detail.Text = T("连接官方服务并准备下载。", "Connecting to the official service.");
                _progress.Value = 0;
                string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
                string engine = Path.Combine(_root, "launcher", "apply-update.ps1");
                var start = new ProcessStartInfo(powershell) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = _root };
                start.EnvironmentVariables.Remove("PSModulePath");
                start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(engine) + " -Root " + Quote(_root) + " -Install -SelfPath " + Quote(_selfPath) + " -CancelFile " + Quote(_cancelPath);
                _engine = Process.Start(start);
                if (_engine == null) throw new IOException("Could not start the Windows PowerShell update engine.");
            } catch (Exception error) { ShowFailure(error.Message); }
        }

        private void RequestCancel() {
            if (_engine == null || _engine.HasExited) { _allowClose = true; Close(); return; }
            _cancelRequested = true; _cancel.Enabled = false; _cancel.Text = T("正在取消...", "Cancelling...");
            _stage.Text = T("正在安全取消...", "Cancelling safely...");
            try { File.WriteAllText(_cancelPath, "cancel\n", Encoding.UTF8); }
            catch (Exception error) { _detail.Text = T("无法写入取消请求：", "Could not request cancellation: ") + SafeMessage(error.Message); }
        }

        private void PollEngine() {
            Dictionary<string, object> status = null;
            try { if (File.Exists(_statusPath)) status = ReadJson(_statusPath); } catch { }
            if (status != null) {
                string phase = GetString(status, "phase");
                long downloaded = GetLong(status, "downloadedBytes"), total = GetLong(status, "totalBytes");
                int percent = (int)Math.Max(0, Math.Min(100, GetLong(status, "progress")));
                _stage.Text = StageText(phase);
                if (total > 0) _detail.Text = FormatBytes(downloaded) + " / " + FormatBytes(total) + "  (" + percent.ToString() + "%)";
                else if (!String.IsNullOrEmpty(GetString(status, "error"))) _detail.Text = GetString(status, "error");
                _progress.Value = percent;
            }
            if (_engine == null || !_engine.HasExited) return;
            int code = _engine.ExitCode;
            if (code == 0 && IsInstalled()) {
                Installed = true; _allowClose = true; _timer.Stop(); Close(); return;
            }
            string state = status == null ? "" : GetString(status, "status");
            if (_cancelRequested || state == "cancelled") {
                _timer.Stop(); _allowClose = true; Close(); return;
            }
            string errorText = status == null ? "Update engine exited with code " + code + "." : GetString(status, "error");
            ShowFailure(errorText);
        }

        private bool IsInstalled() {
            try {
                Dictionary<string, object> state = ReadJson(Path.Combine(_root, "app", "current.json"));
                string version = GetString(state, "version");
                if (!VersionPattern.IsMatch(version)) return false;
                string executable = Path.Combine(_root, "app", version, "DeepSeek Harness.exe");
                return File.Exists(executable) && File.Exists(Path.Combine(Path.GetDirectoryName(executable), "resources", "app.asar"));
            } catch { return false; }
        }

        private void ShowFailure(string detail) {
            _stage.Text = T("首次安装失败", "First-time setup failed");
            _detail.Text = FriendlyFailure(detail);
            _progress.Value = 0; _cancel.Visible = false;
            // Retry takes Cancel's place so the only action sits at the right edge.
            _retry.Location = _cancel.Location;
            _retry.Visible = true; _retry.Enabled = true;
        }

        private static string StageText(string phase) {
            if (phase == "downloading") return T("下载中...", "Downloading...");
            if (phase == "verifying") return T("校验中...", "Verifying...");
            if (phase == "extracting") return T("解包中...", "Extracting...");
            if (phase == "switching" || phase == "waiting-for-exit") return T("切换中...", "Switching...");
            if (phase == "reading-index") return T("正在读取已验收版本索引...", "Reading the accepted version index...");
            return T("正在准备首次安装...", "Preparing first-time setup...");
        }

        private static string FormatBytes(long value) { return (Math.Max(0, value) / (1024.0 * 1024.0)).ToString("0.0") + " MiB"; }
        private static long GetLong(Dictionary<string, object> value, string key) { object raw; long result; return value != null && value.TryGetValue(key, out raw) && Int64.TryParse(Convert.ToString(raw), out result) ? result : 0; }
        private static string FriendlyFailure(string detail) {
            string lower = (detail ?? "").ToLowerInvariant();
            string kind = lower.Contains("digest") || lower.Contains("signature") || lower.Contains("hash") || lower.Contains("size mismatch") || lower.Contains("invalid") || lower.Contains("untrusted") || lower.Contains("archive") || lower.Contains("bound") || lower.Contains("校验") ? T("校验失败。", "Verification failed.") :
                lower.Contains("disk") || lower.Contains("space") || lower.Contains("0x70") || lower.Contains("not enough") ? T("磁盘空间不足。", "Not enough disk space.") :
                lower.Contains("timeout") || lower.Contains("network") || lower.Contains("remote name") || lower.Contains("connection") || lower.Contains("download") ? T("网络连接失败。", "Network connection failed.") : T("安装过程失败。", "Setup failed.");
            return kind + "\r\n" + (String.IsNullOrWhiteSpace(detail) ? T("请检查网络和磁盘空间后重试。", "Check the network and free disk space, then retry.") : SafeMessage(detail));
        }

        private void OnFormClosing(object sender, FormClosingEventArgs args) {
            if (_allowClose || _engine == null || _engine.HasExited) { _timer.Stop(); return; }
            args.Cancel = true; RequestCancel();
        }
    }

    private static string FindOfficialConflict() {
        if (IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p => p.Port == 19387))
            return "Port 19387 is already occupied. Close the other application before starting Portable. / 端口 19387 已被占用，请先关闭其他应用。";
        using (var query = new ManagementObjectSearcher("SELECT Name, ExecutablePath FROM Win32_Process WHERE Name='DeepSeek Harness.exe'"))
        using (var rows = query.Get()) foreach (ManagementObject row in rows) using (row) {
            string path = row["ExecutablePath"] as string;
            if (String.IsNullOrEmpty(path) || !path.StartsWith(AppRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return "Another official DeepSeek Harness is running. Close it before starting Portable. / 检测到另一份官方桌面端正在运行，请先退出。";
        }
        return null;
    }

    private static string ReadCacheName() {
        Dictionary<string, object> follow = ReadJson(Path.Combine(Root, "launcher", "follow.json"));
        string value = GetString(follow, "cacheDirName");
        if (String.IsNullOrEmpty(value) || !Regex.IsMatch(value, @"^[A-Za-z0-9._@-]{1,100}$") || value == "." || value == "..") throw new IOException("Invalid launcher/follow.json cacheDirName.");
        return value;
    }

    private static void WritePortableRootPointer(string cacheName) {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string directory = Path.Combine(local, cacheName); Directory.CreateDirectory(directory); CheckPath(directory);
        WriteTextAtomic(Path.Combine(directory, "portable-root.txt"), Root + Environment.NewLine);
    }

    private static string AppExecutable(string version) { return Path.Combine(AppRoot, version, "DeepSeek Harness.exe"); }
    private static void EnsureApplication(string exe) {
        CheckPath(exe);
        if (!File.Exists(exe) || !File.Exists(Path.Combine(Path.GetDirectoryName(exe), "resources", "app.asar"))) throw new IOException("Selected official application is incomplete.");
    }

    private static Process StartOfficialProcess(string exe, string link, string probe) {
        var start = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Root };
        start.Arguments = "--user-data-dir=" + Quote(Path.Combine(DataRoot, "electron"));
        if (!String.IsNullOrEmpty(probe)) start.Arguments += " --remote-debugging-port=" + probe;
        if (link != null) start.Arguments += " " + Quote(link);
        start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        start.EnvironmentVariables["DSH_HOME"] = Path.Combine(DataRoot, "dsh-home");
        string nativeAddonCache = Path.Combine(DataRoot, "cache", "native-addons");
        start.EnvironmentVariables["NARB_NATIVE_CACHE_DIR"] = nativeAddonCache;
        Directory.CreateDirectory(Path.Combine(DataRoot, "electron")); Directory.CreateDirectory(Path.Combine(DataRoot, "dsh-home")); Directory.CreateDirectory(nativeAddonCache);
        return Process.Start(start);
    }
    private static void StartOfficial(string link, string probe, bool unused) {
        Dictionary<string, object> state = ReadJson(Path.Combine(AppRoot, "current.json"));
        string version = GetString(state, "version"); if (!VersionPattern.IsMatch(version)) throw new IOException("Invalid current version.");
        EnsureApplication(AppExecutable(version)); StartOfficialProcess(AppExecutable(version), link, probe);
    }

    private sealed class RegistrySnapshot { public bool KeyExisted; public bool ValueExisted; public object Value; public RegistryValueKind ValueKind; }
    private static RegistrySnapshot CaptureProtocol() {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(ProtocolKey, false)) {
            var result = new RegistrySnapshot(); result.KeyExisted = key != null;
            if (key != null) { result.ValueExisted = key.GetValueNames().Contains(""); if (result.ValueExisted) { result.Value = key.GetValue("", null, RegistryValueOptions.DoNotExpandEnvironmentNames); result.ValueKind = key.GetValueKind(""); } }
            return result;
        }
    }
    // The official app re-registers dsh:// to its own exe on every start, so ownership is re-checked every second
    // (one registry read) instead of on a slow timer; a link clicked in between would bypass the launcher.
    private static void EnsureProtocolOwned() {
        try {
            string expected = "\"" + Process.GetCurrentProcess().MainModule.FileName + "\" --open \"%1\"";
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(ProtocolKey, false)) {
                if (key != null && String.Equals(key.GetValue("", null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string, expected, StringComparison.Ordinal)) return;
            }
            RegisterProtocol();
        } catch (Exception error) { Log("protocol ownership check failed: " + SafeMessage(error.Message)); }
    }
    private static void RegisterProtocol() {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(ProtocolKey)) key.SetValue("", "\"" + Process.GetCurrentProcess().MainModule.FileName + "\" --open \"%1\"", RegistryValueKind.String);
    }
    private static void RestoreProtocol(RegistrySnapshot snapshot) {
        if (snapshot == null) return;
        if (snapshot.KeyExisted) {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(ProtocolKey)) {
                if (snapshot.ValueExisted) key.SetValue("", snapshot.Value, snapshot.ValueKind); else key.DeleteValue("", false);
            }
        } else {
            Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, false);
            PruneEmptyKey(@"Software\Classes\dsh\shell\open"); PruneEmptyKey(@"Software\Classes\dsh\shell"); PruneEmptyKey(@"Software\Classes\dsh");
        }
    }
    private static void PruneEmptyKey(string path) { using (RegistryKey key = Registry.CurrentUser.OpenSubKey(path, true)) if (key != null && key.SubKeyCount == 0 && key.ValueCount == 0) Registry.CurrentUser.DeleteSubKey(path, false); }

    private static bool IsValidLink(string value) { return value != null && value.Length <= 8192 && value.StartsWith("dsh://", StringComparison.OrdinalIgnoreCase) && value.IndexOfAny(new[] { '"', '\r', '\n', '\0' }) < 0 && !value.Any(Char.IsControl); }
    private static string MutexName(string root) { using (var sha = SHA256.Create()) return "Local\\DSHPortable-" + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", ""); }
    private static Dictionary<string, object> ReadJson(string file) { CheckPath(file); return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)); }
    private static string GetString(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) ? item as string : null; }
    private static bool GetBool(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) && item is bool && (bool)item; }
    private static void WriteJsonAtomic(string file, object value) { WriteTextAtomic(file, Json.Serialize(value)); }
    private static void WriteTextAtomic(string file, string value) {
        CheckPath(file); string temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { byte[] bytes = new UTF8Encoding(false).GetBytes(value); stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
            if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
        } finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    private static void CheckPath(string path) {
        for (string current = Path.GetFullPath(path); !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Redirected portable path is not supported: " + current);
    }
    private static bool HasOwnedProcesses(string appRoot, bool onError = true) {
        string prefix = Path.GetFullPath(appRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        try {
            using (var query = new ManagementObjectSearcher("SELECT Name, ExecutablePath FROM Win32_Process"))
            using (var rows = query.Get()) foreach (ManagementObject row in rows) using (row) {
                string path = row["ExecutablePath"] as string;
                if (!String.IsNullOrEmpty(path) && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true;
                if (path == null && String.Equals(row["Name"] as string, "DeepSeek Harness.exe", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        } catch { return onError; }
    }
    private static string Quote(string value) {
        var output = new StringBuilder(); output.Append('"'); int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { output.Append('\\', slashes * 2 + 1); output.Append('"'); slashes = 0; continue; }
            output.Append('\\', slashes); slashes = 0; output.Append(character);
        }
        output.Append('\\', slashes * 2); output.Append('"'); return output.ToString();
    }
    private static string SafeMessage(string message) { return (message ?? "error").Replace("\r", " ").Replace("\n", " ").Replace(Environment.UserName, "<user>"); }
    private static void Log(string message) {
        if (String.IsNullOrEmpty(LauncherData)) return;
        Directory.CreateDirectory(LauncherData); string file = Path.Combine(LauncherData, "launcher.log"); CheckPath(file);
        if (File.Exists(file) && new FileInfo(file).Length >= 262144) {
            string second = file + ".2", first = file + ".1";
            if (File.Exists(second)) File.Delete(second); if (File.Exists(first)) File.Move(first, second); File.Move(file, first);
        }
        string line = DateTime.UtcNow.ToString("o") + " " + SafeMessage(message);
        if (line.Length > 4096) line = line.Substring(0, 4096);
        File.AppendAllText(file, line + Environment.NewLine, new UTF8Encoding(false));
    }
}
