param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$ResolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$Launcher = Join-Path $ResolvedRoot 'DeepSeek-Herness.exe'
if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
    throw "DeepSeek-Herness.exe is missing: $Launcher"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Assembly = [Reflection.Assembly]::LoadFrom($Launcher)
$AllFields = [Reflection.BindingFlags]'Instance,Static,Public,NonPublic'
$InstanceMembers = [Reflection.BindingFlags]'Instance,NonPublic'
$WindowType = $Assembly.GetType('DshPortable.LauncherWindow', $true)
$StateType = $Assembly.GetType('DshPortable.TrayBridgeState', $true)
$SessionType = $Assembly.GetType('DshPortable.TrayBridgeSession', $true)
$Constructor = $WindowType.GetConstructor($InstanceMembers, $null, [Type[]]@([string[]]), $null)
$ConstructorArgs = New-Object 'System.Object[]' 1
$ConstructorArgs[0] = [string[]]@('--desktop')
$Window = $Constructor.Invoke($ConstructorArgs)

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
    Add-Session $Sessions 'session-3' 'Verify the Linux package' 'review' $false ''
    Add-Session $Sessions 'session-4' 'Prepare release notes' '' $false ''
    Set-Property $StateType $State 'sessions' $Sessions

    $WindowType.GetField('trayState', $AllFields).SetValue($Window, $State)
    $WindowType.GetField('trayBridgeReady', $AllFields).SetValue($Window, $true)

    $LongTitle = [string]::Concat((1..36 | ForEach-Object { "e$([char]0x0301)" }))
    $ShortenedTitle = [string]$WindowType.GetMethod('MenuTitle', $AllFields).Invoke($null, @($LongTitle))
    if ([Globalization.StringInfo]::ParseCombiningCharacters($ShortenedTitle.TrimEnd([char]0x2026)).Length -ne 35 -or -not $ShortenedTitle.EndsWith([char]0x2026)) {
        throw "Tray title truncation must preserve exactly 35 complete text elements"
    }

    $ZhRecent = -join ([char[]]@(0x6700, 0x8FD1))
    $ZhRunning = -join ([char[]]@(0x8FD0, 0x884C, 0x4E2D))
    $ZhWaiting = -join ([char[]]@(0x5F85, 0x56DE, 0x590D))
    $ZhReview = -join ([char[]]@(0x590D, 0x6838))
    $ZhMore = -join ([char[]]@(0x66F4, 0x591A))
    $ZhNew = -join ([char[]]@(0x65B0, 0x4F1A, 0x8BDD))
    $ZhFeedback = -join ([char[]]@(0x53CD, 0x9988, 0x95EE, 0x9898))
    $ZhExit = (-join ([char[]]@(0x9000, 0x51FA))) + ' DeepSeek Harness'

    foreach ($Case in @(
        @{ Locale = 'en'; Theme = 'light'; Recent = 'Recent'; Running = 'Running'; Waiting = 'Needs input'; Review = 'Review'; More = 'More'; New = 'New session'; Feedback = 'Report a problem'; Exit = 'Exit DeepSeek Harness' },
        @{ Locale = 'zh'; Theme = 'dark'; Recent = $ZhRecent; Running = $ZhRunning; Waiting = $ZhWaiting; Review = $ZhReview; More = $ZhMore; New = $ZhNew; Feedback = $ZhFeedback; Exit = $ZhExit }
    )) {
        Set-Property $StateType $State 'locale' $Case.Locale
        Set-Property $StateType $State 'theme' $Case.Theme
        $WindowType.GetField('uiLanguage', $AllFields).SetValue($null, $Case.Locale)
        $WindowType.GetField('trayTheme', $AllFields).SetValue($Window, $Case.Theme)
        $WindowType.GetMethod('RebuildTrayMenu', $InstanceMembers).Invoke($Window, $null) | Out-Null
        $Menu = [Windows.Forms.ContextMenuStrip]$WindowType.GetField('trayMenu', $AllFields).GetValue($Window)

        if ($Menu.Items[0].Text -ne $Case.Recent -or $Menu.Items[0].Enabled) { throw "Invalid recent section for $($Case.Locale)" }
        if ($Menu.Items[1].ShortcutKeyDisplayString -ne $Case.Running) { throw "Running hint is missing for $($Case.Locale)" }
        if ($Menu.Items[2].ShortcutKeyDisplayString -ne $Case.Waiting) { throw "Waiting hint is missing for $($Case.Locale)" }
        if ($Menu.Items[3].ShortcutKeyDisplayString -ne $Case.Review) { throw "Review hint is missing for $($Case.Locale)" }
        if ($Menu.Items[4].Text -ne $Case.More -or $Menu.Items[4].DropDownItems[0].Text -ne 'Prepare release notes') { throw "Bounded More menu is invalid for $($Case.Locale)" }
        if ($Menu.Items[5].Text -ne $Case.New) { throw "New-session action is missing for $($Case.Locale)" }
        if ($Menu.Items[7].Text -ne $Case.Feedback) { throw "Feedback action is missing for $($Case.Locale)" }
        if ($Menu.Items[9].Text -ne $Case.Exit) { throw "Exit action is missing for $($Case.Locale)" }

        $Size = $Menu.GetPreferredSize([Drawing.Size]::Empty)
        if ($Size.Width -lt 240 -or $Size.Height -lt 180) { throw "Tray menu layout is unexpectedly small: $Size" }
        $Menu.Size = $Size
        $Bitmap = New-Object Drawing.Bitmap($Size.Width, $Size.Height)
        try { $Menu.DrawToBitmap($Bitmap, [Drawing.Rectangle]::new(0, 0, $Size.Width, $Size.Height)) }
        finally { $Bitmap.Dispose() }
    }

    Write-Host 'Windows native tray smoke passed: real compiled menu, bounded sessions, locale, theme, and task actions.'
}
finally {
    $Window.Dispose()
}
