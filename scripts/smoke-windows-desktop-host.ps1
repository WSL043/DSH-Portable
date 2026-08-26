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
$BrowserState = Join-Path $Root 'data\runtime\browser.json'
$WorkspaceMarker = Join-Path $Root 'workspace\desktop-host-smoke.txt'
$HomeMarker = Join-Path $Root 'data\dsh-home\desktop-host-smoke.txt'
$LauncherSettings = Join-Path $Root 'data\launcher-settings.json'
$LauncherLog = Join-Path $Root 'data\logs\launcher.log'
$LauncherLogOffset = if (Test-Path -LiteralPath $LauncherLog) { (Get-Item -LiteralPath $LauncherLog).Length } else { 0L }

foreach ($File in @(
    $StartExe,
    $PortableNode,
    $PortableCli,
    (Join-Path $Root 'Microsoft.Web.WebView2.Core.dll'),
    (Join-Path $Root 'Microsoft.Web.WebView2.WinForms.dll'),
    (Join-Path $Root 'WebView2Loader.dll')
)) {
    if (-not (Test-Path -LiteralPath $File)) { throw "Portable file is missing: $File" }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WindowAppIdentity {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IntPtr propertyStore);

    [DllImport("ole32.dll", EntryPoint = "PropVariantClear")]
    private static extern int PropVariantClear(IntPtr value);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetValueDelegate(IntPtr self, IntPtr key, IntPtr value);

    public static string GetAppUserModelId(IntPtr hwnd) {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IntPtr store;
        int result = SHGetPropertyStoreForWindow(hwnd, ref iid, out store);
        if (result != 0) Marshal.ThrowExceptionForHR(result);
        IntPtr key = Marshal.AllocCoTaskMem(20);
        IntPtr value = Marshal.AllocCoTaskMem(24);
        byte[] formatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3").ToByteArray();
        Marshal.Copy(formatId, 0, key, 16);
        Marshal.WriteInt32(key, 16, 5);
        for (int index = 0; index < 24; index++) Marshal.WriteByte(value, index, 0);
        try {
            IntPtr vtable = Marshal.ReadIntPtr(store);
            IntPtr method = Marshal.ReadIntPtr(vtable, 5 * IntPtr.Size);
            GetValueDelegate getValue = (GetValueDelegate)Marshal.GetDelegateForFunctionPointer(method, typeof(GetValueDelegate));
            result = getValue(store, key, value);
            if (result != 0) Marshal.ThrowExceptionForHR(result);
            IntPtr text = Marshal.ReadIntPtr(value, 8);
            return text == IntPtr.Zero ? "" : Marshal.PtrToStringUni(text);
        } finally {
            PropVariantClear(value);
            Marshal.FreeCoTaskMem(value);
            Marshal.FreeCoTaskMem(key);
            Marshal.Release(store);
        }
    }
}
'@

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $WorkspaceMarker), (Split-Path -Parent $HomeMarker) | Out-Null
[System.IO.File]::WriteAllText($LauncherSettings, '{"schemaVersion":1,"closeBehavior":"tray"}', [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($WorkspaceMarker, 'workspace survives native host shutdown', [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($HomeMarker, 'home survives native host shutdown', [System.Text.UTF8Encoding]::new($false))
$WorkspaceDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $WorkspaceMarker).Hash
$HomeDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $HomeMarker).Hash
$Process = $null
$StopProcess = $null
$RestoreProcess = $null
$ExplicitExitClock = $null
$CloseToExitClock = $null

function Get-ProductStatus {
    param([int]$TimeoutSeconds = 15)

    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        # The native host deliberately keeps launcher.lock until its graceful
        # shutdown has completely committed. Treat that short overlap as a
        # transient state instead of turning it into a false lifecycle failure.
        $PreviousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $Lines = @(& $PortableNode $PortableCli status --json 2>&1 | ForEach-Object { [string]$_ })
            $ExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $PreviousErrorActionPreference
        }
        $Raw = ($Lines -join [Environment]::NewLine).Trim()
        if ($ExitCode -eq 0) {
            return [pscustomobject]@{
                ExitCode = 0
                Raw = $Raw
                Status = ($Raw | ConvertFrom-Json).status
            }
        }
        if ($Raw -notmatch 'Another portable launcher is already starting or stopping DSH' -or [DateTime]::UtcNow -ge $Deadline) {
            return [pscustomobject]@{ ExitCode = $ExitCode; Raw = $Raw; Status = '' }
        }
        Start-Sleep -Milliseconds 100
    } while ($true)
}

try {
    $ColdStartClock = [System.Diagnostics.Stopwatch]::StartNew()
    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $StartExe
    $StartInfo.WorkingDirectory = $Root
    $StartInfo.UseShellExecute = $false
    $StartInfo.EnvironmentVariables['DSH_PORTABLE_SKIP_UPDATE_CHECK'] = '1'
    $StartInfo.EnvironmentVariables['DSH_PORTABLE_STARTUP_HOLD_MS'] = '1200'
    $Process = [System.Diagnostics.Process]::Start($StartInfo)

    $StartupDeadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 50
        $Process.Refresh()
        if ($Process.HasExited) { throw "DeepSeek-Herness.exe exited during the native loading view: $($Process.ExitCode)" }
    } while ($Process.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $StartupDeadline)
    if ($Process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'The native loading window did not appear.' }
    $StartupRect = [WindowAppIdentity+Rect]::new()
    if (-not [WindowAppIdentity]::GetWindowRect($Process.MainWindowHandle, [ref]$StartupRect)) { throw 'Could not measure the native loading window.' }
    $StartupWidth = $StartupRect.Right - $StartupRect.Left
    $StartupHeight = $StartupRect.Bottom - $StartupRect.Top
    if ($StartupWidth -gt 700 -or $StartupHeight -gt 420) {
        throw "The native loading view contains excessive blank space: ${StartupWidth}x${StartupHeight}"
    }

    $Deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 250
        $Process.Refresh()
        if ($Process.HasExited) { throw "DeepSeek-Herness.exe exited before its desktop window appeared: $($Process.ExitCode)" }
        $DesktopRect = [WindowAppIdentity+Rect]::new()
        $DesktopWidth = 0
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero -and [WindowAppIdentity]::GetWindowRect($Process.MainWindowHandle, [ref]$DesktopRect)) {
            $DesktopWidth = $DesktopRect.Right - $DesktopRect.Left
        }
        $LaunchLock = Join-Path $Root 'data\runtime\launcher.lock'
        $EmbeddedRenderers = @(
            Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -match '(?i)--embedded-browser-webview=1' -and $_.CommandLine -match '(?i)--webview-exe-name=DeepSeek-Herness\.exe' }
        )
    } while (($Process.MainWindowHandle -eq [IntPtr]::Zero -or $DesktopWidth -lt 900 -or $EmbeddedRenderers.Count -eq 0 -or (Test-Path -LiteralPath $LaunchLock)) -and [DateTime]::UtcNow -lt $Deadline)

    $Status = Get-ProductStatus

    if ($Process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'DeepSeek-Herness.exe did not create a native top-level window.' }
    if ($Status.Status -ne 'running') { throw 'DeepSeek Harness did not become ready behind the desktop host.' }
    if ($Process.MainWindowTitle -notlike 'DeepSeek-Herness*') { throw "Unexpected native window title: $($Process.MainWindowTitle)" }

    $AppId = [WindowAppIdentity]::GetAppUserModelId($Process.MainWindowHandle)
    if ($AppId -ne 'io.github.wsl043.dsh-portable') { throw "Unexpected AppUserModelID: $AppId" }
    if (Test-Path -LiteralPath $BrowserState) { throw 'Native desktop startup created legacy browser.json ownership state.' }

    $AppModeBrowsers = @(
        Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match '(?i)--app=' -or $_.CommandLine -match [regex]::Escape((Join-Path $Root 'data\browser')) }
    )
    if ($AppModeBrowsers.Count -ne 0) {
        throw "Native desktop startup launched an Edge/Chrome app-mode window: $($AppModeBrowsers.ProcessId -join ', ')"
    }
    if ($EmbeddedRenderers.Count -eq 0) { throw 'The native window did not initialize its embedded WebView2 renderer.' }
    $ColdStartClock.Stop()

    # Resize through Win32 without desktop input. Closing to the tray must save
    # these bounds so a later native-host process can restore them.
    $PersistedWidth = 960
    $PersistedHeight = 680
    if (-not [WindowAppIdentity]::SetWindowPos(
        $Process.MainWindowHandle,
        [IntPtr]::Zero,
        $DesktopRect.Left,
        $DesktopRect.Top,
        $PersistedWidth,
        $PersistedHeight,
        0x0014
    )) { throw 'Could not set deterministic desktop bounds for the persistence check.' }
    Start-Sleep -Milliseconds 250

    # Default close behavior is minimized to tray: closing the window must keep
    # the native host and running task alive until the user explicitly exits.
    $DesktopHandle = $Process.MainWindowHandle
    if (-not $Process.CloseMainWindow()) { throw 'CloseMainWindow could not request the default tray close.' }
    Start-Sleep -Seconds 2
    $Process.Refresh()
    if ($Process.HasExited) { throw 'Default window close exited instead of minimizing to tray.' }
    if ([WindowAppIdentity]::IsWindowVisible($DesktopHandle)) { throw 'Default window close left the desktop window visible.' }
    $WindowStateFile = Join-Path $Root 'data\window-state.json'
    if (-not (Test-Path -LiteralPath $WindowStateFile)) { throw 'Closing to the tray did not persist native window state.' }
    $SavedWindowState = Get-Content -Raw -LiteralPath $WindowStateFile | ConvertFrom-Json
    if ($SavedWindowState.width -ne $PersistedWidth -or $SavedWindowState.height -ne $PersistedHeight) {
        throw "Persisted native bounds were $($SavedWindowState.width)x$($SavedWindowState.height), expected ${PersistedWidth}x${PersistedHeight}."
    }
    $StillRunning = Get-ProductStatus
    if ($StillRunning.Status -ne 'running') { throw 'Minimizing to tray stopped the DSH backend.' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $WorkspaceMarker).Hash -ne $WorkspaceDigest) { throw 'Workspace data changed during native host shutdown.' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $HomeMarker).Hash -ne $HomeDigest) { throw 'DSH_HOME data changed during native host shutdown.' }

    # Starting the same executable again restores the existing tray instance;
    # it must not create a second long-running desktop host.
    $RestoreProcess = [System.Diagnostics.Process]::Start($StartInfo)
    if (-not $RestoreProcess.WaitForExit(15000)) { throw 'Second launch did not hand off to the existing tray instance.' }
    if ($RestoreProcess.ExitCode -ne 0) { throw "Second launch failed to restore the tray instance: $($RestoreProcess.ExitCode)" }
    $RestoreDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 100
        $Process.Refresh()
        $RestoredHandle = $Process.MainWindowHandle
    } while (($RestoredHandle -eq [IntPtr]::Zero -or -not [WindowAppIdentity]::IsWindowVisible($RestoredHandle)) -and [DateTime]::UtcNow -lt $RestoreDeadline)
    if ($RestoredHandle -eq [IntPtr]::Zero -or -not [WindowAppIdentity]::IsWindowVisible($RestoredHandle)) { throw 'Second launch did not restore the existing desktop window.' }
    $OwnedHosts = @(
        Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek-Herness.exe'" -ErrorAction SilentlyContinue |
            Where-Object { [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq $StartExe }
    )
    if ($OwnedHosts.Count -ne 1) { throw "Second launch left $($OwnedHosts.Count) owned desktop hosts running." }
    if (-not $Process.CloseMainWindow()) { throw 'Restored window could not return to the tray.' }
    Start-Sleep -Milliseconds 500
    if ([WindowAppIdentity]::IsWindowVisible($RestoredHandle)) { throw 'Restored window remained visible after closing to tray.' }

    # The same executable owns explicit exit; there is no redundant Stop EXE.
    $StopStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StopStartInfo.FileName = $StartExe
    $StopStartInfo.Arguments = 'stop --no-browser --json'
    $StopStartInfo.WorkingDirectory = $Root
    $StopStartInfo.UseShellExecute = $false
    $ExplicitExitClock = [System.Diagnostics.Stopwatch]::StartNew()
    $StopProcess = [System.Diagnostics.Process]::Start($StopStartInfo)
    if (-not $StopProcess.WaitForExit(60000)) { throw 'Explicit exit command did not finish within 60 seconds.' }
    if (-not $Process.WaitForExit(45000)) { throw 'Explicit exit left the native desktop host running.' }
    $StoppedByLauncher = (Get-ProductStatus).Status
    if ($StoppedByLauncher -ne 'stopped') { throw 'Explicit exit left the DSH backend running.' }
    $ExplicitExitClock.Stop()

    # The persisted setting can opt into close-to-exit without changing system settings.
    [System.IO.File]::WriteAllText($LauncherSettings, '{"schemaVersion":1,"closeBehavior":"exit"}', [System.Text.UTF8Encoding]::new($false))
    $Process = [System.Diagnostics.Process]::Start($StartInfo)
    $ExitDeadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 250
        $Process.Refresh()
        if ($Process.HasExited) { throw "Close-to-exit host ended before becoming ready: $($Process.ExitCode)" }
        $ExitReady = (Get-ProductStatus).Status
        $ExitRect = [WindowAppIdentity+Rect]::new()
        $ExitWidth = 0
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero -and [WindowAppIdentity]::GetWindowRect($Process.MainWindowHandle, [ref]$ExitRect)) {
            $ExitWidth = $ExitRect.Right - $ExitRect.Left
        }
    } while (($Process.MainWindowHandle -eq [IntPtr]::Zero -or $ExitWidth -lt 900 -or $ExitReady -ne 'running') -and [DateTime]::UtcNow -lt $ExitDeadline)
    $RestoredStateRect = [WindowAppIdentity+Rect]::new()
    if (-not [WindowAppIdentity]::GetWindowRect($Process.MainWindowHandle, [ref]$RestoredStateRect)) {
        throw 'Could not read the restored native window bounds.'
    }
    $RestoredStateWidth = $RestoredStateRect.Right - $RestoredStateRect.Left
    $RestoredStateHeight = $RestoredStateRect.Bottom - $RestoredStateRect.Top
    if ([Math]::Abs($RestoredStateWidth - $PersistedWidth) -gt 4 -or [Math]::Abs($RestoredStateHeight - $PersistedHeight) -gt 4) {
        throw "Native window bounds were not restored after restart: ${RestoredStateWidth}x${RestoredStateHeight}."
    }
    $CloseToExitClock = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not $Process.CloseMainWindow()) { throw 'Close-to-exit could not request a native close.' }
    if (-not $Process.WaitForExit(45000)) { throw 'Close-to-exit setting left the host running.' }
    if ((Get-ProductStatus).Status -ne 'stopped') { throw 'Close-to-exit setting left the backend running.' }
    $CloseToExitClock.Stop()

    if (Test-Path -LiteralPath $LauncherLog) {
        $Stream = [System.IO.FileStream]::new($LauncherLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
        try {
            [void]$Stream.Seek([Math]::Min($LauncherLogOffset, $Stream.Length), [System.IO.SeekOrigin]::Begin)
            $Reader = [System.IO.StreamReader]::new($Stream, [System.Text.Encoding]::UTF8, $true, 4096, $true)
            try { $LifecycleLog = $Reader.ReadToEnd() } finally { $Reader.Dispose() }
        } finally { $Stream.Dispose() }
        if ($LifecycleLog -match 'watchdog-fired|taskkill exit=') {
            throw "Native desktop shutdown used forced WebView2 termination:`n$LifecycleLog"
        }
        if ($LifecycleLog -notmatch 'controller-close-requested' -or $LifecycleLog -notmatch 'browser-process-exited|process-tree-empty-without-event') {
            throw "Native desktop shutdown did not prove WebView2 resource release:`n$LifecycleLog"
        }
    } else {
        throw 'Native desktop shutdown did not write launcher lifecycle evidence.'
    }

    [pscustomobject]@{
        Root = $Root
        AppUserModelID = $AppId
        MainWindowHandle = $Process.MainWindowHandle
        EmbeddedWebView2Processes = $EmbeddedRenderers.Count
        ColdStartSeconds = [Math]::Round($ColdStartClock.Elapsed.TotalSeconds, 3)
        ExplicitExitSeconds = [Math]::Round($ExplicitExitClock.Elapsed.TotalSeconds, 3)
        CloseToExitSeconds = [Math]::Round($CloseToExitClock.Elapsed.TotalSeconds, 3)
        Status = 'passed'
    }
} finally {
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        & $PortableNode $PortableCli stop --no-browser --json *> $null
        if ($Process -and -not $Process.HasExited) { & taskkill.exe /PID $Process.Id /T /F *> $null }
        if ($StopProcess -and -not $StopProcess.HasExited) { & taskkill.exe /PID $StopProcess.Id /T /F *> $null }
        if ($RestoreProcess -and -not $RestoreProcess.HasExited) { & taskkill.exe /PID $RestoreProcess.Id /T /F *> $null }
    } finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
}
