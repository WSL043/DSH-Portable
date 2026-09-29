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
            if (eventArgs.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited
                || eventArgs.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                trayBridgeReady = false;
                NativeTaskNotification.SetOwnerReady(false);
            }
            string failure = eventArgs.ProcessFailedKind + "/" + eventArgs.Reason
                + " exit=" + eventArgs.ExitCode
                + (String.IsNullOrWhiteSpace(eventArgs.ProcessDescription) ? "" : " " + eventArgs.ProcessDescription);
            if (desktopReady) WriteLauncherLog("webview", "process-failed:" + failure);
            else RecordWebViewPhase("process-failed:" + failure);
            if (webViewProcessFailure != null) webViewProcessFailure.TrySetResult(failure);
            if (!desktopReady || shutdownRunning || allowClose) return;

            if (eventArgs.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited)
                ScheduleWebViewRecovery(false, "renderer-process-exited");
            else if (eventArgs.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
                ScheduleWebViewRecovery(true, "browser-process-exited");
            else if (eventArgs.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                ScheduleWebViewUnresponsivePrompt(failure);
        }

        private void ScheduleWebViewRecovery(bool recreate, string reason)
        {
            if (!IsHandleCreated || IsDisposed || Disposing || shutdownRunning || allowClose) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action<bool, string>(ScheduleWebViewRecovery), recreate, reason); }
                catch (InvalidOperationException) { }
                return;
            }
            if (webViewRecoveryRunning) return;
            Task ignored = RecoverWebViewAsync(recreate, reason);
        }

        private void ScheduleWebViewUnresponsivePrompt(string failure)
        {
            if (!IsHandleCreated || IsDisposed || Disposing || shutdownRunning || allowClose) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action<string>(ScheduleWebViewUnresponsivePrompt), failure); }
                catch (InvalidOperationException) { }
                return;
            }
            webViewUnresponsiveCount += 1;
            WriteLauncherLog("webview-unresponsive", "observation="
                + webViewUnresponsiveCount.ToString(CultureInfo.InvariantCulture) + " " + failure);
            if (webViewUnresponsiveCount < WebViewUnresponsivePromptThreshold
                || webViewUnresponsivePromptVisible
                || webViewRecoveryRunning) return;

            webViewUnresponsivePromptVisible = true;
            try
            {
                DialogResult decision = MessageBox.Show(this,
                    L(
                        "工作台持续无响应。可以继续等待，或只重新加载界面；正在运行的 DeepSeek Harness 后端和会话不会重启。\r\n\r\n是否重新加载界面？",
                        "The workspace remains unresponsive. You can keep waiting or reload only the interface; the running DeepSeek Harness backend and sessions will not restart.\r\n\r\nReload the interface?"),
                    L("DeepSeek Harness 无响应", "DeepSeek Harness is not responding"),
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (decision == DialogResult.Yes) ScheduleWebViewRecovery(false, "renderer-unresponsive");
                else WriteLauncherLog("webview-unresponsive", "user-kept-waiting");
            }
            finally { webViewUnresponsivePromptVisible = false; }
        }

        private async Task RecoverWebViewAsync(bool recreate, string reason)
        {
            if (webViewRecoveryRunning || shutdownRunning || allowClose) return;
            Uri target = applicationUri;
            if (target == null || !IsTrustedLoopbackUrl(target.AbsoluteUri)) return;

            webViewRecoveryRunning = true;
            WriteLauncherLog("webview-recovery", "begin mode=" + (recreate ? "recreate" : "reload") + " reason=" + reason);
            try
            {
                launchPanel.Visible = true;
                launchPanel.BringToFront();
                statusLabel.Text = L("正在恢复工作台界面…", "Recovering the workspace interface…");
                progressDetail.Visible = false;
                activityRing.Indeterminate = true;
                activityRing.Visible = true;

                if (recreate)
                {
                    Task browserExited = webViewBrowserExited == null
                        ? (Task)Task.FromResult<object>(null)
                        : webViewBrowserExited.Task;
                    await Task.WhenAny(browserExited, Task.Delay(5000));
                    ResetWebViewAfterInitializationFailure();
                    await InitializeWebViewAsync();
                    await NavigateWorkspaceAsync(target.AbsoluteUri, false, false);
                }
                else await NavigateWorkspaceAsync(target.AbsoluteUri, false, true);

                webViewUnresponsiveCount = 0;
                WriteLauncherLog("webview-recovery", "complete mode=" + (recreate ? "recreate" : "reload") + " reason=" + reason);
            }
            catch (Exception error)
            {
                string message = error.GetBaseException().Message.Replace("\r", " ").Replace("\n", " | ");
                WriteLauncherLog("webview-recovery", "failed mode=" + (recreate ? "recreate" : "reload")
                    + " reason=" + reason + " error=" + error.GetBaseException().GetType().Name + ":" + message);
                ShowFailure(L(
                    "工作台界面恢复失败。DeepSeek Harness 后端仍保持运行；请导出支持报告后重新打开应用。\r\n",
                    "The workspace interface could not recover. The DeepSeek Harness backend remains running; export a support report, then reopen the app.\r\n") + message);
            }
            finally { webViewRecoveryRunning = false; }
        }

        private async Task NavigateWorkspaceAsync(string url, bool updated, bool reload = false)
        {
            TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs> navigation =
                new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>();
            TaskCompletionSource<bool> workspaceUsable = new TaskCompletionSource<bool>();
            workspaceSurfaceReady = new TaskCompletionSource<string>();
            webViewProcessFailure = new TaskCompletionSource<string>();
            ulong? workspaceNavigationId = null;
            EventHandler<CoreWebView2NavigationStartingEventArgs> starting = delegate(object sender, CoreWebView2NavigationStartingEventArgs eventArgs)
            {
                Uri target;
                if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out target) && target.IsLoopback
                    && applicationUri != null && target.Port == applicationUri.Port)
                    workspaceNavigationId = eventArgs.NavigationId;
            };
            EventHandler<CoreWebView2NavigationCompletedEventArgs> completed = null;
            EventHandler<CoreWebView2DOMContentLoadedEventArgs> domLoaded = null;
            completed = delegate(object sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
            {
                if (workspaceNavigationId != eventArgs.NavigationId)
                {
                    RecordWebViewPhase("prior-navigation-completed:" + eventArgs.NavigationId);
                    return;
                }
                RecordWebViewPhase("navigation-completed:" + eventArgs.IsSuccess + "/" + eventArgs.WebErrorStatus);
                navigation.TrySetResult(eventArgs);
            };
            domLoaded = async delegate(object sender, CoreWebView2DOMContentLoadedEventArgs eventArgs)
            {
                if (workspaceNavigationId != eventArgs.NavigationId) return;
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
            webView.CoreWebView2.NavigationStarting += starting;
            webView.CoreWebView2.NavigationCompleted += completed;
            webView.CoreWebView2.DOMContentLoaded += domLoaded;
            webView.Visible = true;
            if (desktopStart)
            {
                // Keep the one native loading surface until the workspace is usable.
                if (launchPanel.Visible) launchPanel.BringToFront();
            }
            else launchPanel.BringToFront();
            if (reload)
            {
                RecordWebViewPhase("navigation-reload:" + SafeWorkspaceUrl(url));
                webView.CoreWebView2.Reload();
            }
            else
            {
                RecordWebViewPhase("navigation-start:" + SafeWorkspaceUrl(url));
                webView.CoreWebView2.Navigate(url);
            }
            Task timeout = Task.Delay(WorkspaceNavigationTimeoutMs);
            Task winner = await Task.WhenAny(workspaceUsable.Task, navigation.Task, webViewProcessFailure.Task, timeout);
            if (winner == navigation.Task)
            {
                CoreWebView2NavigationCompletedEventArgs navigationResult = await navigation.Task;
                if (!navigationResult.IsSuccess)
                {
                    webView.CoreWebView2.NavigationStarting -= starting;
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
            webView.CoreWebView2.NavigationStarting -= starting;
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
            if (desktopMenu != null) desktopContent.BringToFront();
            webView.Update();
            try { DwmFlush(); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            launchPanel.Visible = false;
            if (webViewRecoveryRunning)
            {
                WriteLauncherLog("webview-recovery", "surface-ready");
                return;
            }
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
            InjectTestWebViewCrashAfterReady();
        }

        private void InjectTestWebViewCrashAfterReady()
        {
            if (testWebViewCrashInjected
                || (!hiddenForAutomation
                    && !String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION"), "1", StringComparison.Ordinal))
                || !String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_WEBVIEW2_CRASH_AFTER_READY"), "1", StringComparison.Ordinal)
                || webView == null
                || webView.CoreWebView2 == null) return;
            testWebViewCrashInjected = true;
            BeginInvoke(new Action(async delegate
            {
                await Task.Delay(500);
                try
                {
                    WriteLauncherLog("webview-test", "renderer-crash-requested");
                    await webView.CoreWebView2.CallDevToolsProtocolMethodAsync("Page.crash", "{}");
                }
                catch (Exception error)
                {
                    WriteLauncherLog("webview-test", "renderer-crash-call-ended " + error.GetBaseException().GetType().Name);
                }
            }));
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
                + "if(!rootVisible||root.querySelector('[data-dsh-boot]'))return 0;"
                + "var gate=window[key];if(!gate){gate={readyPolls:0};window[key]=gate;}"
                + "var visibleControls=0;var controls=root.querySelectorAll('button,input,textarea,[contenteditable=true],[role=button]');"
                + "for(var index=0;index<controls.length;index++){var node=controls[index];var rect=node.getBoundingClientRect();var style=getComputedStyle(node);"
                + "if(rect.width>=20&&rect.height>=20&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0')visibleControls++;}"
                + "var text=String(root.innerText||'').replace(/\\s+/g,' ').trim();"
                + "var fontsReady=!document.fonts||document.fonts.status==='loaded';"
                + "if(fontsReady&&visibleControls>=2&&text.length>0)gate.readyPolls++;else gate.readyPolls=0;"
                + "return gate.readyPolls>=3?2:0;"
                + "}catch(_){return 0;}})()";
            await Task.Delay(50);
            // Mount the workspace behind the native panel and hand off only after
            // readiness is confirmed. No intermediate web loading page is shown.
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
                    "(function(){try{var body=document.body;var root=document.querySelector('#root');var rootRect=root?root.getBoundingClientRect():null;"
                    + "var visibleControls=0;if(root){var controls=root.querySelectorAll('button,input,textarea,[contenteditable=true],[role=button]');"
                    + "for(var i=0;i<controls.length;i++){var rect=controls[i].getBoundingClientRect();var style=getComputedStyle(controls[i]);"
                    + "if(rect.width>=20&&rect.height>=20&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0')visibleControls++;}}"
                    + "return {url:String(location.href||''),ready:document.readyState,children:body?body.querySelectorAll('*').length:0,"
                    + "text:body?String(body.innerText||'').length:0,width:body?body.getBoundingClientRect().width:0,height:body?body.getBoundingClientRect().height:0,"
                    + "root:!!root,rootWidth:rootRect?rootRect.width:0,rootHeight:rootRect?rootRect.height:0,visibleControls:visibleControls,"
                    + "bootVisible:!!document.querySelector('[data-dsh-boot]'),readyPolls:window.__dshPortableStartupGate?window.__dshPortableStartupGate.readyPolls:0};}"
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
                // The initial WebView navigation can consume a one-time DSH
                // token. A timeout probe checks host liveness without replaying it.
                UriBuilder probeUrl = new UriBuilder(url) { Query = String.Empty, Fragment = String.Empty };
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(probeUrl.Uri);
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
            catch (WebException error)
            {
                HttpWebResponse response = error.Response as HttpWebResponse;
                if (response != null && response.StatusCode == HttpStatusCode.Unauthorized)
                {
                    response.Dispose();
                    return "host=401 auth-required (service reachable)";
                }
                if (response != null) response.Dispose();
                return "host-probe-failed=" + error.GetType().Name + ": " + error.Message;
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
            details.AppendLine("portable=" + Assembly.GetExecutingAssembly().GetName().Version);
            details.AppendLine(ProbeWorkspaceDocument(url));
            details.AppendLine(webViewSnapshot);
            lock (webViewStartupTrace)
                details.AppendLine("phases=" + String.Join(" | ", webViewStartupTrace.ToArray()));
            string logDirectory = ResolveLauncherLogDirectory();
            foreach (string name in new[] { "dsh.stderr.log", "dsh.stdout.log" })
            {
                string tail = TailLog(Path.Combine(logDirectory, name), 2000).Trim();
                if (!String.IsNullOrEmpty(tail)) details.AppendLine(name + ":\r\n" + RedactSensitiveText(tail));
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
            if (desktopMenu != null) desktopContent.BringToFront();
        }

    }
}
