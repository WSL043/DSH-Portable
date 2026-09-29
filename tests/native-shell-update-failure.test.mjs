import assert from 'node:assert/strict'
import test from 'node:test'
import { readLauncherSource } from './helpers/launcher-source.mjs'

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `source section not found: ${startMarker}`)
  return source.slice(start, end)
}

test('updater launch failures restore the workspace and remove an unstarted helper copy', async () => {
  const source = await readLauncherSource()
  const update = section(source, 'private async Task ApplyDesktopUpdateAsync(', 'private void StartFullPackageUpdate(')
  assert.match(update, /catch\s*\{\s*if\s*\(!restoredAfterFailure\)\s*await RestoreDesktopAfterUpdateAttemptAsync\(\);\s*throw;/)

  const fullUpdate = section(source, 'private void StartFullPackageUpdate(', 'private static bool IsTrustedProductManifestUrl(')
  assert.match(fullUpdate, /catch\s*\{[\s\S]*?File\.Delete\(helper\)[\s\S]*?HideDesktopOperation\(\)[\s\S]*?throw;/)
})
