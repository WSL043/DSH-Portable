// Windows alpha launcher. The official process receives paths; its code is never patched.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Management;
[assembly: System.Reflection.AssemblyTitle("DSH-Portable")]
[assembly: System.Reflection.AssemblyProduct("DSH-Portable official-payload alpha")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.2")]
[assembly: System.Reflection.AssemblyInformationalVersion("1.0.0-alpha.2")]

internal static class PortableLauncher {
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private const string Layout = "official-payload-alpha2";
    [STAThread]
    private static int Main(string[] args) {
        try {
            var root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
            if (root.Length <= 3) throw new IOException("Extract into a folder, not the drive root. / 请解压到独立文件夹。");
            CheckPath(root);
            var data = Path.Combine(root, "data");
            CheckPath(data);
            var marker = Path.Combine(data, "portable-layout.json");
            var state = Path.Combine(root, "app", "current.json");
            CheckPath(state);
            var selected = Read(state);
            var version = (string)selected["version"];
            if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$")) throw new IOException("Invalid application version");
            var app = Path.Combine(root, "app", version);
            CheckPath(app);
            var executable = Path.Combine(app, "DeepSeek Harness.exe");
            if (!File.Exists(executable) || !File.Exists(Path.Combine(app, "resources", "app.asar"))) throw new IOException("Application incomplete. Extract a fresh alpha package. / 程序不完整，请重新解压实验版。");
            if (File.Exists(Path.Combine(app, "resources", "app-update.yml"))) throw new IOException("Installer updater is enabled; refusing portable launch.");
            Directory.CreateDirectory(data);
            using (var gate = new FileStream(Path.Combine(data, ".launch.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
                var entries = Directory.EnumerateFileSystemEntries(data).Where(p => Path.GetFileName(p) != ".launch.lock");
                if (!File.Exists(marker) && entries.Any()) throw new IOException("Alpha.2 requires a fresh data folder. Existing data was not changed. / Alpha.2 需要全新目录，旧数据未修改。");
                if (File.Exists(marker)) {
                    CheckPath(marker);
                    var previous = Read(marker);
                    if ((string)previous["layout"] != Layout) throw new IOException("Unsupported data layout");
                    var previousRoot = (string)previous["root"];
                    if (!String.Equals(previousRoot, root, StringComparison.OrdinalIgnoreCase)) Relocate(root, previousRoot);
                }
                var directories = new[] { "electron", "dsh-home", "agents", "pnpm-store", "pnpm-cache", "pnpm-state", "native-cache", "node-compile-cache", "launcher" };
                foreach (var name in directories) { var path = Path.Combine(data, name); CheckPath(path); Directory.CreateDirectory(path); }
                var stagedFile = Path.Combine(root, "app", "staged.json");
                CheckPath(stagedFile);
                if (File.Exists(stagedFile) && !HasOwnedProcesses(Path.Combine(root, "app"))) {
                  try {
                    var staged = Read(stagedFile);
                    var next = (string)staged["version"];
                    if (((string)staged["from"] != version && next != version) || !System.Text.RegularExpressions.Regex.IsMatch(next, @"^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$")) throw new IOException("Staged update does not match the current version");
                    var nextApp = Path.Combine(root, "app", next);
                    CheckPath(nextApp);
                    var nextAsar = Path.Combine(nextApp, "resources", "app.asar");
                    if (File.Exists(Path.Combine(nextApp, "resources", "app-update.yml")) || !File.Exists(Path.Combine(nextApp, "DeepSeek Harness.exe"))) throw new IOException("Staged application incomplete");
                    var receipt = (Dictionary<string, object>)staged["receipt"];
                    using (var stream = File.OpenRead(nextAsar)) using (var sha = System.Security.Cryptography.SHA256.Create()) {
                        var hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                        if (hash != (string)receipt["asarSha256"]) throw new IOException("Staged application digest mismatch");
                    }
                    if (next != version) Write(state, new Dictionary<string, object> { { "version", next }, { "previous", version } });
                    File.Delete(stagedFile);
                    version = next; app = nextApp; executable = Path.Combine(app, "DeepSeek Harness.exe");
                  } catch (Exception activationError) {
                    // A failed candidate must not prevent use of the existing application.
                    Write(Path.Combine(data, "launcher", "activation-error.json"), new Dictionary<string, object> {
                        { "status", "current-preserved" }, { "error", activationError.Message }, { "at", DateTime.UtcNow.ToString("o") }
                    });
                  }
                }
                Write(marker, new Dictionary<string, object> { { "layout", Layout }, { "root", root } });
                var start = new ProcessStartInfo(executable) { UseShellExecute = false, WorkingDirectory = root };
                start.Arguments = "--user-data-dir=" + Quote(Path.Combine(data, "electron"));
                // A bounded diagnostic port is permitted for isolated artifact qualification.
                if (args.Length == 1 && args[0].StartsWith("--probe-port=")) {
                    int port;
                    if (!Int32.TryParse(args[0].Substring(13), out port) || port < 1024 || port > 65535) throw new IOException("Invalid diagnostic port");
                    start.Arguments += " --remote-debugging-port=" + port;
                } else if (args.Length != 0) throw new IOException("Unknown launcher option");
                start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                start.EnvironmentVariables["DSH_HOME"] = Path.Combine(data, "dsh-home");
                start.EnvironmentVariables["DSH_AGENTS_HOME"] = Path.Combine(data, "agents");
                start.EnvironmentVariables["NARB_NATIVE_CACHE_DIR"] = Path.Combine(data, "native-cache");
                start.EnvironmentVariables["NODE_COMPILE_CACHE"] = Path.Combine(data, "node-compile-cache");
                foreach (var name in new[] { "store", "cache", "state" }) start.EnvironmentVariables["pnpm_config_" + name + "_dir"] = Path.Combine(data, "pnpm-" + name);
                // The stock host currently owns this fixed port. Never attach to another installation.
                if (IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p => p.Port == 19387)) {
                    var owned = Process.GetProcessesByName("DeepSeek Harness").Any(p => {
                        try { return String.Equals(p.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase); } catch { return false; }
                    });
                    if (!owned) throw new IOException("Another desktop owns port 19387. Exit it before starting Portable. / 请先退出另一份官方桌面程序。");
                }
                Process.Start(start);
                var updateScript = Path.Combine(root, "launcher", "update.ps1");
                if (args.Length == 0 && File.Exists(updateScript)) {
                    var updater = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe")) {
                        UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                        Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(updateScript) + " -Root " + Quote(root)
                    };
                    Process.Start(updater);
                }
            }
            return 0;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "DSH-Portable alpha.2", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    private static void Relocate(string root, string previousRoot) {
        var suffix = Path.Combine("data", "dsh-home", "profiles", "desktop", "node_modules");
        var file = Path.Combine(root, suffix, ".modules.yaml");
        CheckPath(file);
        if (!File.Exists(file)) return;
        var modules = Read(file); // Reviewed pnpm 11 hoisted metadata is JSON (valid YAML).
        if ((string)modules["packageManager"] != "pnpm@11.7.0" || (string)modules["nodeLinker"] != "hoisted") throw new IOException("Moved plugin layout requires a newer launcher");
        var paths = new Dictionary<string, string> { { "storeDir", Path.Combine("data", "pnpm-store", "v11") }, { "virtualStoreDir", Path.Combine(suffix, ".pnpm") } };
        foreach (var item in paths) {
            var before = Path.Combine(previousRoot, item.Value);
            var after = Path.Combine(root, item.Value);
            var actual = (string)modules[item.Key];
            if (!String.Equals(actual, before, StringComparison.OrdinalIgnoreCase) && !String.Equals(actual, after, StringComparison.OrdinalIgnoreCase)) throw new IOException("Unmanaged plugin path; refusing relocation");
            modules[item.Key] = after;
        }
        Write(file, modules);
    }
    private static Dictionary<string, object> Read(string file) { return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file)); }
    private static bool HasOwnedProcesses(string appRoot) {
        var prefix = appRoot + Path.DirectorySeparatorChar;
        try {
            using (var query = new ManagementObjectSearcher("SELECT Name, ExecutablePath FROM Win32_Process"))
            using (var rows = query.Get()) foreach (ManagementObject row in rows) using (row) {
                var path = row["ExecutablePath"] as string;
                if (path != null && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true;
                if (path == null && String.Equals(row["Name"] as string, "DeepSeek Harness.exe", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        } catch { return true; } // Unknown ownership defers activation, never blocks the current app.
    }
    private static void Write(string file, object value) {
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
            var bytes = Encoding.UTF8.GetBytes(Json.Serialize(value)); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
        }
        if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
    }
    private static void CheckPath(string path) {
        for (var current = Path.GetFullPath(path); current != null; current = Path.GetDirectoryName(current)) {
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Redirected portable path is not supported: " + current);
        }
    }
    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
}
