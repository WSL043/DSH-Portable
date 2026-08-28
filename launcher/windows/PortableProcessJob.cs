using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace DshPortable
{
    /// <summary>
    /// Owns the native host process tree. Closing the job releases DSH and
    /// WebView2 children, while a verified full-package updater is launched
    /// outside the job so it can finish after the desktop host exits.
    /// </summary>
    internal static class PortableProcessJob
    {
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const uint JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x00000800;
        private const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const int JobObjectExtendedLimitInformation = 9;
        private static IntPtr jobHandle = IntPtr.Zero;
        private static string status = "not-initialized";

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            internal long PerProcessUserTimeLimit;
            internal long PerJobUserTimeLimit;
            internal uint LimitFlags;
            internal UIntPtr MinimumWorkingSetSize;
            internal UIntPtr MaximumWorkingSetSize;
            internal uint ActiveProcessLimit;
            internal UIntPtr Affinity;
            internal uint PriorityClass;
            internal uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            internal ulong ReadOperationCount;
            internal ulong WriteOperationCount;
            internal ulong OtherOperationCount;
            internal ulong ReadTransferCount;
            internal ulong WriteTransferCount;
            internal ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            internal IO_COUNTERS IoInfo;
            internal UIntPtr ProcessMemoryLimit;
            internal UIntPtr JobMemoryLimit;
            internal UIntPtr PeakProcessMemoryUsed;
            internal UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(
            IntPtr job,
            int informationClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
            uint informationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            internal int cb;
            internal string lpReserved;
            internal string lpDesktop;
            internal string lpTitle;
            internal int dwX;
            internal int dwY;
            internal int dwXSize;
            internal int dwYSize;
            internal int dwXCountChars;
            internal int dwYCountChars;
            internal int dwFillAttribute;
            internal int dwFlags;
            internal short wShowWindow;
            internal short cbReserved2;
            internal IntPtr lpReserved2;
            internal IntPtr hStdInput;
            internal IntPtr hStdOutput;
            internal IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            internal IntPtr hProcess;
            internal IntPtr hThread;
            internal uint dwProcessId;
            internal uint dwThreadId;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcess(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        internal static bool IsActive { get { return jobHandle != IntPtr.Zero; } }
        internal static string Status { get { return status; } }

        internal static void Initialize()
        {
            IntPtr created = CreateJobObject(IntPtr.Zero, null);
            if (created == IntPtr.Zero)
            {
                status = "create-error:" + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture);
                return;
            }

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION information = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
            uint informationLength = (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            if (!SetInformationJobObject(created, JobObjectExtendedLimitInformation, ref information, informationLength))
            {
                status = "configure-error:" + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture);
                CloseHandle(created);
                return;
            }
            if (!AssignProcessToJobObject(created, GetCurrentProcess()))
            {
                status = "assign-error:" + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture);
                CloseHandle(created);
                return;
            }

            jobHandle = created;
            status = "active";
        }

        private static string QuoteArgument(string value)
        {
            if (value == null) return "\"\"";
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '\"' }) < 0) return value;
            StringBuilder quoted = new StringBuilder("\"");
            int slashes = 0;
            foreach (char character in value)
            {
                if (character == '\\')
                {
                    slashes += 1;
                    continue;
                }
                if (character == '\"')
                {
                    quoted.Append('\\', slashes * 2 + 1);
                    quoted.Append('\"');
                    slashes = 0;
                    continue;
                }
                quoted.Append('\\', slashes);
                slashes = 0;
                quoted.Append(character);
            }
            quoted.Append('\\', slashes * 2);
            quoted.Append('\"');
            return quoted.ToString();
        }

        internal static void StartDetachedProcess(string executable, IEnumerable<string> arguments)
        {
            List<string> argumentList = arguments.ToList();
            if (!IsActive)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = executable,
                    Arguments = String.Join(" ", argumentList.Select(QuoteArgument)),
                    WorkingDirectory = System.IO.Path.GetTempPath(),
                    UseShellExecute = true,
                });
                return;
            }
            StringBuilder commandLine = new StringBuilder(QuoteArgument(executable));
            foreach (string argument in argumentList)
            {
                commandLine.Append(' ');
                commandLine.Append(QuoteArgument(argument));
            }
            STARTUPINFO startup = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)) };
            PROCESS_INFORMATION process;
            if (!CreateProcess(
                executable,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_BREAKAWAY_FROM_JOB | CREATE_UNICODE_ENVIRONMENT,
                IntPtr.Zero,
                System.IO.Path.GetTempPath(),
                ref startup,
                out process))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "The independent process could not start.");
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
        }

        internal static void StartDetachedUpdater(string executable, IEnumerable<string> arguments)
        {
            StartDetachedProcess(executable, arguments);
        }

        internal static void ExitOwnedTree()
        {
            IntPtr closing = jobHandle;
            jobHandle = IntPtr.Zero;
            status = "closing";
            if (closing != IntPtr.Zero) CloseHandle(closing);
        }
    }
}
