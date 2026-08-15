[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$StartExe = Join-Path $Root 'DeepSeek-Herness.exe'
$StopExe = Join-Path $Root 'Stop DeepSeek-Herness.exe'
$PortableNode = Join-Path $Root 'runtime\node\node.exe'
$PortableCli = Join-Path $Root 'launcher\portable-cli.mjs'
$BrowserState = Join-Path $Root 'data\runtime\browser.json'
$WorkspaceMarker = Join-Path $Root 'workspace\desktop-host-smoke.txt'
$HomeMarker = Join-Path $Root 'data\dsh-home\desktop-host-smoke.txt'

foreach ($File in @(
    $StartExe,
    $StopExe,
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
[System.IO.File]::WriteAllText($WorkspaceMarker, 'workspace survives native host shutdown', [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($HomeMarker, 'home survives native host shutdown', [System.Text.UTF8Encoding]::new($false))
$WorkspaceDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $WorkspaceMarker).Hash
$HomeDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $HomeMarker).Hash
$Process = $null
$StopProcess = $null

try {
    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $StartExe
    $StartInfo.WorkingDirectory = $Root
    $StartInfo.UseShellExecute = $false
    $StartInfo.EnvironmentVariables['DSH_PORTABLE_SKIP_UPDATE_CHECK'] = '1'
    $Process = [System.Diagnostics.Process]::Start($StartInfo)

    $Deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 250
        $Process.Refresh()
        if ($Process.HasExited) { throw "DeepSeek-Herness.exe exited before its desktop window appeared: $($Process.ExitCode)" }
        $LaunchLock = Join-Path $Root 'data\runtime\launcher.lock'
        $EmbeddedRenderers = @(
            Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -match '(?i)--embedded-browser-webview=1' -and $_.CommandLine -match '(?i)--webview-exe-name=DeepSeek-Herness\.exe' }
        )
    } while (($Process.MainWindowHandle -eq [IntPtr]::Zero -or $EmbeddedRenderers.Count -eq 0 -or (Test-Path -LiteralPath $LaunchLock)) -and [DateTime]::UtcNow -lt $Deadline)

    $StatusJson = & $PortableNode $PortableCli status --json
    $Status = if ($LASTEXITCODE -eq 0) { $StatusJson | ConvertFrom-Json } else { $null }

    if ($Process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'DeepSeek-Herness.exe did not create a native top-level window.' }
    if ($Status.status -ne 'running') { throw 'DeepSeek Harness did not become ready behind the desktop host.' }
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

    if (-not $Process.CloseMainWindow()) { throw 'CloseMainWindow could not request a graceful desktop close.' }
    if (-not $Process.WaitForExit(45000)) { throw 'The native desktop host did not exit after closing its window.' }

    $StoppedJson = & $PortableNode $PortableCli status --json
    $StoppedExitCode = $LASTEXITCODE
    $StoppedStatus = if ($StoppedExitCode -eq 0) { ($StoppedJson | ConvertFrom-Json).status } else { '' }
    if ($StoppedExitCode -ne 0 -or $StoppedStatus -ne 'stopped') {
        throw "Closing the native desktop window did not stop DeepSeek Harness (exit=$StoppedExitCode, status=$StoppedStatus, output=$StoppedJson)."
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $WorkspaceMarker).Hash -ne $WorkspaceDigest) { throw 'Workspace data changed during native host shutdown.' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $HomeMarker).Hash -ne $HomeDigest) { throw 'DSH_HOME data changed during native host shutdown.' }

    $Process = [System.Diagnostics.Process]::Start($StartInfo)
    $StopDeadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 250
        $Process.Refresh()
        if ($Process.HasExited) { throw "DeepSeek-Herness.exe exited before the Stop launcher test: $($Process.ExitCode)" }
        $RunningJson = & $PortableNode $PortableCli status --json
        $RunningStatus = if ($LASTEXITCODE -eq 0) { ($RunningJson | ConvertFrom-Json).status } else { '' }
    } while (($Process.MainWindowHandle -eq [IntPtr]::Zero -or $RunningStatus -ne 'running') -and [DateTime]::UtcNow -lt $StopDeadline)
    if ($Process.MainWindowHandle -eq [IntPtr]::Zero -or $RunningStatus -ne 'running') {
        throw 'The second native desktop instance did not become ready for the Stop launcher test.'
    }
    $StopStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StopStartInfo.FileName = $StopExe
    $StopStartInfo.WorkingDirectory = $Root
    $StopStartInfo.UseShellExecute = $false
    $StopProcess = [System.Diagnostics.Process]::Start($StopStartInfo)
    if (-not $StopProcess.WaitForExit(60000)) { throw 'Stop DeepSeek-Herness.exe did not exit within 60 seconds.' }
    if (-not $Process.WaitForExit(45000)) { throw 'Stop DeepSeek-Herness.exe left the native desktop host running.' }
    $StoppedByLauncherJson = & $PortableNode $PortableCli status --json
    $StoppedByLauncher = if ($LASTEXITCODE -eq 0) { ($StoppedByLauncherJson | ConvertFrom-Json).status } else { '' }
    if ($StoppedByLauncher -ne 'stopped') { throw 'Stop DeepSeek-Herness.exe left the DSH backend running.' }

    [pscustomobject]@{
        Root = $Root
        AppUserModelID = $AppId
        MainWindowHandle = $Process.MainWindowHandle
        EmbeddedWebView2Processes = $EmbeddedRenderers.Count
        Status = 'passed'
    }
} finally {
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        & $PortableNode $PortableCli stop --no-browser --json *> $null
        if ($Process -and -not $Process.HasExited) { & taskkill.exe /PID $Process.Id /T /F *> $null }
        if ($StopProcess -and -not $StopProcess.HasExited) { & taskkill.exe /PID $StopProcess.Id /T /F *> $null }
    } finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
}
