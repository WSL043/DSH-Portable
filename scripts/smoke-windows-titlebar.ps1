param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Evidence,
      [switch]$HeaderOnly, [switch]$HighlightMenu, [switch]$NavigationPreview, [switch]$PopupMenus, [string]$Language)
$ErrorActionPreference='Stop'
$env:DSH_PORTABLE_TEST_HIDDEN='1'
$env:DSH_PORTABLE_TEST_AUTOMATION='1'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TitlebarProbe {
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr handle, IntPtr dc, uint flags);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr w, IntPtr l);
}
'@
$Root=(Resolve-Path -LiteralPath $Root).Path
New-Item -ItemType Directory -Path $Evidence -Force | Out-Null
$Evidence=(Resolve-Path -LiteralPath $Evidence).Path
$assembly=[Reflection.Assembly]::LoadFrom((Join-Path $Root 'DeepSeek-Herness.exe'))
$type=$assembly.GetType('DshPortable.LauncherWindow',$true)
$flags=[Reflection.BindingFlags]'Instance,Public,NonPublic'
$ctor=$type.GetConstructor($flags,$null,[Type[]]@([string[]],[string],[string],[int],[int],[int]),$null)
$window=$ctor.Invoke([object[]]@([string[]]@('--desktop'),'default',$Root,0,0,0))
try {
 # The fixture renders native chrome only; never start a backend or activate a window.
 $events=[ComponentModel.Component].GetProperty('Events',$flags).GetValue($window)
 $shown=[Windows.Forms.Form].GetField('EVENT_SHOWN',[Reflection.BindingFlags]'Static,NonPublic').GetValue($null)
 $window.remove_Shown($events[$shown])
 if($Language){
   $type.GetField('uiLanguage',[Reflection.BindingFlags]'Static,NonPublic').SetValue($null,$Language)
   $type.GetMethod('InitializeDesktopMenu',$flags).Invoke($window,@()) | Out-Null
 }
 $window.Location=[Drawing.Point]::new(-32000,-32000)
 $handle=$window.Handle
 $menu=$type.GetField('desktopMenu',$flags).GetValue($window)
 $content=$type.GetField('desktopContent',$flags).GetValue($window)
 if($null -eq $menu){throw 'Title menu missing'}
 # Establish the child HWND coordinates before native hit testing. The window
 # remains off-screen and SW_SHOWNOACTIVATE never takes foreground focus.
 [TitlebarProbe]::ShowWindow($handle,4) | Out-Null
 [Windows.Forms.Application]::DoEvents()
 $window.PerformLayout()
 $origin=$window.PointToScreen([Drawing.Point]::Empty)
 $inset=$origin.Y-$window.Top
 if($inset -ne 0){throw "Extra top frame remains above the title row: $inset px"}
 if($menu.Height -ne 36 -or $content.Top -ne $menu.Bottom){throw 'Expected a single 36px title row above content'}
 foreach($name in @('caption-minimize','caption-maximize','caption-close')){
   $item=$menu.Items[$name]
   if($null -eq $item -or $item.Bounds.Bottom -gt $menu.Height){throw "Caption control outside title row: $name"}
 }
 $point=$menu.PointToScreen([Drawing.Point]::new([int]($menu.Width/2),18))
 $packed=([long]($point.Y -band 65535) -shl 16) -bor ($point.X -band 65535)
 $hit=[TitlebarProbe]::SendMessage($handle,0x84,[IntPtr]::Zero,[IntPtr]$packed).ToInt32()
 if($hit -ne 2){throw "Blank title row does not use native drag hit testing: $hit"}
 $resizePoint=$menu.PointToScreen([Drawing.Point]::new([int]($menu.Width/2),2))
 $resizePacked=([long]($resizePoint.Y -band 65535) -shl 16) -bor ($resizePoint.X -band 65535)
 $resizeHit=[TitlebarProbe]::SendMessage($handle,0x84,[IntPtr]::Zero,[IntPtr]$resizePacked).ToInt32()
 if($resizeHit -ne 12){throw "Top resize edge is unavailable: $resizeHit; state=$($window.WindowState); menuTop=$($menu.Top); clientPoint=$($window.PointToClient($resizePoint)); client=$($window.ClientRectangle)"}
 # Hidden controls exercise the same caption handlers without moving a visible window.
 $menu.Items['caption-maximize'].PerformClick()
 if($window.WindowState -ne 'Maximized'){throw 'Maximize command failed'}
 $menu.Items['caption-maximize'].PerformClick()
 if($window.WindowState -ne 'Normal'){throw 'Restore command failed'}
 $menu.Items['caption-minimize'].PerformClick()
 if($window.WindowState -ne 'Minimized'){throw 'Minimize command failed'}
 $window.WindowState='Normal'
 $window.Location=[Drawing.Point]::new(-32000,-32000)
 foreach($name in @('menu-file','menu-view','menu-help')) {
   $item=$menu.Items[$name]
   if($item.DropDown.DropShadowEnabled){throw "$name still enables the large native popup shadow"}
   $item.ShowDropDown()
   [Windows.Forms.Application]::DoEvents()
   if(-not $item.DropDown.Visible){throw "$name did not open"}
   $type.GetMethod('OnDeactivate',$flags).Invoke($window,@([EventArgs]::Empty)) | Out-Null
   if($item.DropDown.Visible){throw "$name remained open when the window deactivated"}
 }
 $popupCaptures=[ordered]@{}
 if($NavigationPreview -or $PopupMenus){
   $state=[Activator]::CreateInstance($assembly.GetType('DshPortable.TrayBridgeState'),$true)
   $state.canGoBack=$true
   $state.canGoForward=$false
   $type.GetField('trayState',$flags).SetValue($window,$state)
   $type.GetField('desktopReady',$flags).SetValue($window,$true)
   $type.GetField('trayBridgeReady',$flags).SetValue($window,$true)
   $type.GetField('operationRunning',$flags).SetValue($window,$false)
   $type.GetMethod('RefreshDesktopCommands',$flags).Invoke($window,@()) | Out-Null
   if($NavigationPreview -and (-not $menu.Items['nav-sidebar'].Enabled -or -not $menu.Items['nav-back'].Enabled -or $menu.Items['nav-forward'].Enabled)){throw 'Navigation availability does not follow host state'}
 }
 foreach($theme in @('dark','light')){
   $type.GetField('trayTheme',$flags).SetValue($window,$theme)
   $type.GetMethod('ApplyDesktopChrome',$flags).Invoke($window,@()) | Out-Null
   [TitlebarProbe]::ShowWindow($handle,4) | Out-Null
   [Windows.Forms.Application]::DoEvents()
   if($HighlightMenu){$menu.Items['menu-file'].Select()}
   $captureHeight=if($HeaderOnly){$menu.Height}else{$window.Height}
   $captureWidth=if($HeaderOnly){$menu.Width}else{$window.Width}
   $bitmap=[Drawing.Bitmap]::new($captureWidth,$captureHeight)
   if($HeaderOnly){
     # Hidden-window PrintWindow may return an unpainted frame. Render the real
     # strip directly for deterministic chrome inspection (no DWM border/shadow).
     $menu.DrawToBitmap($bitmap,[Drawing.Rectangle]::new(0,0,$captureWidth,$captureHeight))
   } else {
   $graphics=[Drawing.Graphics]::FromImage($bitmap)
   $dc=$graphics.GetHdc()
   try { if(-not [TitlebarProbe]::PrintWindow($handle,$dc,2)){throw 'Native titlebar capture failed'} }
   finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
   }
   $bitmap.Save((Join-Path $Evidence "$theme.png"))
   $bitmap.Dispose()
   if($PopupMenus){
     $popupCaptures[$theme]=[ordered]@{}
     foreach($name in @('menu-file','menu-view','menu-help')){
       $dropDown=$menu.Items[$name].DropDown
       $dropDown.PerformLayout()
       $dropDown.CreateControl()
       $selectable=@($dropDown.Items | Where-Object { $_ -is [Windows.Forms.ToolStripMenuItem] -and $_.Enabled })
       if($selectable.Count -gt 0){$selectable[0].Select()}
       [Windows.Forms.Application]::DoEvents()
       if($dropDown.Width -lt 260){throw "$name dropdown is narrower than 260px: $($dropDown.Width)"}
       if($dropDown.Padding.Top -ne 6 -or $dropDown.Padding.Bottom -ne 6){throw "$name dropdown padding is not 6px"}
       foreach($item in $dropDown.Items){
         if($item -is [Windows.Forms.ToolStripSeparator]){
           if($item.Height -ne 13){throw "$name separator height is not 13px: $($item.Height)"}
         } elseif($item -is [Windows.Forms.ToolStripMenuItem] -and $item.Height -ne 30){
           throw "$name menu row height is not 30px: $($item.Height)"
         }
       }
       # Draw the real native dropdown off-screen; this does not exercise DWM's popup shadow.
       $popupBitmap=[Drawing.Bitmap]::new($dropDown.Width,$dropDown.Height)
       $dropDown.DrawToBitmap($popupBitmap,[Drawing.Rectangle]::new(0,0,$popupBitmap.Width,$popupBitmap.Height))
       $popupName=$name.Substring(5)
       $popupPath=Join-Path $Evidence "$theme-$popupName.png"
       $popupBitmap.Save($popupPath)
       $popupBitmap.Dispose()
       $popupCaptures[$theme][$popupName]=$popupPath
     }
   }
 }
 @{passed=$true;captionInset=$inset;titleHeight=$menu.Height;contentTop=$content.Top;dragHitTest=$hit;captionCommands=@('minimize','maximize','restore');themes=@('dark','light');popupMenus=$popupCaptures;popupMenuCapture='DrawToBitmap';popupMenuShadowVerified=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Evidence 'result.json') -Encoding UTF8
} finally { $window.Dispose() }
