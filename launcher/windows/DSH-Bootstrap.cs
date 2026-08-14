using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("DSH-Portable")]
[assembly: System.Reflection.AssemblyDescription("Lightweight downloader for DSH-Portable")]
[assembly: System.Reflection.AssemblyCompany("WSL043")]
[assembly: System.Reflection.AssemblyProduct("DSH-Portable")]
[assembly: System.Reflection.AssemblyCopyright("Copyright © WSL043 2026")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.3")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.0.3")]

namespace DshPortableBootstrap
{
    [DataContract]
    internal sealed class PortableManifest
    {
        [DataMember(Name = "schemaVersion")]
        public int SchemaVersion { get; set; }

        [DataMember(Name = "version")]
        public string Version { get; set; }

        [DataMember(Name = "payloads")]
        public PortablePayloads Payloads { get; set; }
    }

    [DataContract]
    internal sealed class PortablePayloads
    {
        [DataMember(Name = "windowsX64")]
        public PortablePayload WindowsX64 { get; set; }
    }

    [DataContract]
    internal sealed class PortablePayload
    {
        [DataMember(Name = "filename")]
        public string Filename { get; set; }

        [DataMember(Name = "url")]
        public string Url { get; set; }

        [DataMember(Name = "sha256")]
        public string Sha256 { get; set; }

        [DataMember(Name = "bytes")]
        public long Bytes { get; set; }
    }

    [DataContract]
    internal sealed class BootstrapResult
    {
        [DataMember(Name = "status")]
        public string Status { get; set; }

        [DataMember(Name = "version", EmitDefaultValue = false)]
        public string Version { get; set; }

        [DataMember(Name = "destination")]
        public string Destination { get; set; }

        [DataMember(Name = "message", EmitDefaultValue = false)]
        public string Message { get; set; }
    }

    internal sealed class BootstrapOptions
    {
        internal const string DefaultManifestUrl = "https://github.com/WSL043/DSH-Portable/releases/latest/download/portable-manifest.json";
        internal const string OfflineDownloadUrl = "https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.exe";

        internal string ManifestUrl = DefaultManifestUrl;
        internal string Destination;
        internal string ResultFile;
        internal bool AllowHttp;
        internal bool NoLaunch;

        internal static BootstrapOptions Parse(string[] args)
        {
            BootstrapOptions options = new BootstrapOptions();
            string executableDirectory = Path.GetDirectoryName(Application.ExecutablePath);
            options.Destination = Path.Combine(executableDirectory, "DSH-Portable");

            for (int index = 0; index < args.Length; index += 1)
            {
                string argument = args[index];
                if (argument == "--allow-http") options.AllowHttp = true;
                else if (argument == "--no-launch") options.NoLaunch = true;
                else if (argument == "--manifest") options.ManifestUrl = RequireValue(args, ref index, argument);
                else if (argument == "--destination") options.Destination = RequireValue(args, ref index, argument);
                else if (argument == "--result") options.ResultFile = RequireValue(args, ref index, argument);
                else throw new ArgumentException("Unknown option: " + argument);
            }

            options.Destination = Path.GetFullPath(options.Destination);
            return options;
        }

        private static string RequireValue(string[] args, ref int index, string option)
        {
            if (index + 1 >= args.Length || String.IsNullOrWhiteSpace(args[index + 1]))
                throw new ArgumentException(option + " requires a value.");
            index += 1;
            return args[index];
        }
    }

    internal sealed class BootstrapInstaller
    {
        private readonly BootstrapOptions options;
        private readonly Action<string> reportStatus;
        private readonly Action<long, long> reportProgress;

        internal BootstrapInstaller(BootstrapOptions options, Action<string> reportStatus, Action<long, long> reportProgress)
        {
            this.options = options;
            this.reportStatus = reportStatus ?? delegate { };
            this.reportProgress = reportProgress ?? delegate { };
        }

        internal async Task<BootstrapResult> ExecuteAsync(CancellationToken cancellationToken)
        {
            if (IsCompletePortable(options.Destination))
            {
                reportStatus("DSH-Portable 已就绪，正在启动…");
                LaunchIfRequested();
                return Result("ready", null, null);
            }

            if (Directory.Exists(options.Destination))
                throw new InvalidOperationException("目标目录已经存在但内容不完整。为避免覆盖数据，请删除该空目录或把下载器移到其他位置后重试。");

            ValidateRemoteUri(options.ManifestUrl, options.AllowHttp, "manifest");
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

            string destinationParent = Path.GetDirectoryName(options.Destination);
            if (String.IsNullOrEmpty(destinationParent)) throw new InvalidOperationException("目标目录无效。");
            Directory.CreateDirectory(destinationParent);

            string operationId = Guid.NewGuid().ToString("N");
            string temporaryArchive = Path.Combine(Path.GetTempPath(), "dsh-portable-" + operationId + ".zip");
            string stagingRoot = Path.Combine(destinationParent, ".dsh-portable-install-" + operationId);

            try
            {
                reportStatus("正在获取 DSH-Portable 版本信息…");
                PortableManifest manifest = await DownloadManifestAsync(options.ManifestUrl, cancellationToken).ConfigureAwait(false);
                PortablePayload payload = ValidateManifest(manifest);
                ValidateRemoteUri(payload.Url, options.AllowHttp, "payload");

                reportStatus("正在下载运行环境，完成后可离线使用…");
                await DownloadFileAsync(payload.Url, temporaryArchive, payload.Bytes, cancellationToken).ConfigureAwait(false);

                reportStatus("正在验证下载内容…");
                string actualHash = ComputeSha256(temporaryArchive);
                if (!String.Equals(actualHash, payload.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("下载内容校验失败；没有修改目标目录。请重新运行下载器。");

                reportStatus("正在准备可移动文件夹…");
                Directory.CreateDirectory(stagingRoot);
                ExtractWithWindowsTar(temporaryArchive, stagingRoot);
                string extracted = Path.Combine(stagingRoot, "DSH-Portable");
                if (!IsCompletePortable(extracted))
                    throw new InvalidDataException("下载包缺少启动器或运行环境；没有修改目标目录。");
                if (Directory.Exists(options.Destination))
                    throw new IOException("目标目录在安装过程中被创建；为避免覆盖数据，操作已停止。");

                Directory.Move(extracted, options.Destination);
                reportProgress(payload.Bytes, payload.Bytes);
                reportStatus("DSH-Portable 已准备完成。");
                LaunchIfRequested();
                return Result("installed", manifest.Version, null);
            }
            finally
            {
                TryDeleteFile(temporaryArchive);
                TryDeleteDirectory(stagingRoot);
            }
        }

        private BootstrapResult Result(string status, string version, string message)
        {
            return new BootstrapResult
            {
                Status = status,
                Version = version,
                Destination = options.Destination,
                Message = message,
            };
        }

        internal BootstrapResult Failure(Exception error)
        {
            return Result("failed", null, FriendlyMessage(error));
        }

        internal static bool IsCompletePortable(string root)
        {
            return File.Exists(Path.Combine(root, "DeepSeek-Herness.exe"))
                && File.Exists(Path.Combine(root, "runtime", "node", "node.exe"))
                && File.Exists(Path.Combine(root, "app", "package.json"));
        }

        private void LaunchIfRequested()
        {
            if (options.NoLaunch) return;
            Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(options.Destination, "DeepSeek-Herness.exe"),
                WorkingDirectory = options.Destination,
                UseShellExecute = true,
            });
        }

        private static async Task<PortableManifest> DownloadManifestAsync(string url, CancellationToken cancellationToken)
        {
            using (HttpClient client = CreateClient())
            using (HttpResponseMessage response = await client.GetAsync(url, HttpCompletionOption.ResponseContentRead, cancellationToken).ConfigureAwait(false))
            {
                response.EnsureSuccessStatusCode();
                byte[] bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                if (bytes.Length == 0 || bytes.Length > 1024 * 1024)
                    throw new InvalidDataException("版本信息大小无效。");
                using (MemoryStream stream = new MemoryStream(bytes))
                {
                    DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(PortableManifest));
                    return (PortableManifest)serializer.ReadObject(stream);
                }
            }
        }

        private async Task DownloadFileAsync(string url, string destination, long expectedBytes, CancellationToken cancellationToken)
        {
            using (HttpClient client = CreateClient())
            using (HttpResponseMessage response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false))
            {
                response.EnsureSuccessStatusCode();
                long? contentLength = response.Content.Headers.ContentLength;
                if (contentLength.HasValue && expectedBytes > 0 && contentLength.Value != expectedBytes)
                    throw new InvalidDataException("下载文件大小与发布信息不一致。");
                if (contentLength.HasValue && contentLength.Value > 1024L * 1024L * 1024L)
                    throw new InvalidDataException("下载文件异常过大，操作已停止。");

                using (Stream input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 128, true))
                {
                    byte[] buffer = new byte[1024 * 128];
                    long total = 0;
                    while (true)
                    {
                        int read = await input.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false);
                        if (read == 0) break;
                        await output.WriteAsync(buffer, 0, read, cancellationToken).ConfigureAwait(false);
                        total += read;
                        reportProgress(total, expectedBytes > 0 ? expectedBytes : (contentLength ?? 0));
                    }
                    await output.FlushAsync(cancellationToken).ConfigureAwait(false);
                    if (expectedBytes > 0 && total != expectedBytes)
                        throw new EndOfStreamException("下载未完成；没有修改目标目录。");
                }
            }
        }

        private static HttpClient CreateClient()
        {
            HttpClientHandler handler = new HttpClientHandler { AllowAutoRedirect = true };
            HttpClient client = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(30) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("DSH-Portable-Bootstrap/1.0");
            return client;
        }

        private static PortablePayload ValidateManifest(PortableManifest manifest)
        {
            if (manifest == null || manifest.SchemaVersion != 1 || manifest.Payloads == null || manifest.Payloads.WindowsX64 == null)
                throw new InvalidDataException("发布信息不兼容，请下载最新版启动器。");
            PortablePayload payload = manifest.Payloads.WindowsX64;
            if (String.IsNullOrWhiteSpace(manifest.Version)
                || String.IsNullOrWhiteSpace(payload.Filename)
                || String.IsNullOrWhiteSpace(payload.Url)
                || payload.Bytes <= 0
                || !Regex.IsMatch(payload.Sha256 ?? String.Empty, "^[0-9a-fA-F]{64}$"))
                throw new InvalidDataException("发布信息缺少必要字段。");
            return payload;
        }

        private static void ValidateRemoteUri(string value, bool allowHttp, string label)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)) throw new InvalidDataException(label + " URL 无效。");
            if (uri.Scheme == Uri.UriSchemeHttps) return;
            if (allowHttp && uri.Scheme == Uri.UriSchemeHttp && (uri.IsLoopback || uri.Host == "127.0.0.1")) return;
            throw new InvalidDataException(label + " URL 必须使用 HTTPS。");
        }

        private static string ComputeSha256(string filename)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(filename))
            {
                byte[] digest = sha.ComputeHash(stream);
                StringBuilder text = new StringBuilder(digest.Length * 2);
                foreach (byte value in digest) text.Append(value.ToString("x2"));
                return text.ToString();
            }
        }

        private static void ExtractWithWindowsTar(string archive, string destination)
        {
            string tar = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "tar.exe");
            if (!File.Exists(tar)) throw new PlatformNotSupportedException("Windows tar.exe 不可用，请改用离线完整包。");
            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = tar,
                Arguments = "-x -f " + Quote(archive) + " -C " + Quote(destination),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
            };
            using (Process process = Process.Start(start))
            {
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidDataException("无法解压下载包：" + error.Trim());
            }
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static string FriendlyMessage(Exception error)
        {
            if (error is OperationCanceledException) return "下载已取消；没有修改目标目录。";
            if (error is HttpRequestException || error is WebException)
                return "无法下载运行环境。请检查网络后重试，或使用离线完整包。";
            return error.Message;
        }

        private static void TryDeleteFile(string filename)
        {
            try { if (File.Exists(filename)) File.Delete(filename); } catch { }
        }

        private static void TryDeleteDirectory(string directory)
        {
            try { if (Directory.Exists(directory)) Directory.Delete(directory, true); } catch { }
        }
    }

    internal sealed class BootstrapWindow : Form
    {
        private readonly BootstrapOptions options;
        private readonly Label titleLabel;
        private readonly Label statusLabel;
        private readonly Label locationLabel;
        private readonly ProgressBar progress;
        private readonly Button actionButton;
        private readonly LinkLabel offlineLink;
        private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
        private bool running = true;

        internal BootstrapWindow(BootstrapOptions options)
        {
            this.options = options;
            Text = "DSH-Portable";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            ClientSize = new Size(520, 210);
            BackColor = Color.FromArgb(250, 250, 250);
            Font = new Font("Segoe UI", 9.5F, FontStyle.Regular, GraphicsUnit.Point);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            titleLabel = new Label
            {
                Text = "准备 DSH-Portable",
                Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold, GraphicsUnit.Point),
                Location = new Point(28, 22),
                Size = new Size(464, 30),
            };
            statusLabel = new Label
            {
                Text = "正在检查本地运行环境…",
                Location = new Point(28, 65),
                Size = new Size(464, 24),
                AutoEllipsis = true,
            };
            locationLabel = new Label
            {
                Text = "保存到：" + options.Destination,
                ForeColor = Color.FromArgb(95, 95, 95),
                Location = new Point(28, 91),
                Size = new Size(464, 23),
                AutoEllipsis = true,
            };
            progress = new ProgressBar
            {
                Location = new Point(28, 123),
                Size = new Size(464, 10),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 22,
            };
            actionButton = new Button
            {
                Text = "取消",
                Location = new Point(400, 157),
                Size = new Size(92, 32),
            };
            actionButton.Click += delegate
            {
                if (running)
                {
                    actionButton.Enabled = false;
                    statusLabel.Text = "正在取消…";
                    cancellation.Cancel();
                }
                else Close();
            };
            offlineLink = new LinkLabel
            {
                Text = "网络有问题？下载离线完整包",
                Location = new Point(28, 164),
                Size = new Size(280, 24),
                Visible = false,
            };
            offlineLink.LinkClicked += delegate
            {
                Process.Start(new ProcessStartInfo { FileName = BootstrapOptions.OfflineDownloadUrl, UseShellExecute = true });
            };

            Controls.Add(titleLabel);
            Controls.Add(statusLabel);
            Controls.Add(locationLabel);
            Controls.Add(progress);
            Controls.Add(actionButton);
            Controls.Add(offlineLink);
            Shown += async delegate { await RunAsync(); };
            FormClosing += OnFormClosing;
        }

        private async Task RunAsync()
        {
            BootstrapInstaller installer = new BootstrapInstaller(options, SetStatus, SetProgress);
            try
            {
                BootstrapResult result = await installer.ExecuteAsync(cancellation.Token);
                WriteResult(options.ResultFile, result);
                running = false;
                Close();
            }
            catch (Exception error)
            {
                BootstrapResult result = installer.Failure(error);
                WriteResult(options.ResultFile, result);
                running = false;
                progress.Visible = false;
                titleLabel.Text = "未能准备 DSH-Portable";
                statusLabel.Text = result.Message;
                statusLabel.ForeColor = Color.FromArgb(176, 38, 38);
                statusLabel.Size = new Size(464, 48);
                offlineLink.Visible = true;
                actionButton.Enabled = true;
                actionButton.Text = "关闭";
                ActiveControl = actionButton;
            }
        }

        private void SetStatus(string text)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(SetStatus), text); return; }
            statusLabel.Text = text;
        }

        private void SetProgress(long current, long total)
        {
            if (InvokeRequired) { BeginInvoke(new Action<long, long>(SetProgress), current, total); return; }
            if (total <= 0) return;
            int value = (int)Math.Max(0, Math.Min(100, current * 100L / total));
            progress.Style = ProgressBarStyle.Continuous;
            progress.MarqueeAnimationSpeed = 0;
            progress.Value = value;
        }

        private void OnFormClosing(object sender, FormClosingEventArgs eventArgs)
        {
            if (!running) return;
            cancellation.Cancel();
            eventArgs.Cancel = true;
        }

        internal static void WriteResult(string filename, BootstrapResult result)
        {
            if (String.IsNullOrWhiteSpace(filename)) return;
            string full = Path.GetFullPath(filename);
            Directory.CreateDirectory(Path.GetDirectoryName(full));
            using (FileStream stream = new FileStream(full, FileMode.Create, FileAccess.Write, FileShare.Read))
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(BootstrapResult));
                serializer.WriteObject(stream, result);
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            BootstrapOptions options = null;
            try
            {
                options = BootstrapOptions.Parse(args);
                if (!String.IsNullOrWhiteSpace(options.ResultFile))
                {
                    BootstrapInstaller installer = new BootstrapInstaller(options, null, null);
                    try
                    {
                        BootstrapResult result = installer.ExecuteAsync(CancellationToken.None).GetAwaiter().GetResult();
                        BootstrapWindow.WriteResult(options.ResultFile, result);
                        return 0;
                    }
                    catch (Exception error)
                    {
                        BootstrapWindow.WriteResult(options.ResultFile, installer.Failure(error));
                        return 1;
                    }
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new BootstrapWindow(options));
                return 0;
            }
            catch (Exception error)
            {
                if (options != null) BootstrapWindow.WriteResult(options.ResultFile, new BootstrapResult
                {
                    Status = "failed",
                    Destination = options.Destination,
                    Message = error.Message,
                });
                else MessageBox.Show(error.Message, "DSH-Portable", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }
        }
    }
}
