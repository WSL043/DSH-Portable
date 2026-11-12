import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readLauncherSource } from './helpers/launcher-source.mjs'

const read = filename => readFile(new URL(`../${filename}`, import.meta.url), 'utf8')

test('the official session export uses the same Windows save and cancel path as any download', async () => {
  const [host, bridge, verify] = await Promise.all([
    readLauncherSource(), read('desktop-bridge/lib/client.js'), read('scripts/verify-runtime.mjs'),
  ])
  const handler = host.match(/private void OnDownloadStarting\([\s\S]*?(?=        private static string GetDefaultDownloadFolder)/u)?.[0]
  assert.ok(handler)
  assert.match(handler, /new SaveFileDialog/u)
  assert.match(handler, /dialog\.ShowDialog\(this\) != DialogResult\.OK[\s\S]*?eventArgs\.Cancel = true/u)
  assert.match(handler, /eventArgs\.ResultFilePath = dialog\.FileName/u)
  assert.doesNotMatch(bridge, /sessionLogDownload|dsh-portable\/download/u)
  assert.match(verify, /requireFromApp\.resolve\('@deepseek-ai\/dsh-session-log-export\/client'\)/u)
})
