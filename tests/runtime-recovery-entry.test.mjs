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

test('stop and status do not prepare a damaged capsule or require a writable cache', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-control-entry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'launcher'), { recursive: true })
  for (const entry of await readdir(new URL('../launcher/', import.meta.url))) {
    if (entry.endsWith('.mjs')) await cp(new URL(`../launcher/${entry}`, import.meta.url), path.join(root, 'launcher', entry))
  }
  await writeFile(path.join(root, 'runtime-capsule.json'), '{damaged')
  const cache = path.join(root, 'blocked-cache')
  await writeFile(cache, 'not a directory')
  const env = { ...process.env, DSH_PORTABLE_STATE_ROOT: root, DSH_PORTABLE_ENVIRONMENT: 'default', DSH_PORTABLE_RUNTIME_CACHE: cache }
  for (const [command, expected] of [['status', 'stopped'], ['stop', 'not-running']]) {
    const { stdout } = await promisify(execFile)(process.execPath, [
      path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs', command, '--json',
    ], { env, windowsHide: true, timeout: 20000 })
    assert.equal(JSON.parse(stdout).status, expected)
  }
  assert.equal(await readFile(cache, 'utf8'), 'not a directory')
  assert.equal(await readFile(path.join(root, 'runtime-capsule.json'), 'utf8'), '{damaged')
})

test('control rejects linked state descendants under custom and named state roots', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-control-state-link-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  await mkdir(path.join(root,'launcher'))
  for (const entry of await readdir(new URL('../launcher/',import.meta.url))) if(entry.endsWith('.mjs')) await cp(new URL('../launcher/'+entry,import.meta.url),path.join(root,'launcher',entry))
  const { environmentStateRoot }=await import('../launcher/portable-core.mjs')
  const { symlink }=await import('node:fs/promises')
  const base=path.join(root,'external-state'), outside=path.join(root,'outside')
  await mkdir(outside); const bytes=JSON.stringify({pid:process.pid})
  await writeFile(path.join(outside,'process.json'),bytes)
  for(const name of ['default','work']) {
    const stateRoot=environmentStateRoot(base,name,process.platform)
    await mkdir(path.join(stateRoot,'data'),{recursive:true})
    await symlink(outside,path.join(stateRoot,'data/runtime'),process.platform==='win32'?'junction':'dir')
    for(const command of ['stop','status']) await assert.rejects(promisify(execFile)(process.execPath,[path.join(root,'launcher/runtime-entry.mjs'),'portable-cli.mjs',command,'--json','--environment',name],{env:{...process.env,DSH_PORTABLE_STATE_ROOT:base},windowsHide:true,timeout:20000}), error=>error.stderr.includes('Unsafe restore path'))
  }
  assert.equal(await readFile(path.join(outside,'process.json'),'utf8'),bytes)
})
