import { readFile } from 'node:fs/promises'

export const launcherSourceFiles = Object.freeze([
  'DSH-Portable.cs',
  'LauncherWindow.Chrome.cs',
  'LauncherWindow.Tray.cs',
  'LauncherWindow.Data.cs',
  'LauncherWindow.WebViewShutdown.cs',
  'LauncherWindow.Host.cs',
  'LauncherWindow.Update.cs',
  'LauncherWindow.Navigation.cs',
  'LauncherWindow.WebView.cs',
  'LauncherWindow.UpdateUi.cs',
  'LauncherWindow.HostFailure.cs',
  'TrayBridge.cs',
  'NativeTaskNotification.cs',
  'TaskbarBadge.cs',
  'DesktopChrome.cs',
  'TaskbarIdentity.cs',
  'Program.cs',
])

export async function readLauncherSource() {
  const sources = await Promise.all(launcherSourceFiles.map(filename =>
    readFile(new URL(`../../launcher/windows/${filename}`, import.meta.url), 'utf8'),
  ))
  return sources.join('')
}
