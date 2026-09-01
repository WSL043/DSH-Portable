using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("DSH-Portable Command")]
[assembly: AssemblyProduct("DSH-Portable")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyVersion("0.6.0.5")]
[assembly: AssemblyFileVersion("0.6.0.5")]

internal static class DshCommand
{
    private static int LaunchDshTerminal(string root, string environmentId)
    {
        var terminal = Path.Combine(root, "launcher", "dsh-terminal.cmd");
        if (!File.Exists(terminal)) throw new FileNotFoundException("DSH terminal launcher is missing.", terminal);
        var start = new ProcessStartInfo
        {
            FileName = terminal,
            Arguments = String.IsNullOrEmpty(environmentId) ? String.Empty : QuoteWindowsArgument(environmentId),
            WorkingDirectory = root,
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Normal,
        };
        if (Process.Start(start) == null) throw new InvalidOperationException("Could not open DSH Terminal.");
        return 0;
    }

    private static string TerminalEnvironment(string[] arguments)
    {
        if (arguments == null || arguments.Length == 0) return null;
        if (!String.Equals(arguments[0], "--terminal", StringComparison.OrdinalIgnoreCase)) return null;
        if (arguments.Length == 1) return String.Empty;
        if (arguments.Length != 3 || !String.Equals(arguments[1], "--environment", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Usage: dsh.exe --terminal [--environment <id>]");
        var value = arguments[2] ?? String.Empty;
        if (value.Length < 1 || value.Length > 32 || !value.All(character =>
            Char.IsLetterOrDigit(character) || character == '.' || character == '-' || character == '_'))
            throw new ArgumentException("Portable environment must be a 1-32 character slug using letters, numbers, dots, dashes, or underscores.");
        return value.ToLowerInvariant();
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
        try
        {
            var executable = Process.GetCurrentProcess().MainModule.FileName;
            var root = Path.GetDirectoryName(executable);
            if (arguments == null || arguments.Length == 0)
                return LaunchDshTerminal(root, String.Empty);
            var terminalEnvironment = TerminalEnvironment(arguments);
            if (terminalEnvironment != null)
                return LaunchDshTerminal(root, terminalEnvironment);

            var node = Path.Combine(root, "runtime", "node", "node.exe");
            var runtimeEntry = Path.Combine(root, "launcher", "runtime-entry.mjs");
            var cli = Path.Combine(root, "launcher", "dsh-cli.mjs");
            if (!File.Exists(node)) throw new FileNotFoundException("Bundled Node.js is missing.", node);
            if (!File.Exists(runtimeEntry)) throw new FileNotFoundException("DSH runtime entry is missing.", runtimeEntry);
            if (!File.Exists(cli)) throw new FileNotFoundException("DSH command launcher is missing.", cli);

            var start = new ProcessStartInfo
            {
                FileName = node,
                Arguments = BuildArguments(runtimeEntry, new[] { Path.GetFileName(cli) }.Concat(arguments).ToArray()),
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
