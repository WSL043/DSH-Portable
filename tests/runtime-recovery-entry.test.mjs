import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createRuntimeCapsule } from '../scripts/create-runtime-capsule.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'

test('repair entry restores a broken capsule before loading it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-recovery-entry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  const source = path.join(root, 'fixture-app')
  const files = {
    'package.json': '{}',
    'node_modules/@deepseek-ai/dsh/package.json': '{"name":"@deepseek-ai/dsh"}',
    'node_modules/@deepseek-ai/dsh/lib/bin.js': '',
    'node_modules/@wsl043/dsh-portable-desktop-bridge/package.json': '{"name":"@wsl043/dsh-portable-desktop-bridge"}',
    'node_modules/@wsl043/dsh-portable-desktop-bridge/cordis.patch.yml': '',
    'node_modules/@wsl043/dsh-portable-plugin-market/package.json': '{"name":"@wsl043/dsh-portable-plugin-market"}',
    'node_modules/pnpm/bin/pnpm.cjs': '',
    'node_modules/.bin/pnpm.cmd': '',
    'node_modules/.bin/pnpm': '',
  }
  for (const [relative, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(source, relative)), { recursive: true })
    await writeFile(path.join(source, relative), bytes)
  }
  await mkdir(path.join(root, 'launcher'), { recursive: true })
  for (const entry of await readdir(new URL('../launcher/', import.meta.url))) {
    if (entry.endsWith('.mjs')) await cp(new URL(`../launcher/${entry}`, import.meta.url), path.join(root, 'launcher', entry))
  }
  for (const filename of [layout.nodeExe, ...(process.platform === 'linux' ? [layout.packageManagerBin] : []), ...(process.platform === 'win32' ? [layout.desktopExe, layout.webView2Core, layout.webView2WinForms, layout.webView2Loader] : [])]) {
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, '')
  }
  const backup = path.join(layout.updateDir, 'entry-test', 'backup')
  await mkdir(backup, { recursive: true })
  const original = await createRuntimeCapsule(source, path.join(backup, 'DSH-App.dshpack'), path.join(backup, 'runtime-capsule.json'), { level: 1 })
  original.filename = 'runtime/DSH-App.dshpack'
  await writeFile(path.join(backup, 'runtime-capsule.json'), JSON.stringify(original))
  await writeFile(path.join(root, 'runtime-capsule.json'), 'broken manifest')
  await mkdir(path.dirname(layout.updateJournal), { recursive: true })
  await writeFile(layout.updateJournal, JSON.stringify({ schemaVersion: 1, operationId: 'entry-test', kind: 'dsh-runtime-capsule', phase: 'testing', hadLicenses: [] }))
  await writeFile(path.join(layout.dataDir, 'sentinel'), 'preserve user data')
  const env = { ...process.env, DSH_PORTABLE_STATE_ROOT: root, DSH_PORTABLE_RUNTIME_ROOT: root,
    DSH_PORTABLE_ENVIRONMENT: 'default', DSH_PORTABLE_RUNTIME_CACHE: path.join(root, 'cache') }
  const run = () => promisify(execFile)(process.execPath, [path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', 'repair', '--json'],
    { env, windowsHide: true, timeout: 20000 })
  const { stdout } = await run()
  assert.equal(JSON.parse(stdout).ok, true, stdout)
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'runtime-capsule.json'), 'utf8')), original)
  assert.equal(await readFile(path.join(layout.dataDir, 'sentinel'), 'utf8'), 'preserve user data')
  await assert.rejects(readFile(layout.updateJournal), { code: 'ENOENT' })
})
