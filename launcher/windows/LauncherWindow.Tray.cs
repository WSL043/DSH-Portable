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
    internal sealed partial class LauncherWindow : Form
    {
        private enum WindowCloseBehavior { Tray, Exit }

        private void HideToTray()
        {
            windowStateBeforeHide = WindowState == FormWindowState.Maximized
                ? FormWindowState.Maximized
                : FormWindowState.Normal;
            SaveDesktopWindowState();
            Hide();
            ShowInTaskbar = false;
            trayIcon.Visible = true;
            if (!trayNoticeShown)
            {
                trayNoticeShown = true;
                if (!TryClaimTrayNotice(Path.GetDirectoryName(LauncherSettingsPath()))) return;
                notificationSessionId = null;
                trayIcon.ShowBalloonTip(3000,
                    L("DeepSeek Harness 仍在运行", "DeepSeek Harness is still running"),
                    L("正在执行的任务会继续。右键托盘图标可以打开或退出。", "Active tasks will continue. Right-click the tray icon to open or exit."),
                    ToolTipIcon.Info);
            }
        }

        internal static bool TryClaimTrayNotice(string dataRoot)
        {
            // Product data survives restarts and application updates. CreateNew
            // also prevents two environments from repeating the onboarding tip.
            try
            {
                Directory.CreateDirectory(dataRoot);
                using (FileStream marker = new FileStream(Path.Combine(dataRoot, "tray-notice-seen"),
                    FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    marker.WriteByte(1);
                }
                return true;
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }

        private void RestoreFromTray()
        {
            if (!desktopReady) return;
            if (hiddenForAutomation) return;
            ShowInTaskbar = true;
            Show();
            WindowState = windowStateBeforeHide;
            Activate();
        }

        internal static string MenuTitle(string value)
        {
            string text = String.IsNullOrWhiteSpace(value) ? L("未命名会话", "Untitled session") : value.Trim();
            const int limit = 28;
            int[] starts = StringInfo.ParseCombiningCharacters(text);
            if (starts.Length > limit) text = text.Substring(0, starts[limit]).TrimEnd() + "…";
            return text.Replace("&", "&&");
        }

        internal static string SessionHintForLocale(TrayBridgeSession session, bool chinese)
        {
            if (!String.IsNullOrEmpty(session.pendingInteraction)) return chinese ? "待回复" : "Needs input";
            if (session.running) return chinese ? "运行中" : "Running";
            string preset = String.IsNullOrWhiteSpace(session.agentPreset) ? "" : session.agentPreset.Trim();
            if (preset.Equals("coding", StringComparison.OrdinalIgnoreCase)) return chinese ? "编码" : "Coding";
            if (preset.Equals("plan", StringComparison.OrdinalIgnoreCase)) return chinese ? "计划" : "Plan";
            if (preset.Equals("review", StringComparison.OrdinalIgnoreCase)) return chinese ? "复核" : "Review";
            if (preset.Equals("standard", StringComparison.OrdinalIgnoreCase)) return chinese ? "标准" : "Standard";
            if (String.IsNullOrEmpty(preset)) return chinese ? "已完成" : "Completed";
            return preset;
        }

        private ToolStripMenuItem CreateSessionMenuItem(TrayBridgeSession session)
        {
            bool chinese = uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase);
            string hint = SessionHintForLocale(session, chinese);
            ToolStripMenuItem item = new ToolStripMenuItem(MenuTitle(session.title))
            {
                AutoToolTip = false,
                ShowShortcutKeys = true,
                ShortcutKeyDisplayString = hint,
                Name = session.id,
                Tag = session,
            };
            item.Click += delegate
            {
                if (!trayBridgeReady || updateInteractionRunning || shutdownRunning) return;
                MarkTaskCompletionHandled(session.id);
                RestoreFromTray();
                PostBridgeAction("open-session", session.id);
            };
            return item;
        }

        private ToolStripMenuItem CreateOpenItem()
        {
            return new ToolStripMenuItem(L("打开 DeepSeek Harness", "Open DeepSeek Harness"), null, delegate { RestoreFromTray(); });
        }

        private void ConfigureDesktopLoadingSurface(string message, bool showDetail)
        {
            launchContent.Size = new Size(360, showDetail ? 164 : 140);
            productIcon.Location = new Point(162, 0);
            productIcon.Size = new Size(36, 36);
            productIcon.Visible = true;
            productLabel.Text = "DeepSeek Harness";
            productLabel.Location = new Point(0, 44);
            productLabel.Size = new Size(360, 24);
            productLabel.TextAlign = ContentAlignment.MiddleCenter;
            productLabel.Font = new Font("Segoe UI Semibold", 12F, FontStyle.Bold, GraphicsUnit.Point);
            activityRing.Location = new Point(170, 80);
            activityRing.Size = new Size(20, 20);
            activityRing.Indeterminate = true;
            activityRing.Value = 0;
            activityRing.Visible = true;
            statusLabel.Location = new Point(0, 112);
            statusLabel.Size = new Size(360, 20);
            statusLabel.AutoEllipsis = true;
            statusLabel.TextAlign = ContentAlignment.MiddleCenter;
            statusLabel.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            statusLabel.Text = message;
            progressDetail.Location = new Point(0, 140);
            progressDetail.Size = new Size(360, 20);
            progressDetail.TextAlign = ContentAlignment.MiddleCenter;
            progressDetail.Visible = showDetail;
            detailsBox.Visible = false;
            copyButton.Visible = false;
            closeButton.Visible = false;
            CenterLaunchContent();
        }

        private ToolStripMenuItem CreateTerminalItem()
        {
            return new ToolStripMenuItem(L("DSH 终端", "DSH Terminal"), null, delegate
            {
                if (!trayBridgeReady || updateInteractionRunning || shutdownRunning) return;
                try
                {
                    string root = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
                    string command = Path.Combine(root, "dsh.exe");
                    if (!File.Exists(command)) throw new FileNotFoundException("DSH command launcher is missing.", command);
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = command,
                        Arguments = "--terminal --environment " + QuoteArgument(environmentId),
                        WorkingDirectory = root,
                        UseShellExecute = false,
                        CreateNoWindow = false,
                        WindowStyle = ProcessWindowStyle.Normal,
                    });
                }
                catch (Exception error)
                {
                    MessageBox.Show(
                        this,
                        L("无法打开 DSH 终端。\n\n", "Could not open DSH Terminal.\n\n") + error.Message,
                        "DeepSeek-Herness",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
            });
        }

        private ToolStripMenuItem CreateExitItem()
        {
            return new ToolStripMenuItem(L("退出 DeepSeek Harness", "Exit DeepSeek Harness"), null, delegate
            {
                if (!shutdownRunning) BeginDesktopShutdown();
            });
        }

        private ToolStripMenuItem CreateReportProblemItem()
        {
            return CreateExternalLinkItem(L("反馈问题", "Report a problem"),
                "https://github.com/WSL043/DSH-Portable/issues/new/choose");
        }

        private ToolStripMenuItem CreateExternalLinkItem(string title, string url)
        {
            return new ToolStripMenuItem(title, null, delegate { OpenExternalUrl(url); });
        }

        private void RebuildTrayMenu()
        {
            RefreshDesktopCommands();
            if (trayMenuOpen)
            {
                trayMenuRefreshPending = true;
                return;
            }

            closeBehaviorItem.Text = L("关闭窗口时", "When closing");
            checkUpdateItem.Text = updateCheckRunning
                ? L("正在检查…", "Checking…")
                : L("检查 DSH-Portable 更新", "Check DSH-Portable updates");
            checkUpdateItem.Enabled = !updateCheckRunning && !updateInteractionRunning;
            checkEngineUpdateItem.Text = updateCheckRunning
                ? L("正在检查…", "Checking…")
                : L("检查 DSH 内核更新", "Check DSH core updates");
            checkEngineUpdateItem.Enabled = !updateCheckRunning && !updateInteractionRunning;
            RefreshAutomaticUpdateCheckItem();
            RefreshTaskNotificationsItem();
            closeBehaviorItem.Checked = false;
            closeBehaviorItem.ShowShortcutKeys = true;
            closeBehaviorItem.ShortcutKeyDisplayString = closeBehavior == WindowCloseBehavior.Tray
                ? L("最小化到托盘", "Minimize to tray")
                : L("退出程序", "Exit application");
            // Detach persistent commands before disposing generated menus.
            // Items.Clear() alone leaves dropdowns and their native resources alive.
            foreach (ToolStripItem persistent in new ToolStripItem[] {
                checkUpdateItem, checkEngineUpdateItem, automaticUpdateCheckItem,
                taskNotificationsItem, closeBehaviorItem })
            {
                if (persistent.Owner != null) persistent.Owner.Items.Remove(persistent);
            }
            ToolStripItem[] retired = trayMenu.Items.Cast<ToolStripItem>().ToArray();
            trayMenu.Items.Clear();
            foreach (ToolStripItem item in retired) item.Dispose();

            List<TrayBridgeSession> sessions = trayBridgeReady && trayState != null && trayState.sessions != null
                ? trayState.sessions.Where(item => item != null && !String.IsNullOrWhiteSpace(item.id)).Take(10).ToList()
                : new List<TrayBridgeSession>();

            trayMenu.Items.Add(CreateOpenItem());
            if (trayBridgeReady)
            {
                trayMenu.Items.Add(new ToolStripSeparator());
                foreach (TrayBridgeSession session in sessions.Take(3))
                    trayMenu.Items.Add(CreateSessionMenuItem(session));

                ToolStripMenuItem more = new ToolStripMenuItem(L("更多", "More"));
                foreach (TrayBridgeSession session in sessions.Skip(3).Take(7))
                    more.DropDownItems.Add(CreateSessionMenuItem(session));
                if (more.DropDownItems.Count > 0) more.DropDownItems.Add(new ToolStripSeparator());
                more.DropDownItems.Add(checkUpdateItem);
                more.DropDownItems.Add(checkEngineUpdateItem);
                more.DropDownItems.Add(automaticUpdateCheckItem);
                more.DropDownItems.Add(taskNotificationsItem);
                more.DropDownItems.Add(closeBehaviorItem);
                more.DropDownItems.Add(new ToolStripSeparator());
                more.DropDownItems.Add(CreateTerminalItem());
                more.DropDownItems.Add(CreateReportProblemItem());
                ToolStripDropDownMenu moreMenu = more.DropDown as ToolStripDropDownMenu;
                if (moreMenu != null)
                {
                    moreMenu.ShowImageMargin = false;
                    moreMenu.ShowCheckMargin = false;
                }
                more.DropDown.Opened += delegate { ApplyRoundedCorners(more.DropDown); };
                trayMenu.Items.Add(more);
                trayMenu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem fresh = new ToolStripMenuItem(L("新会话", "New session"));
                fresh.Click += delegate
                {
                    if (!trayBridgeReady || updateInteractionRunning || shutdownRunning) return;
                    RestoreFromTray();
                    PostBridgeAction("new-session", null);
                };
                trayMenu.Items.Add(fresh);
            }
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(CreateExitItem());
            ApplyTrayTheme();
        }

        private void HandleTrayMouseUp(object sender, MouseEventArgs eventArgs)
        {
            if (eventArgs.Button == MouseButtons.Left) RestoreFromTray();
        }

        private void RefreshAutomaticUpdateCheckItem()
        {
            automaticUpdateCheckItem.Text = L("启动时检查更新", "Check for updates at startup");
            automaticUpdateCheckItem.Checked = false;
            automaticUpdateCheckItem.ShowShortcutKeys = true;
            automaticUpdateCheckItem.ShortcutKeyDisplayString = updateCheckEnabled && engineUpdateCheckEnabled
                ? L("已开启", "On")
                : !updateCheckEnabled && !engineUpdateCheckEnabled
                    ? L("已关闭", "Off")
                    : L("部分开启", "Custom");
            automaticUpdateCheckItem.Invalidate();
        }

        private void RefreshTaskNotificationsItem()
        {
            taskNotificationsItem.Text = L("任务通知", "Task notifications");
            taskNotificationsItem.Checked = false;
            taskNotificationsItem.ShowShortcutKeys = true;
            taskNotificationsItem.ShortcutKeyDisplayString = taskNotificationsEnabled
                ? L("已开启", "On")
                : L("已关闭", "Off");
            taskNotificationsItem.Invalidate();
        }

        private void ApplyTrayTheme()
        {
            bool dark = String.Equals(trayTheme, "dark", StringComparison.OrdinalIgnoreCase);
            DshMenuColorTable colors = new DshMenuColorTable(dark);
            trayMenu.Renderer = new DshMenuRenderer(colors, uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase));
            trayMenu.BackColor = colors.SurfaceColor;
            trayMenu.ForeColor = colors.TextColor;
            trayMenu.Padding = Padding.Empty;
            int rootWidth = MeasureTrayMenuWidth(trayMenu.Items, trayMenu.Font, 220, 282);
            ApplyTrayItemTheme(trayMenu.Items, rootWidth, colors.TextColor, colors.CaptionColor, trayMenu.BackColor, colors.SelectedColor);
            FixTrayDropDownSize(trayMenu, rootWidth);
        }

        private static int MeasureTrayMenuWidth(ToolStripItemCollection items, Font font, int minimum, int maximum)
        {
            int desired = minimum;
            foreach (ToolStripItem item in items)
            {
                ToolStripMenuItem menuItem = item as ToolStripMenuItem;
                if (menuItem == null) continue;
                Size title = TextRenderer.MeasureText(menuItem.Text ?? "", font, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                Size status = String.IsNullOrEmpty(menuItem.ShortcutKeyDisplayString)
                    ? Size.Empty
                    : TextRenderer.MeasureText(menuItem.ShortcutKeyDisplayString, font, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                int width = 28 + title.Width;
                if (status.Width > 0) width += 18 + status.Width;
                if (menuItem.DropDownItems.Count > 0) width += 18;
                desired = Math.Max(desired, width);
            }
            return Math.Min(maximum, desired);
        }

        private static void ApplyTrayItemTheme(ToolStripItemCollection items, int menuWidth, Color foreground, Color caption, Color background, Color selected)
        {
            foreach (ToolStripItem item in items)
            {
                item.ForeColor = foreground;
                item.BackColor = background;
                item.AutoSize = false;
                item.Size = item is ToolStripSeparator ? new Size(menuWidth - 2, 6) : new Size(menuWidth - 2, 35);
                item.Padding = item is ToolStripSeparator ? Padding.Empty : new Padding(10, 5, 10, 5);
                ToolStripMenuItem menuItem = item as ToolStripMenuItem;
                if (menuItem == null) continue;
                menuItem.DropDown.BackColor = background;
                menuItem.DropDown.ForeColor = foreground;
                if (menuItem.DropDownItems.Count > 0)
                {
                    int childWidth = MeasureTrayMenuWidth(menuItem.DropDownItems, font: item.Font, minimum: 196, maximum: 264);
                    ApplyTrayItemTheme(menuItem.DropDownItems, childWidth, foreground, caption, background, selected);
                    FixTrayDropDownSize(menuItem.DropDown, childWidth);
                }
            }
        }

        private static void FixTrayDropDownSize(ToolStripDropDown dropDown, int width)
        {
            int preferredHeight = dropDown.Padding.Vertical + 4;
            foreach (ToolStripItem item in dropDown.Items)
            {
                if (item.Available) preferredHeight += item.Height;
            }
            dropDown.AutoSize = false;
            dropDown.MinimumSize = new Size(width, preferredHeight);
            dropDown.MaximumSize = new Size(width, preferredHeight);
            dropDown.Size = new Size(width, preferredHeight);
        }

        private void MarkTrayBridgeUnavailable()
        {
            trayBridgeReady = false;
            NativeTaskNotification.SetOwnerReady(false);
            RebuildTrayMenu();
        }

        private void PostBridgeAction(string action, string sessionId, string activationId = null)
        {
            if (!trayBridgeReady || webView.CoreWebView2 == null) return;
            Dictionary<string, object> message = new Dictionary<string, object>
            {
                { "type", "dsh-portable/action" },
                { "action", action },
            };
            if (!String.IsNullOrEmpty(sessionId)) message["sessionId"] = sessionId;
            if (!String.IsNullOrEmpty(activationId)) message["activationId"] = activationId;
            try { webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
            catch { MarkTrayBridgeUnavailable(); }
        }

        private void PostBridgeReply(string activationId, string sessionId, string reply)
        {
            if (!trayBridgeReady || webView.CoreWebView2 == null || String.IsNullOrWhiteSpace(sessionId)) return;
            string text = (reply ?? String.Empty).Trim();
            if (text.Length == 0 || text.Length > 8000 || text.IndexOf('\0') >= 0) return;
            Dictionary<string, object> message = new Dictionary<string, object>
            {
                { "type", "dsh-portable/action" },
                { "activationId", activationId },
                { "action", "reply-session" },
                { "sessionId", sessionId },
                { "reply", text },
            };
            try { webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
            catch { MarkTrayBridgeUnavailable(); }
        }

        private void PostBridgeInteractionAnswer(string activationId, string sessionId, string interactionKey, string response)
        {
            if (!trayBridgeReady || webView.CoreWebView2 == null || String.IsNullOrWhiteSpace(sessionId)) return;
            string key = (interactionKey ?? String.Empty).Trim();
            string value = (response ?? String.Empty).Trim();
            if (key.Length == 0 || key.Length > 256 || key.IndexOf('\0') >= 0
                || value.Length == 0 || value.Length > 80 || value.IndexOf('\0') >= 0) return;
            Dictionary<string, object> message = new Dictionary<string, object>
            {
                { "type", "dsh-portable/action" },
                { "activationId", activationId },
                { "action", "resolve-interaction" },
                { "sessionId", sessionId },
                { "interactionKey", key },
                { "response", value },
            };
            try { webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
            catch { MarkTrayBridgeUnavailable(); }
        }

        private void HandleNativeNotificationAction(string activationId, string action, string sessionId, string interactionKey, string response)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try
                {
                    BeginInvoke((MethodInvoker)delegate { QueueNotificationAction(activationId, action, sessionId, interactionKey, response); });
                    return;
                }
                catch (InvalidOperationException) { }
            }
            QueueNotificationAction(activationId, action, sessionId, interactionKey, response);
        }

        private void QueueNotificationAction(string activationId, string action, string sessionId, string interactionKey, string response)
        {
            if ((!String.Equals(action, "open", StringComparison.Ordinal)
                    && !String.Equals(action, "reply", StringComparison.Ordinal)
                    && !String.Equals(action, "resolve-interaction", StringComparison.Ordinal))
                || String.IsNullOrWhiteSpace(sessionId)) return;
            string key = (interactionKey ?? String.Empty).Trim();
            string value = (response ?? String.Empty).Trim();
            if (String.Equals(action, "reply", StringComparison.Ordinal)
                && (value.Length == 0 || value.Length > 8000 || value.IndexOf('\0') >= 0)) return;
            if (String.Equals(action, "resolve-interaction", StringComparison.Ordinal)
                && (key.Length == 0 || key.Length > 256 || key.IndexOf('\0') >= 0
                    || value.Length == 0 || value.Length > 80 || value.IndexOf('\0') >= 0)) return;
            if (!trayBridgeReady || webView == null || webView.CoreWebView2 == null)
            {
                while (pendingNotificationActions.Count >= 16) pendingNotificationActions.Dequeue();
                pendingNotificationActions.Enqueue(Tuple.Create(activationId, action, sessionId, key, value));
                return;
            }
            DispatchNotificationAction(activationId, action, sessionId, key, value);
        }

        private void DispatchNotificationAction(string activationId, string action, string sessionId, string interactionKey, string response)
        {
            MarkTaskCompletionHandled(sessionId);
            if (String.Equals(action, "reply", StringComparison.Ordinal))
            {
                PostBridgeReply(activationId, sessionId, response);
                return;
            }
            if (String.Equals(action, "resolve-interaction", StringComparison.Ordinal))
            {
                PostBridgeInteractionAnswer(activationId, sessionId, interactionKey, response);
                return;
            }
            RestoreFromTray();
            PostBridgeAction("open-session", sessionId, activationId);
        }

        private void FlushNotificationActions()
        {
            while (trayBridgeReady && webView != null && webView.CoreWebView2 != null && pendingNotificationActions.Count > 0)
            {
                Tuple<string, string, string, string, string> pending = pendingNotificationActions.Dequeue();
                DispatchNotificationAction(pending.Item1, pending.Item2, pending.Item3, pending.Item4, pending.Item5);
            }
        }

        private void MarkTaskCompletionHandled(string sessionId)
        {
            if (String.IsNullOrWhiteSpace(sessionId)) return;
            if (unreadCompletedSessions.Remove(sessionId)) UpdateTaskbarBadge();
        }

        private void UpdateTaskbarBadge()
        {
            if (IsHandleCreated) TaskbarBadge.SetOverlayIcon(Handle, unreadCompletedSessions.Count);
        }

        private void HandleTaskCompletionNotifications(TrayBridgeState state)
        {
            List<TrayBridgeSession> sessions = state.sessions ?? new List<TrayBridgeSession>();
            List<TrayBridgeSession> completedThisFrame = new List<TrayBridgeSession>();
            List<TrayBridgeSession> attentionThisFrame = new List<TrayBridgeSession>();
            if (!taskCompletionBaselineReady)
            {
                taskCompletionState.Clear();
                taskInteractionState.Clear();
                unreadCompletedSessions.Clear();
                foreach (TrayBridgeSession session in sessions)
                {
                    if (session != null && !String.IsNullOrWhiteSpace(session.id))
                    {
                        taskCompletionState[session.id] = session.completed;
                        taskInteractionState[session.id] = TaskInteractionIdentity(session);
                        if (session.completed && !String.Equals(state.currentSessionId, session.id, StringComparison.Ordinal))
                            unreadCompletedSessions.Add(session.id);
                    }
                }
                taskCompletionBaselineReady = true;
                UpdateTaskbarBadge();
                return;
            }

            foreach (TrayBridgeSession session in sessions)
            {
                if (session == null || String.IsNullOrWhiteSpace(session.id)) continue;
                bool currentTaskVisible = IsCurrentTaskVisibleAndFocused(state, session);
                if (!session.completed || currentTaskVisible)
                    unreadCompletedSessions.Remove(session.id);
                bool previouslyCompleted;
                bool wasCompleted = taskCompletionState.TryGetValue(session.id, out previouslyCompleted) && previouslyCompleted;
                if (session.completed && !wasCompleted && !currentTaskVisible)
                {
                    unreadCompletedSessions.Add(session.id);
                    if (taskNotificationsEnabled) completedThisFrame.Add(session);
                }
                string pendingInteraction = String.IsNullOrWhiteSpace(session.pendingInteraction)
                    ? String.Empty
                    : session.pendingInteraction.Trim();
                string interactionIdentity = TaskInteractionIdentity(session);
                string previousInteraction;
                taskInteractionState.TryGetValue(session.id, out previousInteraction);
                if (taskNotificationsEnabled
                    && !currentTaskVisible
                    && pendingInteraction.Length > 0
                    && !String.Equals(interactionIdentity, previousInteraction, StringComparison.Ordinal))
                    attentionThisFrame.Add(session);
            }

            List<Tuple<TrayBridgeSession, bool>> fallbackNotifications = new List<Tuple<TrayBridgeSession, bool>>();
            if (completedThisFrame.Count > 0) ShowTaskCompletionNotifications(completedThisFrame, fallbackNotifications);
            if (attentionThisFrame.Count > 0) ShowTaskAttentionNotifications(attentionThisFrame, fallbackNotifications);
            if (fallbackNotifications.Count > 0) ShowTaskNotificationFallback(fallbackNotifications);
            UpdateTaskbarBadge();

            taskCompletionState.Clear();
            taskInteractionState.Clear();
            foreach (TrayBridgeSession session in sessions)
            {
                if (session != null && !String.IsNullOrWhiteSpace(session.id))
                {
                    taskCompletionState[session.id] = session.completed;
                    taskInteractionState[session.id] = TaskInteractionIdentity(session);
                }
            }
        }

        private static string TaskInteractionIdentity(TrayBridgeSession session)
        {
            if (session == null || String.IsNullOrWhiteSpace(session.pendingInteraction)) return String.Empty;
            string kind = session.pendingInteraction.Trim();
            string key = String.IsNullOrWhiteSpace(session.pendingInteractionKey)
                ? kind
                : session.pendingInteractionKey.Trim();
            return kind + "\n" + key;
        }

        private bool IsCurrentTaskVisibleAndFocused(TrayBridgeState state, TrayBridgeSession session)
        {
            return state != null
                && session != null
                && String.Equals(state.currentSessionId, session.id, StringComparison.Ordinal)
                && Visible
                && WindowState != FormWindowState.Minimized
                && ContainsFocus;
        }

        private void ShowTaskCompletionNotifications(
            List<TrayBridgeSession> sessions,
            List<Tuple<TrayBridgeSession, bool>> fallbackNotifications)
        {
            if (sessions == null || sessions.Count == 0) return;
            trayIcon.Visible = true;
            foreach (TrayBridgeSession session in sessions.Take(3))
            {
                notificationSessionId = session.id;
                if (!NativeTaskNotification.ShowCompletion(session, uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase)))
                    fallbackNotifications.Add(Tuple.Create(session, false));
            }
        }

        private void ShowTaskAttentionNotifications(
            List<TrayBridgeSession> sessions,
            List<Tuple<TrayBridgeSession, bool>> fallbackNotifications)
        {
            if (sessions == null || sessions.Count == 0) return;
            trayIcon.Visible = true;
            foreach (TrayBridgeSession session in sessions.Take(3))
            {
                notificationSessionId = session.id;
                if (!NativeTaskNotification.ShowAttention(session, uiLanguage.Equals("zh", StringComparison.OrdinalIgnoreCase)))
                    fallbackNotifications.Add(Tuple.Create(session, true));
            }
        }

        private void ShowTaskNotificationFallback(List<Tuple<TrayBridgeSession, bool>> failures)
        {
            if (failures == null || failures.Count == 0) return;
            Tuple<TrayBridgeSession, bool> preferred = failures.FirstOrDefault(item => item.Item2) ?? failures[0];
            TrayBridgeSession session = preferred.Item1;
            bool attention = failures.Any(item => item.Item2);
            string title = attention
                ? L("任务需要你处理", "Task needs your attention")
                : L("任务已完成", "Task completed");
            string body;
            if (failures.Count > 1)
            {
                body = L(
                    failures.Count.ToString(CultureInfo.InvariantCulture) + " 条任务通知未能显示。点击打开一个任务。",
                    failures.Count.ToString(CultureInfo.InvariantCulture) + " task notifications could not be shown. Click to open one task.");
            }
            else
            {
                string detail = attention
                    ? (String.IsNullOrWhiteSpace(session.pendingInteractionPrompt)
                        ? L("打开任务查看并处理。", "Open the task to review and respond.")
                        : session.pendingInteractionPrompt.Trim())
                    : (String.IsNullOrWhiteSpace(session.finalReply)
                        ? L("打开任务查看结果。", "Open the task to view its result.")
                        : session.finalReply.Trim());
                body = (String.IsNullOrWhiteSpace(session.title) ? session.id : session.title.Trim()) + "\r\n" + detail;
            }
            if (body.Length > 240) body = body.Substring(0, 239).TrimEnd() + "…";
            notificationSessionId = session.id;
            try
            {
                trayIcon.Visible = true;
                trayIcon.ShowBalloonTip(5000, title, body, attention ? ToolTipIcon.Warning : ToolTipIcon.Info);
            }
            catch { notificationSessionId = null; }
        }

        private static void ApplyRoundedCorners(ToolStripDropDown menu)
        {
            if (menu == null || menu.IsDisposed || !menu.IsHandleCreated) return;
            DwmWindowCornerPreference preference = menu is DesktopDropDown
                ? DwmWindowCornerPreference.RoundSmall : DwmWindowCornerPreference.Round;
            try { DwmSetWindowAttribute(menu.Handle, DwmwaWindowCornerPreference, ref preference, sizeof(int)); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
        }

    }
}
