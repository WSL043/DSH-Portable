using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace DshPortable
{
    /// <summary>
    /// Immersive native chrome for the desktop host.
    ///
    /// The stock shell reserves a 36 px title strip above the web surface. That
    /// strip is kept as the *only* window chrome (menus and caption buttons stay
    /// native and fully functional), but it is moved into a small owned overlay
    /// window that floats above the web surface:
    ///
    ///   - the workspace always fills the whole window (no reserved title row);
    ///   - the native strip is hidden by default and slides in when the pointer
    ///     reaches the very top edge of the window (or while a menu is open);
    ///   - dragging the strip's empty background moves the real window, and the
    ///     caption buttons / menus work exactly as in the stock shell.
    ///
    /// The overlay is WS_EX_NOACTIVATE and owned by the launcher window, so it
    /// never steals focus from the WebView and it always stays above the page.
    /// </summary>
    internal sealed partial class LauncherWindow
    {
        private const int ImmersiveChromeHeight = 36;
        private const int ImmersiveRevealBand = 4;
        private const int ImmersiveHideDelayMs = 220;
        private const int ImmersiveTimerIntervalMs = 80;

        private DesktopChromeOverlay immersiveOverlay;
        private Timer immersiveTimer;
        private int immersiveHideAt;
        private bool immersiveDragActive;

        internal bool ForwardDesktopShortcut(Keys key)
        {
            return QueueDesktopShortcut(key);
        }

        private bool ImmersiveChromeAllowed
        {
            get
            {
                return desktopStart && !fullscreen && !IsDisposed && Visible
                    && WindowState != FormWindowState.Minimized;
            }
        }

        private void InstallImmersiveChrome()
        {
            if (desktopMenu == null || immersiveOverlay != null) return;
            // The strip is now hosted by the floating overlay instead of a docked row.
            if (desktopMenu.Parent != null) desktopMenu.Parent.Controls.Remove(desktopMenu);
            immersiveOverlay = new DesktopChromeOverlay(this);
            immersiveOverlay.SuspendLayout();
            immersiveOverlay.Controls.Add(desktopMenu);
            desktopMenu.Dock = DockStyle.Fill;
            desktopMenu.Visible = true;
            immersiveOverlay.MainMenuStrip = desktopMenu;
            immersiveOverlay.ResumeLayout(false);
            immersiveOverlay.Hide();

            desktopMenu.MouseDown += ImmersiveStripMouseDown;
            desktopMenu.MouseDoubleClick += ImmersiveStripDoubleClick;

            immersiveTimer = new Timer { Interval = ImmersiveTimerIntervalMs };
            immersiveTimer.Tick += delegate { PumpImmersiveChrome(); };
            immersiveTimer.Start();
            SyncImmersiveChrome();
            WriteLauncherLog("desktop-window", "immersive-chrome=on");
        }

        private void DetachImmersiveChrome()
        {
            if (immersiveTimer != null)
            {
                immersiveTimer.Stop();
                immersiveTimer.Dispose();
                immersiveTimer = null;
            }
            if (desktopMenu != null)
            {
                desktopMenu.MouseDown -= ImmersiveStripMouseDown;
                desktopMenu.MouseDoubleClick -= ImmersiveStripDoubleClick;
            }
            if (immersiveOverlay != null)
            {
                if (desktopMenu != null && desktopMenu.Parent == immersiveOverlay)
                    immersiveOverlay.Controls.Remove(desktopMenu);
                immersiveOverlay.Dispose();
                immersiveOverlay = null;
            }
        }

        private ToolStripDropDown OpenDesktopDropDown()
        {
            if (desktopMenu == null) return null;
            foreach (ToolStripMenuItem menu in desktopMenu.Items)
                if (menu.HasDropDownItems && menu.DropDown.Visible) return menu.DropDown;
            return null;
        }

        private bool ImmersiveChromeWanted()
        {
            if (immersiveOverlay == null) return false;
            if (OpenDesktopDropDown() != null) return true;
            Rectangle bar = immersiveOverlay.Visible ? immersiveOverlay.Bounds : Rectangle.Empty;
            Point cursor = Cursor.Position;
            if (!bar.IsEmpty && bar.Contains(cursor)) return true;
            Point origin = PointToScreen(Point.Empty);
            return cursor.X >= origin.X && cursor.X <= origin.X + ClientSize.Width
                && cursor.Y >= origin.Y && cursor.Y <= origin.Y + ImmersiveRevealBand;
        }

        private void SyncImmersiveChrome()
        {
            if (immersiveOverlay == null) return;
            if (!ImmersiveChromeAllowed)
            {
                HideImmersiveChrome();
                return;
            }
            Point origin = PointToScreen(Point.Empty);
            Rectangle target = new Rectangle(origin.X, origin.Y,
                Math.Max(1, ClientSize.Width), Math.Max(24, ImmersiveChromeHeight));
            if (immersiveOverlay.Bounds != target) immersiveOverlay.Bounds = target;
        }

        private void ShowImmersiveChrome()
        {
            if (immersiveOverlay == null || !ImmersiveChromeAllowed) return;
            SyncImmersiveChrome();
            if (!immersiveOverlay.Visible)
            {
                immersiveOverlay.Show();
            }
            immersiveHideAt = 0;
        }

        private void HideImmersiveChrome()
        {
            if (immersiveOverlay != null && immersiveOverlay.Visible)
            {
                CloseDesktopMenus();
                immersiveOverlay.Hide();
            }
            immersiveHideAt = 0;
        }

        internal void ShowImmersiveChromeTemporarily(int durationMs)
        {
            if (immersiveOverlay == null) return;
            ShowImmersiveChrome();
            immersiveHideAt = Environment.TickCount + Math.Max(200, durationMs);
        }

        private void PumpImmersiveChrome()
        {
            if (immersiveOverlay == null) return;
            if (!ImmersiveChromeAllowed)
            {
                HideImmersiveChrome();
                return;
            }
            SyncImmersiveChrome();
            // A native caption drag/resize owns the mouse; keep the float hidden
            // so it cannot lag behind or swallow the drag.
            if (immersiveDragActive || Capture)
            {
                if (immersiveOverlay.Visible) HideImmersiveChrome();
                return;
            }
            bool open = OpenDesktopDropDown() != null;
            if (ImmersiveChromeWanted())
            {
                ShowImmersiveChrome();
                return;
            }
            if (!immersiveOverlay.Visible) return;
            if (immersiveHideAt == 0) immersiveHideAt = Environment.TickCount + ImmersiveHideDelayMs;
            else if (unchecked(Environment.TickCount - immersiveHideAt) >= 0) HideImmersiveChrome();
        }

        private void ImmersiveStripMouseDown(object sender, MouseEventArgs eventArgs)
        {
            if (eventArgs.Button != MouseButtons.Left) return;
            if (desktopMenu == null || desktopMenu.GetItemAt(eventArgs.Location) != null) return;
            if (eventArgs.Clicks >= 2)
            {
                WindowState = WindowState == FormWindowState.Maximized
                    ? FormWindowState.Normal : FormWindowState.Maximized;
                return;
            }
            BeginImmersiveDrag();
        }

        private void ImmersiveStripDoubleClick(object sender, MouseEventArgs eventArgs)
        {
            // MouseDown already toggles maximize on Clicks >= 2; keep the handler
            // so a fast second click on the drag band does not start a move loop.
            if (desktopMenu != null && desktopMenu.GetItemAt(eventArgs.Location) != null) return;
        }

        private void BeginImmersiveDrag()
        {
            if (!desktopStart || fullscreen) return;
            immersiveDragActive = true;
            HideImmersiveChrome();
            try
            {
                ReleaseCapture();
                SendMessage(Handle, WmNcLeftButtonDown, new IntPtr(HtCaption), IntPtr.Zero);
            }
            finally
            {
                immersiveDragActive = false;
                SyncImmersiveChrome();
            }
        }

        /// <summary>
        /// Page-drawn "dynamic island" chrome: once the page asks for frameless
        /// mode the native strip leaves the layout and the page floats a compact
        /// centred pill with native drag / window buttons / menu access through
        /// the windowChrome bridge. The strip stays visible until then as a
        /// safe fallback.
        /// </summary>
        private void InstallPillMode()
        {
            if (desktopMenu == null) return;
            if (immersiveTimer != null)
            {
                immersiveTimer.Stop();
                immersiveTimer.Dispose();
                immersiveTimer = null;
            }
            if (immersiveOverlay != null)
            {
                immersiveOverlay.Dispose();
                immersiveOverlay = null;
            }
            WriteLauncherLog("desktop-window", "pill-chrome=on");
        }

        /// <summary>Which window chrome the user chose: "pill" (new island UI) or "native" (stock strip).</summary>
        private string chromeUiMode;

        private string ChromeUiModeFile
        {
            get { return Path.Combine(stateRoot, "data", "chrome-ui.json"); }
        }

        private void LoadChromeUiMode()
        {
            if (chromeUiMode != null) return;
            chromeUiMode = "pill";
            try
            {
                if (File.Exists(ChromeUiModeFile))
                {
                    var value = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(File.ReadAllText(ChromeUiModeFile));
                    if (value != null && value.ContainsKey("mode")
                        && String.Equals(value["mode"], "native", StringComparison.OrdinalIgnoreCase))
                        chromeUiMode = "native";
                }
            }
            catch (Exception) { chromeUiMode = "pill"; }
        }

        private void SaveChromeUiMode()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(ChromeUiModeFile));
                File.WriteAllText(ChromeUiModeFile,
                    new JavaScriptSerializer().Serialize(new Dictionary<string, string> { { "mode", chromeUiMode } }));
            }
            catch (Exception) { }
        }

        private void SetChromeUiMode(string mode)
        {
            LoadChromeUiMode();
            string next = String.Equals(mode, "native", StringComparison.OrdinalIgnoreCase) ? "native" : "pill";
            bool changed = !String.Equals(next, chromeUiMode, StringComparison.Ordinal);
            chromeUiMode = next;
            if (changed) SaveChromeUiMode();
            ApplyFramelessPage(next == "pill");
            PostDesktopWindowState();
            WriteLauncherLog("desktop-window", "ui-mode=" + chromeUiMode);
        }
        /// <summary>Runs one of the native title-bar commands by tool-strip item name.</summary>
        private void ExecuteDesktopMenuCommand(string commandId)
        {
            if (String.IsNullOrEmpty(commandId) || desktopMenu == null) return;
            RefreshDesktopCommands();
            ToolStripItem command = FindDesktopMenuCommand(desktopMenu.Items, commandId);
            if (command != null && command.Enabled) command.PerformClick();
        }

        private static ToolStripItem FindDesktopMenuCommand(ToolStripItemCollection items, string commandId)
        {
            foreach (ToolStripItem item in items)
            {
                if (String.Equals(item.Name, commandId, StringComparison.Ordinal)) return item;
                ToolStripMenuItem menu = item as ToolStripMenuItem;
                if (menu != null && menu.HasDropDownItems)
                {
                    ToolStripItem nested = FindDesktopMenuCommand(menu.DropDownItems, commandId);
                    if (nested != null) return nested;
                }
            }
            return null;
        }

        private ContextMenuStrip nativeMenuPopup;

        /// <summary>Shows the native File/View/Help commands as a native context menu.</summary>
        private void ShowNativeMenuAt(Point screenPoint) { ShowNativeMenuAt(screenPoint, null); }

        /// <summary>
        /// Shows the native commands as a native context menu. With menuName
        /// ("file" / "view" / "help") only that command group is shown; without
        /// it all three groups are shown as submenus.
        /// </summary>
        private void ShowNativeMenuAt(Point screenPoint, string menuName)
        {
            if (desktopMenu == null) return;
            if (nativeMenuPopup != null)
            {
                nativeMenuPopup.Dispose();
                nativeMenuPopup = null;
            }
            ContextMenuStrip popup = new ContextMenuStrip();
            popup.Font = ((DesktopTitleStrip)desktopMenu).MenuFont;
            popup.BackColor = desktopMenu.BackColor;
            popup.ForeColor = desktopMenu.ForeColor;
            popup.Renderer = desktopMenu.Renderer;
            ToolStripMenuItem single = null;
            if (!String.IsNullOrEmpty(menuName))
                single = desktopMenu.Items.Find("menu-" + menuName, true).FirstOrDefault() as ToolStripMenuItem;
            foreach (ToolStripMenuItem top in desktopMenu.Items)
            {
                if (String.IsNullOrEmpty(top.Name)
                    || top.Name.StartsWith("caption-", StringComparison.Ordinal)
                    || top.Name.StartsWith("traffic-", StringComparison.Ordinal)
                    || top.Name.StartsWith("nav-", StringComparison.Ordinal)) continue;
                if (single != null && top != single) continue;
                ToolStripMenuItem root = single == null ? new ToolStripMenuItem(top.Text) : null;
                foreach (ToolStripItem child in top.DropDownItems)
                {
                    ToolStripMenuItem command = child as ToolStripMenuItem;
                    if (command == null)
                    {
                        if (root != null) root.DropDownItems.Add(new ToolStripSeparator());
                        else popup.Items.Add(new ToolStripSeparator());
                        continue;
                    }
                    if (!command.HasDropDownItems)
                    {
                        ToolStripMenuItem clone = new ToolStripMenuItem(command.Text);
                        clone.Enabled = command.Enabled;
                        clone.ShortcutKeyDisplayString = command.ShortcutKeyDisplayString;
                        ToolStripMenuItem source = command;
                        clone.Click += delegate
                        {
                            RefreshDesktopCommands();
                            if (source.Enabled) source.PerformClick();
                        };
                        (root == null ? popup.Items : root.DropDownItems).Add(clone);
                        continue;
                    }
                    ToolStripMenuItem nested = new ToolStripMenuItem(command.Text);
                    foreach (ToolStripItem grandChild in command.DropDownItems)
                    {
                        ToolStripMenuItem grandCommand = grandChild as ToolStripMenuItem;
                        if (grandCommand == null) { nested.DropDownItems.Add(new ToolStripSeparator()); continue; }
                        ToolStripMenuItem clone = new ToolStripMenuItem(grandCommand.Text);
                        clone.Enabled = grandCommand.Enabled;
                        ToolStripMenuItem source = grandCommand;
                        clone.Click += delegate
                        {
                            RefreshDesktopCommands();
                            if (source.Enabled) source.PerformClick();
                        };
                        nested.DropDownItems.Add(clone);
                    }
                    (root == null ? popup.Items : root.DropDownItems).Add(nested);
                }
                if (root != null) popup.Items.Add(root);
            }
            nativeMenuPopup = popup;
            popup.Closed += delegate
            {
                if (nativeMenuPopup == popup) nativeMenuPopup = null;
                popup.Dispose();
            };
            popup.Show(screenPoint);
        }

        protected override void OnLocationChanged(EventArgs eventArgs)
        {
            base.OnLocationChanged(eventArgs);
            SyncImmersiveChrome();
        }

        protected override void OnVisibleChanged(EventArgs eventArgs)
        {
            base.OnVisibleChanged(eventArgs);
            if (!Visible) HideImmersiveChrome();
        }
    }

    /// <summary>Owned, non-activating top-level window that hosts the stock title strip.</summary>
    internal sealed class DesktopChromeOverlay : Form
    {
        private readonly LauncherWindow ownerWindow;

        internal DesktopChromeOverlay(LauncherWindow owner)
        {
            ownerWindow = owner;
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowIcon = false;
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Color.FromArgb(30, 30, 30);
            Opacity = 0.96;
            Owner = owner;
            SetStyle(ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE: never steal focus from the page
                parameters.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW: hidden from Alt+Tab
                return parameters;
            }
        }

        protected override void OnPaint(PaintEventArgs eventArgs)
        {
            base.OnPaint(eventArgs);
            using (Pen line = new Pen(Color.FromArgb(48, 51, 60)))
                eventArgs.Graphics.DrawLine(line, 0, Height - 1, Width - 1, Height - 1);
        }

        protected override bool ProcessCmdKey(ref Message message, Keys keyData)
        {
            if (ownerWindow != null && ownerWindow.ForwardDesktopShortcut(keyData)) return true;
            return base.ProcessCmdKey(ref message, keyData);
        }
    }
}


