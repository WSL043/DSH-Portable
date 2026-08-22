using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("DSH-Portable Command")]
[assembly: AssemblyProduct("DSH-Portable")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyVersion("0.4.3.65534")]
[assembly: AssemblyFileVersion("0.4.3.65534")]

internal static class DshCommand
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "MessageBoxW")]
    private static extern int MessageBoxW(IntPtr window, string message, string title, uint type);

    private static int ShowNoArgumentsGuidance()
    {
        const string message =
            "这是 DSH 命令行入口，需要在 PowerShell 或终端中带参数使用。\n\n" +
            "若要打开 DeepSeek Harness，请运行同一文件夹中的 DeepSeek-Herness.exe。\n\n" +
            "This is the DSH command-line entry point and requires arguments in PowerShell or a terminal.\n\n" +
            "To open DeepSeek Harness, run DeepSeek-Herness.exe in the same folder.";
        MessageBoxW(IntPtr.Zero, message, "DSH 命令行 / DSH command line", 0x00010040);
        return 0;
    }

    private static string QuoteWindowsArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            return value;

        var result = new StringBuilder();
        result.Append('"');
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static string BuildArguments(string cli, string[] arguments)
    {
        var result = new StringBuilder(QuoteWindowsArgument(cli));
        foreach (var argument in arguments)
        {
            result.Append(' ');
            result.Append(QuoteWindowsArgument(argument ?? string.Empty));
        }
        return result.ToString();
    }

    [STAThread]
    private static int Main(string[] arguments)
    {
        if (arguments == null || arguments.Length == 0)
            return ShowNoArgumentsGuidance();

        try
        {
            var executable = Process.GetCurrentProcess().MainModule.FileName;
            var root = Path.GetDirectoryName(executable);
            var node = Path.Combine(root, "runtime", "node", "node.exe");
            var cli = Path.Combine(root, "launcher", "dsh-cli.mjs");
            if (!File.Exists(node)) throw new FileNotFoundException("Bundled Node.js is missing.", node);
            if (!File.Exists(cli)) throw new FileNotFoundException("DSH command launcher is missing.", cli);

            var start = new ProcessStartInfo
            {
                FileName = node,
                Arguments = BuildArguments(cli, arguments),
                WorkingDirectory = Environment.CurrentDirectory,
                UseShellExecute = false,
                CreateNoWindow = false,
            };
            using (var child = Process.Start(start))
            {
                if (child == null) throw new InvalidOperationException("Could not start bundled DSH.");
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("DSH command failed: " + error.Message);
            return 1;
        }
    }
}
