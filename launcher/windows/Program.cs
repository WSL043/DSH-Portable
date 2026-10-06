using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Win32;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Toolkit.Uwp.Notifications;
using Windows.UI.Notifications;

[assembly: AssemblyTitle("DeepSeek-Herness")]
[assembly: AssemblyDescription("Native desktop host for DeepSeek Harness")]
[assembly: AssemblyCompany("WSL043")]
[assembly: AssemblyProduct("DeepSeek-Herness")]
[assembly: AssemblyCopyright("Copyright © WSL043 2026")]
[assembly: AssemblyVersion("0.8.6.65534")]
[assembly: AssemblyFileVersion("0.8.6.65534")]

namespace DshPortable
{
    internal static class Program
    {
        private const string AppUserModelId = "io.github.wsl043.dsh-portable";

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

        private static void RegisterNotificationIdentity()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(
                    @"Software\Classes\AppUserModelId\" + AppUserModelId))
                {
                    if (key == null) return;
                    key.SetValue("DisplayName", "DeepSeek Harness", RegistryValueKind.ExpandString);
                    key.SetValue("IconUri", Application.ExecutablePath, RegistryValueKind.ExpandString);
                    key.SetValue("IconBackgroundColor", "00000000", RegistryValueKind.String);
                    key.SetValue("DshPortableEphemeral", "1", RegistryValueKind.String);
                    key.SetValue("DshPortableOwnerPid", Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture), RegistryValueKind.String);
                }
            }
            catch { }
        }

        private static string[] WaitForRestartHandoff(string[] args)
        {
            if (args == null || args.Length < 2
                || !String.Equals(args[0], "--dsh-restart-after-pid", StringComparison.Ordinal))
                return args ?? new string[0];
            int processId;
            if (!Int32.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out processId)
                || processId <= 0)
                throw new ArgumentException("The restart handoff process id is invalid.");
            try
            {
                using (Process previous = Process.GetProcessById(processId))
                {
                    if (!previous.WaitForExit(60000))
                        throw new TimeoutException("The previous DeepSeek Harness window did not finish closing.");
                }
            }
            catch (ArgumentException)
            {
                // The previous process already exited between launch and lookup.
            }
            return args.Skip(2).ToArray();
        }

        private static bool IsNotificationActivationInvocation(string[] args)
        {
            return (args ?? new string[0]).Any(value =>
                String.Equals(value, "-ToastActivated", StringComparison.OrdinalIgnoreCase));
        }

        private static void RunNotificationActivationBroker(string executableRoot)
        {
            NativeTaskNotification.ConfigureBroker(executableRoot);
            SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (!NativeTaskNotification.Register()) return;
            ApplicationContext context = new ApplicationContext();
            System.Windows.Forms.Timer timeout = new System.Windows.Forms.Timer { Interval = 15000 };
            timeout.Tick += delegate { timeout.Stop(); context.ExitThread(); };
            timeout.Start();
            try { Application.Run(context); }
            finally { timeout.Dispose(); NativeTaskNotification.Unregister(); }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            args = WaitForRestartHandoff(args);
            string executableRoot = Path.GetDirectoryName(Application.ExecutablePath);
            if (IsNotificationActivationInvocation(args))
            {
                RunNotificationActivationBroker(executableRoot);
                return;
            }
            string environmentId = LauncherWindow.ResolveEnvironmentId(args);
            string stateRoot = LauncherWindow.ResolveStateRoot(executableRoot, environmentId);
            string instanceKey = LauncherWindow.ResolveEnvironmentInstanceKey(executableRoot, environmentId);
            int restoreMessage = LauncherWindow.RegisterEnvironmentRestoreMessage(instanceKey);
            int exitMessage = LauncherWindow.RegisterEnvironmentExitMessage(instanceKey);
            int activationMessage = LauncherWindow.RegisterEnvironmentActivationMessage(instanceKey);
            bool notificationDispatch = args.Any(value =>
                String.Equals(value, "--dsh-notification-dispatch", StringComparison.OrdinalIgnoreCase));
            Mutex environmentMutex = null;
            bool ownsEnvironmentMutex = false;
            if (LauncherWindow.IsStartInvocation(args))
            {
                environmentMutex = new Mutex(true, @"Local\DSHPortable." + instanceKey, out ownsEnvironmentMutex);
                if (!ownsEnvironmentMutex)
                {
                    LauncherWindow.SignalExistingDesktopHost(notificationDispatch ? activationMessage : restoreMessage);
                    environmentMutex.Dispose();
                    return;
                }
            }
            PortableProcessJob.Initialize();
            if (LauncherWindow.IsStartInvocation(args))
            {
                NativeTaskNotification.CleanupRegistration();
                RegisterNotificationIdentity();
            }
            SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Application.Run(new LauncherWindow(args, environmentId, stateRoot, restoreMessage, exitMessage, activationMessage));
            }
            finally
            {
                if (environmentMutex != null)
                {
                    if (ownsEnvironmentMutex) environmentMutex.ReleaseMutex();
                    environmentMutex.Dispose();
                }
            }
        }
    }
}
