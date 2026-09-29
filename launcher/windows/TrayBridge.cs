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
    internal sealed class TrayBridgeSession
    {
        public string id { get; set; }
        public string title { get; set; }
        public long updatedAt { get; set; }
        public bool running { get; set; }
        public bool completed { get; set; }
        public string finalReply { get; set; }
        public string pendingInteraction { get; set; }
        public string pendingInteractionKey { get; set; }
        public string pendingInteractionPrompt { get; set; }
        public List<string> pendingInteractionOptions { get; set; }
        public string agentPreset { get; set; }
    }

    internal sealed class TrayBridgeState
    {
        public string type { get; set; }
        public int schemaVersion { get; set; }
        public string locale { get; set; }
        public string theme { get; set; }
        public string themePreference { get; set; }
        public string currentSessionId { get; set; }
        public bool hasRunningSession { get; set; }
        public bool canGoBack { get; set; }
        public bool canGoForward { get; set; }
        public List<TrayBridgeSession> sessions { get; set; }
    }

}
