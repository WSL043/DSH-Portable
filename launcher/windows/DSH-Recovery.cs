using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Reflection;

[assembly: AssemblyTitle("DSH-Portable Recovery")]
[assembly: AssemblyProduct("DSH-Portable")]
[assembly: AssemblyVersion("0.7.5.10001")]
[assembly: AssemblyFileVersion("0.7.5.10001")]

// Independent of WebView2 and the DSH backend. Never starts the workspace.
internal static class PortableRecovery
{
    private static int Check(string root)
    {
        int missing = 0;
        foreach (string relative in new[] { "runtime/node/node.exe", "launcher/runtime-entry.mjs", "launcher/portable-cli.mjs" })
        {
            bool present = File.Exists(Path.Combine(root, relative));
            Console.WriteLine((present ? "OK      " : "MISSING ") + relative);
            if (!present) missing++;
        }
        if (missing != 0)
            Console.WriteLine("运行文件不完整。请将完整离线包解压到新目录，再复制 data 和 workspace；不要删除原目录。\nRuntime files are missing. Extract a full offline package to a new folder and copy data and workspace. Keep the original folder.");
        return missing == 0 ? 0 : 1;
    }

    private static int Run(string root, string command, bool json = true)
    {
        if (Check(root) != 0) return 1;
        var start = new ProcessStartInfo {
            FileName = Path.Combine(root, "runtime", "node", "node.exe"),
            Arguments = "\"" + Path.Combine(root, "launcher", "runtime-entry.mjs") + "\" portable-cli.mjs " + command + (json ? " --json" : ""),
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        // Scope recovery to this copy, not an environment inherited from a DSH terminal.
        foreach (string key in new[] { "DSH_PORTABLE_STATE_ROOT", "DSH_PORTABLE_RUNTIME_ROOT", "DSH_PORTABLE_ENVIRONMENT" })
            start.EnvironmentVariables.Remove(key);
        using (var child = Process.Start(start)) {
            if (child == null) return 1;
            child.OutputDataReceived += (sender, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
            child.ErrorDataReceived += (sender, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            child.WaitForExit();
            return child.ExitCode;
        }
    }

    private static int PluginIndex(bool restore)
    {
        Console.Write(restore ? "暂停项编号 / Paused bundle number (0 cancels): " : "启动项编号 / Active bundle number (0 cancels): ");
        int index;
        if (!Int32.TryParse(Console.ReadLine(), out index) || index < 0 || index > 1000) {
            Console.WriteLine("请输入列表中的编号 / Enter a number from the list.");
            return 0;
        }
        return index;
    }

    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string root = AppDomain.CurrentDomain.BaseDirectory;
        try {
            if (args.Length == 1 && args[0] == "--check") return Check(root);
            if (args.Length != 0) { Console.WriteLine("Usage: DSH-Recovery.exe [--check]"); return 2; }
            Console.WriteLine("DSH-Portable 诊断与修复 / Diagnostics and recovery");
            Console.WriteLine("Recovery version: " + Assembly.GetExecutingAssembly().GetName().Version + "\n" + root);
            Console.WriteLine("不需要打开主界面。修复前请退出 Portable 并保留备份。\nNo desktop UI required. Exit Portable and keep a backup before repair.");
            while (true) {
                Console.WriteLine("\n1 检查运行文件 / Check files\n2 诊断 / Diagnose\n3 修复可重建组件 / Repair generated components\n4 导出支持报告 / Export support report\n5 检查启动插件 / Check startup plugins\n6 暂停故障启动项 / Pause a community or unavailable official bundle\n7 恢复暂停项 / Restore a paused bundle\n0 退出 / Exit");
                string choice = Console.ReadLine();
                if (choice == null || choice == "0") return 0;
                if (choice == "1") { Check(root); continue; }
                if (choice == "5" || choice == "6" || choice == "7") {
                    if (Run(root, "recovery-plugins", false) != 0 || choice == "5") continue;
                    int index = PluginIndex(choice == "7");
                    if (index == 0) continue;
                    string action = choice == "6" ? "recovery-pause-plugin" : "recovery-restore-plugin";
                    int pluginCode = Run(root, action + " --recovery-index " + index);
                    Console.WriteLine("Exit code: " + pluginCode + ". 仅修改启动列表，不卸载插件；重试前请完全退出 Portable。 / Only the startup list changes; quit Portable before retrying.");
                    continue;
                }
                string command = choice == "2" ? "doctor" : choice == "3" ? "repair" : choice == "4" ? "support-report" : null;
                if (command == null) continue;
                int code = Run(root, command);
                Console.WriteLine("Exit code: " + code + ". 请查看上方诊断结果 / Review the result above.");
                if (choice == "3" && code == 2)
                    Console.WriteLine("未执行修复：请从系统托盘完全退出 Portable 后重试。\nRepair not performed: quit Portable from the system tray, then retry.");
                if (choice == "4") Console.WriteLine("报告目录 / Reports: " + Path.Combine(root, "data", "logs"));
            }
        } catch (Exception error) {
            Console.WriteLine(error.Message);
            if (args.Length == 0) { Console.WriteLine("按 Enter 退出 / Press Enter to exit"); Console.ReadLine(); }
            return 1;
        }
    }
}
