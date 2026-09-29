using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class Stub
{
    private static string Escape(string value)
    {
        var result = new StringBuilder();
        foreach (char c in value)
        {
            if (c == '"') result.Append("\\\"");
            else if (c == '\\') result.Append("\\\\");
            else if (c == '\r') result.Append("\\r");
            else if (c == '\n') result.Append("\\n");
            else if (c == '\t') result.Append("\\t");
            else if (c < 32) result.Append("\\u" + ((int)c).ToString("x4"));
            else result.Append(c);
        }
        return result.ToString();
    }

    private static int Main()
    {
        string logPath = Environment.GetEnvironmentVariable("DSH_CONTRACT_STUB_LOG");
        if (String.IsNullOrEmpty(logPath)) return 0;
        try
        {
            string[] all = Environment.GetCommandLineArgs();
            string[] argv = new string[Math.Max(0, all.Length - 1)];
            if (argv.Length > 0) Array.Copy(all, 1, argv, 0, argv.Length);
            string executable = Process.GetCurrentProcess().MainModule.FileName;
            var record = new StringBuilder();
            record.Append("{\"argv\":[");
            for (int i = 0; i < argv.Length; i++)
            {
                if (i > 0) record.Append(',');
                record.Append('"').Append(Escape(argv[i])).Append('"');
            }
            record.Append("],\"executablePath\":\"").Append(Escape(executable)).Append("\"}");
            File.AppendAllText(logPath, record.ToString() + Environment.NewLine, new UTF8Encoding(false));
        }
        catch { }
        return 0;
    }
}
