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
using System.Runtime.ExceptionServices;
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
        private bool productUpdateAvailable;
        private bool engineUpdateAvailable;
        private Action cancelOfflineUpdateFiles;
        private bool exitAfterOfflineUpdateFiles;

        private void RememberUpdateAvailability(bool engineScope, string status)
        {
            if (status != "available" && status != "full-package-required" && status != "current"
                && status != "ignored" && status != "deferred") return;
            bool available = status == "available" || status == "full-package-required";
            if (engineScope) engineUpdateAvailable = available;
            else productUpdateAvailable = available;
        }

        private async Task CheckForDesktopUpdateAsync(bool manual, string scope)
        {
            await CheckForDesktopUpdateAsync(manual, scope, String.Empty);
        }

        private async Task CheckForDesktopUpdateAsync(bool manual, string scope, string manifestUrl, string input = "")
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
                string[] checkArguments = !String.IsNullOrEmpty(input)
                    ? new[] { "check-update", "--scope", scope, "--json", "--input", input }
                    : !String.IsNullOrEmpty(manifestUrl)
                    ? new[] { "check-update", "--scope", scope, "--json", "--force", "--update-manifest", manifestUrl }
                    : manual
                        ? new[] { "check-update", "--scope", scope, "--json", "--force" }
                        : new[] { "check-update", "--scope", scope, "--json" };
                Tuple<int, string> check = await Task.Run(() => InvokePortableCli(checkArguments));
                if (check.Item1 != 0)
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        String.IsNullOrEmpty(input)
                            ? L("现在无法检查更新，请稍后再试。", "Updates could not be checked right now. Try again later.")
                            : OfflineUpdateFailureMessage(check.Item2),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                string updateStatus = JsonString(check.Item2, "status");
                string current = JsonString(check.Item2, "productCurrent");
                string latest = JsonString(check.Item2, "latest");
                string engineCurrent = JsonString(check.Item2, "engineCurrent");
                string engineLatest = JsonString(check.Item2, "engineLatest");
                string fullPackageManifestUrl = JsonString(check.Item2, "fullPackageManifestUrl");
                RememberUpdateAvailability(engineScope, updateStatus);
                // Background checks only record availability; interaction belongs to an explicit user action.
                if (!manual) return;
                FinishUpdateCheckPhase();
                if (updateStatus == "current")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("当前通道无可用更新。", "No update is available in this channel.")
                            + (engineScope
                                ? (String.IsNullOrEmpty(engineCurrent) ? "" : "\r\n\r\nDeepSeek Harness " + engineCurrent)
                                : (String.IsNullOrEmpty(current) ? "" : "\r\n\r\nDSH-Portable " + current)),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "wrong-platform" && !String.IsNullOrEmpty(input))
                {
                    MessageBox.Show(this, L("所选离线包不适用于当前系统或架构，请下载对应平台的文件。",
                        "This offline package is for another system or architecture. Download the matching platform files."),
                        L("离线更新", "Offline update"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "core-incompatible")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("这个内核需要更新版本的 DSH-Portable 才能使用。请先更新 DSH-Portable，再选择这个内核；也可以先在更新设置里选用适合当前版本的内核。",
                          "This core needs a newer DSH-Portable. Update DSH-Portable first, then choose this core; or pick a core that fits this version in update settings."),
                        L("需要先更新 DSH-Portable", "Update DSH-Portable first"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "core-awaiting-qualification")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("这个内核还在等待测试，不需要你做什么。通过后会自动出现在可选列表里，稍后再检查更新即可。",
                          "This core is still being tested. You do not need to do anything; it appears in the list when it passes. Check for updates again later."),
                        L("内核更新", "Core update"), MessageBoxButtons.OK, MessageBoxIcon.Information);
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
                        L("所选通道尚未提供更新包，请稍后重试。", "No update package is available on the selected channel yet. Try again later."),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "engine-follows-product")
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("所选通道尚未提供内核更新包，请稍后重试。", "No core update package is available on the selected channel yet. Try again later."),
                        L("检查更新", "Check for updates"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (updateStatus == "full-package-required")
                {
                    if (!String.IsNullOrEmpty(input))
                    {
                        Dictionary<string, object> result = json.Deserialize<Dictionary<string, object>>(check.Item2);
                        object supported;
                        if (result == null || !result.TryGetValue("existingFullUpdater", out supported)
                            || !(supported is bool) || !(bool)supported)
                        {
                            MessageBox.Show(this, L("此组件包需要匹配的完整便携包，请选择该完整包的签名清单。",
                                "This component needs a matching full portable package. Select that full package's signed manifest."),
                                L("需要完整便携包", "Full portable package required"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                            return;
                        }
                    }
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
                    int choice = await ShowUpdateChoiceOverlayAsync(current, latest, engineCurrent, engineLatest, true);
                    if (choice == 1) StartFullPackageUpdate(fullPackageManifestUrl, input);
                    else if (choice < 0 && String.IsNullOrEmpty(input)) await Task.Run(() => InvokePortableCli(new[] { "ignore-update", "--scope", scope, "--json" }));
                    else if (String.IsNullOrEmpty(input)) await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--scope", scope, "--json" }));
                    return;
                }
                if (updateStatus != "available")
                {
                    if (manual && !String.IsNullOrEmpty(input)) MessageBox.Show(this,
                        L("离线包不适用于当前环境：", "The offline package is not applicable: ") + updateStatus,
                        L("离线更新", "Offline update"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                if (!trayBridgeReady)
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        UpdateDescription(current, latest, engineCurrent, engineLatest, false, scope) + "\r\n\r\n"
                            + L("为了确认不会中断任务，请等任务状态就绪后再检查更新。",
                                "To avoid interrupting work, wait until the task state is ready, then check for updates again."),
                        targetName + L(" 更新", " update"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (trayState != null && trayState.hasRunningSession)
                {
                    if (!manual) return;
                    MessageBox.Show(this,
                        L("任务仍在运行，本次不会中断它。任务完成后可再次检查更新。",
                          "A task is still running, so it will not be interrupted. Check for updates again when it finishes."),
                        L("稍后更新", "Update later"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (!EnsureNoOtherRunningEnvironmentHosts(manual)) return;

                bool accepted = await ShowUpdateChoiceOverlayAsync(current, latest, engineCurrent, engineLatest, false, scope) == 1;
                if (!accepted)
                {
                    if (String.IsNullOrEmpty(input)) await Task.Run(() => InvokePortableCli(new[] { "defer-update", "--scope", scope, "--json" }));
                    return;
                }
                await ApplyDesktopUpdateAsync(scope, manifestUrl, input);
            }
            catch (Exception error)
            {
                if (!manual) return;
                MessageBox.Show(this,
                    L("更新没有完成，你现在用的版本不受影响，可以稍后再试。", "The update did not finish. The version you use now is unaffected; you can try again later.")
                        + Environment.NewLine + Environment.NewLine + L("详情：", "Details: ") + error.Message,
                    L("更新失败", "Update failed"), MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                updateCheckRunning = false;
                updateInteractionRunning = false;
                RebuildTrayMenu();
            }
        }

        private string OfflineUpdateFailureMessage(string output)
        {
            if (JsonString(output, "code") == "UPDATE_LOCAL_PACKAGE_INVALID")
            {
                switch (JsonString(output, "reason"))
                {
                    case "manifest-required": return L("请选择原始更新清单（.json），不能直接选择 ZIP。", "Select the original update manifest (.json), not the ZIP.");
                    case "missing-manifest": return L("找不到更新清单，请重新选择原始 JSON 文件。", "The update manifest is missing. Select the original JSON file again.");
                    case "missing-signature": return L("缺少所选 JSON 的 .json.sig 签名文件，请将原始签名放在同一目录。", "The matching .json.sig signature is missing. Keep the original signature beside the JSON.");
                    case "missing-archive": return L("缺少清单指定的 ZIP，请将对应 ZIP 按原文件名放在同一目录。", "The ZIP named by the manifest is missing. Keep it in the same folder with its original filename.");
                    case "scope-mismatch": return L("所选文件与入口不匹配。Portable 包请从「从文件更新 Portable」导入，内核包请从「从文件更新内核」导入。", "The file does not match this update section. Use Update Portable from file for Portable packages, or Update core from file for cores.");
                    case "signature-mismatch": return L("清单签名未通过验证，请重新下载配套的原始 JSON 和 .sig，勿编辑文件。", "The manifest signature is invalid. Download the matching original JSON and .sig again without editing them.");
                    case "archive-mismatch": return L("ZIP 大小或校验值不匹配，请重新下载清单指定的 ZIP，勿混用版本。", "The ZIP size or checksum does not match. Download the ZIP named by this manifest without mixing versions.");
                }
            }
            return L("离线更新包未通过验证。请选择原始 JSON，并将同名 .json.sig 和清单指定的 ZIP 放在同一目录。",
                "The offline update failed verification. Select the original JSON and keep its matching .json.sig and named ZIP in the same folder.");
        }

        private async Task SelectOfflineUpdateAsync(string scope)
        {
            if (updateCheckRunning || updateInteractionRunning) return;
            using (OpenFileDialog dialog = new OpenFileDialog {
                Filter = L("签名更新清单 (*.json)|*.json", "Signed update manifest (*.json)|*.json"),
                Title = String.Equals(scope, "engine", StringComparison.Ordinal)
                    ? L("选择内核更新清单（JSON）", "Select core update manifest (JSON)")
                    : L("选择 Portable 更新清单（JSON）", "Select Portable update manifest (JSON)"),
                CheckFileExists = true, Multiselect = false, RestoreDirectory = true
            })
            {
                if (dialog.ShowDialog(this) == DialogResult.OK)
                    await CheckForDesktopUpdateAsync(true, scope, String.Empty, Path.GetFullPath(dialog.FileName));
            }
        }

        private async Task PrepareOfflineUpdateFilesAsync(string scope, string manifestUrl)
        {
            if (shutdownRunning || updateCheckRunning || updateInteractionRunning || exitAfterOfflineUpdateFiles) return;
            updateInteractionRunning = true;
            RebuildTrayMenu();
            string title = L("获取更新文件", "Get update files");
            CancellationTokenSource cancellation = new CancellationTokenSource();
            cancelOfflineUpdateFiles = cancellation.Cancel;
            try
            {
                string parent;
                using (FolderBrowserDialog picker = new FolderBrowserDialog {
                    Description = L("选择保存目录；会新建文件夹，下载并验证配套的 JSON、签名和 ZIP。", "Choose a folder. The matching JSON, signature and ZIP will be downloaded and verified in a new subfolder."),
                    ShowNewFolderButton = true
                })
                {
                    if (picker.ShowDialog(this) != DialogResult.OK) return;
                    parent = Path.GetFullPath(picker.SelectedPath);
                }
                if (cancellation.IsCancellationRequested) return;
                List<string> arguments = new List<string> { "prepare-update-files", "--scope", scope, "--output", parent, "--json", "--progress-json" };
                if (!String.IsNullOrEmpty(manifestUrl)) { arguments.Add("--update-manifest"); arguments.Add(manifestUrl); }
                Tuple<int, string> result;
                using (Form progress = new Form {
                    Text = title, ClientSize = new Size(460, 180), FormBorderStyle = FormBorderStyle.FixedDialog,
                    StartPosition = FormStartPosition.CenterParent, MinimizeBox = false, MaximizeBox = false,
                    ShowInTaskbar = false, AutoScaleMode = AutoScaleMode.Font, Font = Font
                })
                {
                    Label stage = new Label { Location = new Point(20, 20), Size = new Size(420, 24), Text = L("正在准备下载…", "Preparing download…") };
                    ProgressBar bar = new ProgressBar { Location = new Point(20, 54), Size = new Size(420, 18), Style = ProgressBarStyle.Continuous };
                    Label detail = new Label { Location = new Point(20, 84), Size = new Size(420, 36), Text = L("只获取文件，不安装或切换版本。", "Downloads files without installing or switching versions.") };
                    Button cancel = new Button { Text = L("取消", "Cancel"), Location = new Point(340, 132), Size = new Size(100, 30) };
                    progress.Controls.AddRange(new Control[] { stage, bar, detail, cancel });
                    progress.CancelButton = cancel;
                    bool finished = false;
                    Action requestCancellation = delegate {
                        if (finished || cancellation.IsCancellationRequested) return;
                        cancel.Enabled = false;
                        stage.Text = L("正在取消并清理下载…", "Cancelling and cleaning up…");
                        bar.Value = 0;
                        detail.Text = L("请稍等，当前安装的版本不会更改。", "Please wait. The installed version will not change.");
                        cancellation.Cancel();
                    };
                    cancelOfflineUpdateFiles = requestCancellation;
                    cancel.Click += delegate { requestCancellation(); };
                    progress.FormClosing += delegate(object sender, FormClosingEventArgs args) {
                        if (!finished) { args.Cancel = true; requestCancellation(); }
                    };
                    Action<string> onProgress = delegate(string jsonLine) {
                        if (progress.IsDisposed || !progress.IsHandleCreated) return;
                        try { progress.BeginInvoke((MethodInvoker)delegate {
                            if (finished || cancellation.IsCancellationRequested || exitAfterOfflineUpdateFiles) return;
                            string phase = JsonString(jsonLine, "phase");
                            if (phase == "downloading")
                            {
                                long received = JsonLong(jsonLine, "receivedBytes");
                                long total = JsonLong(jsonLine, "totalBytes");
                                int percent = (int)Math.Max(0, Math.Min(100, JsonLong(jsonLine, "percent")));
                                stage.Text = L("正在下载更新文件…", "Downloading update files…");
                                bar.Value = total > 0 ? percent : 0;
                                detail.Text = total > 0 ? percent + "%  ·  " + FormatBytes(received) + " / " + FormatBytes(total)
                                    : FormatBytes(received) + " · " + L("总大小未知", "total size unknown");
                            }
                            else if (phase == "verifying")
                            {
                                stage.Text = L("正在验证更新文件…", "Verifying update files…");
                                bar.Value = 0;
                                detail.Text = L("正在检查签名和 ZIP 校验值。", "Checking the signature and ZIP checksum.");
                            }
                            else if (phase == "complete")
                            {
                                stage.Text = L("文件已下载并验证。", "Files downloaded and verified.");
                                bar.Style = ProgressBarStyle.Continuous;
                                bar.Value = 100;
                                detail.Text = "100%";
                            }
                        }); }
                        catch (InvalidOperationException) { }
                    };
                    TaskCompletionSource<Tuple<int, string>> completion = new TaskCompletionSource<Tuple<int, string>>();
                    progress.Shown += async delegate {
                        try { completion.TrySetResult(await Task.Run(() => InvokePortableCli(arguments.ToArray(), onProgress, cancellation.Token))); }
                        catch (OperationCanceledException) { completion.TrySetResult(Tuple.Create(0, "{\"status\":\"cancelled\"}")); }
                        catch (Exception error) { completion.TrySetException(error); }
                        finally { finished = true; if (!progress.IsDisposed) progress.Close(); }
                    };
                    progress.ShowDialog(this);
                    result = await completion.Task;
                }
                if (IsDisposed) return;
                string status = JsonString(result.Item2, "status");
                string directory = JsonString(result.Item2, "directory");
                if (status == "cancelled")
                {
                    if (JsonBoolean(result.Item2, "cleanupPending"))
                        MessageBox.Show(this, L("已取消，部分下载文件暂时无法清理。请稍后删除此文件夹：", "Cancelled. Some downloaded files could not be cleaned up. Remove this folder later:")
                            + "\r\n\r\n" + directory, title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                if (exitAfterOfflineUpdateFiles) return;
                string version = JsonString(result.Item2, "version");
                if (result.Item1 == 0 && status == "saved" && !String.IsNullOrEmpty(directory) && !String.IsNullOrEmpty(version))
                    MessageBox.Show(this, version + "\r\n\r\n" + directory + "\r\n\r\n"
                        + L("JSON、签名和 ZIP 已配齐并验证。之后从「从文件更新」选择其中的原始 JSON。", "The JSON, signature and ZIP are ready and verified. Later, use Update from file and select the original JSON in this folder."),
                        title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                else
                    MessageBox.Show(this, result.Item1 == 0
                        ? L("未保存更新文件。当前通道或所选版本没有适用于此环境的更新包。", "No update files were saved. This channel or selected version has no update package applicable to this environment.")
                        : L("下载或验证未完成。请检查网络或保存目录，稍后再试；未完成的文件不能用于更新。", "The download or verification did not finish. Check the network or save folder and try again; incomplete files cannot be used for updating."),
                        title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            catch (Exception)
            {
                if (!IsDisposed && !exitAfterOfflineUpdateFiles) MessageBox.Show(this,
                    L("未能获取更新文件，请检查网络或保存目录，稍后再试。当前版本不受影响。", "Update files could not be prepared. Check the network or save folder and try again. The installed version is unaffected."),
                    title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                cancelOfflineUpdateFiles = null;
                cancellation.Dispose();
                updateInteractionRunning = false;
                bool shouldExit = exitAfterOfflineUpdateFiles;
                exitAfterOfflineUpdateFiles = false;
                if (!IsDisposed)
                {
                    if (shouldExit) BeginDesktopShutdown();
                    else RebuildTrayMenu();
                }
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

        private async Task ApplyDesktopUpdateAsync(string scope, string manifestUrl = "", string input = "")
        {
            bool restoredAfterFailure = false;
            ExceptionDispatchInfo updateFailure = null;
            try
            {
                bool engineScope = String.Equals(scope, "engine", StringComparison.Ordinal);
                string targetName = engineScope ? "DeepSeek Harness" : "DSH-Portable";
                ShowDesktopOperation(engineScope
                    ? L("正在准备 DeepSeek Harness 更新…", "Preparing the DeepSeek Harness update…")
                    : L("正在准备 DSH-Portable 更新…", "Preparing the DSH-Portable update…"));
                MarkTrayBridgeUnavailable();
                string[] updateArguments = !String.IsNullOrEmpty(input)
                    ? new[] { "update", "--scope", scope, "--no-browser", "--json", "--progress-json", "--input", input }
                    : String.IsNullOrEmpty(manifestUrl)
                    ? new[] { "update", "--scope", scope, "--no-browser", "--json", "--progress-json" }
                    : new[] { "update", "--scope", scope, "--no-browser", "--json", "--progress-json", "--update-manifest", manifestUrl };
                Tuple<int, string> updated = await Task.Run(() => InvokePortableCli(updateArguments, HandleUpdateProgress));
                if (updated.Item1 != 0)
                {
                    await RestoreDesktopAfterUpdateAttemptAsync();
                    restoredAfterFailure = true;
                    string code = JsonString(updated.Item2, "code");
                    string safeDetail = RedactSensitiveText(updated.Item2);
                    WriteLauncherLog("portable-cli-error", safeDetail.Length > 4096 ? safeDetail.Substring(0, 4096) : safeDetail);
                    throw new InvalidOperationException(code == "UPDATE_LOCAL_PACKAGE_INVALID"
                        ? OfflineUpdateFailureMessage(updated.Item2) : FriendlyPortableUpdateError(code));
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
                RememberUpdateAvailability(engineScope, "current");
                HideDesktopOperation();
                string completionMessage = targetName + L(" 更新已完成。", " update is complete.");
                string[] disabledPlugins = JsonUpdateWarningPlugins(updated.Item2);
                if (disabledPlugins.Length > 0)
                {
                    string pluginList = String.Join("、", disabledPlugins);
                    completionMessage += Environment.NewLine + String.Format(CultureInfo.CurrentCulture,
                        L(
                            "{0} 个插件与新版本不兼容，已被自动停用：{1}。请到插件页更新它们。",
                            "{0} plugins are incompatible with the new version and were automatically disabled: {1}. Update them on the Plugins page."),
                        disabledPlugins.Length, pluginList);
                }
                MessageBox.Show(this,
                    completionMessage,
                    targetName + L(" 已更新", " updated"), MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception error)
            {
                updateFailure = ExceptionDispatchInfo.Capture(error);
            }
            if (updateFailure != null)
            {
                if (!restoredAfterFailure) await RestoreDesktopAfterUpdateAttemptAsync();
                updateFailure.Throw();
            }
        }

        private static string[] JsonUpdateWarningPlugins(string json)
        {
            string input = json ?? String.Empty;
            // CLI stderr JSONL precedes the final stdout result; retain standalone pretty JSON too.
            IEnumerable<string> candidates = new[] { input }.Concat(
                input.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Reverse());
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            foreach (string candidate in candidates)
            {
                try
                {
                    IDictionary<string, object> payload = serializer.DeserializeObject(candidate) as IDictionary<string, object>;
                    object warningsValue;
                    if (payload == null || payload.ContainsKey("type") || !payload.TryGetValue("warnings", out warningsValue)) continue;
                    object[] warnings = warningsValue as object[];
                    if (warnings == null) return new string[0];

                    List<string> plugins = new List<string>();
                    foreach (object warningValue in warnings)
                    {
                        IDictionary<string, object> warning = warningValue as IDictionary<string, object>;
                        object pluginValue;
                        if (warning == null || !warning.TryGetValue("plugin", out pluginValue)) continue;
                        string plugin = Convert.ToString(pluginValue, CultureInfo.InvariantCulture);
                        if (!String.IsNullOrWhiteSpace(plugin)) plugins.Add(plugin);
                    }
                    return plugins.Distinct(StringComparer.Ordinal).ToArray();
                }
                catch { }
            }
            return new string[0];
        }

        private void StartFullPackageUpdate(string manifestUrl, string offlineManifestPath = "")
        {
            string helper = null;
            try
            {
                Uri manifest = null;
                if (String.IsNullOrEmpty(offlineManifestPath) && (!Uri.TryCreate(manifestUrl, UriKind.Absolute, out manifest)
                    || manifest.Scheme != Uri.UriSchemeHttps
                    || !String.Equals(manifest.Host, "github.com", StringComparison.OrdinalIgnoreCase)
                    || !manifest.AbsolutePath.StartsWith("/WSL043/DSH-Portable/releases/download/v", StringComparison.Ordinal)
                    || !manifest.AbsolutePath.EndsWith("/portable-manifest.json", StringComparison.Ordinal)))
                    throw new InvalidOperationException(L(
                        "更新清单地址无效，请重新检查更新。",
                        "The update manifest target is invalid. Check for updates again."));
                if (!String.IsNullOrEmpty(offlineManifestPath))
                {
                    offlineManifestPath = Path.GetFullPath(offlineManifestPath);
                    if (!File.Exists(offlineManifestPath)) throw new FileNotFoundException("Offline update manifest is missing.", offlineManifestPath);
                }
                string source = Path.Combine(root, "launcher", "DSH-FullUpdater.exe");
                if (!File.Exists(source)) throw new FileNotFoundException(L(
                    "完整更新组件缺失，请重新安装当前版本后再试。",
                    "The full update component is missing. Reinstall this version and try again."), source);
                helper = Path.Combine(Path.GetTempPath(), "DSH-FullUpdater-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(source, helper, false);
                PortableProcessJob.StartDetachedUpdater(helper, new[]
                {
                    "--upgrade-existing",
                    "--destination", root,
                    String.IsNullOrEmpty(offlineManifestPath) ? "--manifest" : "--manifest-file",
                    String.IsNullOrEmpty(offlineManifestPath) ? manifest.AbsoluteUri : offlineManifestPath,
                    "--window-bounds", String.Join(",", new[] { Bounds.X, Bounds.Y, Bounds.Width, Bounds.Height }.Select(value => value.ToString(System.Globalization.CultureInfo.InvariantCulture))),
                    "--theme", String.Equals(trayTheme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light",
                });
            }
            catch
            {
                if (helper != null) try { File.Delete(helper); } catch { }
                HideDesktopOperation();
                throw;
            }
            ShowDesktopOperation(L(
                "正在交给独立更新器，当前窗口将安全关闭…",
                "Handing off to the updater; this window will close safely…"));
            BeginDesktopShutdown();
        }

        private static bool IsTrustedProductManifestUrl(string manifestUrl)
        {
            Uri manifest;
            return Uri.TryCreate(manifestUrl, UriKind.Absolute, out manifest)
                && manifest.Scheme == Uri.UriSchemeHttps
                && String.Equals(manifest.Host, "github.com", StringComparison.OrdinalIgnoreCase)
                && String.IsNullOrEmpty(manifest.Query) && String.IsNullOrEmpty(manifest.Fragment)
                && Regex.IsMatch(manifest.AbsolutePath, @"^/WSL043/DSH-Portable/releases/download/update-channel-(stable|candidate)/portable-update-windows-x64-\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?\.json$");
        }

        private static bool IsTrustedEngineManifestUrl(string manifestUrl)
        {
            Uri manifest;
            return Uri.TryCreate(manifestUrl, UriKind.Absolute, out manifest)
                && manifest.Scheme == Uri.UriSchemeHttps
                && String.Equals(manifest.Host, "github.com", StringComparison.OrdinalIgnoreCase)
                && manifest.AbsolutePath.StartsWith("/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-", StringComparison.Ordinal)
                && manifest.AbsolutePath.Contains("/dsh-core-update-")
                && manifest.AbsolutePath.EndsWith(".json", StringComparison.Ordinal);
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

    }
}
