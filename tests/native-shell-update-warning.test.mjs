import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { readLauncherSource } from './helpers/launcher-source.mjs'

test('update completion dialog reports compatibility warnings while retaining plugin choices', async () => {
  const source = (await readLauncherSource()).replace(/\r\n/g, '\n')

  assert.match(source, /JsonUpdateWarningPlugins\(updated\.Item2\)/)
  assert.match(source, /completionMessage \+= Environment\.NewLine \+ String\.Format/)
  assert.match(source, /\{0\} 个插件报告与新版本不兼容：\{1\}。已保留原有启用选择，请到插件页检查兼容性。/)
  assert.match(source, /\{0\} plugins report incompatibility with the new version: \{1\}\. Your enablement choices were retained; review compatibility on the Plugins page\./)
  assert.match(source, /serializer\.DeserializeObject\(candidate\)/)
  assert.match(source, /payload\.TryGetValue\("warnings", out warningsValue\)/)
  assert.match(source, /warning\.TryGetValue\("plugin", out pluginValue\)/)
  assert.match(source, /plugins\.Distinct\(StringComparer\.Ordinal\)\.ToArray\(\)/)
})

test('native warning parsing reads the last CLI result despite stderr JSONL and trailing noise', { skip: process.platform !== 'win32' }, async () => {
  const source = await readFile(new URL('../launcher/windows/LauncherWindow.Update.cs', import.meta.url), 'utf8')
  const start = source.indexOf('        private static string[] JsonUpdateWarningPlugins(')
  const end = source.indexOf('        private void StartFullPackageUpdate(', start)
  assert.ok(start >= 0 && end > start, 'actual native warning parser is present')
  const expected = ['dsh-image-viewer', 'dsh-chat-manager']
  const payload = { warnings: [...expected.map(plugin => ({ plugin })), { plugin: expected[0] }, null, {}, { plugin: ' ' }] }
  const result = JSON.stringify(payload)
  const event = JSON.stringify({ type: 'portable-warning', warnings: [{ plugin: 'event-only' }] })
  const cases = [
    [result, expected],
    [JSON.stringify(payload, null, 2), expected],
    [event + '\r\nnot JSON\n' + result + '\n{"status":"running"}', expected],
    ['{"warnings":[{"plugin":"old-result"}]}\n' + result + '\n' + event, expected],
    [result + '\n{broken', expected],
    [result + '\n{"warnings":[]}', []],
    [result + '\n{"warnings":null}', []],
    ['{invalid\n' + event + '\n{"status":"running"}', []],
    [null, []],
  ]
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-update-warning-'))
  try {
    const probe = path.join(root, 'warning-probe.cs')
    const executable = path.join(root, 'warning-probe.exe')
    const inputs = path.join(root, 'inputs.json')
    await writeFile(probe, [
      'using System; using System.Collections.Generic; using System.Globalization; using System.Linq; using System.Web.Script.Serialization;',
      'class Probe {', source.slice(start, end),
      'static void Main(string[] args) { Console.OutputEncoding = new System.Text.UTF8Encoding(false);',
      'var serializer = new JavaScriptSerializer(); var inputs = serializer.Deserialize<string[]>(System.IO.File.ReadAllText(args[0]));',
      'Console.Write(serializer.Serialize(inputs.Select(JsonUpdateWarningPlugins).ToArray())); } }',
    ].join('\n'))
    await writeFile(inputs, JSON.stringify(cases.map(([input]) => input)))
    const execute = promisify(execFile)
    await execute('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', [
      '/nologo', '/target:exe', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll',
      '/out:' + executable, probe,
    ], { windowsHide: true, timeout: 20_000 })
    const { stdout } = await execute(executable, [inputs], { windowsHide: true, timeout: 10_000 })
    assert.deepEqual(JSON.parse(stdout), cases.map(([, plugins]) => plugins))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
