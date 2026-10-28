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
  assert.match(update, /catch\s*\(Exception error\)\s*\{\s*updateFailure\s*=\s*ExceptionDispatchInfo\.Capture\(error\);\s*\}\s*if\s*\(updateFailure != null\)\s*\{\s*if\s*\(!restoredAfterFailure\)\s*await RestoreDesktopAfterUpdateAttemptAsync\(\);\s*updateFailure\.Throw\(\);/)

  const fullUpdate = section(source, 'private void StartFullPackageUpdate(', 'private static bool IsTrustedProductManifestUrl(')
  assert.match(fullUpdate, /catch\s*\{[\s\S]*?File\.Delete\(helper\)[\s\S]*?HideDesktopOperation\(\)[\s\S]*?throw;/)
})


test('getting update files only prepares a native-selected directory and requires a saved receipt', async () => {
  const source = await readLauncherSource()
  const prepare = section(source, 'private async Task PrepareOfflineUpdateFilesAsync(', 'private void FinishUpdateCheckPhase(')
  assert.match(prepare, /FolderBrowserDialog picker/)
  assert.match(prepare, /parent = Path\.GetFullPath\(picker\.SelectedPath\)/)
  assert.match(prepare, /"prepare-update-files", "--scope", scope, "--output", parent, "--json", "--progress-json"/)
  assert.match(prepare, /arguments\.Add\("--update-manifest"\); arguments\.Add\(manifestUrl\)/)
  assert.match(prepare, /result\.Item1 == 0 && status == "saved" && !String\.IsNullOrEmpty\(directory\) && !String\.IsNullOrEmpty\(version\)/)
  assert.match(prepare, /if \(status == "cancelled"\)[\s\S]*?"cleanupPending"[\s\S]*?return;/)
  assert.doesNotMatch(prepare, /CheckForDesktopUpdateAsync|ApplyDesktopUpdateAsync|RestoreDesktopAfterUpdateAttemptAsync|"(?:start|stop|apply-update)"/)
  const route = section(source, 'String.Equals(Convert.ToString(messageType), "dsh-portable/open-update"', 'String.Equals(Convert.ToString(messageType), "dsh-portable/pick-directory"')
  assert.match(route, /downloadFilesValue is bool && \(bool\)downloadFilesValue/)
  assert.match(route, /offline && \(downloadFiles \|\| !String.IsNullOrEmpty\(requestedManifest\)\)/)
  assert.match(route, /if \(downloadFiles\) await PrepareOfflineUpdateFilesAsync\(requestedScope, requestedManifest\)/)
  assert.doesNotMatch(route, /TryGetValue\("(?:output|directory)"/)
})

test('download cancellation waits for the held child cleanup and leaves existing CLI commands unchanged', async () => {
  const source = await readLauncherSource()
  const prepare = section(source, 'private async Task PrepareOfflineUpdateFilesAsync(', 'private void FinishUpdateCheckPhase(')
  assert.match(prepare, /progress\.CancelButton = cancel/)
  assert.match(prepare, /progress\.FormClosing[\s\S]*?if \(!finished\) \{ args\.Cancel = true; requestCancellation\(\); \}/)
  assert.match(prepare, /cancellation\.Cancel\(\)/)
  assert.match(prepare, /InvokePortableCli\(arguments\.ToArray\(\), onProgress, cancellation\.Token\)/)
  assert.match(prepare, /finally \{ finished = true; if \(!progress\.IsDisposed\) progress\.Close\(\); \}/)
  const helper = section(source, 'private Tuple<int, string> InvokePortableCli(string[] actionArgs, Action<string> progressCallback)', 'private void ShowFailure(')
  assert.match(helper, /return InvokePortableCli\(actionArgs, progressCallback, CancellationToken.None\)/)
  assert.match(helper, /bool prepareFiles = actionArgs.Length > 0 && actionArgs\[0\] == "prepare-update-files"/)
  assert.match(helper, /RedirectStandardInput = prepareFiles/)
  assert.match(helper, /using \(CancellationTokenRegistration cancellation = prepareFiles[\s\S]*?cancellationToken.Register/)
  assert.ok(helper.includes('Encoding.ASCII.GetBytes("cancel\\n")'))
  assert.match(helper, /process\.StandardInput\.BaseStream\.Write\(request, 0, request\.Length\)/)
  assert.match(helper, /process\.StandardInput\.BaseStream\.Flush\(\)/)
  assert.match(helper, /process\.StandardOutput.ReadLine\(\)[\s\S]*?process\.WaitForExit\(\)/)
  assert.doesNotMatch(helper, /\.Kill\(|GetProcessById/)
})
