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

        private async Task<int> ShowUpdateChoiceOverlayAsync(string current, string latest, string engineCurrent, string engineLatest, bool fullPackage, string scope = "product")
        {
            bool engineScope = String.Equals(scope, "engine", StringComparison.Ordinal);
            RestoreFromTray();
            webView.Enabled = false;
            launchPanel.Visible = true;
            launchPanel.BringToFront();
            ConfigureDesktopLoadingSurface(engineScope
                ? L("发现 DeepSeek Harness 更新", "DeepSeek Harness update available")
                : L("发现 DSH-Portable 更新", "DSH-Portable update available"), true);
            launchContent.Size = new Size(540, 260);
            productIcon.Location = new Point(252, 0);
            productLabel.Location = new Point(0, 43);
            productLabel.Size = new Size(540, 28);
            productLabel.Text = engineScope ? "DeepSeek Harness" : "DSH-Portable";
            activityRing.Visible = false;
            statusLabel.Location = new Point(0, 78);
            statusLabel.Size = new Size(540, 22);
            progressDetail.Location = new Point(20, 109);
            progressDetail.Size = new Size(500, 75);
            progressDetail.AutoEllipsis = false;
            progressDetail.Text = UpdateDescription(current, latest, engineCurrent, engineLatest, fullPackage, scope);
            progressDetail.TextAlign = ContentAlignment.MiddleCenter;
            CenterLaunchContent();

            Button updateNow = new Button { Text = L("现在更新", "Update now"), Location = new Point(fullPackage ? 100 : 154, 208), Size = new Size(105, 36) };
            Button skip = new Button { Text = L("跳过此版本", "Skip version"), Location = new Point(216, 208), Size = new Size(105, 36), Visible = fullPackage };
            Button later = new Button { Text = L("稍后", "Later"), Location = new Point(fullPackage ? 332 : 281, 208), Size = new Size(105, 36) };
            bool dark = String.Equals(trayTheme, "dark", StringComparison.OrdinalIgnoreCase);
            foreach (Button button in new[] { updateNow, skip, later })
            {
                button.FlatStyle = FlatStyle.Flat;
                button.FlatAppearance.BorderSize = 1;
                button.FlatAppearance.BorderColor = dark ? Color.FromArgb(77, 77, 81) : Color.FromArgb(202, 204, 208);
                button.BackColor = dark ? Color.FromArgb(48, 48, 51) : Color.FromArgb(255, 255, 255);
                button.ForeColor = dark ? Color.FromArgb(235, 235, 235) : Color.FromArgb(35, 35, 35);
            }
            updateNow.FlatAppearance.BorderSize = 0;
            updateNow.BackColor = dark ? Color.FromArgb(235, 235, 235) : Color.FromArgb(35, 35, 35);
            updateNow.ForeColor = dark ? Color.FromArgb(24, 24, 26) : Color.White;
            Button previousAccept = AcceptButton as Button;
            Button previousCancel = CancelButton as Button;
            TaskCompletionSource<int> selection = new TaskCompletionSource<int>();
            updateNow.Click += delegate { selection.TrySetResult(1); };
            skip.Click += delegate { selection.TrySetResult(-1); };
            later.Click += delegate { selection.TrySetResult(0); };
            FormClosedEventHandler closed = delegate { selection.TrySetResult(0); };
            FormClosingEventHandler closing = delegate { selection.TrySetResult(0); };
            FormClosed += closed;
            FormClosing += closing;
            launchContent.Controls.Add(updateNow);
            launchContent.Controls.Add(skip);
            launchContent.Controls.Add(later);
            AcceptButton = updateNow;
            CancelButton = later;
            updateNow.Focus();
            int choice = 0;
            try
            {
                choice = await selection.Task;
                return choice;
            }
            finally
            {
                FormClosed -= closed;
                FormClosing -= closing;
                AcceptButton = previousAccept;
                CancelButton = previousCancel;
                launchContent.Controls.Remove(updateNow);
                launchContent.Controls.Remove(skip);
                launchContent.Controls.Remove(later);
                updateNow.Dispose();
                skip.Dispose();
                later.Dispose();
                if (!IsDisposed)
                {
                    ConfigureDesktopLoadingSurface(engineScope
                        ? L("正在准备内核更新…", "Preparing the engine update…")
                        : L("正在准备 DSH-Portable 更新…", "Preparing the DSH-Portable update…"), true);
                    if (choice != 1) HideDesktopOperation();
                }
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
                else if (phase == "stopping-current") statusLabel.Text = L("下载已完成，正在暂停工作台以安全更新…", "Download complete. Pausing the workspace for a safe update…");
                else if (phase == "preflighting") statusLabel.Text = L("正在检查现有插件与新内核是否兼容…", "Checking existing plugins against the new core…");
                else if (phase == "installing") statusLabel.Text = L("正在安装 DSH-Portable 更新…", "Installing the DSH-Portable update…");
                else if (phase == "validating") statusLabel.Text = L("正在验证新版本能否启动…", "Checking that the new version can start…");
                else if (phase == "rolling-back") statusLabel.Text = L("新版本未通过验证，正在恢复原版本…", "The new version did not pass validation; restoring the previous version…");
                else if (phase == "rollback-complete" || phase == "restarting-previous") statusLabel.Text = L("已恢复原版本，正在重新启动…", "The previous version was restored and is restarting…");
                else if (phase == "restarting-current") statusLabel.Text = L("当前版本未更改，正在重新打开工作台…", "The installed version was unchanged. Reopening the workspace…");
                else if (phase == "recovered") statusLabel.Text = L("原版本已恢复，正在重新打开工作台…", "The previous version is ready; reopening the workspace…");
                else if (phase == "complete") statusLabel.Text = L("正在重新打开工作台…", "Reopening the workspace…");
                progressDetail.Text = phase == "complete" ? "100%" : L("会话、设置、插件和工作区保持不变", "Sessions, settings, plugins, and workspace stay in place");
            }
            progressDetail.Visible = true;
        }

        private void HandleStartupProgress(string jsonLine)
        {
            if (!IsHandleCreated || IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action<string>(HandleStartupProgress), jsonLine); }
                catch (InvalidOperationException) { }
                return;
            }
            string phase = JsonString(jsonLine, "phase");
            if (phase == "runtime-preparing")
                statusLabel.Text = L("正在准备便携运行环境…", "Preparing the portable runtime…");
            else if (phase == "runtime-directories" || phase == "runtime-files")
            {
                long completed = JsonLong(jsonLine, "completed");
                long total = JsonLong(jsonLine, "total");
                if (total <= 0) return;
                int percent = (int)Math.Max(0, Math.Min(100, completed * 100D / total));
                // Each percentage describes this phase, not an estimated ETA.
                statusLabel.Text = (phase == "runtime-directories"
                    ? L("正在准备运行环境…", "Preparing the runtime…")
                    : L("正在展开运行文件…", "Unpacking runtime files…")) + " " + percent + "%";
            }
            else if (phase == "runtime-finalizing")
                statusLabel.Text = L("正在完成运行环境准备…", "Finishing runtime preparation…");
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

        private string FriendlyPortableUpdateError(string code)
        {
            if (String.Equals(code, "UPDATE_ROLLED_BACK", StringComparison.Ordinal)) return L(
                "新版本未通过启动验证，已恢复并重新启动原版本。详细信息已写入支持日志。",
                "The new version did not pass startup validation. The previous version was restored and restarted. Details were saved to the support log.");
            if (String.Equals(code, "UPDATE_RECOVERY_FAILED", StringComparison.Ordinal)) return L(
                "更新失败，原版本也未能自动重启。请重新打开 DSH-Portable 并导出支持报告。",
                "The update failed and the previous version could not restart automatically. Reopen DSH-Portable and export a support report.");
            if (String.Equals(code, "DSH_PROFILE_COMPATIBILITY_FAILED", StringComparison.Ordinal)) return L(
                "新内核与现有插件 Profile 不兼容，当前版本未被替换并已重新打开。详细信息已写入支持日志。",
                "The new core is incompatible with an existing plugin profile. The installed version was not replaced and has reopened. Details were saved to the support log.");
            return L(
                "更新未能完成。安装仍可恢复；请导出支持报告以便排查。",
                "The update could not be completed. The installation remains recoverable; export a support report for details.");
        }

        private static string RedactSensitiveText(string source)
        {
            string value = source ?? String.Empty;
            value = Regex.Replace(value, "(?i)(Bearer\\s+)[^\\s\\\"']+", "$1[REDACTED]");
            value = Regex.Replace(value,
                "(?i)([\\\"']?[^\\s\\\"']*(?:token|password|secret|authorization|cookie|api[_-]?key)[^\\s\\\"']*[\\\"']?\\s*[:=]\\s*)[\\\"']?[^\\s,;}&\\\"']+",
                "$1[REDACTED]");
            value = Regex.Replace(value, "(?i)([?&](?:token|access_token|auth|authorization)=)[^&#\\s]+", "$1[REDACTED]");
            value = Regex.Replace(value, "\\bsk-[A-Za-z0-9_-]{6,}\\b", "[REDACTED]");
            return value;
        }

    }
}
