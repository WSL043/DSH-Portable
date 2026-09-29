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
            // WebView input belongs to another process and does not reach the
            // WinForms menu message filter. Dismiss without consuming the click.
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                "document.addEventListener('pointerdown',()=>window.chrome.webview.postMessage({type:'dsh-portable/dismiss-menu'}),true);");
            // Official UI styles initially use their default palette before the
            // settings plugin publishes. Keep that interval in the selected scheme.
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                "(()=>{const install=()=>{if(!document.documentElement)return false;"
                + "const style=document.createElement('style');style.id='portable-startup-theme';"
                + "style.textContent='html,body,#root{background-color:#f8f8f8!important;color-scheme:light}@media(prefers-color-scheme:dark){html,body,#root{background-color:#18181a!important;color-scheme:dark}}';"
                + "document.documentElement.appendChild(style);return true;};"
                + "if(!install()){const observer=new MutationObserver(()=>{if(install())observer.disconnect()});observer.observe(document,{childList:true,subtree:true})}})()");
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
            if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_HIDDEN"), "1", StringComparison.Ordinal)
                && String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_CONTINUOUS_DOM_MUTATION"), "1", StringComparison.Ordinal))
            {
                await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    "document.addEventListener('DOMContentLoaded',function(){"
                    + "var root=document.querySelector('#root');if(!root)return;"
                    + "var install=function(){"
                    + "if(root.querySelectorAll('button,input,textarea,[contenteditable=true],[role=button]').length<2){requestAnimationFrame(install);return;}"
                    + "var pulse=document.createElement('span');pulse.hidden=true;root.appendChild(pulse);"
                    + "setInterval(function(){pulse.textContent=String(performance.now());},50);"
                    + "};requestAnimationFrame(install);"
                    + "},{once:true});");
            }
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                "(()=>{"
                + "if(window.__DSH_PORTABLE_NATIVE__)return;"
                + "const bridge=window.chrome&&window.chrome.webview;"
                + "if(!bridge||typeof bridge.postMessage!=='function'||typeof bridge.addEventListener!=='function'||typeof bridge.removeEventListener!=='function')return;"
                + "const native={protocolVersion:1,capabilities:Object.freeze({"
                + "pickDirectory:true,saveDataPackage:true,openDataPackage:true,importData:true,restartHost:true,"
                + "openEnvironment:true,openUpdate:true,preferences:true,sessionProjection:true,clearWebCache:true"
                + "}),"
                + "postMessage:function(message){return bridge.postMessage(message);},"
                + "addEventListener:function(name,listener){return bridge.addEventListener(name,listener);},"
                + "removeEventListener:function(name,listener){return bridge.removeEventListener(name,listener);}"
                + "};"
                + "Object.defineProperty(window,'__DSH_PORTABLE_NATIVE__',{configurable:false,value:Object.freeze(native)});"
                + "})();");
            webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
            webView.CoreWebView2.DownloadStarting += OnDownloadStarting;
            webView.CoreWebView2.ContentLoading += delegate(object sender, CoreWebView2ContentLoadingEventArgs eventArgs)
            {
                RecordWebViewPhase("content-loading:" + eventArgs.NavigationId);
            };
            webView.CoreWebView2.ProcessFailed += OnWebViewProcessFailed;
            ApplyDesktopChrome();
        }

        private async Task InitializeWebViewAttemptAsync(string userData, CoreWebView2EnvironmentOptions options)
        {
            bundledWebViewLeaseRequired = false;
            if (!testWebViewBusyInjected
                && String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_WEBVIEW2_BUSY_ONCE"), "1", StringComparison.Ordinal))
            {
                testWebViewBusyInjected = true;
                throw new COMException("The requested resource is in use.", WebViewResourceInUseHResult);
            }

            // Try the installed runtime first. Merely carrying an offline capsule
            // must not unpack another browser on machines that already have one.
            bool systemRuntimeMissing = false;
            try
            {
                if (String.Equals(Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_WEBVIEW2_MISSING"), "1", StringComparison.Ordinal))
                    throw new WebView2RuntimeNotFoundException();
                webViewEnvironment = await CoreWebView2Environment.CreateAsync(null, userData, options);
                AppendStartupTrace("native-host", "system-webview-runtime", new Dictionary<string, object>
                    { { "version", webViewEnvironment.BrowserVersionString } });
            }
            catch (WebView2RuntimeNotFoundException)
            {
                AppendStartupTrace("native-host", "system-webview-runtime-missing", new Dictionary<string, object>());
                if (!Directory.Exists(Path.Combine(root, "runtime", "webview2"))) throw;
                systemRuntimeMissing = true;
            }
            if (systemRuntimeMissing)
            {
                string browserFolder = await ResolveBundledWebViewRuntimeAsync();
                if (browserFolder == null) throw new WebView2RuntimeNotFoundException();
                webViewEnvironment = await CoreWebView2Environment.CreateAsync(browserFolder, userData, options);
            }
            webViewBrowserExited = new TaskCompletionSource<CoreWebView2BrowserProcessExitedEventArgs>();
            webViewEnvironment.BrowserProcessExited += OnWebViewBrowserProcessExited;
            await webView.EnsureCoreWebView2Async(webViewEnvironment);
            webView.SendToBack();
            if (launchPanel.Visible) launchPanel.BringToFront();
            AppendStartupTrace("native-host", "webview-initialized-behind-loader",
                new Dictionary<string, object> { { "loadingFrontmost", desktopContent.Controls.GetChildIndex(launchPanel) == 0 } });
            ownedWebViewBrowserProcessId = unchecked((int)webView.CoreWebView2.BrowserProcessId);
            if (bundledWebViewLeaseRequired)
                await RunBundledWebViewRuntimeAsync(ownedWebViewBrowserProcessId, true);
            RecordWebViewPhase("environment-ready:" + webViewEnvironment.BrowserVersionString);
        }

        private Task<string> RunBundledWebViewRuntimeAsync(int ownerPid, bool leaseOnly)
        {
            return Task.Run(delegate
            {
                var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node", "node.exe"),
                    "\"" + Path.Combine(root, "launcher", "webview-runtime.mjs") + "\" \"" + root + "\" "
                    + ownerPid.ToString(CultureInfo.InvariantCulture) + (leaseOnly ? " --lease-only" : ""));
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.WindowStyle = ProcessWindowStyle.Hidden;
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                start.StandardOutputEncoding = Encoding.UTF8;
                start.StandardErrorEncoding = Encoding.UTF8;
                start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"] = stateRoot;
                start.EnvironmentVariables["DSH_PORTABLE_STARTUP_ID"] = startupId;
                start.EnvironmentVariables["DSH_PORTABLE_STARTUP_STARTED_AT"] = startupStartedAt.ToString(CultureInfo.InvariantCulture);
                using (var process = Process.Start(start))
                {
                    var output = process.StandardOutput.ReadToEndAsync();
                    var error = process.StandardError.ReadToEndAsync();
                    if (!process.WaitForExit(120000))
                    {
                        process.Kill();
                        throw new TimeoutException("Bundled WebView2 preparation timed out.");
                    }
                    if (process.ExitCode != 0) throw new InvalidOperationException("Bundled WebView2 preparation failed: " + error.Result);
                    var result = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(output.Result);
                    return Convert.ToString(result["browserFolder"], CultureInfo.InvariantCulture);
                }
            });
        }

        private async Task<string> ResolveBundledWebViewRuntimeAsync()
        {
            string folder = Path.Combine(root, "runtime", "webview2");
            if (!Directory.Exists(folder)) return null;
            if (File.Exists(Path.Combine(folder, "runtime-capsule.json")))
            {
                AppendStartupTrace("native-host", "bundled-webview-prepare-begin", new Dictionary<string, object>());
                folder = await RunBundledWebViewRuntimeAsync(Process.GetCurrentProcess().Id, false);
                bundledWebViewLeaseRequired = true;
            }
            if (!File.Exists(Path.Combine(folder, "msedgewebview2.exe")))
                throw new InvalidOperationException("The bundled WebView2 runtime is incomplete. Extract the complete offline package again.");

            // Unpackaged Windows 10 hosts require AppContainer read/execute
            // access for Fixed Version 120+. Keep these rights inside our runtime.
            if (Environment.OSVersion.Version.Major == 10 && Environment.OSVersion.Version.Build < 22000)
            {
                var security = Directory.GetAccessControl(folder);
                bool changed = false;
                foreach (string sid in new string[] { "S-1-15-2-1", "S-1-15-2-2" })
                {
                    var identity = new System.Security.Principal.SecurityIdentifier(sid);
                    var rule = new System.Security.AccessControl.FileSystemAccessRule(identity,
                        System.Security.AccessControl.FileSystemRights.ReadAndExecute,
                        System.Security.AccessControl.InheritanceFlags.ContainerInherit | System.Security.AccessControl.InheritanceFlags.ObjectInherit,
                        System.Security.AccessControl.PropagationFlags.None,
                        System.Security.AccessControl.AccessControlType.Allow);
                    bool modified;
                    security.ModifyAccessRule(System.Security.AccessControl.AccessControlModification.Add, rule, out modified);
                    changed |= modified;
                }
                if (changed) Directory.SetAccessControl(folder, security);
            }
            AppendStartupTrace("native-host", "bundled-webview-runtime", new Dictionary<string, object> { { "folder", folder } });
            return folder;
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
            WebView2 view = new WebView2
            {
                Dock = DockStyle.Fill,
                Location = Point.Empty,
                DefaultBackgroundColor = BackColor,
                Visible = false,
            };
            view.KeyDown += delegate(object sender, KeyEventArgs args)
            {
                if (!QueueDesktopShortcut(args.KeyData)) return;
                args.Handled = true;
                args.SuppressKeyPress = true;
            };
            return view;
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
                try { desktopContent.Controls.Remove(failedWebView); }
                catch { }
                try { failedWebView.Dispose(); }
                catch { }
            }
            webViewEnvironment = null;
            webViewBrowserExited = null;
            ownedWebViewBrowserProcessId = 0;
            webView = CreateDesktopWebView();
            desktopContent.Controls.Add(webView);
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

            // NavigateWorkspaceAsync performs the single native-to-WebView handoff.
            // Reapplying chrome/layout here repaints an already visible workspace.
            operationRunning = false;
            desktopReady = true;
            RefreshDesktopCommands();
            trayIcon.Visible = true;
        }

        private void FitWebViewToClient()
        {
            int border = desktopStart && !fullscreen && WindowState == FormWindowState.Normal
                ? Math.Max(4, (int)Math.Ceiling(4 * DeviceDpi / 96.0)) : 0;
            desktopContent.Padding = new Padding(border, 0, border, border);
            desktopContent.BackColor = BackColor;
            if (webView == null || webView.IsDisposed) return;
            if (desktopMenu != null) desktopContent.BringToFront();
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
            if (applicationUri == null)
                AppendStartupTrace("webview", "initial-navigation", new Dictionary<string, object> {
                    { "targetKind", eventArgs.Uri.StartsWith("data:text/html", StringComparison.OrdinalIgnoreCase) ? "inline-html" : eventArgs.Uri == "about:blank" ? "blank" : "other" },
                    { "desktopStart", desktopStart }, { "desktopReady", desktopReady }
                });
            if (desktopStart && !desktopReady && applicationUri == null && eventArgs.Uri == "about:blank")
            {
                return;
            }
            Uri target;
            if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out target)) { eventArgs.Cancel = true; return; }
            if (applicationUri != null && target.IsLoopback && target.Port == applicationUri.Port)
            {
                trayBridgeReady = false;
                NativeTaskNotification.SetOwnerReady(false);
                return;
            }
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

    }
}
