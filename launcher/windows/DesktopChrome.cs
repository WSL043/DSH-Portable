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
    internal sealed class DshMenuColorTable : ProfessionalColorTable
    {
        private readonly bool dark;

        internal DshMenuColorTable(bool isDark)
        {
            dark = isDark;
            UseSystemColors = false;
        }

        private Color Surface { get { return dark ? Color.FromArgb(31, 32, 34) : Color.FromArgb(249, 249, 249); } }
        private Color Selected { get { return dark ? Color.FromArgb(45, 47, 50) : Color.FromArgb(235, 235, 235); } }
        private Color Border { get { return dark ? Color.FromArgb(61, 63, 66) : Color.FromArgb(218, 218, 218); } }
        internal Color TextColor { get { return dark ? Color.FromArgb(238, 239, 241) : Color.FromArgb(15, 17, 21); } }
        internal Color CaptionColor { get { return dark ? Color.FromArgb(173, 178, 184) : Color.FromArgb(97, 102, 107); } }
        internal Color DisabledColor { get { return dark ? Color.FromArgb(121, 124, 129) : Color.FromArgb(148, 151, 157); } }
        internal Color DisabledCaptionColor { get { return dark ? Color.FromArgb(112, 116, 121) : Color.FromArgb(157, 160, 166); } }
        internal Color SurfaceColor { get { return Surface; } }
        internal Color SelectedColor { get { return Selected; } }
        internal Color BorderColor { get { return Border; } }

        public override Color ToolStripDropDownBackground { get { return Surface; } }
        public override Color ImageMarginGradientBegin { get { return Surface; } }
        public override Color ImageMarginGradientMiddle { get { return Surface; } }
        public override Color ImageMarginGradientEnd { get { return Surface; } }
        public override Color MenuBorder { get { return Border; } }
        public override Color MenuItemBorder { get { return Selected; } }
        public override Color MenuItemSelected { get { return Selected; } }
        public override Color MenuItemSelectedGradientBegin { get { return Selected; } }
        public override Color MenuItemSelectedGradientEnd { get { return Selected; } }
        public override Color MenuItemPressedGradientBegin { get { return Selected; } }
        public override Color MenuItemPressedGradientMiddle { get { return Selected; } }
        public override Color MenuItemPressedGradientEnd { get { return Selected; } }
        public override Color SeparatorDark { get { return Border; } }
        public override Color SeparatorLight { get { return Surface; } }
    }

    internal sealed class DshMenuRenderer : ToolStripProfessionalRenderer
    {
        private readonly Color selectedColor;
        private readonly Color textColor;
        private readonly Color captionColor;
        private readonly Color runningColor;
        private readonly Color borderColor;
        private readonly bool chinese;

        internal DshMenuRenderer(DshMenuColorTable colors, bool isChinese)
            : base(colors)
        {
            RoundedEdges = false;
            selectedColor = colors.SelectedColor;
            textColor = colors.TextColor;
            captionColor = colors.CaptionColor;
            runningColor = Color.FromArgb(45, 201, 111);
            borderColor = colors.BorderColor;
            chinese = isChinese;
        }

        private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs eventArgs)
        {
            ToolStripMenuItem item = eventArgs.Item as ToolStripMenuItem;
            using (Brush surface = new SolidBrush(eventArgs.ToolStrip.BackColor))
                eventArgs.Graphics.FillRectangle(surface, new Rectangle(Point.Empty, eventArgs.Item.Size));
            if (item == null || !item.Selected) return;
            Rectangle selectedBounds = new Rectangle(4, 2, Math.Max(1, eventArgs.Item.Width - 8), Math.Max(1, eventArgs.Item.Height - 4));
            eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = RoundedRectangle(selectedBounds, 5))
            using (Brush selected = new SolidBrush(selectedColor))
                eventArgs.Graphics.FillPath(selected, path);
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs eventArgs)
        {
            int y = eventArgs.Item.Height / 2;
            using (Pen pen = new Pen(borderColor))
                eventArgs.Graphics.DrawLine(pen, 8, y, Math.Max(8, eventArgs.Item.Width - 8), y);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs eventArgs)
        {
            TrayBridgeSession session = eventArgs.Item.Tag as TrayBridgeSession;
            ToolStripMenuItem menuItem = eventArgs.Item as ToolStripMenuItem;
            if (menuItem == null)
            {
                base.OnRenderItemText(eventArgs);
                return;
            }
            if (session == null)
            {
                string caption = menuItem.ShortcutKeyDisplayString ?? "";
                Size captionSize = String.IsNullOrEmpty(caption)
                    ? Size.Empty
                    : TextRenderer.MeasureText(caption, eventArgs.TextFont, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                int trailing = menuItem.DropDownItems.Count > 0 ? 28 : 12;
                int captionLeft = Math.Max(82, eventArgs.Item.Width - trailing - captionSize.Width);
                if (eventArgs.Text == menuItem.Text)
                {
                    int titleRight = String.IsNullOrEmpty(caption) ? eventArgs.Item.Width - trailing : captionLeft - 12;
                    Rectangle commandBounds = new Rectangle(14, 0, Math.Max(24, titleRight - 14), eventArgs.Item.Height);
                    TextRenderer.DrawText(
                        eventArgs.Graphics,
                        menuItem.Text,
                        eventArgs.TextFont,
                        commandBounds,
                        menuItem.ForeColor,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                    return;
                }
                if (eventArgs.Text == caption && !String.IsNullOrEmpty(caption))
                {
                    Rectangle captionBounds = new Rectangle(captionLeft, 0, captionSize.Width, eventArgs.Item.Height);
                    TextRenderer.DrawText(
                        eventArgs.Graphics,
                        caption,
                        eventArgs.TextFont,
                        captionBounds,
                        captionColor,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
                }
                return;
            }

            string status = LauncherWindow.SessionHintForLocale(session, chinese);
            Size statusSize = TextRenderer.MeasureText(
                status,
                eventArgs.TextFont,
                Size.Empty,
                TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
            int statusLeft = Math.Max(82, eventArgs.Item.Width - 12 - statusSize.Width);
            if (eventArgs.Text == menuItem.Text)
            {
                Rectangle titleBounds = new Rectangle(14, 0, Math.Max(24, statusLeft - 26), eventArgs.Item.Height);
                TextRenderer.DrawText(
                    eventArgs.Graphics,
                    menuItem.Text,
                    eventArgs.TextFont,
                    titleBounds,
                    menuItem.ForeColor,
                    TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                return;
            }
            if (eventArgs.Text != menuItem.ShortcutKeyDisplayString) return;

            Rectangle textBounds = new Rectangle(statusLeft, 0, statusSize.Width, eventArgs.Item.Height);
            if (session.running)
            {
                using (Brush dot = new SolidBrush(runningColor))
                    eventArgs.Graphics.FillEllipse(dot, Math.Max(10, statusLeft - 11), Math.Max(0, (eventArgs.Item.Height - 6) / 2), 6, 6);
            }
            TextRenderer.DrawText(
                eventArgs.Graphics,
                status,
                eventArgs.TextFont,
                textBounds,
                captionColor,
                TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs eventArgs)
        {
            Rectangle arrowBounds = new Rectangle(
                Math.Max(0, eventArgs.Item.Width - 22),
                Math.Max(0, (eventArgs.Item.Height - 12) / 2),
                12,
                12);
            ControlPaint.DrawMenuGlyph(
                eventArgs.Graphics,
                arrowBounds,
                MenuGlyph.Arrow,
                textColor,
                eventArgs.Item.Selected ? selectedColor : eventArgs.Item.Owner.BackColor);
        }
    }


    internal sealed class DshActivityRing : Control
    {
        private readonly System.Windows.Forms.Timer animationTimer;
        private bool indeterminate = true;
        private int progressValue;
        private int rotation;
        private readonly Stopwatch animationClock = Stopwatch.StartNew();

        internal DshActivityRing()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            TrackColor = Color.FromArgb(226, 228, 232);
            IndicatorColor = Color.FromArgb(27, 28, 30);
            animationTimer = new System.Windows.Forms.Timer { Interval = 16, Enabled = true };
            animationTimer.Tick += delegate
            {
                rotation = (int)(animationClock.Elapsed.TotalMilliseconds * 0.24) % 360;
                Invalidate();
            };
        }

        internal event EventHandler FramePainted;
        internal int PaintedFrames { get; private set; }
        internal int Rotation { get { return rotation; } }

        internal Color TrackColor { get; set; }
        internal Color IndicatorColor { get; set; }

        internal bool Indeterminate
        {
            get { return indeterminate; }
            set
            {
                indeterminate = value;
                animationTimer.Enabled = value && Visible;
                Invalidate();
            }
        }

        internal int Value
        {
            get { return progressValue; }
            set { progressValue = Math.Max(0, Math.Min(100, value)); Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs eventArgs)
        {
            base.OnPaint(eventArgs);
            PaintedFrames++;
            eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float stroke = 2F;
            float diameter = Math.Max(2F, Math.Min(Width, Height) - stroke - 1F);
            RectangleF bounds = new RectangleF(
                (Width - diameter) / 2F,
                (Height - diameter) / 2F,
                diameter,
                diameter);
            using (Pen track = new Pen(TrackColor, stroke))
                eventArgs.Graphics.DrawEllipse(track, bounds);
            float sweep = indeterminate
                ? 72F
                : progressValue >= 100 ? 359.9F : Math.Max(0F, 360F * progressValue / 100F);
            if (sweep > 0F)
            {
                using (Pen indicator = new Pen(IndicatorColor, stroke))
                {
                    indicator.StartCap = LineCap.Round;
                    indicator.EndCap = LineCap.Round;
                    eventArgs.Graphics.DrawArc(indicator, bounds, indeterminate ? rotation - 90F : -90F, sweep);
                }
            }
            if (FramePainted != null && (PaintedFrames == 1 || PaintedFrames == 10)) FramePainted(this, EventArgs.Empty);
        }

        protected override void OnVisibleChanged(EventArgs eventArgs)
        {
            base.OnVisibleChanged(eventArgs);
            animationTimer.Enabled = Visible && indeterminate;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) animationTimer.Dispose();
            base.Dispose(disposing);
        }
    }

    internal sealed class DesktopTitleRenderer : ToolStripProfessionalRenderer
    {
        private readonly bool dark;
        private readonly DshMenuColorTable colors;

        internal DesktopTitleRenderer(bool isDark) : this(new DshMenuColorTable(isDark), isDark) { }

        private DesktopTitleRenderer(DshMenuColorTable menuColors, bool isDark) : base(menuColors)
        {
            colors = menuColors;
            dark = isDark;
            RoundedEdges = false;
        }

        internal DshMenuColorTable Colors { get { return colors; } }

        private bool IsDesktopDropDown(ToolStrip toolStrip)
        {
            return toolStrip is ToolStripDropDown;
        }

        private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
        {
            if (e.ToolStrip is DesktopTitleStrip)
            {
                e.Graphics.Clear(e.ToolStrip.BackColor);
                return;
            }
            if (IsDesktopDropDown(e.ToolStrip))
            {
                using (SolidBrush brush = new SolidBrush(colors.SurfaceColor))
                    e.Graphics.FillRectangle(brush, new Rectangle(Point.Empty, e.ToolStrip.Size));
                return;
            }
            base.OnRenderToolStripBackground(e);
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            if (!(e.ToolStrip is DesktopTitleStrip)) base.OnRenderToolStripBorder(e);
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (IsDesktopDropDown(e.ToolStrip))
            {
                ToolStripMenuItem dropDownItem = e.Item as ToolStripMenuItem;
                using (SolidBrush surface = new SolidBrush(colors.SurfaceColor))
                    e.Graphics.FillRectangle(surface, new Rectangle(Point.Empty, e.Item.Size));
                if (dropDownItem == null || (!dropDownItem.Selected && !dropDownItem.Pressed)) return;
                Rectangle selectedBounds = new Rectangle(4, 2, Math.Max(1, e.Item.Width - 8), Math.Max(1, e.Item.Height - 4));
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (GraphicsPath path = RoundedRectangle(selectedBounds, 4))
                using (SolidBrush selected = new SolidBrush(colors.SelectedColor))
                    e.Graphics.FillPath(selected, path);
                return;
            }
            if (!(e.ToolStrip is DesktopTitleStrip)) { base.OnRenderMenuItemBackground(e); return; }
            if (!e.Item.Enabled || (!e.Item.Selected && !e.Item.Pressed)) return;
            bool close = e.Item.Name == "caption-close";
            Rectangle bounds = new Rectangle(0, 0, e.Item.Width, e.Item.Height);
            Color color = close ? Color.FromArgb(232, 17, 35)
                : e.Item.Pressed ? (dark ? Color.FromArgb(62, 62, 62) : Color.FromArgb(220, 220, 220))
                : dark ? Color.FromArgb(47, 47, 47) : Color.FromArgb(235, 235, 235);
            using (SolidBrush brush = new SolidBrush(color))
            {
                if (e.Item.Name.StartsWith("caption-"))
                {
                    if (close && e.ToolStrip.FindForm().WindowState == FormWindowState.Normal)
                    {
                        using (GraphicsPath corner = new GraphicsPath())
                        {
                            corner.AddLine(0, 0, bounds.Right - 8, 0);
                            corner.AddArc(bounds.Right - 16, 0, 16, 16, 270, 90);
                            corner.AddLine(bounds.Right, 8, bounds.Right, bounds.Bottom);
                            corner.AddLine(bounds.Right, bounds.Bottom, 0, bounds.Bottom);
                            corner.CloseFigure();
                            SmoothingMode previous = e.Graphics.SmoothingMode;
                            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                            e.Graphics.FillPath(brush, corner);
                            e.Graphics.SmoothingMode = previous;
                        }
                    }
                    else e.Graphics.FillRectangle(brush, bounds);
                    return;
                }
                bounds.Inflate(-1, -2);
                using (GraphicsPath shape = new GraphicsPath())
                {
                    int diameter = e.Item.Name.StartsWith("nav-") ? 14 : 8;
                    shape.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
                    shape.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
                    shape.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
                    shape.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
                    shape.CloseFigure();
                    SmoothingMode previous = e.Graphics.SmoothingMode;
                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    e.Graphics.FillPath(brush, shape);
                    e.Graphics.SmoothingMode = previous;
                }
            }
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            if (IsDesktopDropDown(e.ToolStrip))
            {
                int y = e.Item.Height / 2;
                using (Pen pen = new Pen(colors.BorderColor))
                    e.Graphics.DrawLine(pen, 12, y, Math.Max(12, e.Item.Width - 12), y);
                return;
            }
            base.OnRenderSeparator(e);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (IsDesktopDropDown(e.ToolStrip))
            {
                ToolStripMenuItem dropDownItem = e.Item as ToolStripMenuItem;
                if (dropDownItem == null) { base.OnRenderItemText(e); return; }
                string shortcut = dropDownItem.ShowShortcutKeys ? dropDownItem.ShortcutKeyDisplayString ?? "" : "";
                Size shortcutSize = String.IsNullOrEmpty(shortcut)
                    ? Size.Empty
                    : TextRenderer.MeasureText(shortcut, e.TextFont, Size.Empty,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                int trailing = dropDownItem.DropDownItems.Count > 0 ? 30 : 12;
                int shortcutLeft = Math.Max(12, e.Item.Width - trailing - shortcutSize.Width);
                Color titleColor = dropDownItem.Enabled ? colors.TextColor : colors.DisabledColor;
                Color shortcutColor = dropDownItem.Enabled ? colors.CaptionColor : colors.DisabledCaptionColor;
                if (e.Text == dropDownItem.Text)
                {
                    int titleRight = String.IsNullOrEmpty(shortcut) ? e.Item.Width - trailing : shortcutLeft - 12;
                    Rectangle titleBounds = new Rectangle(12, 0, Math.Max(1, titleRight - 12), e.Item.Height);
                    TextRenderer.DrawText(e.Graphics, dropDownItem.Text, e.TextFont, titleBounds, titleColor,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter);
                    return;
                }
                if (e.Text == shortcut && !String.IsNullOrEmpty(shortcut))
                {
                    Rectangle shortcutBounds = new Rectangle(shortcutLeft, 0, shortcutSize.Width, e.Item.Height);
                    TextRenderer.DrawText(e.Graphics, shortcut, e.TextFont, shortcutBounds, shortcutColor,
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
                }
                return;
            }
            if (e.ToolStrip is DesktopTitleStrip && e.Item.Name.StartsWith("nav-"))
            {
                Color color = !e.Item.Enabled ? (dark ? Color.FromArgb(77, 77, 77) : Color.FromArgb(184, 184, 184))
                    : e.Item.Selected || e.Item.Pressed ? (dark ? Color.FromArgb(224, 224, 224) : Color.FromArgb(40, 40, 40))
                    : dark ? Color.FromArgb(151, 151, 151) : Color.FromArgb(103, 103, 103);
                float x = e.Item.Width / 2F, y = e.Item.Height / 2F;
                using (Pen pen = new Pen(color, 1.1F))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    pen.LineJoin = LineJoin.Round;
                    SmoothingMode previous = e.Graphics.SmoothingMode;
                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    if (e.Item.Name == "nav-sidebar")
                    {
                        using (GraphicsPath outline = RoundedRectangle(new Rectangle((int)x - 6, (int)y - 5, 12, 10), 2))
                            e.Graphics.DrawPath(pen, outline);
                        e.Graphics.DrawLine(pen, x - 2, y - 5, x - 2, y + 5);
                    }
                    else
                    {
                        float direction = e.Item.Name == "nav-back" ? -1 : 1;
                        e.Graphics.DrawLine(pen, x - 5, y, x + 5, y);
                        e.Graphics.DrawLine(pen, x + direction * 5, y, x, y - 4);
                        e.Graphics.DrawLine(pen, x + direction * 5, y, x, y + 4);
                    }
                    e.Graphics.SmoothingMode = previous;
                }
                return;
            }
            if (e.ToolStrip is DesktopTitleStrip)
                e.TextColor = e.Item.Name == "caption-close" && e.Item.Selected ? Color.White
                    : e.Item.Selected ? (dark ? Color.White : Color.FromArgb(30, 30, 32))
                    : dark ? Color.FromArgb(155, 155, 155) : Color.FromArgb(96, 96, 96);
            base.OnRenderItemText(e);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            if (IsDesktopDropDown(e.Item.Owner))
            {
                ToolStripMenuItem dropDownItem = e.Item as ToolStripMenuItem;
                Color glyph = dropDownItem != null && dropDownItem.Enabled ? colors.TextColor : colors.DisabledColor;
                Rectangle arrowBounds = new Rectangle(Math.Max(0, e.Item.Width - 24),
                    Math.Max(0, (e.Item.Height - 12) / 2), 12, 12);
                ControlPaint.DrawMenuGlyph(e.Graphics, arrowBounds, MenuGlyph.Arrow, glyph,
                    e.Item.Selected ? colors.SelectedColor : colors.SurfaceColor);
                return;
            }
            base.OnRenderArrow(e);
        }
    }

    internal sealed class DesktopDropDown : ToolStripDropDownMenu
    {
        internal DesktopDropDown() { DropShadowEnabled = false; }
        protected override Padding DefaultPadding { get { return new Padding(0, 6, 0, 6); } }
    }

    internal sealed class DesktopMenuItem : ToolStripMenuItem
    {
        internal DesktopMenuItem(string text) : base(text) { }
        protected override void OnMouseEnter(EventArgs e)
        {
            // ToolStripMenuItem starts its auto-expand timer here. Selection is
            // painted by the strip; clicks and keyboard navigation retain native handling.
            Invalidate();
        }
    }

    internal sealed class DesktopTitleStrip : MenuStrip
    {
        internal readonly Font CaptionFont = new Font("Segoe MDL2 Assets", 8.5F);
        internal readonly Font MenuFont = new Font("Microsoft YaHei UI", 9F);
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing) CaptionFont.Dispose();
            if (disposing) MenuFont.Dispose();
        }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0084)
            {
                long position = message.LParam.ToInt64();
                Point point = PointToClient(new Point((short)position, (short)(position >> 16)));
                int border = Math.Max(4, (int)Math.Ceiling(4 * DeviceDpi / 96.0));
                if (GetItemAt(point) == null || (FindForm().WindowState == FormWindowState.Normal
                    && (point.Y < border || point.X < border || point.X >= Width - border)))
                { message.Result = new IntPtr(-1); return; }
            }
            base.WndProc(ref message);
        }
    }

    internal sealed class DesktopContentPanel : Panel
    {
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0084)
            {
                long position = message.LParam.ToInt64();
                Point point = PointToClient(new Point((short)position, (short)(position >> 16)));
                if (ClientRectangle.Contains(point) && !DisplayRectangle.Contains(point))
                {
                    // The reserved border belongs to the top-level sizing frame.
                    message.Result = new IntPtr(-1); // HTTRANSPARENT
                    return;
                }
            }
            base.WndProc(ref message);
        }
    }

}
