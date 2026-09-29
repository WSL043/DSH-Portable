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
        private void HandleFailure(int exitCode, string message)
        {
            AppendStartupTrace("native-host", "startup-failed", new Dictionary<string, object> { { "exitCode", exitCode } });
            startupTraceActive = false;
            operationRunning = false;
            if (String.Equals(
                Environment.GetEnvironmentVariable("DSH_PORTABLE_UPDATE_PREFLIGHT"),
                "1",
                StringComparison.Ordinal))
            {
                WriteNonInteractiveDiagnostic(message);
                Environment.ExitCode = exitCode != 0 ? exitCode : 1;
                allowClose = true;
                DisposeTrayIcon();
                Close();
                return;
            }
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
            return InvokePortableCli(actionArgs, null);
        }

        private Tuple<int, string> InvokePortableCli(string[] actionArgs, Action<string> progressCallback)
        {
            string node = Path.Combine(root, "runtime", "node", "node.exe");
            string runtimeEntry = Path.Combine(root, "launcher", "runtime-entry.mjs");
            string cli = Path.Combine(root, "launcher", "portable-cli.mjs");
            if (!File.Exists(node) || !File.Exists(runtimeEntry) || !File.Exists(cli))
                throw new InvalidOperationException(L(
                    "DSH-Portable 文件夹不完整。请完整解压后再启动。",
                    "This DSH-Portable folder is incomplete. Extract the entire package before starting it."));

            StringBuilder arguments = new StringBuilder(QuoteArgument(runtimeEntry));
            arguments.Append(" ").Append(QuoteArgument(Path.GetFileName(cli)));
            foreach (string item in actionArgs) arguments.Append(" ").Append(QuoteArgument(item));
            if (!String.Equals(environmentId, "default", StringComparison.Ordinal)
                && !actionArgs.Any(item => String.Equals(item, "--environment", StringComparison.OrdinalIgnoreCase)))
                arguments.Append(" --environment ").Append(QuoteArgument(environmentId));
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
            string baseStateRoot = String.Equals(environmentId, "default", StringComparison.Ordinal)
                ? stateRoot
                : Directory.GetParent(Directory.GetParent(stateRoot).FullName).FullName;
            start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"] = baseStateRoot;
            // Only the preparation process gets this default. runtime-entry
            // clears it before starting the core or plugin helpers.
            if (actionArgs.Length > 0 && actionArgs[0] == "start"
                && !start.EnvironmentVariables.ContainsKey("UV_THREADPOOL_SIZE"))
            {
                start.EnvironmentVariables["UV_THREADPOOL_SIZE"] = "16";
                start.EnvironmentVariables["DSH_PORTABLE_PREPARATION_POOL"] = "16";
            }
            if (startupTraceActive)
            {
                start.EnvironmentVariables["DSH_PORTABLE_STARTUP_ID"] = startupId;
                start.EnvironmentVariables["DSH_PORTABLE_STARTUP_STARTED_AT"] = startupStartedAt.ToString(CultureInfo.InvariantCulture);
            }

            using (Process process = Process.Start(start))
            {
                Task<string> stderr = process.StandardError.ReadToEndAsync();
                List<string> stdout = new List<string>();
                string line;
                while ((line = process.StandardOutput.ReadLine()) != null)
                {
                    string progressType = JsonString(line, "type");
                    if (progressCallback != null && (progressType == "update-progress" || progressType == "startup-progress")) progressCallback(line);
                    else if (!String.IsNullOrWhiteSpace(line)) stdout.Add(line);
                }
                process.WaitForExit();
                stderr.Wait();
                string rawMessage = (stderr.Result + Environment.NewLine + String.Join(Environment.NewLine, stdout)).Trim();
                string message = process.ExitCode == 0 ? rawMessage : RedactSensitiveText(rawMessage);
                return Tuple.Create(process.ExitCode, message);
            }
        }

        private void ShowFailure(string message)
        {
            operationRunning = false;
            if (!hiddenForAutomation)
            {
                ShowInTaskbar = true;
                Opacity = 1;
            }
            launchPanel.Visible = true;
            webView.Visible = false;
            activityRing.Visible = false;
            RestoreFailureIdentity();
            if (!desktopStart) ClientSize = new Size(640, 360);
            launchContent.Size = new Size(584, 304);
            CenterLaunchContent();
            MinimumSize = desktopStart ? new Size(900, 620) : Size.Empty;
            FormBorderStyle = desktopStart ? FormBorderStyle.Sizable : FormBorderStyle.FixedDialog;
            MaximizeBox = desktopStart;
            MinimizeBox = desktopStart;
            statusLabel.AutoEllipsis = false;
            statusLabel.Location = new Point(80, 53);
            statusLabel.Size = new Size(480, 28);
            statusLabel.Text = IsStopCommand(launcherArgs)
                ? L("DeepSeek Harness 停止失败。", "DeepSeek Harness could not stop.")
                : L("DeepSeek Harness 启动失败。", "DeepSeek Harness could not start.");
            statusLabel.ForeColor = Color.FromArgb(178, 38, 38);
            detailsBox.Text = message ?? string.Empty;
            detailsBox.Visible = true;
            copyButton.Visible = true;
            closeButton.Location = new Point(468, 252);
            closeButton.Visible = true;
            AcceptButton = closeButton;
            ActiveControl = closeButton;
        }

        private void ShowShutdownFailure(string message)
        {
            operationRunning = false;
            launchPanel.Visible = true;
            launchPanel.BringToFront();
            activityRing.Visible = false;
            RestoreFailureIdentity();
            if (!desktopStart) ClientSize = new Size(640, 360);
            launchContent.Size = new Size(584, 304);
            CenterLaunchContent();
            MinimumSize = desktopStart ? new Size(900, 620) : Size.Empty;
            FormBorderStyle = desktopStart ? FormBorderStyle.Sizable : FormBorderStyle.FixedDialog;
            MaximizeBox = desktopStart;
            MinimizeBox = desktopStart;
            statusLabel.AutoEllipsis = false;
            statusLabel.Location = new Point(80, 53);
            statusLabel.Size = new Size(480, 28);
            statusLabel.Text = L("DeepSeek Harness 停止失败。", "DeepSeek Harness could not stop.");
            statusLabel.ForeColor = Color.FromArgb(178, 38, 38);
            string launcherLog = Path.Combine(ResolveLauncherLogDirectory(), "launcher.log");
            detailsBox.Text = (message ?? string.Empty) + "\r\n\r\n" + L("日志 / Log: ", "Log: ") + launcherLog;
            detailsBox.Visible = true;
            copyButton.Visible = true;
            closeButton.Location = new Point(468, 252);
            closeButton.Visible = true;
            AcceptButton = closeButton;
            ActiveControl = closeButton;
        }

        private void RestoreFailureIdentity()
        {
            productIcon.Visible = true;
            productIcon.Location = new Point(24, 20);
            productIcon.Size = new Size(40, 40);
            productLabel.Text = "DeepSeek Harness";
            productLabel.Location = new Point(80, 18);
            productLabel.Size = new Size(480, 30);
            productLabel.TextAlign = ContentAlignment.MiddleLeft;
            productLabel.Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold, GraphicsUnit.Point);
            statusLabel.TextAlign = ContentAlignment.MiddleLeft;
            statusLabel.Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
        }
    }
}
