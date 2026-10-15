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
                    DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " [" + category + "] " + message
                    + " startupId=" + startupId + Environment.NewLine,
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

        private void AppendHistoryLog(string name, string line)
        {
            try
            {
                string history = Path.Combine(ResolveLauncherLogDirectory(), "history");
                string directory = Path.Combine(history, startupId);
                Directory.CreateDirectory(history);
                if ((File.GetAttributes(history) & FileAttributes.ReparsePoint) != 0) return;
                Directory.CreateDirectory(directory);
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) return;
                string filename = Path.Combine(directory, name);
                if (File.Exists(filename) && (File.GetAttributes(filename) & FileAttributes.ReparsePoint) != 0) return;
                if (File.Exists(filename) && new FileInfo(filename).Length + Encoding.UTF8.GetByteCount(line) + 2 > 128 * 1024)
                {
                    File.Delete(filename + ".previous");
                    File.Move(filename, filename + ".previous");
                }
                File.AppendAllText(filename, line + Environment.NewLine, new UTF8Encoding(false));
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
                using (Process current = Process.GetCurrentProcess()) entry["pid"] = current.Id;
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
                AppendHistoryLog("startup.jsonl", json.Serialize(entry));
            }
            catch { }
        }

        private async Task<List<string>> InspectWebViewForShutdownAsync()
        {
            try
            {
                List<string> remaining = await Task.Run(() => OwnedWebViewProcessDiagnostics());
                return remaining;
            }
            catch (TimeoutException error)
            {
                // A slow CIM query is not evidence of a broken workspace. The
                // active kernel job already owns this process tree; close that
                // verified boundary rather than guessing PIDs or ignoring locks.
                if (!PortableProcessJob.IsActive) throw;
                WriteLauncherLog("shutdown-webview", "query-timeout-job-close " + error.Message);
                ExitOwnedTreeForShutdown();
                throw; // Environment.Exit above does not return; fail closed if it does.
            }
        }

        private List<string> OwnedWebViewProcessDiagnostics()
        {
            if (Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION") == "1"
                && Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_WEBVIEW_QUERY_TIMEOUT") == "1")
                throw new TimeoutException("Injected owned WebView2 process query timeout.");
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

        internal static int RegisterEnvironmentActivationMessage(string instanceKey)
        {
            uint message = RegisterWindowMessage("DSHPortable.NotificationActivation." + instanceKey);
            if (message == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not register the Portable notification activation message.");
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

        [DllImport("user32.dll")]
        private static extern bool IsZoomed(IntPtr window);

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
                    if (Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_UI_STALL") == "1")
                    {
                        WriteLauncherLog("health-test", "ui-stall-begin");
                        Thread.Sleep(8000);
                        WriteLauncherLog("health-test", "ui-stall-end");
                    }
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

    }
}
