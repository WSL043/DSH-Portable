import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  diagnosePortable,
  exportPortableSupportReport,
  repairPortable,
  summarizeWindowsTasklist,
} from '../launcher/repair-core.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-repair-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root, process.platform)
  const required = [layout.nodeExe, layout.dshBin, layout.hostBin, layout.desktopBridgePatch, layout.packageManagerBin]
  if (layout.platform === 'win32') required.push(layout.desktopExe, layout.webView2Core, layout.webView2WinForms, layout.webView2Loader)
  for (const filename of required) {
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, filename.endsWith('package.json') ? '{}' : 'fixture')
  }
  await writeFile(path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    dependencies: {},
  }))
  const packagedDsh = path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh')
  const profileDsh = path.join(layout.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(path.dirname(profileDsh), { recursive: true })
  await symlink(packagedDsh, profileDsh, process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(path.join(path.dirname(layout.desktopBridgePatch), 'package.json'), '{"name":"bridge"}')
  await mkdir(path.dirname(path.join(layout.pluginMarketRoot, 'package.json')), { recursive: true })
  await writeFile(path.join(layout.pluginMarketRoot, 'package.json'), '{"name":"market"}')
  await mkdir(layout.workspace, { recursive: true })
  await mkdir(path.join(layout.dshHome, 'sessions', 'keep'), { recursive: true })
  await writeFile(path.join(layout.workspace, 'keep.txt'), 'workspace')
  await writeFile(path.join(layout.dshHome, 'sessions', 'keep', 'session.jsonl'), 'private conversation')
  return layout
}

test('doctor is read-only and distinguishes repairable generated state from a missing payload', async (t) => {
  const layout = await fixture(t)
  const first = await diagnosePortable(layout)
  assert.equal(first.ok, true)
  assert.equal(first.checks.every((check) => check.status === 'ok'), true)

  await rm(layout.desktopBridgePatch)
  const broken = await diagnosePortable(layout)
  assert.equal(broken.ok, false)
  assert.equal(broken.needsFullPackage, true)
  assert.equal(broken.checks.some((check) => check.id === 'runtime.desktopBridge' && check.status === 'error'), true)
  await assert.rejects(readFile(layout.desktopBridgePatch), { code: 'ENOENT' })
})

test('doctor reports a missing Windows desktop dependency as a complete-package repair', { skip: process.platform !== 'win32' }, async (t) => {
  const layout = await fixture(t)
  await rm(layout.webView2Loader)
  const broken = await diagnosePortable(layout)
  assert.equal(broken.ok, false)
  assert.equal(broken.needsFullPackage, true)
  assert.equal(broken.checks.some((check) => check.id === 'shell.webView2Loader' && check.status === 'error'), true)
})

test('doctor detects a missing transitive DSH package before the profile fails to boot', async (t) => {
  const layout = await fixture(t)
  await writeFile(path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    dependencies: { '@deepseek-ai/missing-runtime-package': '1.0.0' },
  }))

  const broken = await diagnosePortable(layout)
  assert.equal(broken.ok, false)
  assert.equal(broken.needsFullPackage, true)
  assert.equal(broken.checks.some(check => check.id === 'runtime.dshDependencyClosure'
    && check.status === 'error'
    && check.detail.includes('@deepseek-ai/missing-runtime-package')), true)
})

test('doctor detects and repair rebuilds a missing managed profile resolver without replacing the package', async (t) => {
  const layout = await fixture(t)
  const packageName = '@deepseek-ai/dsh-client-ui-jobs'
  const packaged = path.join(layout.appDir, 'node_modules', ...packageName.split('/'))
  const resolver = path.join(layout.dshHome, 'profiles', 'node_modules', ...packageName.split('/'))
  await mkdir(packaged, { recursive: true })
  await writeFile(path.join(packaged, 'package.json'), JSON.stringify({ name: packageName }))
  await writeFile(path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    dependencies: { [packageName]: '1.0.0' },
  }))

  const broken = await diagnosePortable(layout)
  assert.equal(broken.ok, false)
  assert.equal(broken.needsFullPackage, false)
  assert.equal(broken.checks.some(check => check.id === 'generated.dshProfileResolver'
    && check.status === 'error'
    && check.repairable === true
    && check.detail.includes(packageName)), true)
  await assert.rejects(realpath(resolver), { code: 'ENOENT' }, 'doctor must remain read-only')

  const repaired = await repairPortable(layout, { running: false })
  assert.equal(repaired.ok, true)
  assert.ok(repaired.actions.includes('rebuild-managed-profile-resolver'))
  assert.equal(await realpath(resolver), await realpath(packaged))
  assert.equal(repaired.checks.some(check => check.id === 'generated.dshProfileResolver'
    && check.status === 'ok'), true)
})

test('repair rebuilds only generated resolver links and preserves durable user data', async (t) => {
  const layout = await fixture(t)
  const staleFallback = path.join(layout.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'stale')
  await mkdir(staleFallback, { recursive: true })
  await writeFile(path.join(staleFallback, 'package.json'), '{}')
  const packaged = path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'required')
  await mkdir(packaged, { recursive: true })
  await writeFile(path.join(packaged, 'package.json'), '{"name":"@deepseek-ai/required"}')
  await writeFile(path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    dependencies: { '@deepseek-ai/required': '1.0.0' },
  }))

  const result = await repairPortable(layout, { running: false })
  assert.equal(result.ok, true)
  assert.ok(result.actions.includes('rebuild-managed-profile-resolver'))
  assert.equal(await readFile(path.join(layout.workspace, 'keep.txt'), 'utf8'), 'workspace')
  assert.equal(await readFile(path.join(layout.dshHome, 'sessions', 'keep', 'session.jsonl'), 'utf8'), 'private conversation')
})

test('repair never mutates generated runtime state while DSH is running', async (t) => {
  const layout = await fixture(t)
  const result = await repairPortable(layout, { running: true })
  assert.equal(result.ok, false)
  assert.equal(result.deferred, true)
  assert.deepEqual(result.actions, [])
})

test('support report is bounded, useful, and removes credentials and conversation content', async (t) => {
  const layout = await fixture(t)
  await mkdir(layout.logsDir, { recursive: true })
  await writeFile(path.join(layout.logsDir, 'launcher.log'), `${'x'.repeat(200000)}\nBearer secret-token\napi_key=sk-private\ncontrolToken=portable-control-secret\n{"workspaceAuthToken":"workspace-auth-secret"}\ndsh web: http://127.0.0.1:3080/?token=workspace-secret\nnormal line`)
  await writeFile(path.join(layout.logsDir, 'launcher.log.previous'), 'previous startup phase')
  await writeFile(path.join(layout.logsDir, 'startup-latest.jsonl'), '{"startupId":"latest","phase":"complete","token":"startup-secret"}\n')
  await writeFile(path.join(layout.logsDir, 'startup-previous.jsonl'), '{"startupId":"previous","phase":"host-wait-begin"}\n')
  const output = path.join(layout.root, 'support.json')
  const result = await exportPortableSupportReport(layout, output)
  assert.equal(result.output, output)
  assert.ok(result.bytes < 512 * 1024)
  const source = await readFile(output, 'utf8')
  assert.match(source, /normal line/)
  assert.match(source, /previous startup phase/)
  assert.match(source, /launcher\.log\.previous/)
  assert.match(source, /startup-latest\.jsonl/)
  assert.match(source, /startup-previous\.jsonl/)
  assert.match(source, /host-wait-begin/)
  assert.match(source, /runtimeProcesses/)
  assert.doesNotMatch(source, /secret-token|sk-private|portable-control-secret|workspace-auth-secret|workspace-secret|startup-secret|private conversation/)
  assert.match(source, /\[REDACTED\]/)
})

test('Windows support diagnostics summarize terminal-storm process counts without command lines', () => {
  const counts = summarizeWindowsTasklist([
    '"OpenConsole.exe","100","Console","1","10,000 K"',
    '"openconsole.exe","101","Console","1","10,000 K"',
    '"WindowsTerminal.exe","102","Console","1","20,000 K"',
    '"unrelated.exe","103","Console","1","1,000 K"',
  ].join('\r\n'))
  assert.equal(counts['OpenConsole.exe'], 2)
  assert.equal(counts['WindowsTerminal.exe'], 1)
  assert.equal(counts['DeepSeek-Herness.exe'], 0)
  assert.equal(Object.hasOwn(counts, 'unrelated.exe'), false)
})
