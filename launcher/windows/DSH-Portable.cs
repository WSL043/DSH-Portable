using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("DeepSeek-Herness")]
[assembly: AssemblyDescription("Portable launcher for the official DeepSeek Harness runtime")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyProduct("DeepSeek-Herness")]
[assembly: AssemblyCopyright("Copyright © WSL043 2026")]
[assembly: AssemblyVersion("0.1.0.2")]
[assembly: AssemblyFileVersion("0.1.0.2")]

namespace DshPortable
{
    internal sealed class LauncherWindow : Form
    {
        private readonly Label statusLabel;
        private readonly ProgressBar progress;
        private readonly Button closeButton;
        private readonly string root;
        private readonly string[] launcherArgs;
        private bool operationRunning = true;

        internal LauncherWindow(string[] args)
        {
            root = Path.GetDirectoryName(Application.ExecutablePath);
            launcherArgs = ResolveArguments(args);

            Text = "DeepSeek-Herness";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            ClientSize = new Size(440, 138);
            BackColor = Color.White;
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

            statusLabel = new Label();
            statusLabel.AutoEllipsis = true;
            statusLabel.Location = new Point(28, 26);
            statusLabel.Size = new Size(384, 48);
            statusLabel.Text = IsStopCommand(launcherArgs) ? "Stopping DeepSeek-Herness…" : "Starting DeepSeek-Herness…";

            progress = new ProgressBar();
            progress.Location = new Point(28, 83);
            progress.Size = new Size(384, 8);
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 24;

            closeButton = new Button();
            closeButton.Text = "Close";
            closeButton.Size = new Size(92, 32);
            closeButton.Location = new Point(320, 88);
            closeButton.Visible = false;
            closeButton.Click += delegate { Close(); };

            Controls.Add(statusLabel);
            Controls.Add(progress);
            Controls.Add(closeButton);
            Shown += async delegate { await RunLauncherAsync(); };
            FormClosing += delegate(object sender, FormClosingEventArgs eventArgs)
            {
                if (operationRunning && eventArgs.CloseReason == CloseReason.UserClosing) eventArgs.Cancel = true;
            };
        }

        private static string[] ResolveArguments(string[] args)
        {
            if (args != null && args.Length > 0) return args;
            string name = Path.GetFileNameWithoutExtension(Application.ExecutablePath);
            return name.StartsWith("Stop ", StringComparison.OrdinalIgnoreCase)
                ? new[] { "stop" }
                : new[] { "start" };
        }

        private static bool IsStopCommand(string[] args)
        {
            return args.Length > 0 && string.Equals(args[0], "stop", StringComparison.OrdinalIgnoreCase);
        }

        private static string QuoteArgument(string value)
        {
            if (string.IsNullOrEmpty(value)) return "\"\"";
            StringBuilder quoted = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char character in value)
            {
                if (character == '\\')
                {
                    backslashes += 1;
                    continue;
                }
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
            try
            {
                Tuple<int, string> result = await Task.Run(() => InvokePortableCli());
                if (result.Item1 == 0)
                {
                    operationRunning = false;
                    Close();
                    return;
                }
                ShowFailure(result.Item2.Length > 0 ? result.Item2 : "DeepSeek-Herness could not complete the requested action.");
            }
            catch (Exception error)
            {
                ShowFailure(error.Message);
            }
        }

        private Tuple<int, string> InvokePortableCli()
        {
            string node = Path.Combine(root, "runtime", "node", "node.exe");
            string cli = Path.Combine(root, "launcher", "portable-cli.mjs");
            if (!File.Exists(node) || !File.Exists(cli))
                throw new InvalidOperationException("This DSH-Portable folder is incomplete. Extract the entire package before starting it.");

            StringBuilder arguments = new StringBuilder(QuoteArgument(cli));
            foreach (string item in launcherArgs) arguments.Append(" ").Append(QuoteArgument(item));

            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = node;
            start.Arguments = arguments.ToString();
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            if (File.Exists(Path.Combine(root, "installed-mode.json")) &&
                string.IsNullOrEmpty(start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"]))
            {
                string localState = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DeepSeek-Herness"
                );
                start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"] = localState;
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
            progress.Visible = false;
            statusLabel.Text = message;
            statusLabel.ForeColor = Color.FromArgb(178, 38, 38);
            statusLabel.Size = new Size(384, 62);
            closeButton.Visible = true;
            AcceptButton = closeButton;
            ActiveControl = closeButton;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherWindow(args));
        }
    }
}
