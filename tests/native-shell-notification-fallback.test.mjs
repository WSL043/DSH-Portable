import assert from 'node:assert/strict'
import test from 'node:test'
import { readLauncherSource } from './helpers/launcher-source.mjs'

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `source section not found: ${startMarker}`)
  return source.slice(start, end)
}

test('failed native Toast notifications degrade to a clickable localized tray balloon', async () => {
  const source = await readLauncherSource()
  const taskNotifications = section(source, 'private void ShowTaskCompletionNotifications(', 'private static void ApplyRoundedCorners(')
  assert.match(taskNotifications, /!NativeTaskNotification\.ShowCompletion\([\s\S]*?fallbackNotifications\.Add/)
  assert.match(taskNotifications, /!NativeTaskNotification\.ShowAttention\([\s\S]*?fallbackNotifications\.Add/)
  assert.match(taskNotifications, /private void ShowTaskNotificationFallback\([\s\S]*?trayIcon\.ShowBalloonTip\(/)
  assert.match(taskNotifications, /notificationSessionId\s*=\s*session\.id/)
})
