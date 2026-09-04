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
$ConstructorMembers = [Reflection.BindingFlags]'Instance,Public,NonPublic'
$WindowType = $Assembly.GetType('DshPortable.LauncherWindow', $true)
$StateType = $Assembly.GetType('DshPortable.TrayBridgeState', $true)
$SessionType = $Assembly.GetType('DshPortable.TrayBridgeSession', $true)
if ($Assembly.GetType('DshPortable.TrayTaskFlyout', $false)) {
    throw 'Rejected task-flyout type is still present in the compiled launcher'
}
$ConstructorSignature = [Type[]]@([string[]], [string], [string], [int], [int], [int])
$Constructor = $WindowType.GetConstructor($ConstructorMembers, $null, $ConstructorSignature, $null)
if (-not $Constructor) { throw 'LauncherWindow environment-aware constructor is missing' }
$ConstructorArgs = New-Object 'System.Object[]' 6
$ConstructorArgs[0] = [string[]]@('--desktop')
$ConstructorArgs[1] = 'default'
$ConstructorArgs[2] = $ResolvedRoot
$ConstructorArgs[3] = 0
$ConstructorArgs[4] = 0
$ConstructorArgs[5] = 0
$Window = $Constructor.Invoke($ConstructorArgs)
$WindowType.GetField('root', $AllFields).SetValue($Window, $ResolvedRoot)
$LoadUpdateCheckEnabled = $WindowType.GetMethod('LoadUpdateCheckEnabled', $InstanceMembers)
$InitialProductUpdateEnabled = $LoadUpdateCheckEnabled.Invoke(
    $Window,
    [Reflection.BindingFlags]::Default,
    $null,
    [object[]]@('productUpdateCheckEnabled'),
    [Globalization.CultureInfo]::InvariantCulture
)
$InitialEngineUpdateEnabled = $LoadUpdateCheckEnabled.Invoke(
    $Window,
    [Reflection.BindingFlags]::Default,
    $null,
    [object[]]@('engineUpdateCheckEnabled'),
    [Globalization.CultureInfo]::InvariantCulture
)
$WindowType.GetField('updateCheckEnabled', $AllFields).SetValue($Window, $InitialProductUpdateEnabled)
$WindowType.GetField('engineUpdateCheckEnabled', $AllFields).SetValue($Window, $InitialEngineUpdateEnabled)
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

function Save-DesktopCapture([string]$Filename) {
    Start-Sleep -Milliseconds 900
    $Bounds = [Windows.Forms.SystemInformation]::VirtualScreen
    $CaptureWidth = [Math]::Min(560, $Bounds.Width)
    $CaptureHeight = [Math]::Min(650, $Bounds.Height)
    $CaptureLeft = $Bounds.Right - $CaptureWidth
    $CaptureTop = $Bounds.Bottom - $CaptureHeight
    $Capture = New-Object Drawing.Bitmap $CaptureWidth, $CaptureHeight
    $Graphics = [Drawing.Graphics]::FromImage($Capture)
    try {
        $Graphics.CopyFromScreen($CaptureLeft, $CaptureTop, 0, 0, $Capture.Size)
        $Capture.Save((Join-Path $CaptureDirectory $Filename))
    }
    finally {
        $Graphics.Dispose()
        $Capture.Dispose()
    }
}

function Assert-MenuRowsFillWidth([Windows.Forms.ToolStripDropDown]$DropDown, [string]$Name) {
    $ContentRight = $DropDown.ClientSize.Width
    foreach ($Item in $DropDown.Items) {
        if (-not $Item.Available) { continue }
        $Gap = $ContentRight - $Item.Bounds.Right
        if ($Gap -gt 4) {
            throw "$Name leaves an empty right gutter of $Gap px after '$($Item.Text)'"
        }
    }
}

function Test-NativeTaskNotification {
    $NativeNotificationType = $Assembly.GetType('DshPortable.NativeTaskNotification', $true)
    $ToolkitAssembly = [Reflection.Assembly]::LoadFrom((Join-Path $ResolvedRoot 'Microsoft.Toolkit.Uwp.Notifications.dll'))
    $ToastManager = $ToolkitAssembly.GetType('Microsoft.Toolkit.Uwp.Notifications.ToastNotificationManagerCompat', $true)
    if (-not $ToastManager.GetEvent('OnActivated')) { throw 'ToastNotificationManagerCompat activation event is missing' }
    $Session = [Activator]::CreateInstance($SessionType, $true)
    $FullReply = "Full reply line one.`r`nLine two remains in the native notification when it expands."
    $sessionId = 'notification-session-9'
    Set-Property $SessionType $Session 'id' $sessionId
    Set-Property $SessionType $Session 'title' 'Verify task completion notification'
    Set-Property $SessionType $Session 'finalReply' $FullReply
    Set-Property $SessionType $Session 'running' $true
    Set-Property $SessionType $Session 'completed' $false
    $Registered = $NativeNotificationType.GetMethod('Register', $AllFields).Invoke($null, [object[]]::new(0))
    if (-not $Registered) { throw 'Native notification activation registration failed' }

    # Exercise the real LauncherWindow completion transition while it is not
    # focused and has no taskbar surface. This is the path used after minimize
    # to tray; a direct NativeTaskNotification.Show call would miss regressions
    # in baseline tracking and host routing.
    $Window.Hide()
    $Window.ShowInTaskbar = $false
    $WindowType.GetField('uiLanguage', $AllFields).SetValue($Window, 'zh')
    $WindowType.GetField('taskNotificationsEnabled', $AllFields).SetValue($Window, $true)
    $Baseline = [Activator]::CreateInstance($StateType, $true)
    Set-Property $StateType $Baseline 'type' 'dsh-portable/state'
    Set-Property $StateType $Baseline 'schemaVersion' 1
    Set-Property $StateType $Baseline 'currentSessionId' 'another-session'
    $ListType = [Collections.Generic.List``1].MakeGenericType($SessionType)
    $NotificationSessions = [Activator]::CreateInstance($ListType)
    $NotificationSessions.Add($Session)
    Set-Property $StateType $Baseline 'sessions' $NotificationSessions
    $CompletionHandler = $WindowType.GetMethod('HandleTaskCompletionNotifications', $InstanceMembers)
    $CompletionHandler.Invoke($Window, @($Baseline)) | Out-Null
    Set-Property $SessionType $Session 'running' $false
    Set-Property $SessionType $Session 'completed' $true
    $CompletionHandler.Invoke($Window, @($Baseline)) | Out-Null
    $Unread = $WindowType.GetField('unreadCompletedSessions', $AllFields).GetValue($Window)
    if (-not $Unread.Contains($sessionId)) { throw 'Background completion did not reach the native unread state' }
    if ($WindowType.GetField('notificationSessionId', $AllFields).GetValue($Window) -ne $sessionId) {
        throw 'Background completion did not reach the native notification route'
    }

    # Exercise the pure parser with the same semicolon-delimited arguments
    # generated by ToastContentBuilder. No synthetic activation event is used.
    $Pair = [Collections.Generic.KeyValuePair[string, object]]
    $ReplyInputs = [Collections.Generic.List[Collections.Generic.KeyValuePair[string, object]]]::new()
    $ReplyInputs.Add([Activator]::CreateInstance($Pair, @('reply', 'Continue refining')))
    $ParseArguments = [object[]]@("action=reply;sessionId=$sessionId", $ReplyInputs, '', '', '', '')
    $Parsed = $NativeNotificationType.GetMethod('TryParseActivation', $AllFields).Invoke($null, $ParseArguments)
    if (-not $Parsed -or $ParseArguments[2] -ne 'reply' -or $ParseArguments[3] -ne $sessionId -or $ParseArguments[4] -ne '' -or $ParseArguments[5] -ne 'Continue refining') {
        throw 'Native Reply parser did not preserve the exact task and reply text'
    }
    $InvalidParseArguments = [object[]]@("action=reply;sessionId=$sessionId", $null, '', '', '', '')
    if ($NativeNotificationType.GetMethod('TryParseActivation', $AllFields).Invoke($null, $InvalidParseArguments)) {
        throw 'Native Reply parser accepted an activation with no reply input'
    }

    # Exercise the activator-to-environment inbox, not just its parser. The
    # same activation id must be delivered once and an expired action rejected.
    $InstanceKey = $WindowType.GetMethod('ResolveEnvironmentInstanceKey', $AllFields).Invoke($null, @($ResolvedRoot, 'default'))
    $RootKey = $WindowType.GetMethod('ResolveEnvironmentInstanceKey', $AllFields).Invoke($null, @($ResolvedRoot, 'notification-root'))
    $RootMap = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\WSL043\DSH-Portable\NotificationRoots\$RootKey")
    try {
        $RootMap.SetValue('Root', $ResolvedRoot, [Microsoft.Win32.RegistryValueKind]::String)
        $RootMap.SetValue('Executable', [IO.Path]::GetFullPath($Launcher), [Microsoft.Win32.RegistryValueKind]::String)
    }
    finally { $RootMap.Dispose() }
    $Inbox = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "DSH-Portable\notification-activations\$InstanceKey"
    if (Test-Path -LiteralPath $Inbox) { Remove-Item -LiteralPath $Inbox -Recurse -Force }
    $CreatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $ActivationId = [Guid]::NewGuid().ToString('N')
    $NativeNotificationType.GetMethod('SetOwnerReady', $AllFields).Invoke($null, @($true)) | Out-Null
    $OpenActivation = "action=open;sessionId=$sessionId;environmentId=default;instanceKey=$InstanceKey;rootKey=$RootKey;activationId=$ActivationId;createdAt=$CreatedAt"
    $NativeNotificationType.GetMethod('DispatchActivation', $AllFields).Invoke($null, @($OpenActivation, $null)) | Out-Null
    $NativeNotificationType.GetMethod('DispatchActivation', $AllFields).Invoke($null, @($OpenActivation, $null)) | Out-Null
    $ExpiredId = [Guid]::NewGuid().ToString('N')
    $ExpiredAt = $CreatedAt - 604801
    $ExpiredActivation = "action=open;sessionId=$sessionId;environmentId=default;instanceKey=$InstanceKey;rootKey=$RootKey;activationId=$ExpiredId;createdAt=$ExpiredAt"
    $NativeNotificationType.GetMethod('DispatchActivation', $AllFields).Invoke($null, @($ExpiredActivation, $null)) | Out-Null
    $pendingActions = $WindowType.GetField('pendingNotificationActions', $AllFields).GetValue($Window)
    if ($pendingActions.Count -ne 1) { throw 'Environment notification inbox did not deduplicate or reject expiry' }
    $pendingOpen = $pendingActions.Dequeue()
    if ($pendingOpen.Item1 -ne $ActivationId -or $pendingOpen.Item2 -ne 'open' -or $pendingOpen.Item3 -ne $sessionId) {
        throw 'Environment notification inbox did not deliver to the exact owner'
    }
    if (Test-Path -LiteralPath $Inbox) { Remove-Item -LiteralPath $Inbox -Recurse -Force }

    # Exercise the same exact-session queue used by an Action Center Reply
    # activation while the WebView is unavailable. The queued tuple must retain
    # both the originating task and the complete reply without substitution.
    $replyText = 'Reply routed to the originating task.'
    $WindowType.GetField('trayBridgeReady', $AllFields).SetValue($Window, $false)
    $WindowType.GetMethod('QueueNotificationAction', $InstanceMembers).Invoke(
        $Window,
        [Reflection.BindingFlags]::Default,
        $null,
        [object[]]@([Guid]::NewGuid().ToString('N'), 'reply', $sessionId, '', $replyText),
        [Globalization.CultureInfo]::InvariantCulture
    ) | Out-Null
    $pendingActions = $WindowType.GetField('pendingNotificationActions', $AllFields).GetValue($Window)
    $pendingReply = $pendingActions.Dequeue()
    if ($pendingReply.Item2 -ne 'reply' -or $pendingReply.Item3 -ne $sessionId -or $pendingReply.Item4 -ne '' -or $pendingReply.Item5 -ne $replyText) {
        throw 'Native Reply did not preserve the exact originating task and reply text'
    }

    # Local visual acceptance passes CaptureDirectory and inspects this real
    # desktop capture. CI exercises the same hidden-window completion route.
    if ($CaptureDirectory) {
        Save-DesktopCapture 'native-task-notification.png'
    }


    # A new approval transition uses a persistent notification with bounded
    # native actions. Its activation must preserve the exact pending key and
    # response so the bridge can reject stale approvals before answering DSH.
    $WindowType.GetField('notificationSessionId', $AllFields).SetValue($Window, $null)
    Set-Property $SessionType $Session 'pendingInteraction' 'approval'
    Set-Property $SessionType $Session 'pendingInteractionKey' 'approval:smoke-1'
    Set-Property $SessionType $Session 'pendingInteractionPrompt' 'Allow the native smoke command?'
    $InteractionOptions = [Collections.Generic.List[string]]::new()
    $InteractionOptions.Add('rejected')
    $InteractionOptions.Add('allowed-once')
    Set-Property $SessionType $Session 'pendingInteractionOptions' $InteractionOptions
    $CompletionHandler.Invoke($Window, @($Baseline)) | Out-Null
    if ($WindowType.GetField('notificationSessionId', $AllFields).GetValue($Window) -ne $sessionId) {
        throw 'Approval transition did not reach the native attention notification route'
    }

    $ResolveArguments = [object[]]@("action=resolve-interaction;sessionId=$sessionId;interactionKey=approval:smoke-1;response=allowed-once", $null, '', '', '', '')
    $Resolved = $NativeNotificationType.GetMethod('TryParseActivation', $AllFields).Invoke($null, $ResolveArguments)
    if (-not $Resolved -or $ResolveArguments[2] -ne 'resolve-interaction' -or $ResolveArguments[3] -ne $sessionId -or $ResolveArguments[4] -ne 'approval:smoke-1' -or $ResolveArguments[5] -ne 'allowed-once') {
        throw 'Native approval parser did not preserve the exact pending interaction and response'
    }
    $WindowType.GetMethod('QueueNotificationAction', $InstanceMembers).Invoke(
        $Window,
        [Reflection.BindingFlags]::Default,
        $null,
        [object[]]@([Guid]::NewGuid().ToString('N'), 'resolve-interaction', $sessionId, 'approval:smoke-1', 'rejected'),
        [Globalization.CultureInfo]::InvariantCulture
    ) | Out-Null
    $pendingApproval = $pendingActions.Dequeue()
    if ($pendingApproval.Item2 -ne 'resolve-interaction' -or $pendingApproval.Item3 -ne $sessionId -or $pendingApproval.Item4 -ne 'approval:smoke-1' -or $pendingApproval.Item5 -ne 'rejected') {
        throw 'Native approval queue did not preserve the exact pending interaction and response'
    }
    if ($CaptureDirectory) {
        Save-DesktopCapture 'native-task-attention.png'
    }
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

    Test-NativeTaskNotification

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
    $ZhTerminal = 'DSH ' + (-join ([char[]]@(0x7EC8, 0x7AEF)))
    $ZhFeedback = -join ([char[]]@(0x53CD, 0x9988, 0x95EE, 0x9898))
    $ZhExit = (-join ([char[]]@(0x9000, 0x51FA))) + ' DeepSeek Harness'

    foreach ($Case in @(
        @{ Locale = 'en'; Theme = 'light'; Running = 'Running'; Waiting = 'Needs input'; Completed = 'Completed'; More = 'More'; New = 'New session'; Terminal = 'DSH Terminal'; Feedback = 'Report a problem'; Exit = 'Exit DeepSeek Harness' },
        @{ Locale = 'zh'; Theme = 'dark'; Running = $ZhRunning; Waiting = $ZhWaiting; Completed = $ZhCompleted; More = $ZhMore; New = $ZhNew; Terminal = $ZhTerminal; Feedback = $ZhFeedback; Exit = $ZhExit }
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
        $WindowType.GetMethod('RebuildTrayMenu', $InstanceMembers).Invoke(
            $Window,
            [Reflection.BindingFlags]::Default,
            $null,
            [object[]]::new(0),
            [Globalization.CultureInfo]::InvariantCulture
        ) | Out-Null
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
        if ($Menu.Items[5].DropDownItems.Count -ne 10) { throw "More submenu must contain bounded overflow and direct settings commands" }
        if ($Menu.Items[5].DropDownItems[8].Text -ne $Case.Terminal) { throw "DSH Terminal command must be in More for $($Case.Locale)" }
        if ($Menu.Items[5].DropDownItems[9].Text -ne $Case.Feedback) { throw "Feedback command must be in More for $($Case.Locale)" }
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
            $ProductUpdateEnabledField = $WindowType.GetField('updateCheckEnabled', $AllFields)
            $EngineUpdateEnabledField = $WindowType.GetField('engineUpdateCheckEnabled', $AllFields)
            $SettingsPath = Join-Path $ResolvedRoot 'data\launcher-settings.json'
            if ([bool]$ProductUpdateEnabledField.GetValue($Window) -or [bool]$EngineUpdateEnabledField.GetValue($Window) -or $AutomaticItem.ShortcutKeyDisplayString -ne 'Off') {
                throw 'Automatic update checks must default to Off until the user opts in'
            }
            $AutomaticItem.PerformClick()
            [Windows.Forms.Application]::DoEvents()
            if (-not [bool]$ProductUpdateEnabledField.GetValue($Window) -or -not [bool]$EngineUpdateEnabledField.GetValue($Window) -or $AutomaticItem.ShortcutKeyDisplayString -ne 'On') {
                throw 'Automatic update check status did not change immediately after click'
            }
            $SavedSettings = Get-Content -Raw -LiteralPath $SettingsPath
            if (-not (Test-Path -LiteralPath $SettingsPath) -or $SavedSettings -notmatch '"productUpdateCheckEnabled":true' -or $SavedSettings -notmatch '"engineUpdateCheckEnabled":true') {
                throw 'Automatic update check preference was not saved'
            }

            $ReloadedWindow = $Constructor.Invoke($ConstructorArgs)
            try {
                $WindowType.GetField('root', $AllFields).SetValue($ReloadedWindow, $ResolvedRoot)
                $ReloadedProductEnabled = $LoadUpdateCheckEnabled.Invoke(
                    $ReloadedWindow,
                    [Reflection.BindingFlags]::Default,
                    $null,
                    [object[]]@('productUpdateCheckEnabled'),
                    [Globalization.CultureInfo]::InvariantCulture
                )
                $ReloadedEngineEnabled = $LoadUpdateCheckEnabled.Invoke(
                    $ReloadedWindow,
                    [Reflection.BindingFlags]::Default,
                    $null,
                    [object[]]@('engineUpdateCheckEnabled'),
                    [Globalization.CultureInfo]::InvariantCulture
                )
                $ProductUpdateEnabledField.SetValue($ReloadedWindow, $ReloadedProductEnabled)
                $EngineUpdateEnabledField.SetValue($ReloadedWindow, $ReloadedEngineEnabled)
                $WindowType.GetMethod('RebuildTrayMenu', $InstanceMembers).Invoke(
                    $ReloadedWindow,
                    [Reflection.BindingFlags]::Default,
                    $null,
                    [object[]]::new(0),
                    [Globalization.CultureInfo]::InvariantCulture
                ) | Out-Null
                $ReloadedItem = [Windows.Forms.ToolStripMenuItem]$WindowType.GetField('automaticUpdateCheckItem', $AllFields).GetValue($ReloadedWindow)
                if (-not [bool]$ProductUpdateEnabledField.GetValue($ReloadedWindow) -or -not [bool]$EngineUpdateEnabledField.GetValue($ReloadedWindow) -or $ReloadedItem.ShortcutKeyDisplayString -ne 'On') {
                    throw 'Automatic update check preference was not restored after restart'
                }
            }
            finally {
                $ReloadedWindow.Dispose()
            }

            $AutomaticItem.PerformClick()
            [Windows.Forms.Application]::DoEvents()
            if ([bool]$ProductUpdateEnabledField.GetValue($Window) -or [bool]$EngineUpdateEnabledField.GetValue($Window) -or $AutomaticItem.ShortcutKeyDisplayString -ne 'Off') {
                throw 'Automatic update check preference could not be disabled again'
            }
        }

        $Menu.Show([Drawing.Point]::new(-32000, -32000))
        [Windows.Forms.Application]::DoEvents()
        if ($Menu.Width -lt 220 -or $Menu.Width -gt 282) { throw "Tray menu width is outside the content-sized target: $($Menu.Width)" }
        if ($Menu.Height -lt 230 -or $Menu.Height -gt 330) { throw "Tray menu height is outside the compact target: $($Menu.Height)" }
        Assert-MenuRowsFillWidth $Menu "Tray menu"
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
            $More = [Windows.Forms.ToolStripMenuItem]$Menu.Items[5]
            $Menu.Show([Drawing.Point]::new(-32000, -32000))
            $More.ShowDropDown()
            [Windows.Forms.Application]::DoEvents()
            $MoreMenu = $More.DropDown
            if ($MoreMenu.Width -lt 196 -or $MoreMenu.Width -gt 264) { throw "More menu width is outside the content-sized target: $($MoreMenu.Width)" }
            Assert-MenuRowsFillWidth $MoreMenu "More menu"
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

    Write-Host 'Windows native tray smoke passed: compact menu, native Action Center delivery path, exact-session reply queue, locale, theme, and command fallback.'
}
finally {
    $NativeNotificationType = $Assembly.GetType('DshPortable.NativeTaskNotification', $false)
    if ($NativeNotificationType) {
        $NativeNotificationType.GetMethod('Unregister', $AllFields).Invoke($null, [object[]]::new(0)) | Out-Null
    }
    $Window.Dispose()
}
