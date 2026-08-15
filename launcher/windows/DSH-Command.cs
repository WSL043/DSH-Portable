using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("DSH-Portable Command")]
[assembly: AssemblyProduct("DSH-Portable")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyVersion("0.2.0.1")]
[assembly: AssemblyFileVersion("0.2.0.1")]

internal static class DshCommand
{
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
