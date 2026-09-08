param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Evidence,
      [switch]$HeaderOnly, [switch]$HighlightMenu, [string]$Language)
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
 $window.PerformLayout()
 $origin=$window.PointToScreen([Drawing.Point]::Empty)
 $inset=$origin.Y-$window.Top
 if($inset -gt 12){throw "Separate native caption remains: $inset px"}
 if($menu.Height -ne 36 -or $content.Top -ne $menu.Bottom){throw 'Expected a single 36px title row above content'}
 foreach($name in @('caption-minimize','caption-maximize','caption-close')){
   $item=$menu.Items[$name]
   if($null -eq $item -or $item.Bounds.Bottom -gt $menu.Height){throw "Caption control outside title row: $name"}
 }
 $point=$menu.PointToScreen([Drawing.Point]::new([int]($menu.Width/2),18))
 $packed=([long]($point.Y -band 65535) -shl 16) -bor ($point.X -band 65535)
 $hit=[TitlebarProbe]::SendMessage($handle,0x84,[IntPtr]::Zero,[IntPtr]$packed).ToInt32()
 if($hit -ne 2){throw "Blank title row does not use native drag hit testing: $hit"}
 # Hidden controls exercise the same caption handlers without moving a visible window.
 $menu.Items['caption-maximize'].PerformClick()
 if($window.WindowState -ne 'Maximized'){throw 'Maximize command failed'}
 $menu.Items['caption-maximize'].PerformClick()
 if($window.WindowState -ne 'Normal'){throw 'Restore command failed'}
 $menu.Items['caption-minimize'].PerformClick()
 if($window.WindowState -ne 'Minimized'){throw 'Minimize command failed'}
 $window.WindowState='Normal'
 $window.Location=[Drawing.Point]::new(-32000,-32000)
 foreach($theme in @('dark','light')){
   $type.GetField('trayTheme',$flags).SetValue($window,$theme)
   $type.GetMethod('ApplyDesktopChrome',$flags).Invoke($window,@()) | Out-Null
   [TitlebarProbe]::ShowWindow($handle,4) | Out-Null
   [Windows.Forms.Application]::DoEvents()
   if($HighlightMenu){$menu.Items[0].Select()}
   $captureHeight=if($HeaderOnly){72}else{$window.Height}
   $bitmap=[Drawing.Bitmap]::new($window.Width,$captureHeight)
   $graphics=[Drawing.Graphics]::FromImage($bitmap)
   $dc=$graphics.GetHdc()
   try { if(-not [TitlebarProbe]::PrintWindow($handle,$dc,2)){throw 'Native titlebar capture failed'} }
   finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
   $bitmap.Save((Join-Path $Evidence "$theme.png"))
   $bitmap.Dispose()
 }
 @{passed=$true;captionInset=$inset;titleHeight=$menu.Height;contentTop=$content.Top;dragHitTest=$hit;captionCommands=@('minimize','maximize','restore');themes=@('dark','light')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Evidence 'result.json') -Encoding UTF8
} finally { $window.Dispose() }
