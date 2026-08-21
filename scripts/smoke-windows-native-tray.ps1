param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [string]$CaptureDirectory,
    [switch]$CaptureSelected
)

$ErrorActionPreference = 'Stop'
$ResolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$Launcher = Join-Path $ResolvedRoot 'DeepSeek-Herness.exe'
if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
    throw "DeepSeek-Herness.exe is missing: $Launcher"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshTrayCapture {
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr window, IntPtr deviceContext, uint flags);
}
'@
$Assembly = [Reflection.Assembly]::LoadFrom($Launcher)
$AllFields = [Reflection.BindingFlags]'Instance,Static,Public,NonPublic'
$InstanceMembers = [Reflection.BindingFlags]'Instance,NonPublic'
$WindowType = $Assembly.GetType('DshPortable.LauncherWindow', $true)
$StateType = $Assembly.GetType('DshPortable.TrayBridgeState', $true)
$SessionType = $Assembly.GetType('DshPortable.TrayBridgeSession', $true)
if ($Assembly.GetType('DshPortable.TrayTaskFlyout', $false)) {
    throw 'Rejected task-flyout type is still present in the compiled launcher'
}
$Constructor = $WindowType.GetConstructor($InstanceMembers, $null, [Type[]]@([string[]]), $null)
$ConstructorArgs = New-Object 'System.Object[]' 1
$ConstructorArgs[0] = [string[]]@('--desktop')
$Window = $Constructor.Invoke($ConstructorArgs)
$WindowType.GetField('root', $AllFields).SetValue($Window, $ResolvedRoot)
$InitialUpdateEnabled = $WindowType.GetMethod('LoadUpdateCheckEnabled', $InstanceMembers).Invoke($Window, $null)
$WindowType.GetField('updateCheckEnabled', $AllFields).SetValue($Window, $InitialUpdateEnabled)
if ($CaptureDirectory) {
    New-Item -ItemType Directory -Force -Path $CaptureDirectory | Out-Null
}

function Set-Property([Type]$Type, [object]$Target, [string]$Name, [object]$Value) {
    $Type.GetProperty($Name).SetValue($Target, $Value, $null)
}

function Add-Session([object]$List, [string]$Id, [string]$Title, [string]$Preset, [bool]$Running, [string]$Pending) {
    $Session = [Activator]::CreateInstance($SessionType, $true)
    Set-Property $SessionType $Session 'id' $Id
    Set-Property $SessionType $Session 'title' $Title
    Set-Property $SessionType $Session 'agentPreset' $Preset
    Set-Property $SessionType $Session 'running' $Running
    Set-Property $SessionType $Session 'pendingInteraction' $Pending
    $List.Add($Session)
}

try {
    $State = [Activator]::CreateInstance($StateType, $true)
    Set-Property $StateType $State 'type' 'dsh-portable/state'
    Set-Property $StateType $State 'schemaVersion' 1
    Set-Property $StateType $State 'currentSessionId' 'session-1'
    $ListType = [Collections.Generic.List``1].MakeGenericType($SessionType)
    $Sessions = [Activator]::CreateInstance($ListType)
    Add-Session $Sessions 'session-1' 'Implement native downloads' 'coding' $true ''
    Add-Session $Sessions 'session-2' 'Review a waiting task' 'plan' $false 'approval'
    Add-Session $Sessions 'session-3' 'Verify the Linux package' '' $false ''
    Add-Session $Sessions 'session-4' 'Prepare release notes' 'review' $false ''
    Set-Property $StateType $State 'sessions' $Sessions

    $WindowType.GetField('trayState', $AllFields).SetValue($Window, $State)
    $WindowType.GetField('trayBridgeReady', $AllFields).SetValue($Window, $true)

    $LongTitle = [string]::Concat((1..29 | ForEach-Object { "e$([char]0x0301)" }))
    $ShortenedTitle = [string]$WindowType.GetMethod('MenuTitle', $AllFields).Invoke($null, @($LongTitle))
    if ([Globalization.StringInfo]::ParseCombiningCharacters($ShortenedTitle.TrimEnd([char]0x2026)).Length -ne 28 -or -not $ShortenedTitle.EndsWith([char]0x2026)) {
        throw 'Tray title truncation must preserve exactly 28 complete text elements'
    }

    $ZhRunning = -join ([char[]]@(0x8FD0, 0x884C, 0x4E2D))
    $ZhWaiting = -join ([char[]]@(0x5F85, 0x56DE, 0x590D))
    $ZhReview = -join ([char[]]@(0x590D, 0x6838))
    $ZhCompleted = -join ([char[]]@(0x5DF2, 0x5B8C, 0x6210))
    $ZhMore = -join ([char[]]@(0x66F4, 0x591A))
    $ZhNew = -join ([char[]]@(0x65B0, 0x4F1A, 0x8BDD))
    $ZhFeedback = -join ([char[]]@(0x53CD, 0x9988, 0x95EE, 0x9898))
    $ZhExit = (-join ([char[]]@(0x9000, 0x51FA))) + ' DeepSeek Harness'

    foreach ($Case in @(
        @{ Locale = 'en'; Theme = 'light'; Running = 'Running'; Waiting = 'Needs input'; Completed = 'Completed'; More = 'More'; New = 'New session'; Feedback = 'Report a problem'; Exit = 'Exit DeepSeek Harness' },
        @{ Locale = 'zh'; Theme = 'dark'; Running = $ZhRunning; Waiting = $ZhWaiting; Completed = $ZhCompleted; More = $ZhMore; New = $ZhNew; Feedback = $ZhFeedback; Exit = $ZhExit }
    )) {
        Set-Property $StateType $State 'locale' $Case.Locale
        Set-Property $StateType $State 'theme' $Case.Theme
        if ($Case.Locale -eq 'zh') {
            Set-Property $SessionType $Sessions[0] 'title' (-join ([char[]]@(0x6574,0x7406,0x672C,0x5468,0x66F4,0x65B0)))
            Set-Property $SessionType $Sessions[1] 'title' (-join ([char[]]@(0x4FEE,0x590D,0x63D2,0x4EF6,0x5B89,0x88C5)))
            Set-Property $SessionType $Sessions[2] 'title' (-join ([char[]]@(0x7814,0x7A76,0x7F13,0x5B58,0x7B56,0x7565)))
            Set-Property $SessionType $Sessions[3] 'title' (-join ([char[]]@(0x51C6,0x5907,0x53D1,0x5E03,0x8BF4,0x660E)))
        }
        $WindowType.GetField('uiLanguage', $AllFields).SetValue($null, $Case.Locale)
        $WindowType.GetField('trayTheme', $AllFields).SetValue($Window, $Case.Theme)
        $WindowType.GetMethod('RebuildTrayMenu', $InstanceMembers).Invoke($Window, $null) | Out-Null
        $Menu = [Windows.Forms.ContextMenuStrip]$WindowType.GetField('trayMenu', $AllFields).GetValue($Window)

        if ($Menu.Items.Count -ne 10) { throw "The tray menu must expose exactly ten bounded rows for $($Case.Locale)" }
        if ($Menu.Items[0].Text -notmatch 'DeepSeek Harness') { throw "Open command must be the first root item for $($Case.Locale)" }
        if ($Menu.Items[1] -isnot [Windows.Forms.ToolStripSeparator]) { throw "Open command separator is missing for $($Case.Locale)" }
        if ($Menu.Items[2].ShortcutKeyDisplayString.Trim() -ne $Case.Running) { throw "Running state is missing for $($Case.Locale)" }
        if ($Menu.Items[3].ShortcutKeyDisplayString -ne $Case.Waiting) { throw "Waiting state is missing for $($Case.Locale)" }
        if ($Menu.Items[4].ShortcutKeyDisplayString -ne $Case.Completed) { throw "Completed state is missing for $($Case.Locale)" }
        if ($Menu.Items[6] -isnot [Windows.Forms.ToolStripSeparator] -or $Menu.Items[8] -isnot [Windows.Forms.ToolStripSeparator]) {
            throw "Tray grouping is incorrect for $($Case.Locale)"
        }
        if ($Menu.Items[5].Text -ne $Case.More) { throw "More command is missing for $($Case.Locale)" }
        if ($Menu.Items[7].Text -ne $Case.New) { throw "New-session command is missing for $($Case.Locale)" }
        if ($Menu.Items[9].Text -ne $Case.Exit) { throw "Exit command is missing for $($Case.Locale)" }
        if ($Menu.Items[5].DropDownItems.Count -ne 8) { throw "More submenu must contain bounded overflow and direct settings commands" }
        if ($Menu.Items[5].DropDownItems[7].Text -ne $Case.Feedback) { throw "Feedback command must be in More for $($Case.Locale)" }
        foreach ($MoreItem in $Menu.Items[5].DropDownItems) {
            if ($MoreItem -is [Windows.Forms.ToolStripMenuItem] -and $MoreItem.DropDownItems.Count -ne 0) {
                throw "More submenu must stop at the second level"
            }
        }

        $Window.Hide()
        $Window.ShowInTaskbar = $false
        $WindowType.GetField('desktopReady', $AllFields).SetValue($Window, $true)
        $LeftClick = [Windows.Forms.MouseEventArgs]::new([Windows.Forms.MouseButtons]::Left, 1, 0, 0, 0)
        $WindowType.GetMethod('HandleTrayMouseUp', $InstanceMembers).Invoke($Window, @($null, $LeftClick)) | Out-Null
        [Windows.Forms.Application]::DoEvents()
        if (-not $Window.Visible -or -not $Window.ShowInTaskbar -or $Menu.Visible) {
            throw 'Left-click must restore the desktop window without opening the tray menu'
        }

        if ($Case.Locale -eq 'en') {
            $AutomaticItem = [Windows.Forms.ToolStripMenuItem]$WindowType.GetField('automaticUpdateCheckItem', $AllFields).GetValue($Window)
            $UpdateEnabledField = $WindowType.GetField('updateCheckEnabled', $AllFields)
            $SettingsPath = Join-Path $ResolvedRoot 'data\launcher-settings.json'
            if ([bool]$UpdateEnabledField.GetValue($Window) -or $AutomaticItem.ShortcutKeyDisplayString -ne 'Off') {
                throw 'Automatic update checks must default to Off until the user opts in'
            }
            $AutomaticItem.PerformClick()
            [Windows.Forms.Application]::DoEvents()
            if (-not [bool]$UpdateEnabledField.GetValue($Window) -or $AutomaticItem.ShortcutKeyDisplayString -ne 'On') {
                throw 'Automatic update check status did not change immediately after click'
            }
            if (-not (Test-Path -LiteralPath $SettingsPath) -or (Get-Content -Raw -LiteralPath $SettingsPath) -notmatch '"updateCheckEnabled":true') {
                throw 'Automatic update check preference was not saved'
            }

            $ReloadedWindow = $Constructor.Invoke($ConstructorArgs)
            try {
                $WindowType.GetField('root', $AllFields).SetValue($ReloadedWindow, $ResolvedRoot)
                $ReloadedEnabled = $WindowType.GetMethod('LoadUpdateCheckEnabled', $InstanceMembers).Invoke($ReloadedWindow, $null)
                $UpdateEnabledField.SetValue($ReloadedWindow, $ReloadedEnabled)
                $WindowType.GetMethod('RebuildTrayMenu', $InstanceMembers).Invoke($ReloadedWindow, $null) | Out-Null
                $ReloadedItem = [Windows.Forms.ToolStripMenuItem]$WindowType.GetField('automaticUpdateCheckItem', $AllFields).GetValue($ReloadedWindow)
                if (-not [bool]$UpdateEnabledField.GetValue($ReloadedWindow) -or $ReloadedItem.ShortcutKeyDisplayString -ne 'On') {
                    throw 'Automatic update check preference was not restored after restart'
                }
            }
            finally {
                $ReloadedWindow.Dispose()
            }

            $AutomaticItem.PerformClick()
            [Windows.Forms.Application]::DoEvents()
            if ([bool]$UpdateEnabledField.GetValue($Window) -or $AutomaticItem.ShortcutKeyDisplayString -ne 'Off') {
                throw 'Automatic update check preference could not be disabled again'
            }
        }

        $Menu.Show([Drawing.Point]::new(-32000, -32000))
        [Windows.Forms.Application]::DoEvents()
        if ($Menu.Width -lt 220 -or $Menu.Width -gt 282) { throw "Tray menu width is outside the content-sized target: $($Menu.Width)" }
        if ($Menu.Height -lt 230 -or $Menu.Height -gt 330) { throw "Tray menu height is outside the compact target: $($Menu.Height)" }
        if ($CaptureSelected -and $Case.Locale -eq 'zh' -and $Case.Theme -eq 'dark') {
            $Menu.Items[4].Select()
            [Windows.Forms.Application]::DoEvents()
        }
        $Bitmap = New-Object Drawing.Bitmap($Menu.Width, $Menu.Height)
        try {
            $Graphics = [Drawing.Graphics]::FromImage($Bitmap)
            try {
                $DeviceContext = $Graphics.GetHdc()
                try { $Captured = [DshTrayCapture]::PrintWindow($Menu.Handle, $DeviceContext, 2) }
                finally { $Graphics.ReleaseHdc($DeviceContext) }
            }
            finally { $Graphics.Dispose() }
            $CenterPixel = $Bitmap.GetPixel([Math]::Max(0, [int]($Bitmap.Width / 2)), [Math]::Max(0, [int]($Bitmap.Height / 2)))
            if (-not $Captured -or ($CenterPixel.R -eq 0 -and $CenterPixel.G -eq 0 -and $CenterPixel.B -eq 0)) {
                $Menu.DrawToBitmap($Bitmap, [Drawing.Rectangle]::new(0, 0, $Menu.Width, $Menu.Height))
            }
            if ($CaptureDirectory) {
                $Bitmap.Save((Join-Path $CaptureDirectory ("tray-menu-$($Case.Locale)-$($Case.Theme).png")))
            }
        }
        finally {
            $Bitmap.Dispose()
            $Menu.Close()
        }

        if ($CaptureDirectory -and $Case.Locale -eq 'zh' -and $Case.Theme -eq 'dark') {
            $More = [Windows.Forms.ToolStripMenuItem]$Menu.Items[4]
            $Menu.Show([Drawing.Point]::new(-32000, -32000))
            $More.ShowDropDown()
            [Windows.Forms.Application]::DoEvents()
            $MoreMenu = $More.DropDown
            if ($MoreMenu.Width -lt 196 -or $MoreMenu.Width -gt 264) { throw "More menu width is outside the content-sized target: $($MoreMenu.Width)" }
            $MoreBitmap = New-Object Drawing.Bitmap($MoreMenu.Width, $MoreMenu.Height)
            try {
                $MoreMenu.DrawToBitmap($MoreBitmap, [Drawing.Rectangle]::new(0, 0, $MoreMenu.Width, $MoreMenu.Height))
                $MoreBitmap.Save((Join-Path $CaptureDirectory 'tray-menu-zh-dark-more.png'))
            }
            finally {
                $MoreBitmap.Dispose()
                $MoreMenu.Close()
                $Menu.Close()
            }
        }
    }

    Write-Host 'Windows native tray smoke passed: one compact menu, recent sessions, locale, theme, and command fallback.'
}
finally {
    $Window.Dispose()
}
