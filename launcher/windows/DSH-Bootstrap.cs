using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Globalization;
using System.Runtime.InteropServices;
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
using Microsoft.Win32.SafeHandles;

[assembly: System.Reflection.AssemblyTitle("DSH-Portable")]
[assembly: System.Reflection.AssemblyDescription("Lightweight downloader for DSH-Portable")]
[assembly: System.Reflection.AssemblyCompany("WSL043")]
[assembly: System.Reflection.AssemblyProduct("DSH-Portable")]
[assembly: System.Reflection.AssemblyCopyright("Copyright © WSL043 2026")]
[assembly: System.Reflection.AssemblyVersion("0.6.0.1")]
[assembly: System.Reflection.AssemblyFileVersion("0.6.0.1")]

namespace DshPortableBootstrap
{
    internal sealed class BootstrapActivityRing : Control
    {
        private readonly System.Windows.Forms.Timer animationTimer;
        private bool indeterminate = true;
        private int value;
        private int rotation;

        internal BootstrapActivityRing()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            animationTimer = new System.Windows.Forms.Timer { Interval = 16, Enabled = true };
            animationTimer.Tick += delegate { rotation = (rotation + 7) % 360; Invalidate(); };
        }

        internal bool Indeterminate
        {
            get { return indeterminate; }
            set { indeterminate = value; animationTimer.Enabled = value && Visible; Invalidate(); }
        }

        internal int Value
        {
            get { return value; }
            set { this.value = Math.Max(0, Math.Min(100, value)); Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs eventArgs)
        {
            base.OnPaint(eventArgs);
            eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float stroke = 2F;
            float diameter = Math.Max(2F, Math.Min(Width, Height) - stroke - 1F);
            RectangleF bounds = new RectangleF((Width - diameter) / 2F, (Height - diameter) / 2F, diameter, diameter);
            using (Pen track = new Pen(Color.FromArgb(226, 228, 232), stroke)) eventArgs.Graphics.DrawEllipse(track, bounds);
            float sweep = indeterminate ? 72F : value >= 100 ? 359.9F : Math.Max(0F, 360F * value / 100F);
            if (sweep > 0F)
            {
                using (Pen indicator = new Pen(Color.FromArgb(27, 28, 30), stroke))
                {
                    indicator.StartCap = LineCap.Round;
                    indicator.EndCap = LineCap.Round;
                    eventArgs.Graphics.DrawArc(indicator, bounds, indeterminate ? rotation - 90F : -90F, sweep);
                }
            }
        }

        protected override void OnVisibleChanged(EventArgs eventArgs)
        {
            base.OnVisibleChanged(eventArgs);
            animationTimer.Enabled = Visible && indeterminate;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) animationTimer.Dispose();
            base.Dispose(disposing);
        }
    }

    internal static class BootstrapText
    {
        private static readonly string UiLanguage = CultureInfo.InstalledUICulture.TwoLetterISOLanguageName;

        internal static string L(string chinese, string english)
        {
            return String.Equals(UiLanguage, "zh", StringComparison.OrdinalIgnoreCase) ? chinese : english;
        }
    }

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
    internal sealed class InstalledComponents
    {
        [DataMember(Name = "portableVersion")]
        public string PortableVersion { get; set; }
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

    [DataContract]
    internal sealed class InstalledModeDefinition
    {
        [DataMember(Name = "schemaVersion")]
        public int SchemaVersion { get; set; }

        [DataMember(Name = "stateRoot")]
        public string StateRoot { get; set; }
    }

    [DataContract]
    internal sealed class UpdateOutcome
    {
        [DataMember(Name = "schemaVersion")]
        public int SchemaVersion { get; set; }

        [DataMember(Name = "status")]
        public string Status { get; set; }

        [DataMember(Name = "targetVersion", EmitDefaultValue = false)]
        public string TargetVersion { get; set; }

        [DataMember(Name = "restoredVersion", EmitDefaultValue = false)]
        public string RestoredVersion { get; set; }

        [DataMember(Name = "recordedAt")]
        public string RecordedAt { get; set; }

        [DataMember(Name = "message", EmitDefaultValue = false)]
        public string Message { get; set; }
    }

    internal sealed class BootstrapOptions
    {
        internal const string DefaultManifestUrl = "https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-manifest.json";
        internal const string OfflineDownloadUrl = "https://github.com/WSL043/DSH-Portable/releases/latest/download/DSH-Portable-windows-x64-offline.zip";

        internal string ManifestUrl = DefaultManifestUrl;
        internal string Destination;
        internal string ResultFile;
        internal bool AllowHttp;
        internal bool NoLaunch;
        internal bool UpgradeExisting;
        internal bool DestinationExplicit;

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
                else if (argument == "--upgrade-existing") options.UpgradeExisting = true;
                else if (argument == "--manifest") options.ManifestUrl = RequireValue(args, ref index, argument);
                else if (argument == "--destination")
                {
                    options.Destination = RequireValue(args, ref index, argument);
                    options.DestinationExplicit = true;
                }
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
        private const uint GenericWrite = 0x40000000;
        private const uint FileShareRead = 0x00000001;
        private const uint CreateAlways = 2;
        private const uint FileAttributeNormal = 0x00000080;
        private const uint FileAttributeDirectory = 0x00000010;
        private const uint FileAttributeReadOnly = 0x00000001;
        private const uint FileAttributeReparsePoint = 0x00000400;
        private const uint InvalidFileAttributes = 0xffffffff;
        private const int ErrorFileNotFound = 2;
        private const int ErrorPathNotFound = 3;
        private const int ErrorNoMoreFiles = 18;
        private const int ErrorAlreadyExists = 183;
        private static readonly IntPtr InvalidFindHandle = new IntPtr(-1);

        private sealed class SemanticVersion
        {
            internal long Major;
            internal long Minor;
            internal long Patch;
            internal string[] Prerelease;
        }

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
            bool existingComplete = IsCompletePortable(options.Destination);
            bool upgradeExisting = options.UpgradeExisting;
            string installedVersion = existingComplete ? ReadInstalledPortableVersion(options.Destination) : null;
            PortableManifest manifest = null;
            PortablePayload payload = null;

            if (existingComplete && !upgradeExisting)
            {
                if (String.IsNullOrWhiteSpace(installedVersion))
                {
                    reportStatus(BootstrapText.L("现有 DSH-Portable 缺少版本信息，正在直接启动…", "Version information is unavailable. Starting DSH-Portable…"));
                    LaunchIfRequested();
                    return Result("ready", null, "Installed version metadata is unavailable; automatic update was skipped.");
                }

                try
                {
                    ValidateRemoteUri(options.ManifestUrl, options.AllowHttp, "manifest");
                    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                    reportStatus(BootstrapText.L("正在检查 DSH-Portable 更新…", "Checking for DSH-Portable updates…"));
                    manifest = await DownloadManifestAsync(
                        options.ManifestUrl,
                        cancellationToken,
                        TimeSpan.FromSeconds(5)).ConfigureAwait(false);
                    payload = ValidateManifest(manifest);
                    ValidateRemoteUri(payload.Url, options.AllowHttp, "payload");
                    int compared = ComparePortableVersions(installedVersion, manifest.Version);
                    if (compared >= 0)
                    {
                        reportStatus(BootstrapText.L("DSH-Portable 已是最新版，正在启动…", "DSH-Portable is up to date. Starting…"));
                        LaunchIfRequested();
                        return Result("ready", installedVersion, null);
                    }
                    upgradeExisting = true;
                    reportStatus(BootstrapText.L("发现新版本 " + manifest.Version + "，正在准备安全升级…", "Version " + manifest.Version + " is available. Preparing a safe update…"));
                }
                catch (Exception error)
                {
                    if (error is OperationCanceledException && cancellationToken.IsCancellationRequested) throw;
                    reportStatus(BootstrapText.L("暂时无法检查更新，正在启动现有版本…", "Could not check for updates. Starting the installed version…"));
                    LaunchIfRequested();
                    return Result("ready", installedVersion, FriendlyMessage(error));
                }
            }

            if (Directory.Exists(options.Destination) && !upgradeExisting)
                throw new InvalidOperationException(BootstrapText.L("目标目录已经存在但内容不完整。为避免覆盖数据，请删除该空目录或把下载器移到其他位置后重试。", "The destination folder exists but is incomplete. To protect your data, remove the empty folder or move the downloader elsewhere and try again."));

            ValidateRemoteUri(options.ManifestUrl, options.AllowHttp, "manifest");
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

            string destinationParent = Path.GetDirectoryName(options.Destination);
            if (String.IsNullOrEmpty(destinationParent)) throw new InvalidOperationException(BootstrapText.L("目标目录无效。", "The destination folder is invalid."));
            Directory.CreateDirectory(destinationParent);

            string operationId = Guid.NewGuid().ToString("N");
            string temporaryArchive = Path.Combine(Path.GetTempPath(), "dsh-portable-" + operationId + ".zip");
            string stagingRoot = Path.Combine(destinationParent, ".dsh-portable-install-" + operationId);

            try
            {
                if (manifest == null || payload == null)
                {
                    reportStatus(BootstrapText.L("正在获取 DSH-Portable 版本信息…", "Getting DSH-Portable version information…"));
                    manifest = await DownloadManifestAsync(options.ManifestUrl, cancellationToken).ConfigureAwait(false);
                    payload = ValidateManifest(manifest);
                    ValidateRemoteUri(payload.Url, options.AllowHttp, "payload");
                }

                reportStatus(BootstrapText.L("正在下载运行环境，完成后可离线使用…", "Downloading the runtime for offline use…"));
                await DownloadFileAsync(payload.Url, temporaryArchive, payload.Bytes, cancellationToken).ConfigureAwait(false);

                reportStatus(BootstrapText.L("正在验证下载内容…", "Verifying the download…"));
                string actualHash = ComputeSha256(temporaryArchive);
                if (!String.Equals(actualHash, payload.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException(BootstrapText.L("下载内容校验失败；没有修改目标目录。请重新运行下载器。", "The download failed verification. The destination was not changed. Run the downloader again."));

                reportStatus(BootstrapText.L("正在准备可移动文件夹…", "Preparing the movable folder…"));
                EnsureDirectory(stagingRoot);
                ExtractZipArchive(temporaryArchive, stagingRoot);
                string extracted = Path.Combine(stagingRoot, "DSH-Portable");
                if (!IsCompletePortable(extracted))
                    throw new InvalidDataException(BootstrapText.L("下载包缺少启动器或运行环境；没有修改目标目录。", "The package is missing the launcher or runtime. The destination was not changed."));
                if (upgradeExisting)
                {
                    if (!IsCompletePortable(options.Destination))
                        throw new InvalidOperationException(BootstrapText.L("现有 DSH-Portable 目录不完整；没有修改任何文件。", "The existing DSH-Portable folder is incomplete. No files were changed."));
                    reportStatus(BootstrapText.L("正在停止当前版本…", "Stopping the current version…"));
                    StopRunningPortable();
                    reportStatus(BootstrapText.L("正在刷新 DSH profile 模块映射…", "Refreshing the DSH profile module mapping…"));
                    ResetManagedProfileModuleFallback();
                    if (!options.NoLaunch)
                    {
                        reportStatus(BootstrapText.L("正在检查现有数据与新版本的兼容性…", "Checking existing data against the new version…"));
                        try
                        {
                            VerifyStagedPortableCompatibility(extracted, manifest.Version);
                        }
                        catch (Exception compatibilityError)
                        {
                            WriteUpdateOutcome("blocked", manifest.Version, installedVersion, BootstrapText.L(
                                "新版本未通过现有数据兼容性检查，当前版本保持不变。",
                                "The new version did not pass the existing-data compatibility check. The current version was left unchanged."));
                            LaunchIfRequested();
                            throw new InvalidOperationException(BootstrapText.L(
                                "新版本未通过兼容性检查；当前程序文件没有被替换。",
                                "The new version did not pass the compatibility check. Current program files were not replaced."), compatibilityError);
                        }
                    }
                    reportStatus(BootstrapText.L("正在安装新版本并保留个人数据…", "Installing the new version and preserving your data…"));
                    string backupRoot = Path.Combine(destinationParent, ".dsh-portable-backup-" + operationId);
                    ReplacePortableTransactionally(extracted, backupRoot);
                    if (options.NoLaunch)
                    {
                        TryDeleteDirectory(backupRoot);
                    }
                    else
                    try
                    {
                        reportStatus(BootstrapText.L("正在验证新版本工作台…", "Verifying the updated workspace…"));
                        VerifyUpdatedPortableStartup(backupRoot, manifest.Version);
                        TryDeleteDirectory(backupRoot);
                        WriteUpdateOutcome("updated", manifest.Version, null, null);
                    }
                    catch (Exception startupError)
                    {
                        reportStatus(BootstrapText.L("新版本启动失败，正在恢复上一版本…", "The updated version could not start. Restoring the previous version…"));
                        RestorePortableTransactionally(backupRoot);
                        WriteUpdateOutcome("rolled-back", manifest.Version, installedVersion, BootstrapText.L(
                            "上次更新未通过启动验证，已自动恢复上一版本。",
                            "The last update did not pass startup verification, so the previous version was restored."));
                        LaunchIfRequested();
                        throw new InvalidOperationException(BootstrapText.L(
                            "更新后的工作台未通过启动验证，已自动恢复上一版本。",
                            "The updated workspace did not pass startup verification. The previous version was restored."), startupError);
                    }
                }
                else
                {
                    if (Directory.Exists(options.Destination))
                        throw new IOException(BootstrapText.L("目标目录在安装过程中被创建；为避免覆盖数据，操作已停止。", "The destination folder was created during installation. The operation stopped to protect its contents."));
                    Directory.Move(extracted, options.Destination);
                }
                reportProgress(payload.Bytes, payload.Bytes);
                reportStatus(upgradeExisting
                    ? BootstrapText.L("DSH-Portable 已更新完成。", "DSH-Portable has been updated.")
                    : BootstrapText.L("DSH-Portable 已准备完成。", "DSH-Portable is ready."));
                if (!upgradeExisting) LaunchIfRequested();
                return Result(upgradeExisting ? "updated" : "installed", manifest.Version, null);
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

        private static string ReadInstalledPortableVersion(string root)
        {
            string filename = Path.Combine(root, "licenses", "COMPONENTS.json");
            if (!File.Exists(filename)) return null;
            try
            {
                using (FileStream stream = File.OpenRead(filename))
                {
                    DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(InstalledComponents));
                    InstalledComponents components = (InstalledComponents)serializer.ReadObject(stream);
                    return components == null || String.IsNullOrWhiteSpace(components.PortableVersion)
                        ? null
                        : components.PortableVersion.Trim();
                }
            }
            catch { return null; }
        }

        private static SemanticVersion ParsePortableVersion(string value)
        {
            Match match = Regex.Match(
                value ?? String.Empty,
                @"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$");
            long major;
            long minor;
            long patch;
            if (!match.Success
                || !Int64.TryParse(match.Groups[1].Value, out major)
                || !Int64.TryParse(match.Groups[2].Value, out minor)
                || !Int64.TryParse(match.Groups[3].Value, out patch))
                throw new InvalidDataException((value ?? String.Empty) + " is not a valid semantic version.");

            string[] prerelease = null;
            string rawPrerelease = match.Groups[4].Success ? match.Groups[4].Value : null;
            if (!String.IsNullOrEmpty(rawPrerelease))
            {
                Match portablePreview = Regex.Match(rawPrerelease, @"^rc\.([0-9]+)-portable\.([0-9]+)$");
                prerelease = portablePreview.Success
                    ? new[] { "rc", portablePreview.Groups[1].Value, "portable", portablePreview.Groups[2].Value }
                    : rawPrerelease.Split('.');
            }
            return new SemanticVersion { Major = major, Minor = minor, Patch = patch, Prerelease = prerelease };
        }

        private static int CompareNumericIdentifier(string left, string right)
        {
            string normalizedLeft = left.TrimStart('0');
            string normalizedRight = right.TrimStart('0');
            if (normalizedLeft.Length == 0) normalizedLeft = "0";
            if (normalizedRight.Length == 0) normalizedRight = "0";
            if (normalizedLeft.Length != normalizedRight.Length) return normalizedLeft.Length < normalizedRight.Length ? -1 : 1;
            int compared = String.CompareOrdinal(normalizedLeft, normalizedRight);
            return compared == 0 ? 0 : compared < 0 ? -1 : 1;
        }

        private static int ComparePrereleaseIdentifier(string left, string right)
        {
            bool leftNumeric = Regex.IsMatch(left, "^[0-9]+$");
            bool rightNumeric = Regex.IsMatch(right, "^[0-9]+$");
            if (leftNumeric && rightNumeric) return CompareNumericIdentifier(left, right);
            if (leftNumeric != rightNumeric) return leftNumeric ? -1 : 1;
            int compared = String.CompareOrdinal(left, right);
            return compared == 0 ? 0 : compared < 0 ? -1 : 1;
        }

        private static int ComparePortableVersions(string leftValue, string rightValue)
        {
            SemanticVersion left = ParsePortableVersion(leftValue);
            SemanticVersion right = ParsePortableVersion(rightValue);
            long[] leftCore = { left.Major, left.Minor, left.Patch };
            long[] rightCore = { right.Major, right.Minor, right.Patch };
            for (int index = 0; index < 3; index += 1)
            {
                if (leftCore[index] != rightCore[index]) return leftCore[index] < rightCore[index] ? -1 : 1;
            }
            if (left.Prerelease == null || right.Prerelease == null)
            {
                if (left.Prerelease == null && right.Prerelease == null) return 0;
                return left.Prerelease == null ? 1 : -1;
            }
            int length = Math.Max(left.Prerelease.Length, right.Prerelease.Length);
            for (int index = 0; index < length; index += 1)
            {
                if (index >= left.Prerelease.Length) return -1;
                if (index >= right.Prerelease.Length) return 1;
                int compared = ComparePrereleaseIdentifier(left.Prerelease[index], right.Prerelease[index]);
                if (compared != 0) return compared;
            }
            return 0;
        }

        private void LaunchIfRequested()
        {
            if (options.NoLaunch) return;
            Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(options.Destination, "DeepSeek-Herness.exe"),
                WorkingDirectory = options.Destination,
                UseShellExecute = false,
            });
        }

        private void StopRunningPortable()
        {
            string stateFile = Path.Combine(options.Destination, "data", "runtime", "process.json");
            string launcher = Path.Combine(options.Destination, "DeepSeek-Herness.exe");
            bool shouldStop = File.Exists(stateFile) || HasRunningLauncher(launcher);
            if (!shouldStop) return;
            using (Process process = Process.Start(new ProcessStartInfo
            {
                FileName = launcher,
                Arguments = "stop --no-browser --json",
                WorkingDirectory = options.Destination,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            }))
            {
                if (process == null || !process.WaitForExit(30000) || process.ExitCode != 0)
                    throw new InvalidOperationException(BootstrapText.L("当前 DSH 服务未能安全停止；没有替换程序文件。", "The running DSH service could not be stopped safely. No program files were replaced."));
            }
            DateTime deadline = DateTime.UtcNow.AddSeconds(15);
            while (HasRunningLauncher(launcher) && DateTime.UtcNow < deadline) Thread.Sleep(100);
            if (HasRunningLauncher(launcher))
                throw new InvalidOperationException(BootstrapText.L("DSH-Portable 仍在运行；请关闭窗口后重试更新。", "DSH-Portable is still running. Close its window and try the update again."));
            WaitForPortableWebViewRelease();
        }

        private void WriteUpdateOutcome(string status, string targetVersion, string restoredVersion, string message)
        {
            try
            {
                string runtime = Path.Combine(options.Destination, "data", "runtime");
                Directory.CreateDirectory(runtime);
                string destination = Path.Combine(runtime, "last-update-result.json");
                string temporary = destination + "." + Process.GetCurrentProcess().Id + ".tmp";
                UpdateOutcome outcome = new UpdateOutcome
                {
                    SchemaVersion = 1,
                    Status = status,
                    TargetVersion = targetVersion,
                    RestoredVersion = restoredVersion,
                    RecordedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                    Message = message,
                };
                using (FileStream stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.Read))
                {
                    DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(UpdateOutcome));
                    serializer.WriteObject(stream, outcome);
                }
                if (File.Exists(destination)) File.Replace(temporary, destination, null);
                else File.Move(temporary, destination);
            }
            catch { }
        }

        private void VerifyUpdatedPortableStartup(string backupRoot, string targetVersion)
        {
            string runtime = Path.Combine(options.Destination, "data", "runtime");
            Directory.CreateDirectory(runtime);
            string token = Guid.NewGuid().ToString("N");
            string marker = Path.Combine(runtime, "full-update-health-" + token + ".ready");
            Process process = null;
            try
            {
                ProcessStartInfo start = new ProcessStartInfo
                {
                    FileName = Path.Combine(options.Destination, "DeepSeek-Herness.exe"),
                    WorkingDirectory = options.Destination,
                    UseShellExecute = false,
                };
                start.EnvironmentVariables["DSH_PORTABLE_UPDATE_HEALTH_FILE"] = marker;
                start.EnvironmentVariables["DSH_PORTABLE_UPDATE_HEALTH_TOKEN"] = token;
                start.EnvironmentVariables["DSH_PORTABLE_UPDATE_TARGET_VERSION"] = targetVersion ?? String.Empty;
                process = Process.Start(start);
                if (process == null) throw new InvalidOperationException(BootstrapText.L("无法启动更新后的程序。", "The updated application could not be started."));

                DateTime deadline = DateTime.UtcNow.AddSeconds(90);
                while (DateTime.UtcNow < deadline)
                {
                    if (File.Exists(marker))
                    {
                        string actual = File.ReadAllText(marker, Encoding.UTF8).Trim();
                        if (!String.Equals(actual, token, StringComparison.Ordinal))
                            throw new InvalidDataException(BootstrapText.L("更新启动验证结果无效。", "The update startup verification result is invalid."));
                        return;
                    }
                    if (process.HasExited)
                        throw new InvalidOperationException(BootstrapText.L("更新后的程序在工作台就绪前退出。", "The updated application exited before its workspace became ready."));
                    Thread.Sleep(200);
                }
                throw new TimeoutException(BootstrapText.L("更新后的工作台未能在 90 秒内就绪。", "The updated workspace did not become ready within 90 seconds."));
            }
            finally
            {
                TryDeleteFile(marker);
                if (process != null) process.Dispose();
            }
        }

        private void VerifyStagedPortableCompatibility(string extracted, string targetVersion)
        {
            string baseStateRoot = ResolveProductStateRoot();
            foreach (string environmentId in PreflightEnvironmentIds(baseStateRoot))
            {
                string environmentStateRoot = String.Equals(environmentId, "default", StringComparison.Ordinal)
                    ? baseStateRoot
                    : Path.Combine(baseStateRoot, "environments", environmentId);
                string runtime = Path.Combine(environmentStateRoot, "data", "runtime");
                Directory.CreateDirectory(runtime);
                string token = Guid.NewGuid().ToString("N");
                string marker = Path.Combine(runtime, "staged-update-health-" + token + ".ready");
                Process process = null;
                try
                {
                    ProcessStartInfo start = new ProcessStartInfo
                    {
                        FileName = Path.Combine(extracted, "DeepSeek-Herness.exe"),
                        WorkingDirectory = extracted,
                        UseShellExecute = false,
                    };
                    if (!String.Equals(environmentId, "default", StringComparison.Ordinal))
                        start.Arguments = "--environment " + QuoteProcessArgument(environmentId);
                    start.EnvironmentVariables["DSH_PORTABLE_STATE_ROOT"] = baseStateRoot;
                    start.EnvironmentVariables["DSH_PORTABLE_UPDATE_HEALTH_FILE"] = marker;
                    start.EnvironmentVariables["DSH_PORTABLE_UPDATE_HEALTH_TOKEN"] = token;
                    start.EnvironmentVariables["DSH_PORTABLE_UPDATE_TARGET_VERSION"] = targetVersion ?? String.Empty;
                    start.EnvironmentVariables["DSH_PORTABLE_UPDATE_PREFLIGHT"] = "1";
                    start.EnvironmentVariables["DSH_PORTABLE_TEST_HIDDEN"] = "1";
                    process = Process.Start(start);
                    if (process == null) throw new InvalidOperationException(BootstrapText.L("无法启动新版本兼容性检查。", "The new-version compatibility check could not be started."));

                    DateTime deadline = DateTime.UtcNow.AddSeconds(90);
                    bool ready = false;
                    while (DateTime.UtcNow < deadline)
                    {
                        if (File.Exists(marker))
                        {
                            string actual = File.ReadAllText(marker, Encoding.UTF8).Trim();
                            if (!String.Equals(actual, token, StringComparison.Ordinal))
                                throw new InvalidDataException(BootstrapText.L("兼容性检查结果无效。", "The compatibility check result is invalid."));
                            ready = true;
                            break;
                        }
                        if (process.HasExited)
                            throw new InvalidOperationException(BootstrapText.L("新版本在兼容性检查完成前退出。", "The new version exited before its compatibility check completed."));
                        Thread.Sleep(200);
                    }
                    if (!ready) throw new TimeoutException(BootstrapText.L("新版本兼容性检查未能在 90 秒内完成。", "The new-version compatibility check did not finish within 90 seconds."));
                    if (!process.WaitForExit(30000))
                        throw new TimeoutException(BootstrapText.L("兼容性检查完成后，新版本未能安全退出。", "The new version did not exit safely after its compatibility check."));
                    if (process.ExitCode != 0)
                        throw new InvalidOperationException(BootstrapText.L("新版本兼容性检查退出异常。", "The new-version compatibility check exited with an error."));
                }
                finally
                {
                    TryDeleteFile(marker);
                    if (process != null)
                    {
                        try
                        {
                            if (!process.HasExited)
                            {
                                process.Kill();
                                process.WaitForExit(10000);
                            }
                        }
                        catch { }
                        process.Dispose();
                    }
                }
            }
        }

        private System.Collections.Generic.List<string> PreflightEnvironmentIds(string baseStateRoot)
        {
            System.Collections.Generic.List<string> result = new System.Collections.Generic.List<string> { "default" };
            string environmentsRoot = Path.Combine(baseStateRoot, "environments");
            if (!Directory.Exists(environmentsRoot)) return result;
            foreach (string directory in Directory.GetDirectories(environmentsRoot))
            {
                string id = Path.GetFileName(directory).ToLowerInvariant();
                if (!Regex.IsMatch(id, "^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$", RegexOptions.CultureInvariant)
                    || Regex.IsMatch(id, "^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) continue;
                if (!Directory.Exists(Path.Combine(directory, "data", "dsh-home", "profiles"))) continue;
                result.Add(id);
            }
            return result;
        }

        private string ResolveProductStateRoot()
        {
            string definition = Path.Combine(options.Destination, "installed-mode.json");
            if (!File.Exists(definition)) return options.Destination;
            InstalledModeDefinition installed;
            using (FileStream stream = new FileStream(definition, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                installed = (InstalledModeDefinition)new DataContractJsonSerializer(typeof(InstalledModeDefinition)).ReadObject(stream);
            if (installed == null || installed.SchemaVersion != 1 || String.IsNullOrWhiteSpace(installed.StateRoot))
                throw new InvalidDataException(BootstrapText.L("安装模式配置无效。", "The installed-mode configuration is invalid."));
            string expanded = Regex.Replace(installed.StateRoot, "%([^%]+)%", delegate(Match match)
            {
                string value = Environment.GetEnvironmentVariable(match.Groups[1].Value);
                return String.IsNullOrEmpty(value) ? match.Value : value;
            });
            if (Regex.IsMatch(expanded, "%[^%]+%"))
                throw new InvalidDataException(BootstrapText.L("安装模式配置引用了不可用的环境变量。", "The installed-mode configuration references an unavailable environment variable."));
            return Path.GetFullPath(expanded);
        }

        private static string QuoteProcessArgument(string value)
        {
            return "\"" + (value ?? String.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        private void RestorePortableTransactionally(string backupRoot)
        {
            try { StopRunningPortable(); } catch { }
            string[] preserved = new[] { "data", "workspace", "installed-mode.json" };
            foreach (string item in Directory.GetFileSystemEntries(options.Destination))
            {
                string name = Path.GetFileName(item);
                if (Array.Exists(preserved, value => String.Equals(value, name, StringComparison.OrdinalIgnoreCase))) continue;
                DeleteEntry(item);
                if (Directory.Exists(item) || File.Exists(item))
                    throw new IOException(BootstrapText.L("无法移除启动失败的新版本文件。", "A failed updated program file could not be removed."));
            }
            foreach (string item in Directory.GetFileSystemEntries(backupRoot))
            {
                string name = Path.GetFileName(item);
                MoveEntry(item, Path.Combine(options.Destination, name));
            }
            if (!IsCompletePortable(options.Destination))
                throw new InvalidDataException(BootstrapText.L("上一版本恢复后缺少必要文件。", "Required files are missing after restoring the previous version."));
            TryDeleteDirectory(backupRoot);
        }

        private void WaitForPortableWebViewRelease()
        {
            string dataRoot = ResolvePortableWebViewDataRoot();
            if (String.IsNullOrEmpty(dataRoot)) return;
            string script =
                "$root=$env:DSH_PORTABLE_WEBVIEW_ROOT; " +
                "@(Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" -ErrorAction Stop | " +
                "Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count";
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            DateTime deadline = DateTime.UtcNow.AddSeconds(8);
            do
            {
                try
                {
                    ProcessStartInfo start = new ProcessStartInfo
                    {
                        FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
                        Arguments = "-NoProfile -NonInteractive -EncodedCommand " + encoded,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                    };
                    start.EnvironmentVariables["DSH_PORTABLE_WEBVIEW_ROOT"] = dataRoot;
                    using (Process process = Process.Start(start))
                    {
                        Task<string> output = process.StandardOutput.ReadToEndAsync();
                        Task<string> error = process.StandardError.ReadToEndAsync();
                        if (!process.WaitForExit(5000))
                        {
                            try { process.Kill(); } catch { }
                            return;
                        }
                        Task.WaitAll(output, error);
                        int count;
                        if (process.ExitCode != 0 || !Int32.TryParse(output.Result.Trim(), out count)) return;
                        if (count == 0) return;
                    }
                }
                catch { return; }
                Thread.Sleep(250);
            }
            while (DateTime.UtcNow < deadline);
        }

        private string ResolvePortableWebViewDataRoot()
        {
            if (File.Exists(Path.Combine(options.Destination, "installed-mode.json")))
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepSeek-Herness", "data", "webview2");
            string identityPath = Path.Combine(options.Destination, "data", "portable-instance.id");
            if (!File.Exists(identityPath)) return null;
            string identity;
            try { identity = File.ReadAllText(identityPath, Encoding.ASCII).Trim().ToLowerInvariant(); }
            catch { return null; }
            if (!Regex.IsMatch(identity, "^[0-9a-f]{32}$", RegexOptions.CultureInvariant)) return null;
            string fullRoot = Path.GetFullPath(options.Destination).ToUpperInvariant();
            string locationKey;
            using (SHA256 hash = SHA256.Create())
            {
                byte[] digest = hash.ComputeHash(Encoding.UTF8.GetBytes(fullRoot));
                locationKey = BitConverter.ToString(digest, 0, 16).Replace("-", "").ToLowerInvariant();
            }
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DSH-Portable", "webview2", identity, locationKey);
        }

        private static bool HasRunningLauncher(string launcher)
        {
            string expected = Path.GetFullPath(launcher);
            foreach (Process process in Process.GetProcessesByName("DeepSeek-Herness"))
            {
                try
                {
                    if (String.Equals(Path.GetFullPath(process.MainModule.FileName), expected, StringComparison.OrdinalIgnoreCase)) return true;
                }
                catch { }
                finally { process.Dispose(); }
            }
            return false;
        }

        private void ResetManagedProfileModuleFallback()
        {
            string fallback = Path.Combine(options.Destination, "data", "dsh-home", "profiles", "node_modules");
            if (!Directory.Exists(fallback) && !File.Exists(fallback)) return;
            if (Directory.Exists(fallback)) TryDeleteDirectory(fallback);
            else TryDeleteFile(fallback);
            if (Directory.Exists(fallback) || File.Exists(fallback))
                throw new IOException(BootstrapText.L("无法刷新 DSH profile 的可再生模块映射；没有替换程序文件。", "The regenerable DSH profile module mapping could not be refreshed. No program files were replaced."));
        }

        private void ReplacePortableTransactionally(string extracted, string backupRoot)
        {
            string[] preserved = new[] { "data", "workspace", "installed-mode.json" };
            Directory.CreateDirectory(backupRoot);
            System.Collections.Generic.List<string> movedOld = new System.Collections.Generic.List<string>();
            System.Collections.Generic.List<string> movedNew = new System.Collections.Generic.List<string>();
            try
            {
                foreach (string item in Directory.GetFileSystemEntries(options.Destination))
                {
                    string name = Path.GetFileName(item);
                    if (Array.Exists(preserved, value => String.Equals(value, name, StringComparison.OrdinalIgnoreCase))) continue;
                    MoveEntry(item, Path.Combine(backupRoot, name));
                    movedOld.Add(name);
                }
                foreach (string item in Directory.GetFileSystemEntries(extracted))
                {
                    string name = Path.GetFileName(item);
                    string target = Path.Combine(options.Destination, name);
                    if (Array.Exists(preserved, value => String.Equals(value, name, StringComparison.OrdinalIgnoreCase))
                        && (Directory.Exists(target) || File.Exists(target))) continue;
                    MoveEntry(item, target);
                    movedNew.Add(name);
                }
                if (!IsCompletePortable(options.Destination)) throw new InvalidDataException(BootstrapText.L("新版本安装后缺少必要文件。", "Required files are missing after the update."));
            }
            catch
            {
                for (int index = movedNew.Count - 1; index >= 0; index -= 1) DeleteEntry(Path.Combine(options.Destination, movedNew[index]));
                for (int index = movedOld.Count - 1; index >= 0; index -= 1)
                {
                    string backup = Path.Combine(backupRoot, movedOld[index]);
                    if (Directory.Exists(backup) || File.Exists(backup)) MoveEntry(backup, Path.Combine(options.Destination, movedOld[index]));
                }
                throw;
            }
        }

        private static void MoveEntry(string source, string destination)
        {
            if (Directory.Exists(source)) Directory.Move(source, destination);
            else File.Move(source, destination);
        }

        private static void DeleteEntry(string value)
        {
            if (Directory.Exists(value)) TryDeleteDirectory(value);
            else TryDeleteFile(value);
        }

        private static async Task<PortableManifest> DownloadManifestAsync(
            string url,
            CancellationToken cancellationToken,
            TimeSpan? timeout = null)
        {
            using (HttpClient client = CreateClient(timeout))
            using (HttpResponseMessage response = await client.GetAsync(url, HttpCompletionOption.ResponseContentRead, cancellationToken).ConfigureAwait(false))
            {
                response.EnsureSuccessStatusCode();
                byte[] bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                if (bytes.Length == 0 || bytes.Length > 1024 * 1024)
                    throw new InvalidDataException(BootstrapText.L("版本信息大小无效。", "The version information has an invalid size."));
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
                    throw new InvalidDataException(BootstrapText.L("下载文件大小与发布信息不一致。", "The downloaded file size does not match the release information."));
                if (contentLength.HasValue && contentLength.Value > 1024L * 1024L * 1024L)
                    throw new InvalidDataException(BootstrapText.L("下载文件异常过大，操作已停止。", "The download is unexpectedly large. The operation was stopped."));

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
                        throw new EndOfStreamException(BootstrapText.L("下载未完成；没有修改目标目录。", "The download did not finish. The destination was not changed."));
                }
            }
        }

        private static HttpClient CreateClient(TimeSpan? timeout = null)
        {
            HttpClientHandler handler = new HttpClientHandler { AllowAutoRedirect = true };
            HttpClient client = new HttpClient(handler) { Timeout = timeout ?? TimeSpan.FromMinutes(30) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("DSH-Portable-Bootstrap/1.0");
            return client;
        }

        private static PortablePayload ValidateManifest(PortableManifest manifest)
        {
            if (manifest == null || manifest.SchemaVersion != 1 || manifest.Payloads == null || manifest.Payloads.WindowsX64 == null)
                throw new InvalidDataException(BootstrapText.L("发布信息不兼容，请下载最新版启动器。", "The release information is incompatible. Download the latest bootstrap."));
            PortablePayload payload = manifest.Payloads.WindowsX64;
            if (String.IsNullOrWhiteSpace(manifest.Version)
                || String.IsNullOrWhiteSpace(payload.Filename)
                || String.IsNullOrWhiteSpace(payload.Url)
                || payload.Bytes <= 0
                || !Regex.IsMatch(payload.Sha256 ?? String.Empty, "^[0-9a-fA-F]{64}$"))
                throw new InvalidDataException(BootstrapText.L("发布信息缺少必要字段。", "The release information is missing required fields."));
            return payload;
        }

        private static void ValidateRemoteUri(string value, bool allowHttp, string label)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)) throw new InvalidDataException(BootstrapText.L(label + " URL 无效。", label + " URL is invalid."));
            if (uri.Scheme == Uri.UriSchemeHttps) return;
            if (allowHttp && uri.Scheme == Uri.UriSchemeHttp && (uri.IsLoopback || uri.Host == "127.0.0.1")) return;
            throw new InvalidDataException(BootstrapText.L(label + " URL 必须使用 HTTPS。", label + " URL must use HTTPS."));
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

        private static void ExtractZipArchive(string archive, string destination)
        {
            using (FileStream archiveStream = File.OpenRead(archive))
            using (ZipArchive zip = new ZipArchive(archiveStream, ZipArchiveMode.Read, false))
            {
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string relativePath = SafeEntryPath(entry.FullName);
                    if (String.IsNullOrEmpty(relativePath)) continue;
                    string target = destination.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                        + Path.DirectorySeparatorChar + relativePath;

                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal)
                        || entry.FullName.EndsWith("\\", StringComparison.Ordinal))
                    {
                        EnsureDirectory(target);
                        continue;
                    }

                    string parent = ParentDirectory(target);
                    if (!String.IsNullOrEmpty(parent)) EnsureDirectory(parent);
                    using (Stream input = entry.Open())
                    using (FileStream output = CreateOutputFile(target))
                    {
                        input.CopyTo(output);
                    }
                }
            }
        }

        private static string SafeEntryPath(string value)
        {
            string normalized = (value ?? String.Empty).Replace('\\', '/');
            if (normalized.StartsWith("/", StringComparison.Ordinal) || normalized.IndexOf('\0') >= 0)
                throw new InvalidDataException(BootstrapText.L("下载包包含不安全的路径；没有修改目标目录。", "The package contains an unsafe path. The destination was not changed."));

            string safe = String.Empty;
            foreach (string segment in normalized.Split('/'))
            {
                if (segment.Length == 0 || segment == ".") continue;
                if (segment == ".." || segment.IndexOf(':') >= 0)
                    throw new InvalidDataException(BootstrapText.L("下载包包含不安全的路径；没有修改目标目录。", "The package contains an unsafe path. The destination was not changed."));
                safe = safe.Length == 0 ? segment : safe + Path.DirectorySeparatorChar + segment;
            }
            return safe;
        }

        private static void EnsureDirectory(string value)
        {
            string fullPath = IsAbsolutePath(value) ? value : Path.GetFullPath(value);
            string extendedPath = ToExtendedPath(fullPath);
            uint attributes = GetFileAttributesW(extendedPath);
            if (attributes != InvalidFileAttributes)
            {
                if ((attributes & FileAttributeDirectory) != 0) return;
                throw new IOException(BootstrapText.L("目标路径中存在同名文件：", "A file already exists at the destination path: ") + fullPath);
            }

            string parent = ParentDirectory(fullPath);
            if (!String.IsNullOrEmpty(parent) && !String.Equals(parent, fullPath, StringComparison.OrdinalIgnoreCase))
                EnsureDirectory(parent);

            if (CreateDirectoryW(extendedPath, IntPtr.Zero)) return;
            int error = Marshal.GetLastWin32Error();
            if (error == ErrorAlreadyExists && (GetFileAttributesW(extendedPath) & FileAttributeDirectory) != 0) return;
            throw new IOException(BootstrapText.L("无法创建目录：", "Could not create the folder: ") + fullPath, new Win32Exception(error));
        }

        private static FileStream CreateOutputFile(string value)
        {
            string fullPath = IsAbsolutePath(value) ? value : Path.GetFullPath(value);
            SafeFileHandle handle = CreateFileW(
                ToExtendedPath(fullPath),
                GenericWrite,
                FileShareRead,
                IntPtr.Zero,
                CreateAlways,
                FileAttributeNormal,
                IntPtr.Zero);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new IOException(BootstrapText.L("无法写入下载包中的文件：", "Could not write a file from the package: ") + fullPath, new Win32Exception(error));
            }
            return new FileStream(handle, FileAccess.Write, 1024 * 128, false);
        }

        private static string ParentDirectory(string value)
        {
            if (String.IsNullOrEmpty(value)) return null;
            string trimmed = value.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            int rootLength = RootLength(value);
            if (rootLength > 0 && trimmed.Length <= rootLength) return null;

            int slash = Math.Max(trimmed.LastIndexOf(Path.DirectorySeparatorChar), trimmed.LastIndexOf(Path.AltDirectorySeparatorChar));
            if (slash < 0) return null;
            if (rootLength > 0 && slash < rootLength) return value.Substring(0, rootLength);
            return trimmed.Substring(0, slash);
        }

        private static bool IsAbsolutePath(string value)
        {
            if (String.IsNullOrEmpty(value)) return false;
            if (value.StartsWith("\\\\", StringComparison.Ordinal)) return true;
            return value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':'
                && (value[2] == Path.DirectorySeparatorChar || value[2] == Path.AltDirectorySeparatorChar);
        }

        private static int RootLength(string value)
        {
            if (String.IsNullOrEmpty(value)) return 0;
            if (value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':'
                && (value[2] == Path.DirectorySeparatorChar || value[2] == Path.AltDirectorySeparatorChar))
                return 3;
            if (!value.StartsWith("\\\\", StringComparison.Ordinal)) return 0;

            int serverEnd = value.IndexOfAny(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, 2);
            if (serverEnd < 0) return value.Length;
            int shareEnd = value.IndexOfAny(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, serverEnd + 1);
            return shareEnd < 0 ? value.Length : shareEnd + 1;
        }

        private static string ToExtendedPath(string value)
        {
            string fullPath = IsAbsolutePath(value) ? value : Path.GetFullPath(value);
            if (fullPath.StartsWith("\\\\?\\", StringComparison.Ordinal)) return fullPath;
            if (fullPath.StartsWith("\\\\", StringComparison.Ordinal)) return "\\\\?\\UNC\\" + fullPath.Substring(2);
            return "\\\\?\\" + fullPath;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateDirectoryW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateDirectoryW(string path, IntPtr securityAttributes);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetFileAttributesW")]
        private static extern uint GetFileAttributesW(string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
        private static extern SafeFileHandle CreateFileW(
            string filename,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        private static string FriendlyMessage(Exception error)
        {
            if (error is OperationCanceledException) return BootstrapText.L("下载已取消；没有修改目标目录。", "The download was cancelled. The destination was not changed.");
            if (error is HttpRequestException || error is WebException)
                return BootstrapText.L("无法下载运行环境。请检查网络后重试，或使用离线完整包。", "Could not download the runtime. Check your connection and try again, or use the full offline package.");
            return error.Message;
        }

        private static void TryDeleteFile(string filename)
        {
            try { if (File.Exists(filename)) File.Delete(filename); } catch { }
        }

        private static void TryDeleteDirectory(string directory)
        {
            try
            {
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, true);
                    return;
                }
            }
            catch { }

            try { DeleteDirectoryTreeExtended(ToExtendedPath(directory)); } catch { }
        }

        private static void DeleteDirectoryTreeExtended(string extendedDirectory)
        {
            string directory = extendedDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            uint directoryAttributes = GetFileAttributesW(directory);
            if (directoryAttributes == InvalidFileAttributes)
            {
                int missingError = Marshal.GetLastWin32Error();
                if (missingError == ErrorFileNotFound || missingError == ErrorPathNotFound) return;
                throw new Win32Exception(missingError);
            }

            Win32FindData data;
            IntPtr findHandle = FindFirstFileW(directory + "\\*", out data);
            if (findHandle != InvalidFindHandle)
            {
                try
                {
                    while (true)
                    {
                        string name = data.FileName;
                        if (!String.Equals(name, ".", StringComparison.Ordinal)
                            && !String.Equals(name, "..", StringComparison.Ordinal))
                        {
                            string child = directory + "\\" + name;
                            bool isDirectory = (data.FileAttributes & FileAttributeDirectory) != 0;
                            bool isReparsePoint = (data.FileAttributes & FileAttributeReparsePoint) != 0;
                            if (isDirectory && !isReparsePoint)
                            {
                                DeleteDirectoryTreeExtended(child);
                            }
                            else if (isDirectory)
                            {
                                if (!RemoveDirectoryW(child)) throw new Win32Exception(Marshal.GetLastWin32Error());
                            }
                            else
                            {
                                if ((data.FileAttributes & FileAttributeReadOnly) != 0)
                                    SetFileAttributesW(child, FileAttributeNormal);
                                if (!DeleteFileW(child)) throw new Win32Exception(Marshal.GetLastWin32Error());
                            }
                        }

                        if (FindNextFileW(findHandle, out data)) continue;
                        int nextError = Marshal.GetLastWin32Error();
                        if (nextError != ErrorNoMoreFiles) throw new Win32Exception(nextError);
                        break;
                    }
                }
                finally
                {
                    FindClose(findHandle);
                }
            }
            else
            {
                int findError = Marshal.GetLastWin32Error();
                if (findError != ErrorFileNotFound) throw new Win32Exception(findError);
            }

            if (!RemoveDirectoryW(directory))
            {
                int removeError = Marshal.GetLastWin32Error();
                if (removeError != ErrorFileNotFound && removeError != ErrorPathNotFound)
                    throw new Win32Exception(removeError);
            }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Win32FindData
        {
            internal uint FileAttributes;
            internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
            internal System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
            internal System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
            internal uint FileSizeHigh;
            internal uint FileSizeLow;
            internal uint Reserved0;
            internal uint Reserved1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            internal string FileName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
            internal string AlternateFileName;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "FindFirstFileW")]
        private static extern IntPtr FindFirstFileW(string filename, out Win32FindData data);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "FindNextFileW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindNextFileW(IntPtr findHandle, out Win32FindData data);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindClose(IntPtr findHandle);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "DeleteFileW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DeleteFileW(string filename);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "RemoveDirectoryW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool RemoveDirectoryW(string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SetFileAttributesW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetFileAttributesW(string filename, uint attributes);
    }

    internal sealed class BootstrapWindow : Form
    {
        private readonly BootstrapOptions options;
        private readonly Label titleLabel;
        private readonly Label statusLabel;
        private readonly Label locationLabel;
        private readonly BootstrapActivityRing activityRing;
        private readonly Label progressPercentLabel;
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
            ClientSize = new Size(520, 220);
            BackColor = Color.FromArgb(250, 250, 250);
            Font = new Font("Segoe UI", 9.5F, FontStyle.Regular, GraphicsUnit.Point);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            titleLabel = new Label
            {
                Text = BootstrapText.L("准备 DSH-Portable", "Preparing DSH-Portable"),
                Font = new Font("Segoe UI Semibold", 14F, FontStyle.Bold, GraphicsUnit.Point),
                Location = new Point(28, 22),
                Size = new Size(464, 30),
            };
            statusLabel = new Label
            {
                Text = BootstrapText.L("正在检查本地运行环境…", "Checking the local runtime…"),
                Location = new Point(28, 65),
                Size = new Size(464, 24),
                AutoEllipsis = true,
            };
            locationLabel = new Label
            {
                Text = BootstrapText.L("保存到：", "Save to: ") + options.Destination,
                ForeColor = Color.FromArgb(95, 95, 95),
                Location = new Point(28, 91),
                Size = new Size(276, 23),
                AutoEllipsis = true,
            };
            activityRing = new BootstrapActivityRing
            {
                Location = new Point(250, 117),
                Size = new Size(20, 20),
                Indeterminate = true,
            };
            progressPercentLabel = new Label
            {
                Location = new Point(28, 141),
                Size = new Size(464, 23),
                ForeColor = Color.FromArgb(95, 95, 95),
                TextAlign = ContentAlignment.MiddleCenter,
                Visible = false,
            };
            actionButton = new Button
            {
                Text = BootstrapText.L("取消", "Cancel"),
                Location = new Point(400, 176),
                Size = new Size(92, 32),
            };
            actionButton.Click += delegate
            {
                if (running)
                {
                    actionButton.Enabled = false;
                    statusLabel.Text = BootstrapText.L("正在取消…", "Cancelling…");
                    cancellation.Cancel();
                }
                else Close();
            };
            offlineLink = new LinkLabel
            {
                Text = BootstrapText.L("网络有问题？下载离线完整包", "Network issue? Download the full offline package"),
                Location = new Point(28, 183),
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
            Controls.Add(progressPercentLabel);
            Controls.Add(activityRing);
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
                activityRing.Visible = false;
                progressPercentLabel.Visible = false;
                titleLabel.Text = BootstrapText.L("未能准备 DSH-Portable", "Could not prepare DSH-Portable");
                statusLabel.Text = result.Message;
                statusLabel.ForeColor = Color.FromArgb(176, 38, 38);
                statusLabel.Size = new Size(464, 48);
                offlineLink.Visible = true;
                actionButton.Enabled = true;
                actionButton.Text = BootstrapText.L("关闭", "Close");
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
            activityRing.Indeterminate = false;
            activityRing.Value = value;
            progressPercentLabel.Text = value + "%" + "  ·  " + FormatBytes(current) + " / " + FormatBytes(total);
            progressPercentLabel.Visible = true;
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes < 1024) return Math.Max(0, bytes) + " B";
            if (bytes < 1024L * 1024L) return (bytes / 1024D).ToString("0.0") + " KB";
            return (bytes / 1024D / 1024D).ToString("0.0") + " MB";
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
                if (!options.DestinationExplicit && !BootstrapInstaller.IsCompletePortable(options.Destination))
                {
                    using (FolderBrowserDialog dialog = new FolderBrowserDialog())
                    {
                        dialog.Description = BootstrapText.L("选择 DSH-Portable 的保存位置", "Choose where to save DSH-Portable");
                        dialog.ShowNewFolderButton = true;
                        dialog.SelectedPath = Path.GetDirectoryName(Application.ExecutablePath);
                        if (dialog.ShowDialog() != DialogResult.OK) return 0;
                        options.Destination = Path.GetFullPath(Path.Combine(dialog.SelectedPath, "DSH-Portable"));
                        options.DestinationExplicit = true;
                    }
                }
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
