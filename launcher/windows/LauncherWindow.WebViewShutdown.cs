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
        protected override void OnHandleCreated(EventArgs eventArgs)
        {
            base.OnHandleCreated(eventArgs);
            TaskbarIdentity.Apply(Handle, "io.github.wsl043.dsh-portable");
            UpdateTaskbarBadge();
            if (desktopStart && desktopHealthTimer == null) StartDesktopHealth();
        }

        protected override void OnFormClosed(FormClosedEventArgs eventArgs)
        {
            WriteLauncherLog("shutdown", "form-closed");
            desktopHealthStopped = true;
            if (desktopHealthTimer != null) desktopHealthTimer.Dispose();
            SaveDesktopWindowState();
            UnregisterDesktopHostProcess();
            NativeTaskNotification.ActionRequested -= HandleNativeNotificationAction;
            NativeTaskNotification.SetOwnerReady(false);
            NativeTaskNotification.Unregister();
            TaskbarBadge.SetOverlayIcon(Handle, 0);
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
            Stopwatch stopClock = Stopwatch.StartNew();
            try
            {
                result = await Task.Run(() => InvokePortableCli(new[] { "stop", "--no-browser", "--json" }));
            }
            catch (Exception error)
            {
                result = Tuple.Create(1, error.GetBaseException().Message);
            }
            WriteLauncherLog("shutdown", "stop-cli-complete exitCode=" + result.Item1.ToString(CultureInfo.InvariantCulture)
                + " elapsedMs=" + stopClock.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture));
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
            ScheduleRequestedRestart();
            DisposeTrayIcon();
            WriteLauncherLog("shutdown", "complete");
            Close();
        }

        private void ScheduleRequestedRestart()
        {
            if (!restartAfterShutdown) return;
            PortableProcessJob.StartDetachedUpdater(Application.ExecutablePath, RestartArguments());
            restartAfterShutdown = false;
            WriteLauncherLog("restart-host", "relaunch-scheduled afterPid="
                + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
        }

        private void OnWebViewBrowserProcessExited(object sender, CoreWebView2BrowserProcessExitedEventArgs eventArgs)
        {
            RecordWebViewPhase("browser-exited:" + eventArgs.BrowserProcessExitKind);
            if (webViewBrowserExited != null) webViewBrowserExited.TrySetResult(eventArgs);
            if (desktopReady && !shutdownRunning && !allowClose
                && String.Equals(eventArgs.BrowserProcessExitKind.ToString(), "Failed", StringComparison.OrdinalIgnoreCase))
                ScheduleWebViewRecovery(true, "browser-process-exited");
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
                    desktopContent.Controls.Remove(closingWebView);
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

            if (PortableProcessJob.IsActive
                && Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION") == "1"
                && Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_FORCE_JOB_CLOSE") == "1")
            {
                WriteLauncherLog("shutdown-webview", "job-close-test-requested");
                ExitOwnedTreeForShutdown();
                return;
            }

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            DateTime gracefulDeadline = DateTime.UtcNow.AddMilliseconds(Math.Min(WebViewGracefulShutdownMs, timeoutMs));
            bool exitEventObserved = exited.IsCompleted;
            bool forceAttempted = false;
            List<string> remaining = new List<string>();
            while (DateTime.UtcNow < deadline)
            {
                remaining = await InspectWebViewForShutdownAsync();
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
                    remaining = await InspectWebViewForShutdownAsync();
                    if (remaining.Count > 0 && PortableProcessJob.IsActive)
                    {
                        WriteLauncherLog("shutdown-webview", "job-close-requested remaining="
                            + String.Join(";", remaining));
                        ExitOwnedTreeForShutdown();
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

        private void ExitOwnedTreeForShutdown()
        {
            // Closing our kill-on-close job also terminates this host. The
            // detached restart must be outside that job before it is closed.
            ScheduleRequestedRestart();
            PortableProcessJob.ExitOwnedTree();
            Environment.Exit(0);
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

        private void StartDesktopHealth()
        {
            desktopHealthAck = Stopwatch.GetTimestamp();
            desktopHealthLastSample = desktopHealthAck;
            try
            {
                using (Process current = Process.GetCurrentProcess()) desktopHealthCpu = current.TotalProcessorTime.TotalMilliseconds;
                string filename = Path.Combine(ResolveLauncherLogDirectory(), "desktop-health.jsonl");
                Directory.CreateDirectory(Path.GetDirectoryName(filename));
                File.Delete(filename + ".previous");
                if (File.Exists(filename)) File.Move(filename, filename + ".previous");
            }
            catch { }
            desktopHealthTimer = new System.Threading.Timer(SampleDesktopHealth, null, 2000, 2000);
            Disposed += delegate {
                desktopHealthStopped = true;
                if (desktopHealthTimer != null) desktopHealthTimer.Dispose();
            };
        }

        private void SampleDesktopHealth(object ignored)
        {
            if (desktopHealthStopped || !Monitor.TryEnter(desktopHealthGate)) return;
            try
            {
                long now = Stopwatch.GetTimestamp();
                double age = (now - Interlocked.Read(ref desktopHealthAck)) * 1000.0 / Stopwatch.Frequency;
                bool delayed = age >= 5000;
                using (Process current = Process.GetCurrentProcess())
                {
                    double cpu = current.TotalProcessorTime.TotalMilliseconds;
                    double interval = (now - desktopHealthLastSample) * 1000.0 / Stopwatch.Frequency;
                    double cpuPercent = interval > 0 ? Math.Round((cpu - desktopHealthCpu) * 100.0 / interval) : 0;
                    desktopHealthCpu = cpu;
                    desktopHealthLastSample = now;
                    if (delayed || delayed != desktopHealthWasDelayed || desktopHealthLastWrite == 0
                        || (now - desktopHealthLastWrite) * 1000.0 / Stopwatch.Frequency >= 30000)
                    {
                        string filename = Path.Combine(ResolveLauncherLogDirectory(), "desktop-health.jsonl");
                        if (File.Exists(filename) && new FileInfo(filename).Length >= 128 * 1024)
                        {
                            File.Delete(filename + ".previous");
                            File.Move(filename, filename + ".previous");
                        }
                        var entry = new Dictionary<string, object> {
                            { "timestamp", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                            { "startupId", startupId }, { "pid", current.Id }, { "component", "native-host" },
                            { "phase", shutdownRunning ? "shutdown" : desktopReady ? "running" : "starting" },
                            { "observation", delayed ? "ui-heartbeat-delayed" : desktopHealthWasDelayed ? "ui-heartbeat-recovered" : "sample" },
                            { "uiHeartbeatAgeMs", Math.Round(age) }, { "cpuPercent", cpuPercent },
                            { "workingSetBytes", current.WorkingSet64 }, { "privateBytes", current.PrivateMemorySize64 },
                            { "handleCount", current.HandleCount }
                        };
                        string line = new JavaScriptSerializer().Serialize(entry);
                        File.AppendAllText(filename, line + Environment.NewLine, new UTF8Encoding(false));
                        AppendHistoryLog("desktop-health.jsonl", line);
                        desktopHealthWasDelayed = delayed;
                        desktopHealthLastWrite = now;
                    }
                }
                // Keep at most one UI callback queued, even when the UI is stuck.
                if (!desktopHealthStopped && Interlocked.CompareExchange(ref desktopHealthPending, 1, 0) == 0)
                    BeginInvoke((MethodInvoker)delegate {
                        Interlocked.Exchange(ref desktopHealthAck, Stopwatch.GetTimestamp());
                        Interlocked.Exchange(ref desktopHealthPending, 0);
                        if (desktopStart && !desktopReady && launchPanel != null && activityRing != null)
                        {
                            Point clientOrigin = PointToScreen(Point.Empty);
                            Rectangle ringBounds = launchPanel.RectangleToClient(activityRing.RectangleToScreen(activityRing.ClientRectangle));
                            AppendStartupTrace("native-host", "native-loading-observation", new Dictionary<string, object> {
                                { "windowVisible", Visible }, { "windowState", WindowState.ToString() },
                                { "topFrameInset", clientOrigin.Y - Top }, { "menuTop", desktopMenu == null ? -1 : desktopMenu.Top },
                                { "loadingVisible", launchPanel.Visible }, { "ringVisible", activityRing.Visible },
                                { "loadingFrontmost", desktopContent.Controls.GetChildIndex(launchPanel) == 0 },
                                { "ringInViewport", launchPanel.ClientRectangle.IntersectsWith(ringBounds) },
                                { "paintedFrames", activityRing.PaintedFrames }, { "rotation", activityRing.Rotation },
                                { "loadingWidth", launchPanel.Width }, { "loadingHeight", launchPanel.Height }
                            });
                        }
                    });
            }
            catch { }
            finally { Monitor.Exit(desktopHealthGate); }
        }

    }
}
