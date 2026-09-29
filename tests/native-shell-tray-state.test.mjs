import assert from 'node:assert/strict'
import test from 'node:test'
import { readLauncherSource } from './helpers/launcher-source.mjs'

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `source section not found: ${startMarker}`)
  return source.slice(start, end)
}

test('tray bridge loss invalidates stale native actions and refreshes the menu', async () => {
  const source = await readLauncherSource()
  const unavailable = section(source, 'private void MarkTrayBridgeUnavailable()', 'private void PostBridgeAction(')
  assert.match(unavailable, /trayBridgeReady\s*=\s*false;[\s\S]*SetOwnerReady\(false\);[\s\S]*RebuildTrayMenu\(\);/)

  const sessionItem = section(source, 'private ToolStripMenuItem CreateSessionMenuItem(', 'private ToolStripMenuItem CreateOpenItem(')
  assert.match(sessionItem, /if\s*\(!trayBridgeReady\s*\|\|\s*updateInteractionRunning\s*\|\|\s*shutdownRunning\)\s*return;/)

  const processFailure = section(source, 'private void OnWebViewProcessFailed(', 'private void ScheduleWebViewRecovery(')
  assert.match(processFailure, /MarkTrayBridgeUnavailable\(\)/)

  const update = section(source, 'private async Task ApplyDesktopUpdateAsync(', 'private void StartFullPackageUpdate(')
  assert.match(update, /MarkTrayBridgeUnavailable\(\)/)
})
