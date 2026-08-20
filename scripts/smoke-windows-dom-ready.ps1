[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$StartExe = Join-Path $Root 'DeepSeek-Herness.exe'
$PortableNode = Join-Path $Root 'runtime\node\node.exe'
$PortableCli = Join-Path $Root 'launcher\portable-cli.mjs'
$Process = $null

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

public sealed class DshStalledHttpServer : IDisposable {
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    private readonly TcpListener listener;
    private readonly List<TcpClient> clients = new List<TcpClient>();
    private bool stopped;

    public DshStalledHttpServer() {
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        Task.Run((Func<Task>)AcceptLoop);
    }

    public int Port { get; private set; }

    public static int WindowWidth(int expectedProcessId) {
        int widest = 0;
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != (uint)expectedProcessId) return true;
            Rect rect;
            if (GetWindowRect(window, out rect)) widest = Math.Max(widest, rect.Right - rect.Left);
            return true;
        }, IntPtr.Zero);
        return widest;
    }

    private async Task AcceptLoop() {
        while (!stopped) {
            try {
                TcpClient client = await listener.AcceptTcpClientAsync();
                lock (clients) clients.Add(client);
            } catch (ObjectDisposedException) {
                return;
            } catch (SocketException) {
                if (stopped) return;
                throw;
            }
        }
    }

    public void Dispose() {
        stopped = true;
        listener.Stop();
        lock (clients) {
            foreach (TcpClient client in clients) client.Dispose();
            clients.Clear();
        }
    }
}
'@

$Server = [DshStalledHttpServer]::new()
try {
    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $StartExe
    $StartInfo.WorkingDirectory = $Root
    $StartInfo.UseShellExecute = $false
    $StartInfo.EnvironmentVariables['DSH_PORTABLE_SKIP_UPDATE_CHECK'] = '1'
    $StartInfo.EnvironmentVariables['DSH_PORTABLE_TEST_HIDDEN'] = '1'
    $StartInfo.EnvironmentVariables['DSH_PORTABLE_TEST_STALLED_RESOURCE_URL'] = "http://127.0.0.1:$($Server.Port)/never-finishes.png"

    $Clock = [System.Diagnostics.Stopwatch]::StartNew()
    $Process = [System.Diagnostics.Process]::Start($StartInfo)
    $Deadline = [DateTime]::UtcNow.AddSeconds(25)
    $DesktopWidth = 0
    do {
        Start-Sleep -Milliseconds 100
        $Process.Refresh()
        if ($Process.HasExited) { throw "Desktop host exited before the usable DOM appeared: $($Process.ExitCode)" }
        $DesktopWidth = [DshStalledHttpServer]::WindowWidth($Process.Id)
    } while ($DesktopWidth -lt 900 -and [DateTime]::UtcNow -lt $Deadline)
    $Clock.Stop()

    if ($DesktopWidth -lt 900) {
        throw 'The desktop host kept waiting for NavigationCompleted after the workspace DOM was usable.'
    }
    if ($Clock.Elapsed.TotalSeconds -ge 25) {
        throw "The usable-DOM gate took $([Math]::Round($Clock.Elapsed.TotalSeconds, 3)) seconds."
    }

    [pscustomobject]@{
        Root = $Root
        StalledResource = $StartInfo.EnvironmentVariables['DSH_PORTABLE_TEST_STALLED_RESOURCE_URL']
        WorkspaceVisibleSeconds = [Math]::Round($Clock.Elapsed.TotalSeconds, 3)
        Status = 'passed'
    }
} finally {
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        & $PortableNode $PortableCli stop --no-browser --json *> $null
        if ($Process -and -not $Process.HasExited) { & taskkill.exe /PID $Process.Id /T /F *> $null }
    } finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
        $Server.Dispose()
    }
}
