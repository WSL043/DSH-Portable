// Pure portable Windows entry: launch, supervise, own dsh://, and apply updates.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
[assembly: System.Reflection.AssemblyTitle("DeepSeek Harness Portable")]
[assembly: System.Reflection.AssemblyProduct("DSH-Portable official-payload")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.4")]
[assembly: System.Reflection.AssemblyInformationalVersion("1.0.0-alpha.4")]

internal static class PortableLauncher {
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly Regex VersionPattern = new Regex(@"^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$", RegexOptions.CultureInvariant);
    private static readonly Regex UpdatedName = new Regex(@"^deepseek-harness-(\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?)-win-x64\.exe$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private const string ProtocolKey = @"Software\Classes\dsh\shell\open\command";
    private static RegistrySnapshot ProtocolBefore;
    private static string Root, AppRoot, DataRoot, LauncherData;

    [STAThread]
    private static int Main(string[] args) {
        try {
            string updateVersion;
            if (TryUpdatedVersion(Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName), args, out updateVersion))
                return ApplyUpdatedCopy(updateVersion);
            return Run(args);
        } catch (Exception error) {
            try { Log("fatal: " + SafeMessage(error.Message)); } catch { }
            MessageBox.Show(error.Message + "\r\n\r\n便携启动失败。", "DeepSeek Harness Portable", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int ApplyUpdatedCopy(string version) {
        // This mode intentionally writes only through the root-owned update engine.
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string selfPath = Process.GetCurrentProcess().MainModule.FileName;
        string pending = Path.GetDirectoryName(selfPath);
        if (!String.Equals(Path.GetFileName(pending), "pending", StringComparison.OrdinalIgnoreCase)) throw new IOException("Updated launcher is not under the updater pending directory.");
        string cache = Directory.GetParent(pending).FullName;
        if (!cache.StartsWith(Path.GetFullPath(local).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Updated launcher cache is outside LocalAppData.");
        string pointer = Path.Combine(cache, "portable-root.txt");
        if (!File.Exists(pointer)) throw new IOException("Portable root pointer is missing; update was not applied.");
        string root = Path.GetFullPath(File.ReadAllText(pointer, Encoding.UTF8).Trim());
        if (root.Length <= 3 || !File.Exists(Path.Combine(root, "launcher", "apply-update.ps1"))) throw new IOException("Portable update root is invalid.");
        string engine = Path.Combine(root, "launcher", "apply-update.ps1");
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        var ps = new ProcessStartInfo(powershell) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        ps.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(engine) + " -Root " + Quote(root) + " -Version " + Quote(version) + " -SelfPath " + Quote(selfPath);
        int code = 1;
        try { using (Process child = Process.Start(ps)) { child.WaitForExit(); code = child.ExitCode; } }
        finally {
            string launcher = Path.Combine(root, "DeepSeek Harness Portable.exe");
            if (File.Exists(launcher)) Process.Start(new ProcessStartInfo(launcher) { UseShellExecute = false, WorkingDirectory = root });
        }
        return code == 0 ? 0 : 1;
    }

    private static bool TryUpdatedVersion(string filename, string[] args, out string version) {
        version = null;
        Match match = UpdatedName.Match(filename ?? "");
        if (!match.Success || !args.Contains("--updated", StringComparer.OrdinalIgnoreCase)) return false;
        version = match.Groups[1].Value;
        if (!VersionPattern.IsMatch(version)) throw new IOException("Updated launcher filename has an invalid version.");
        return true;
    }

    private static int Run(string[] args) {
        Root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
        if (Root.Length <= 3) throw new IOException("Extract into a folder, not a drive root. / 请解压到独立文件夹。");
        CheckPath(Root);
        AppRoot = Path.Combine(Root, "app"); DataRoot = Path.Combine(Root, "data"); LauncherData = Path.Combine(DataRoot, "launcher");
        string link = null, probe = null; int restartPid = 0;
        foreach (string arg in args) {
            int value;
            if (arg.StartsWith("--probe-port=") && probe == null && Int32.TryParse(arg.Substring(13), out value) && value >= 1024 && value <= 65535) probe = value.ToString();
            else if (arg.StartsWith("--restart-after=") && restartPid == 0 && Int32.TryParse(arg.Substring(16), out value) && value > 0) restartPid = value;
            else if (arg == "--open" && link == null) { /* the next token is consumed below */ }
            else if (arg.StartsWith("dsh://", StringComparison.OrdinalIgnoreCase) && link == null && IsValidLink(arg)) link = arg;
            else throw new IOException("Unsupported portable launch argument. / 不支持此启动参数。");
        }
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--open") {
            if (link != null || !IsValidLink(args[i + 1])) throw new IOException("Invalid dsh:// link.");
            link = args[i + 1];
        }
        if (args.Count(a => a == "--open") > 1 || args.Contains("--open") && link == null) throw new IOException("Invalid dsh:// link.");

        CheckPath(LauncherData); Directory.CreateDirectory(LauncherData);
        WritePortableRootPointer(ReadCacheName());
        bool created;
        using (var mutex = new Mutex(true, MutexName(Root), out created)) {
            if (!created) {
                if (link != null) { StartOfficial(link, probe, false); return 0; }
                return 0;
            }
            try { return Supervise(link, probe, restartPid); }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static int Supervise(string initialLink, string probe, int restartPid) {
        if (restartPid > 0) WaitForRestartProcess(restartPid);
        Dictionary<string, object> state = ReadJson(Path.Combine(AppRoot, "current.json"));
        string version = GetString(state, "version"), previous = GetString(state, "previous");
        bool pendingHealth = GetBool(state, "pendingHealth");
        if (!VersionPattern.IsMatch(version)) throw new IOException("Invalid app/current.json version.");
        string executable = AppExecutable(version);
        EnsureApplication(executable);
        CheckExternalOfficialOrPort(executable);

        ProtocolBefore = CaptureProtocol();
        bool protocolChanged = false;
        try {
            protocolChanged = true; RegisterProtocol();
            Log("starting version=" + version);
            Process app = StartOfficialProcess(executable, initialLink, probe);
            if (pendingHealth) {
                if (app.WaitForExit(20000)) {
                    int exitCode = app.ExitCode;
                    if (ShouldRollback(true, exitCode) && !String.IsNullOrEmpty(previous) && VersionPattern.IsMatch(previous) && previous != version) {
                        state["version"] = previous; state["previous"] = version; state["pendingHealth"] = false; state["switchedAt"] = DateTime.UtcNow.ToString("o");
                        WriteJsonAtomic(Path.Combine(AppRoot, "current.json"), state);
                        WriteJsonAtomic(Path.Combine(LauncherData, "update-status.json"), new Dictionary<string, object> { { "status", "rolled-back" }, { "version", version }, { "error", "New version exited before the 20-second health window." } });
                        Log("health rollback version=" + version + " exit=" + exitCode);
                        version = previous; executable = AppExecutable(previous); EnsureApplication(executable);
                        app = StartOfficialProcess(executable, null, probe);
                    } else {
                        Log("health process exited early with code=" + exitCode + "; no previous version available");
                    }
                } else {
                    state["pendingHealth"] = false;
                    WriteJsonAtomic(Path.Combine(AppRoot, "current.json"), state);
                    Log("health window passed version=" + version);
                }
            }
            DateTime nextProtocolRepair = DateTime.UtcNow.AddSeconds(60);
            while (!app.WaitForExit(1000)) {
                if (DateTime.UtcNow >= nextProtocolRepair) { RegisterProtocol(); nextProtocolRepair = DateTime.UtcNow.AddSeconds(60); }
            }
            Log("desktop exited version=" + version + " code=" + app.ExitCode);
            return app.ExitCode;
        } finally {
            if (protocolChanged) RestoreProtocol(ProtocolBefore);
        }
    }

    private static bool ShouldRollback(bool pendingHealth, int exitCode) { return pendingHealth && exitCode != 0; }

    private static void WaitForRestartProcess(int pid) {
        try {
            using (Process previous = Process.GetProcessById(pid)) {
                try {
                    if (!previous.HasExited) {
                        string path = previous.MainModule.FileName;
                        if (path == null || !path.StartsWith(AppRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Restart process is not owned by this Portable.");
                        if (!previous.WaitForExit(120000)) throw new IOException("The previous desktop has not exited.");
                    }
                } catch (System.ComponentModel.Win32Exception) { if (!previous.HasExited) throw; }
            }
        } catch (ArgumentException) { }
        DateTime deadline = DateTime.UtcNow.AddSeconds(30);
        while (HasOwnedProcesses(AppRoot) && DateTime.UtcNow < deadline) Thread.Sleep(100);
        if (HasOwnedProcesses(AppRoot)) throw new IOException("Desktop runtimes have not exited.");
    }

    private static void CheckExternalOfficialOrPort(string executable) {
        if (IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p => p.Port == 19387))
            throw new IOException("Port 19387 is already occupied. Close the other application before starting Portable. / 端口 19387 已被占用，请先关闭其他应用。");
        using (var query = new ManagementObjectSearcher("SELECT Name, ExecutablePath FROM Win32_Process WHERE Name='DeepSeek Harness.exe'"))
        using (var rows = query.Get()) foreach (ManagementObject row in rows) using (row) {
            string path = row["ExecutablePath"] as string;
            if (String.IsNullOrEmpty(path) || !path.StartsWith(AppRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Another official DeepSeek Harness is running. Close it before starting Portable. / 检测到另一份官方桌面端正在运行，请先退出。");
        }
    }

    private static string ReadCacheName() {
        Dictionary<string, object> follow = ReadJson(Path.Combine(Root, "launcher", "follow.json"));
        string value = GetString(follow, "cacheDirName");
        if (String.IsNullOrEmpty(value) || !Regex.IsMatch(value, @"^[A-Za-z0-9._@-]{1,100}$") || value == "." || value == "..") throw new IOException("Invalid launcher/follow.json cacheDirName.");
        return value;
    }

    private static void WritePortableRootPointer(string cacheName) {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string directory = Path.Combine(local, cacheName); Directory.CreateDirectory(directory); CheckPath(directory);
        WriteTextAtomic(Path.Combine(directory, "portable-root.txt"), Root + Environment.NewLine);
    }

    private static string AppExecutable(string version) { return Path.Combine(AppRoot, version, "DeepSeek Harness.exe"); }
    private static void EnsureApplication(string exe) {
        CheckPath(exe);
        if (!File.Exists(exe) || !File.Exists(Path.Combine(Path.GetDirectoryName(exe), "resources", "app.asar"))) throw new IOException("Selected official application is incomplete.");
    }

    private static Process StartOfficialProcess(string exe, string link, string probe) {
        var start = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Root };
        start.Arguments = "--user-data-dir=" + Quote(Path.Combine(DataRoot, "electron"));
        if (!String.IsNullOrEmpty(probe)) start.Arguments += " --remote-debugging-port=" + probe;
        if (link != null) start.Arguments += " " + Quote(link);
        start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        start.EnvironmentVariables["DSH_HOME"] = Path.Combine(DataRoot, "dsh-home");
        Directory.CreateDirectory(Path.Combine(DataRoot, "electron")); Directory.CreateDirectory(Path.Combine(DataRoot, "dsh-home"));
        return Process.Start(start);
    }
    private static void StartOfficial(string link, string probe, bool unused) {
        Dictionary<string, object> state = ReadJson(Path.Combine(AppRoot, "current.json"));
        string version = GetString(state, "version"); if (!VersionPattern.IsMatch(version)) throw new IOException("Invalid current version.");
        EnsureApplication(AppExecutable(version)); StartOfficialProcess(AppExecutable(version), link, probe);
    }

    private sealed class RegistrySnapshot { public bool KeyExisted; public bool ValueExisted; public object Value; public RegistryValueKind ValueKind; }
    private static RegistrySnapshot CaptureProtocol() {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(ProtocolKey, false)) {
            var result = new RegistrySnapshot(); result.KeyExisted = key != null;
            if (key != null) { result.ValueExisted = key.GetValueNames().Contains(""); if (result.ValueExisted) { result.Value = key.GetValue("", null, RegistryValueOptions.DoNotExpandEnvironmentNames); result.ValueKind = key.GetValueKind(""); } }
            return result;
        }
    }
    private static void RegisterProtocol() {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(ProtocolKey)) key.SetValue("", "\"" + Process.GetCurrentProcess().MainModule.FileName + "\" --open \"%1\"", RegistryValueKind.String);
    }
    private static void RestoreProtocol(RegistrySnapshot snapshot) {
        if (snapshot == null) return;
        if (snapshot.KeyExisted) {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(ProtocolKey)) {
                if (snapshot.ValueExisted) key.SetValue("", snapshot.Value, snapshot.ValueKind); else key.DeleteValue("", false);
            }
        } else {
            Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, false);
            PruneEmptyKey(@"Software\Classes\dsh\shell\open"); PruneEmptyKey(@"Software\Classes\dsh\shell"); PruneEmptyKey(@"Software\Classes\dsh");
        }
    }
    private static void PruneEmptyKey(string path) { using (RegistryKey key = Registry.CurrentUser.OpenSubKey(path, true)) if (key != null && key.SubKeyCount == 0 && key.ValueCount == 0) Registry.CurrentUser.DeleteSubKey(path, false); }

    private static bool IsValidLink(string value) { return value != null && value.Length <= 8192 && value.StartsWith("dsh://", StringComparison.OrdinalIgnoreCase) && value.IndexOfAny(new[] { '"', '\r', '\n', '\0' }) < 0 && !value.Any(Char.IsControl); }
    private static string MutexName(string root) { using (var sha = SHA256.Create()) return "Local\\DSHPortable-" + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", ""); }
    private static Dictionary<string, object> ReadJson(string file) { CheckPath(file); return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)); }
    private static string GetString(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) ? item as string : null; }
    private static bool GetBool(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) && item is bool && (bool)item; }
    private static void WriteJsonAtomic(string file, object value) { WriteTextAtomic(file, Json.Serialize(value)); }
    private static void WriteTextAtomic(string file, string value) {
        CheckPath(file); string temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { byte[] bytes = new UTF8Encoding(false).GetBytes(value); stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
            if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
        } finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    private static void CheckPath(string path) {
        for (string current = Path.GetFullPath(path); !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Redirected portable path is not supported: " + current);
    }
    private static bool HasOwnedProcesses(string appRoot) {
        string prefix = Path.GetFullPath(appRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        try {
            using (var query = new ManagementObjectSearcher("SELECT Name, ExecutablePath FROM Win32_Process"))
            using (var rows = query.Get()) foreach (ManagementObject row in rows) using (row) {
                string path = row["ExecutablePath"] as string;
                if (!String.IsNullOrEmpty(path) && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true;
                if (path == null && String.Equals(row["Name"] as string, "DeepSeek Harness.exe", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        } catch { return true; }
    }
    private static string Quote(string value) {
        var output = new StringBuilder(); output.Append('"'); int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { output.Append('\\', slashes * 2 + 1); output.Append('"'); slashes = 0; continue; }
            output.Append('\\', slashes); slashes = 0; output.Append(character);
        }
        output.Append('\\', slashes * 2); output.Append('"'); return output.ToString();
    }
    private static string SafeMessage(string message) { return (message ?? "error").Replace("\r", " ").Replace("\n", " ").Replace(Environment.UserName, "<user>"); }
    private static void Log(string message) {
        if (String.IsNullOrEmpty(LauncherData)) return;
        Directory.CreateDirectory(LauncherData); string file = Path.Combine(LauncherData, "launcher.log"); CheckPath(file);
        if (File.Exists(file) && new FileInfo(file).Length >= 262144) {
            string second = file + ".2", first = file + ".1";
            if (File.Exists(second)) File.Delete(second); if (File.Exists(first)) File.Move(first, second); File.Move(file, first);
        }
        string line = DateTime.UtcNow.ToString("o") + " " + SafeMessage(message);
        if (line.Length > 4096) line = line.Substring(0, 4096);
        File.AppendAllText(file, line + Environment.NewLine, new UTF8Encoding(false));
    }
}
