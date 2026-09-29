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
        private async void ClearWebCache(string requestId)
        {
            var core = webView.CoreWebView2;
            bool accepted = !webCacheCleanupRunning;
            string error = accepted ? null : "Web cache cleanup is already running.";
            var clock = Stopwatch.StartNew();
            if (accepted)
            {
                webCacheCleanupRunning = true;
                try
                {
                    // Never use AllProfile/AllSite: these also contain user state.
                    await core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache);
                }
                catch (Exception failure) { error = failure.GetType().Name; }
                finally { webCacheCleanupRunning = false; }
                WriteLauncherLog("web-cache", "completed=" + (error == null) + " elapsedMs=" + clock.ElapsedMilliseconds
                    + (error == null ? String.Empty : " error=" + error));
            }
            try { core.PostWebMessageAsJson(json.Serialize(new {
                type = "dsh-portable/clear-web-cache-result", requestId = requestId, ok = error == null, error = error
            })); } catch (Exception) { /* The window may have closed during cleanup. */ }
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
                    && Convert.ToString(messageType) == "dsh-portable/dismiss-menu")
                {
                    CloseDesktopMenus();
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && Convert.ToString(messageType) == "dsh-portable/test-desktop"
                    && hiddenForAutomation
                    && Environment.GetEnvironmentVariable("DSH_PORTABLE_TEST_AUTOMATION") == "1")
                {
                    object key;
                    if (message.TryGetValue("key", out key)) QueueDesktopShortcut((Keys)Convert.ToInt32(key));
                    object command;
                    if (message.TryGetValue("command", out command) && Convert.ToString(command) == "maximize")
                        BeginInvoke(new Action(delegate {
                            RefreshDesktopCommands();
                            ((ToolStripMenuItem)desktopMenu.Items["menu-view"]).DropDownItems["maximize"].PerformClick();
                        }));
                    BeginInvoke(new Action(delegate
                    {
                        RefreshDesktopCommands();
                        Rectangle clientScreen = RectangleToScreen(ClientRectangle);
                        Rectangle workArea = Screen.FromControl(this).WorkingArea;
                        webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {
                            type = "dsh-portable/test-desktop-result", fullscreen = fullscreen,
                            menuVisible = desktopMenu.Visible, nativeLoadingVisible = launchPanel.Visible,
                            openMenus = desktopMenu.Items.OfType<ToolStripMenuItem>()
                                .Where(menu => menu.HasDropDownItems && menu.DropDown.Visible).Select(menu => menu.Name).ToArray(),
                            paintedFrames = activityRing.PaintedFrames, rotation = activityRing.Rotation,
                            bounds = new { x = Bounds.X, y = Bounds.Y, width = Bounds.Width, height = Bounds.Height },
                            clientScreen = new { x = clientScreen.X, y = clientScreen.Y, width = clientScreen.Width, height = clientScreen.Height },
                            workArea = new { x = workArea.X, y = workArea.Y, width = workArea.Width, height = workArea.Height },
                            windowState = WindowState.ToString(), chrome = FormBorderStyle.ToString(),
                            menuBottom = desktopMenu.Bottom, contentTop = desktopContent.Top + webView.Top,
                            zoom = webView.ZoomFactor, theme = trayTheme
                        }));
                    }));
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/notification-action-result", StringComparison.Ordinal))
                {
                    object activationValue;
                    object terminalValue;
                    string activationId = message.TryGetValue("activationId", out activationValue)
                        ? Convert.ToString(activationValue) : String.Empty;
                    bool terminal = message.TryGetValue("terminal", out terminalValue) && terminalValue is bool && (bool)terminalValue;
                    NativeTaskNotification.CompleteActivation(activationId, terminal);
                    return;
                }
                if (message != null && message.TryGetValue("type", out messageType)
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/boot-visible", StringComparison.Ordinal))
                {
                    RecordWebViewPhase("boot-visible-message");
                    statusLabel.Text = L("正在加载工作台…", "Loading the workspace…");
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
                    && String.Equals(Convert.ToString(messageType), "dsh-portable/open-update", StringComparison.Ordinal))
                {
                    object scopeValue;
                    string requestedScope = message.TryGetValue("scope", out scopeValue)
                        ? Convert.ToString(scopeValue)
                        : String.Empty;
                    object manifestValue;
                    string requestedManifest = message.TryGetValue("manifestUrl", out manifestValue)
                        ? Convert.ToString(manifestValue)
                        : String.Empty;
                    if (!String.Equals(requestedScope, "product", StringComparison.Ordinal)
                        && !String.Equals(requestedScope, "engine", StringComparison.Ordinal)) return;
                    if (!String.IsNullOrEmpty(requestedManifest)
                        && (String.Equals(requestedScope, "engine", StringComparison.Ordinal) ? !IsTrustedEngineManifestUrl(requestedManifest) : !IsTrustedProductManifestUrl(requestedManifest))) return;
                    BeginInvoke((MethodInvoker)(async delegate { await CheckForDesktopUpdateAsync(true, requestedScope, requestedManifest); }));
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
                if (message != null && message.TryGetValue("type", out messageType)
                    && Convert.ToString(messageType) == "dsh-portable/clear-web-cache")
                {
                    object requestValue;
                    string requestId = message.TryGetValue("requestId", out requestValue) ? Convert.ToString(requestValue) : String.Empty;
                    if (Regex.IsMatch(requestId ?? String.Empty, "^web-cache-[A-Za-z0-9-]{1,96}$")) ClearWebCache(requestId);
                    return;
                }
                TrayBridgeState state = json.Deserialize<TrayBridgeState>(eventArgs.WebMessageAsJson);
                if (state == null || state.type != "dsh-portable/state" || state.schemaVersion != 1) return;
                if (state.sessions == null) state.sessions = new List<TrayBridgeSession>();
                if (state.sessions.Count > 10) state.sessions = state.sessions.Take(10).ToList();
                BeginInvoke((MethodInvoker)delegate
                {
                    if (shutdownRunning || allowClose || IsDisposed) return;
                    string nextLanguage = String.Equals(state.locale, "zh", StringComparison.OrdinalIgnoreCase) ? "zh" : "en";
                    string nextTheme = String.Equals(state.theme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light";
                    bool chromeChanged = uiLanguage != nextLanguage || trayTheme != nextTheme;
                    uiLanguage = nextLanguage;
                    trayTheme = nextTheme;
                    string nextPreference = state.themePreference;
                    bool preferenceChanged = !String.IsNullOrEmpty(nextPreference) && themePreference != nextPreference;
                    if (!String.IsNullOrEmpty(nextPreference) && (themePreference != nextPreference || chromeChanged))
                    {
                        themePreference = nextPreference;
                        SaveWindowTheme();
                    }
                    if (chromeChanged || preferenceChanged) ApplyDesktopChrome();
                    webView.CoreWebView2.ExecuteScriptAsync("document.getElementById('portable-startup-theme')?.remove()");
                    HandleTaskCompletionNotifications(state);
                    trayState = state;
                    trayBridgeReady = true;
                    NativeTaskNotification.SetOwnerReady(true);
                    FlushNotificationActions();
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
            bool previousTopMost = TopMost;
            try
            {
                RestoreFromTray();
                TopMost = true;
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
            finally
            {
                TopMost = previousTopMost;
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
            bool ownerTopMost = TopMost;
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
                        + " ownerTopMost=" + (ownerTopMost ? "true" : "false")
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
                if (String.Equals(JsonString(imported.Item2, "status"), "restored-without-plugins", StringComparison.Ordinal))
                    MessageBox.Show(this, L(
                        "会话、设置等数据已导入。插件依赖在此电脑无法重建，插件未导入；原数据包仍保留，可在插件页重新安装后再导入插件。",
                        "Sessions and settings were imported. Plugin dependencies could not be rebuilt on this computer, so plugins were skipped. The original data package remains available for a later retry."),
                        L("部分数据已导入", "Data partially imported"), MessageBoxButtons.OK, MessageBoxIcon.Information);
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

        private static Rectangle ClampRestoredBounds(Rectangle savedBounds, IList<Rectangle> workAreas, Size minimumSize)
        {
            if (workAreas == null || workAreas.Count == 0)
                throw new ArgumentException("At least one monitor work area is required.", "workAreas");

            // The caller places the primary work area first. Keeping it selected
            // when every intersection is zero handles a removed secondary display.
            Rectangle selected = workAreas[0];
            long largestIntersection = 0;
            foreach (Rectangle workArea in workAreas)
            {
                if (workArea.Width <= 0 || workArea.Height <= 0) continue;
                long overlapWidth = Math.Max(0L,
                    Math.Min((long)workArea.X + workArea.Width, (long)savedBounds.X + Math.Max(0, savedBounds.Width))
                    - Math.Max((long)workArea.X, savedBounds.X));
                long overlapHeight = Math.Max(0L,
                    Math.Min((long)workArea.Y + workArea.Height, (long)savedBounds.Y + Math.Max(0, savedBounds.Height))
                    - Math.Max((long)workArea.Y, savedBounds.Y));
                long intersection = overlapWidth * overlapHeight;
                if (intersection > largestIntersection)
                {
                    selected = workArea;
                    largestIntersection = intersection;
                }
            }

            int width = Math.Min(Math.Max(Math.Max(1, savedBounds.Width), Math.Max(1, minimumSize.Width)), selected.Width);
            int height = Math.Min(Math.Max(Math.Max(1, savedBounds.Height), Math.Max(1, minimumSize.Height)), selected.Height);
            long maxX = (long)selected.X + selected.Width - width;
            long maxY = (long)selected.Y + selected.Height - height;
            long x = Math.Max((long)selected.X, Math.Min((long)savedBounds.X, maxX));
            long y = Math.Max((long)selected.Y, Math.Min((long)savedBounds.Y, maxY));
            return new Rectangle((int)x, (int)y, width, height);
        }

        private void RestoreDesktopWindowState()
        {
            try
            {
                DesktopWindowState state = json.Deserialize<DesktopWindowState>(
                    File.ReadAllText(DesktopWindowStatePath(), Encoding.UTF8));
                Rectangle bounds = new Rectangle(state.x, state.y, state.width, state.height);
                if (state.schemaVersion != 1 || state.width <= 0 || state.height <= 0) throw new InvalidDataException();
                Rectangle[] workAreas = Screen.AllScreens
                    .OrderByDescending(screen => screen.Primary)
                    .Select(screen => screen.WorkingArea)
                    .ToArray();
                bounds = ClampRestoredBounds(bounds, workAreas, MinimumSize);
                StartPosition = FormStartPosition.Manual;
                // Saved bounds are native outer bounds. Creating a captionless
                // Sizable handle after assigning them adds the legacy frame size.
                if (!IsHandleCreated) CreateHandle();
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
            if (!desktopReady || fullscreen) return;
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

    }
}
