import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { patchSessionExportClient } from '../scripts/patch-session-export-ui.mjs'

const read = filename => readFile(new URL(`../${filename}`, import.meta.url), 'utf8')

test('Windows routes native download lifecycle back into the existing DSH export modal', async () => {
  const [host, bridge] = await Promise.all([
    read('launcher/windows/DSH-Portable.cs'),
    read('desktop-bridge/lib/client.js'),
  ])

  assert.doesNotMatch(host, /class\s+DownloadProgressWindow\s*:\s*Form/)
  assert.doesNotMatch(host, /new\s+DownloadProgressWindow\s*\(/)
  assert.match(host, /type["']?\s*,\s*["']dsh-portable\/download["']/)
  assert.match(host, /DownloadOperation\.Uri|operation\.Uri/)
  assert.match(host, /BytesReceivedChanged/)
  assert.match(host, /StateChanged/)
  assert.match(host, /CoreWebView2DownloadState\.Completed/)
  assert.match(host, /CoreWebView2DownloadInterruptReason\.UserCanceled/)
  assert.match(host, /SaveFileDialog/)

  assert.match(bridge, /sessionLogDownload/)
  assert.match(bridge, /dsh-portable\/download/)
  assert.match(bridge, /sessionLogDownload\.store\.update|controller\.store\.update/)
  assert.match(bridge, /nativeDownload/)
})

test('builds apply and verify the guarded DSH Session export modal adaptation', async () => {
  const [patcher, windows, macos, linux, verify] = await Promise.all([
    read('scripts/patch-session-export-ui.mjs'),
    read('scripts/build-windows.ps1'),
    read('scripts/build-macos.sh'),
    read('scripts/build-linux.sh'),
    read('scripts/verify-runtime.mjs'),
  ])

  assert.match(patcher, /dsh-portable-native-download-v1/)
  assert.match(patcher, /nativeDownload/)
  assert.match(patcher, /Session export client compatibility check failed/)
  assert.match(windows, /patch-session-export-ui\.mjs/)
  assert.match(macos, /patch-session-export-ui\.mjs/)
  assert.match(linux, /patch-session-export-ui\.mjs/)
  assert.match(verify, /dsh-portable-native-download-v1/)
})

test('Session export adaptation is idempotent and fails closed when the upstream seam changes', () => {
  const source = [
    '\t\t\tconst error = status === "error" ? entry?.error || t("dialog.commandFailed") : null;',
    '\t\t\treturn (0, react_jsx_runtime.jsx)',
    '\t\t\t\ttitle: status === "downloading" ? t("dialog.preparingTitle") : status === "success" ? t("dialog.successTitle") : t("dialog.errorTitle"),',
    '\t\t\t\tdescription: status === "downloading" ? t("dialog.preparingDescription") : status === "success" ? t("dialog.successDescription") : error ?? t("dialog.commandFailed"),',
    '\t\t\t"dialog.commandFailed": "无法启动 Session 导出。"',
    '\t\t\t"dialog.commandFailed": "Could not start the Session export."',
  ].join('\n')
  const patched = patchSessionExportClient(source)
  assert.match(patched, /dsh-portable-native-download-v1/)
  assert.match(patched, /nativeDownload/)
  assert.match(patched, /Session export complete/)
  assert.equal(patchSessionExportClient(patched), patched)
  assert.throws(
    () => patchSessionExportClient(source.replace('const error =', 'const changedError =')),
    /compatibility check failed/,
  )
})
