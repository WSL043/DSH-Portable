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
namespace DshPortable
{
    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    [Guid("FE67BADC-9348-428F-B76A-C021C42D3E80")]
    public sealed class DshNotificationActivator : NotificationActivator
    {
        public override void OnActivated(string arguments, NotificationUserInput userInput, string appUserModelId)
        {
            IEnumerable<KeyValuePair<string, object>> values = userInput == null
                ? null
                : userInput.Select(item => new KeyValuePair<string, object>(item.Key, item.Value));
            NativeTaskNotification.DispatchActivation(arguments, values);
        }
    }

    internal static class NativeTaskNotification
    {
        private const string AppUserModelId = "io.github.wsl043.dsh-portable";
        private const string RegistrationRoot = @"Software\Classes\AppUserModelId\";
        private const string RootMapRegistry = @"Software\WSL043\DSH-Portable\NotificationRoots\";
        private static bool registered;
        private static string executableRoot;
        private static string ownerEnvironmentId;
        private static string ownerInstanceKey;
        private static string ownerRootKey;
        private static bool ownerReady;
        private static readonly object activationSync = new object();
        private static readonly HashSet<string> inflightActivations = new HashSet<string>(StringComparer.Ordinal);
        internal static event Action<string, string, string, string, string> ActionRequested;

        private sealed class ActivationEnvelope
        {
            public string activationId { get; set; }
            public long createdAt { get; set; }
            public string environmentId { get; set; }
            public string instanceKey { get; set; }
            public string rootKey { get; set; }
            public string action { get; set; }
            public string sessionId { get; set; }
            public string interactionKey { get; set; }
            public string response { get; set; }
        }

        internal static void ConfigureOwner(string root, string environmentId, string instanceKey)
        {
            executableRoot = Path.GetFullPath(root);
            ownerEnvironmentId = environmentId;
            ownerInstanceKey = instanceKey;
            ownerRootKey = LauncherWindow.ResolveEnvironmentInstanceKey(executableRoot, "notification-root");
            ownerReady = false;
            RegisterTrustedRoot(ownerRootKey, executableRoot);
        }

        internal static void ConfigureBroker(string root)
        {
            executableRoot = Path.GetFullPath(root);
            ownerEnvironmentId = null;
            ownerInstanceKey = null;
            ownerRootKey = null;
            ownerReady = false;
        }

        private static void RegisterTrustedRoot(string rootKey, string root)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RootMapRegistry + rootKey))
                {
                    if (key == null) return;
                    key.SetValue("Root", Path.GetFullPath(root), RegistryValueKind.String);
                    key.SetValue("Executable", Path.GetFullPath(Application.ExecutablePath), RegistryValueKind.String);
                }
            }
            catch { }
        }

        private static bool TryResolveTrustedRoot(string rootKey, out string root, out string executable)
        {
            root = String.Empty;
            executable = String.Empty;
            if (!Regex.IsMatch(rootKey ?? String.Empty, "^[0-9a-f]{32}$", RegexOptions.CultureInvariant)) return false;
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RootMapRegistry + rootKey))
                {
                    if (key == null) return false;
                    root = Path.GetFullPath(Convert.ToString(key.GetValue("Root"), CultureInfo.InvariantCulture));
                    executable = Path.GetFullPath(Convert.ToString(key.GetValue("Executable"), CultureInfo.InvariantCulture));
                }
                return String.Equals(LauncherWindow.ResolveEnvironmentInstanceKey(root, "notification-root"), rootKey, StringComparison.Ordinal)
                    && String.Equals(Path.GetDirectoryName(executable), root, StringComparison.OrdinalIgnoreCase)
                    && File.Exists(executable);
            }
            catch { root = String.Empty; executable = String.Empty; return false; }
        }

        internal static bool Register()
        {
            if (registered) return true;
            try
            {
                DesktopNotificationManagerCompat.RegisterAumidAndComServer<DshNotificationActivator>(AppUserModelId);
                DesktopNotificationManagerCompat.RegisterActivator<DshNotificationActivator>();
                registered = true;
                return true;
            }
            catch
            {
                return false;
            }
        }

        internal static void Unregister()
        {
            registered = false;
        }

        // Clear only our stale display identity before startup. The COM
        // activator registration is updated in-place for the current portable
        // path and must remain available while notifications sit in Action Center.
        internal static void CleanupRegistration()
        {
            CleanupFixedIdentity();
        }

        private static void CleanupFixedIdentity()
        {
            string aumidPath = RegistrationRoot + AppUserModelId;
            try
            {
                int ownerPid = 0;
                bool owned = false;
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(aumidPath))
                {
                    if (key == null) return;
                    object marker = key.GetValue("DshPortableEphemeral");
                    Int32.TryParse(key.GetValue("DshPortableOwnerPid") as string, out ownerPid);
                    owned = String.Equals(marker == null ? null : marker.ToString(), "1", StringComparison.Ordinal);
                }
                if (!owned) return;
                if (ownerPid > 0 && ownerPid != Process.GetCurrentProcess().Id)
                {
                    try { using (Process.GetProcessById(ownerPid)) { return; } }
                    catch (ArgumentException) { }
                    catch (InvalidOperationException) { }
                }
                Registry.CurrentUser.DeleteSubKeyTree(aumidPath, false);
            }
            catch { }
        }

        internal static bool TryParseActivation(
            string argument,
            IEnumerable<KeyValuePair<string, object>> userInput,
            out string action,
            out string sessionId,
            out string interactionKey,
            out string response)
        {
            action = String.Empty;
            sessionId = String.Empty;
            interactionKey = String.Empty;
            response = String.Empty;
            try
            {
                ToastArguments arguments = ToastArguments.Parse(argument ?? String.Empty);
                string parsedAction;
                string parsedSessionId;
                if (!arguments.TryGetValue("action", out parsedAction)
                    || !arguments.TryGetValue("sessionId", out parsedSessionId)
                    || (String.Equals(parsedAction, "reply", StringComparison.Ordinal) == false
                        && String.Equals(parsedAction, "open", StringComparison.Ordinal) == false
                        && String.Equals(parsedAction, "resolve-interaction", StringComparison.Ordinal) == false)
                    || String.IsNullOrWhiteSpace(parsedSessionId)) return false;
                action = parsedAction;
                sessionId = parsedSessionId;
                if (String.Equals(action, "reply", StringComparison.Ordinal))
                {
                    if (userInput == null) return false;
                    bool found = false;
                    foreach (KeyValuePair<string, object> input in userInput)
                    {
                        if (!String.Equals(input.Key, "reply", StringComparison.Ordinal)) continue;
                        found = true;
                        if (input.Value == null) return false;
                        response = input.Value.ToString().Trim();
                        break;
                    }
                    if (!found || response.Length == 0 || response.Length > 8000 || response.IndexOf('\0') >= 0) return false;
                }
                else if (String.Equals(action, "resolve-interaction", StringComparison.Ordinal))
                {
                    string parsedKey;
                    string parsedResponse;
                    if (!arguments.TryGetValue("interactionKey", out parsedKey)
                        || !arguments.TryGetValue("response", out parsedResponse)) return false;
                    interactionKey = (parsedKey ?? String.Empty).Trim();
                    response = (parsedResponse ?? String.Empty).Trim();
                    if (interactionKey.Length == 0 || interactionKey.Length > 256 || interactionKey.IndexOf('\0') >= 0
                        || response.Length == 0 || response.Length > 80 || response.IndexOf('\0') >= 0) return false;
                }
                return true;
            }
            catch
            {
                action = String.Empty;
                sessionId = String.Empty;
                interactionKey = String.Empty;
                response = String.Empty;
                return false;
            }
        }

        internal static void DispatchActivation(string argument, IEnumerable<KeyValuePair<string, object>> userInput)
        {
            try
            {
                string action;
                string sessionId;
                string interactionKey;
                string response;
                if (!TryParseActivation(argument, userInput,
                    out action, out sessionId, out interactionKey, out response)) return;
                ToastArguments arguments = ToastArguments.Parse(argument ?? String.Empty);
                string environmentId;
                string instanceKey;
                string rootKey;
                string activationId;
                string createdAtText;
                long createdAt;
                if (!arguments.TryGetValue("environmentId", out environmentId)
                    || !arguments.TryGetValue("instanceKey", out instanceKey)
                    || !arguments.TryGetValue("rootKey", out rootKey)
                    || !arguments.TryGetValue("activationId", out activationId)
                    || !arguments.TryGetValue("createdAt", out createdAtText)
                    || !Regex.IsMatch(environmentId ?? String.Empty, "^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$", RegexOptions.CultureInvariant)
                    || !Regex.IsMatch(activationId ?? String.Empty, "^[0-9a-f]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                    || !Int64.TryParse(createdAtText, NumberStyles.None, CultureInfo.InvariantCulture, out createdAt)) return;
                RouteActivation(new ActivationEnvelope {
                    activationId = activationId.ToLowerInvariant(), createdAt = createdAt,
                    environmentId = environmentId, instanceKey = instanceKey,
                    rootKey = rootKey,
                    action = action, sessionId = sessionId, interactionKey = interactionKey, response = response,
                });
            }
            catch { }
        }

        private static void RouteActivation(ActivationEnvelope envelope)
        {
            if (envelope == null || String.IsNullOrWhiteSpace(executableRoot)) return;
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (envelope.createdAt > now + 300 || envelope.createdAt < now - 604800) return;
            string targetRoot;
            string targetExecutable;
            if (!TryResolveTrustedRoot(envelope.rootKey, out targetRoot, out targetExecutable)) return;
            string expectedKey = LauncherWindow.ResolveEnvironmentInstanceKey(targetRoot, envelope.environmentId);
            if (!String.Equals(expectedKey, envelope.instanceKey, StringComparison.Ordinal)) return;
            if (!StoreActivation(envelope)) return;
            if (String.Equals(ownerRootKey, envelope.rootKey, StringComparison.Ordinal)
                && String.Equals(ownerEnvironmentId, envelope.environmentId, StringComparison.Ordinal)
                && String.Equals(ownerInstanceKey, envelope.instanceKey, StringComparison.Ordinal))
                DrainOwnerActivations();
            else
                Process.Start(new ProcessStartInfo(targetExecutable,
                    "start --environment " + envelope.environmentId + " --dsh-notification-dispatch") { UseShellExecute = true });
        }

        private static string ActivationDirectory(string instanceKey)
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DSH-Portable", "notification-activations", instanceKey);
        }

        private static bool StoreActivation(ActivationEnvelope envelope)
        {
            string temporary = null;
            try
            {
                lock (activationSync)
                {
                    string directory = ActivationDirectory(envelope.instanceKey);
                    Directory.CreateDirectory(directory);
                    CleanupActivationDirectory(directory);
                    if (Directory.GetFiles(directory).Count(value => !value.EndsWith(".done", StringComparison.OrdinalIgnoreCase)) >= 64) return false;
                    string pending = Path.Combine(directory, envelope.activationId + ".json");
                    string done = Path.Combine(directory, envelope.activationId + ".done");
                    if (File.Exists(pending) || File.Exists(done)) return false;
                    temporary = Path.Combine(directory, envelope.activationId + ".tmp-" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
                    File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(envelope), new UTF8Encoding(false));
                    File.Move(temporary, pending);
                    return true;
                }
            }
            catch { return false; }
            finally { if (!String.IsNullOrWhiteSpace(temporary)) try { File.Delete(temporary); } catch { } }
        }

        private static void CleanupActivationDirectory(string directory)
        {
            DateTime cutoff = DateTime.UtcNow.AddDays(-7);
            foreach (string file in Directory.GetFiles(directory))
            {
                try { if (File.GetLastWriteTimeUtc(file) < cutoff) File.Delete(file); } catch { }
            }
            foreach (string file in Directory.GetFiles(directory, "*.done")
                .OrderByDescending(File.GetLastWriteTimeUtc).Skip(256))
                try { File.Delete(file); } catch { }
        }

        internal static void DrainOwnerActivations()
        {
            if (!ownerReady || String.IsNullOrWhiteSpace(ownerInstanceKey)) return;
            lock (activationSync)
            {
                string directory = ActivationDirectory(ownerInstanceKey);
                if (!Directory.Exists(directory)) return;
                foreach (string file in Directory.GetFiles(directory, "*.json").OrderBy(value => value, StringComparer.Ordinal).Take(64))
                {
                    try
                    {
                        if (File.Exists(Path.ChangeExtension(file, ".done"))) { File.Delete(file); continue; }
                        ActivationEnvelope envelope = new JavaScriptSerializer().Deserialize<ActivationEnvelope>(File.ReadAllText(file, Encoding.UTF8));
                        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                        if (envelope == null || envelope.createdAt > now + 300 || envelope.createdAt < now - 604800
                            || !String.Equals(envelope.environmentId, ownerEnvironmentId, StringComparison.Ordinal)
                            || !String.Equals(envelope.instanceKey, ownerInstanceKey, StringComparison.Ordinal)) { File.Delete(file); continue; }
                        if (inflightActivations.Contains(envelope.activationId)) continue;
                        Action<string, string, string, string, string> requested = ActionRequested;
                        if (requested == null) return;
                        inflightActivations.Add(envelope.activationId);
                        requested(envelope.activationId, envelope.action, envelope.sessionId, envelope.interactionKey, envelope.response);
                    }
                    catch { }
                }
            }
        }

        internal static void CompleteActivation(string activationId, bool terminal)
        {
            if (!Regex.IsMatch(activationId ?? String.Empty, "^[0-9a-f]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                || String.IsNullOrWhiteSpace(ownerInstanceKey)) return;
            lock (activationSync)
            {
                inflightActivations.Remove(activationId);
                if (!terminal) return;
                string directory = ActivationDirectory(ownerInstanceKey);
                string pending = Path.Combine(directory, activationId.ToLowerInvariant() + ".json");
                string done = Path.Combine(directory, activationId.ToLowerInvariant() + ".done");
                try
                {
                    File.WriteAllText(done, String.Empty, new UTF8Encoding(false));
                    File.Delete(pending);
                }
                catch { }
            }
        }

        internal static void SetOwnerReady(bool value)
        {
            bool becameReady = value && !ownerReady;
            ownerReady = value;
            if (value)
            {
                if (becameReady) lock (activationSync) inflightActivations.Clear();
                DrainOwnerActivations();
            }
        }

        private static void AddActivationIdentity(ToastContentBuilder builder, string activationId, long createdAt)
        {
            builder.AddArgument("environmentId", ownerEnvironmentId)
                .AddArgument("instanceKey", ownerInstanceKey)
                .AddArgument("rootKey", ownerRootKey)
                .AddArgument("activationId", activationId)
                .AddArgument("createdAt", createdAt.ToString(CultureInfo.InvariantCulture));
        }

        private static ToastButton AddActivationIdentity(ToastButton button, string activationId, long createdAt)
        {
            return button.AddArgument("environmentId", ownerEnvironmentId)
                .AddArgument("instanceKey", ownerInstanceKey)
                .AddArgument("rootKey", ownerRootKey)
                .AddArgument("activationId", activationId)
                .AddArgument("createdAt", createdAt.ToString(CultureInfo.InvariantCulture));
        }

        internal static bool ShowAttention(TrayBridgeSession session, bool chinese)
        {
            if (session == null || String.IsNullOrWhiteSpace(session.id) || !Register()) return false;
            try
            {
                string interaction = session.pendingInteraction == null
                    ? String.Empty
                    : session.pendingInteraction.Trim();
                string heading = String.Equals(interaction, "question", StringComparison.OrdinalIgnoreCase)
                    ? (chinese ? "任务有问题需要回答" : "Task has a question")
                    : String.Equals(interaction, "approval", StringComparison.OrdinalIgnoreCase)
                        ? (chinese ? "任务等待批准" : "Task needs approval")
                        : (chinese ? "任务需要你处理" : "Task needs your attention");
                string prompt = String.IsNullOrWhiteSpace(session.pendingInteractionPrompt)
                    ? (chinese ? "打开任务查看并处理" : "Open the task to review and respond")
                    : session.pendingInteractionPrompt.Trim();
                if (prompt.Length > 512) prompt = prompt.Substring(0, 512);
                List<string> choices = (session.pendingInteractionOptions ?? new List<string>())
                    .Where(value => !String.IsNullOrWhiteSpace(value) && value.Trim().Length <= 80 && value.IndexOf('\0') < 0)
                    .Select(value => value.Trim())
                    .Distinct(StringComparer.Ordinal)
                    .Take(4)
                    .ToList();
                string activationId = Guid.NewGuid().ToString("N");
                long createdAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                ToastContentBuilder builder = new ToastContentBuilder()
                    .AddArgument("action", "open")
                    .AddArgument("sessionId", session.id)
                    .AddText(heading)
                    .AddText(String.IsNullOrWhiteSpace(session.title) ? session.id : session.title.Trim())
                    .AddText(prompt);
                AddActivationIdentity(builder, activationId, createdAt);
                if (!String.IsNullOrWhiteSpace(session.pendingInteractionKey))
                {
                    foreach (string choice in choices)
                    {
                        string label = choice;
                        if (String.Equals(interaction, "approval", StringComparison.OrdinalIgnoreCase))
                        {
                            if (String.Equals(choice, "rejected", StringComparison.Ordinal)) label = chinese ? "拒绝" : "Reject";
                            else if (String.Equals(choice, "allowed-once", StringComparison.Ordinal)) label = chinese ? "允许一次" : "Allow once";
                            else continue;
                        }
                        builder.AddButton(AddActivationIdentity(new ToastButton()
                            .SetContent(label)
                            .AddArgument("action", "resolve-interaction")
                            .AddArgument("sessionId", session.id)
                            .AddArgument("interactionKey", session.pendingInteractionKey)
                            .AddArgument("response", choice), activationId, createdAt));
                    }
                }
                ToastContent content = builder
                    .AddButton(AddActivationIdentity(new ToastButton()
                        .SetContent(chinese ? "打开" : "Open")
                        .AddArgument("action", "open")
                        .AddArgument("sessionId", session.id), activationId, createdAt))
                    .SetToastScenario(ToastScenario.Reminder)
                    .GetToastContent();
                DesktopNotificationManagerCompat.CreateToastNotifier().Show(new ToastNotification(content.GetXml()));
                return true;
            }
            catch
            {
                return false;
            }
        }

        internal static bool ShowCompletion(TrayBridgeSession session, bool chinese)
        {
            if (session == null || String.IsNullOrWhiteSpace(session.id) || !Register()) return false;
            try
            {
                string finalReply = String.IsNullOrWhiteSpace(session.finalReply)
                    ? (chinese ? "打开任务查看结果" : "Open the task to view its result")
                    : session.finalReply.Trim();
                string activationId = Guid.NewGuid().ToString("N");
                long createdAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                ToastContentBuilder builder = new ToastContentBuilder()
                    .AddArgument("action", "open")
                    .AddArgument("sessionId", session.id)
                    .AddText(chinese ? "任务已完成" : "Task completed")
                    .AddText(String.IsNullOrWhiteSpace(session.title) ? session.id : session.title.Trim())
                    .AddText(finalReply)
                    .AddInputTextBox("reply", chinese ? "回复此任务" : "Reply to this task", String.Empty);
                AddActivationIdentity(builder, activationId, createdAt);
                ToastContent content = builder
                    .AddButton(AddActivationIdentity(new ToastButton()
                        .SetContent(chinese ? "回复" : "Reply")
                        .AddArgument("action", "reply")
                        .AddArgument("sessionId", session.id)
                        .SetTextBoxId("reply"), activationId, createdAt))
                    .AddButton(AddActivationIdentity(new ToastButton()
                        .SetContent(chinese ? "打开" : "Open")
                        .AddArgument("action", "open")
                        .AddArgument("sessionId", session.id), activationId, createdAt))
                    .GetToastContent();
                DesktopNotificationManagerCompat.CreateToastNotifier().Show(new ToastNotification(content.GetXml()));
                return true;
            }
            catch
            {
                return false;
            }
        }
    }

    internal sealed class DesktopWindowState
    {
        public int schemaVersion { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public bool maximized { get; set; }
    }

}
