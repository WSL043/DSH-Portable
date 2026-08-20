import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '..')
const launcherSource = path.join(projectRoot, 'launcher', 'windows', 'DSH-Portable.cs')

test('Windows desktop host allows one minute for WebView2 workspace navigation', async () => {
  const source = await readFile(launcherSource, 'utf8')
  assert.match(source, /WorkspaceNavigationTimeoutMs\s*=\s*60000/)
  assert.equal((source.match(/Task\.Delay\(WorkspaceNavigationTimeoutMs\)/g) ?? []).length, 2)
  assert.doesNotMatch(source, /Task\.Delay\(30000\)/)
  assert.doesNotMatch(source, /工作台未能在 30 秒内打开|workspace did not open within 30 seconds/)
  assert.equal((source.match(/60 秒内打开/g) ?? []).length, 2)
  assert.equal((source.match(/within 60 seconds/g) ?? []).length, 2)
})

test('Windows cold start shows the local workspace before checking for updates in the background', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const runLauncher = source.slice(
    source.indexOf('private async Task RunLauncherAsync()'),
    source.indexOf('private void ShowDesktopOperation'),
  )
  const startIndex = runLauncher.indexOf('InvokePortableCli(new[] { "start", "--no-browser", "--json" })')
  const desktopIndex = runLauncher.indexOf('await ShowDesktopAsync(url)')
  const automaticCheckIndex = runLauncher.indexOf('CheckForDesktopUpdateAsync(false)')
  assert.ok(startIndex >= 0, 'the native host must start the local DSH service')
  assert.ok(desktopIndex > startIndex, 'the WebView must open after the service is ready')
  assert.ok(automaticCheckIndex > desktopIndex, 'automatic update checking must begin only after the workspace is visible')
  assert.doesNotMatch(runLauncher.slice(0, desktopIndex), /CheckAndApplyUpdateAsync/)
  assert.match(source, /checkUpdateItem\.Click\s*\+=\s*async delegate \{ await CheckForDesktopUpdateAsync\(true\); \}/)
})

test('Windows never treats an unavailable tray bridge state as permission to replace the running product', async () => {
  const source = await readFile(launcherSource, 'utf8')
  const updateCheck = source.slice(
    source.indexOf('private async Task CheckForDesktopUpdateAsync(bool manual)'),
    source.indexOf('private void ShowDesktopOperation'),
  )
  const fullPackageBranch = updateCheck.slice(
    updateCheck.indexOf('if (updateStatus == "full-package-required")'),
    updateCheck.indexOf('if (updateStatus != "available")'),
  )

  assert.match(fullPackageBranch, /if \(!trayBridgeReady\)/)
  assert.ok(
    fullPackageBranch.indexOf('if (!trayBridgeReady)') < fullPackageBranch.indexOf('ShowUpdateChoiceAsync'),
    'the shell must fail closed before offering a complete-package replacement',
  )
  assert.match(fullPackageBranch, /if \(!manual\) return/)
  assert.match(fullPackageBranch, /正在读取任务状态|reading the current task state/i)
})
