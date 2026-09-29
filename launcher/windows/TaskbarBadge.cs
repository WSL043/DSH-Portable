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
    internal static class TaskbarBadge
    {
        [ComImport, Guid("56FDF344-FD6D-11D0-958A-006097C9A090"), ClassInterface(ClassInterfaceType.None)]
        private class TaskbarList { }

        [ComImport, Guid("EA1AFB91-9E28-4B86-90E9-9E9F8A5EEA84"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface ITaskbarList3
        {
            void HrInit();
            void AddTab(IntPtr hwnd);
            void DeleteTab(IntPtr hwnd);
            void ActivateTab(IntPtr hwnd);
            void SetActiveAlt(IntPtr hwnd);
            void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
            void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);
            void SetProgressState(IntPtr hwnd, int flags);
            void RegisterTab(IntPtr tab, IntPtr mdi);
            void UnregisterTab(IntPtr tab);
            void SetTabOrder(IntPtr tab, IntPtr insertBefore);
            void SetTabActive(IntPtr tab, IntPtr mdi, uint reserved);
            void ThumbBarAddButtons(IntPtr hwnd, uint count, IntPtr buttons);
            void ThumbBarUpdateButtons(IntPtr hwnd, uint count, IntPtr buttons);
            void ThumbBarSetImageList(IntPtr hwnd, IntPtr imageList);
            void SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr icon);

        internal static void SetOverlayIcon(IntPtr window, int count)
        {
            if (window == IntPtr.Zero) return;
            ITaskbarList3 taskbar = null;
            IntPtr iconHandle = IntPtr.Zero;
            try
            {
                taskbar = (ITaskbarList3)new TaskbarList();
                taskbar.HrInit();
                if (count <= 0)
                {
                    taskbar.SetOverlayIcon(window, IntPtr.Zero, String.Empty);
                    return;
                }
                using (Bitmap bitmap = new Bitmap(32, 32))
                using (Graphics graphics = Graphics.FromImage(bitmap))
                using (Brush badge = new SolidBrush(Color.FromArgb(220, 46, 56)))
                using (Font font = new Font("Segoe UI", count > 9 ? 11F : 15F, FontStyle.Bold, GraphicsUnit.Pixel))
                {
                    graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.Clear(Color.Transparent);
                    graphics.FillEllipse(badge, 1, 1, 30, 30);
                    string text = count > 9 ? "9+" : count.ToString(CultureInfo.InvariantCulture);
                    TextRenderer.DrawText(graphics, text, font, new Rectangle(0, 0, 32, 32), Color.White,
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                    iconHandle = bitmap.GetHicon();
                }
                taskbar.SetOverlayIcon(window, iconHandle, count.ToString(CultureInfo.InvariantCulture) + " completed tasks");
            }
            catch { }
            finally
            {
                if (iconHandle != IntPtr.Zero) DestroyIcon(iconHandle);
                if (taskbar != null && Marshal.IsComObject(taskbar)) Marshal.ReleaseComObject(taskbar);
            }
        }
    }

}
