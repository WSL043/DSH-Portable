import assert from 'node:assert/strict'
import test from 'node:test'

import { readLauncherSource } from './helpers/launcher-source.mjs'

test('update completion dialog lists disabled plugins with Chinese and English copy', async () => {
  const source = (await readLauncherSource()).replace(/\r\n/g, '\n')

  assert.match(source, /JsonUpdateWarningPlugins\(updated\.Item2\)/)
  assert.match(source, /completionMessage \+= Environment\.NewLine \+ String\.Format/)
  assert.match(source, /\{0\} 个插件与新版本不兼容，已被自动停用：\{1\}。请到插件页更新它们。/)
  assert.match(source, /\{0\} plugins are incompatible with the new version and were automatically disabled: \{1\}\. Update them on the Plugins page\./)
  assert.match(source, /new JavaScriptSerializer\(\)\.DeserializeObject\(json \?\? String\.Empty\)/)
  assert.match(source, /payload\.TryGetValue\("warnings", out warningsValue\)/)
  assert.match(source, /warning\.TryGetValue\("plugin", out pluginValue\)/)
  assert.match(source, /plugins\.Distinct\(StringComparer\.Ordinal\)\.ToArray\(\)/)
})
