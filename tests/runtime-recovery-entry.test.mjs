import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createRuntimeCapsule } from '../scripts/create-runtime-capsule.mjs'
import { layoutForRoot } from '../launcher/portable-core.mjs'
import { platformUpdateKey } from '../launcher/update-core.mjs'

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


test('update metadata and choices work without a capsule cache while runtime mutations stay guarded', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-metadata-entry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'launcher'))
  for (const entry of await readdir(new URL('../launcher/', import.meta.url))) {
    if (entry.endsWith('.mjs')) await cp(new URL('../launcher/' + entry, import.meta.url), path.join(root, 'launcher', entry))
  }
  await mkdir(path.join(root, 'licenses'))
  await writeFile(path.join(root, 'licenses/COMPONENTS.json'), JSON.stringify({
    portableVersion: '0.9.7', dshVersion: '0.2.1-rc.3', nodeVersion: process.versions.node,
    updaterSchema: 1, shellSchema: 1, shellContract: 1, runtimeLayout: 'capsule-v1',
  }))
  await writeFile(path.join(root, 'runtime-capsule.json'), '{damaged')
  const cache = path.join(root, 'blocked-cache'), state = path.join(root, 'installed-state')
  await writeFile(cache, 'not a directory')
  const platform = platformUpdateKey()
  const manifests = Object.fromEntries(['product', 'engine'].map(scope => [scope, {
    schemaVersion: 1, updateKind: scope, portableVersion: scope === 'product' ? '0.9.8' : '0.9.7',
    releaseChannel: 'stable', platform, minimumUpdaterSchema: 1, requiredShellSchema: 1, requiredShellContract: 1,
    targetRuntimeLayout: 'capsule-v1', component: {
      kind: 'dsh-runtime-capsule', dshVersion: '0.2.1-rc.4', requiredNodeVersion: process.versions.node,
      runtimeLayout: 'capsule-v1', bytes: 1, sha256: 'a'.repeat(64), urls: ['https://example.com/core.zip'],
    },
  }]))
  const preload = path.join(root, 'feed-fixture.mjs')
  await writeFile(preload, 'const manifests = ' + JSON.stringify(manifests) + ';\n' + [
    'globalThis.fetch = async value => {',
    "  const url = new URL(value), scope = url.pathname.includes('dsh-core') ? 'engine' : 'product';",
    '  const manifest = manifests[scope];',
    "  const body = url.pathname.includes('index-') ? { schemaVersion: 1, releaseChannel: 'stable', versions: [{",
    "    version: scope === 'engine' ? manifest.component.dshVersion : manifest.portableVersion, manifest,",
    "    manifestUrl: 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-update-" + platform + "-0.9.8.json',",
    '  }] } : manifest;',
    '  return new Response(JSON.stringify(body));',
    '};',
  ].join('\n'))
  const env = { ...process.env, DSH_PORTABLE_STATE_ROOT: state, DSH_PORTABLE_ENVIRONMENT: 'research',
    DSH_PORTABLE_RUNTIME_ROOT: path.join(root, 'stale-runtime'), DSH_PORTABLE_RUNTIME_CACHE: cache }
  const run = (command, scope = 'product', extra = []) => promisify(execFile)(process.execPath, [
    '--import', pathToFileURL(preload).href, path.join(root, 'launcher/runtime-entry.mjs'), 'portable-cli.mjs',
    command, '--scope', scope, '--json', ...extra,
  ], { env, windowsHide: true, timeout: 20000 })
  const result = async (command, scope) => JSON.parse((await run(command, scope)).stdout)
  for (const scope of ['product', 'engine']) {
    assert.equal((await result('list-updates', scope)).versions[0].status, 'available')
    assert.equal((await result('check-update', scope)).status, 'available')
    assert.equal((await result('defer-update', scope)).status, 'deferred')
    assert.equal((await result('check-update', scope)).status, 'deferred')
    assert.equal((await result('ignore-update', scope)).status, 'ignored')
    assert.equal((await result('check-update', scope)).status, 'ignored')
    const cacheFile = path.join(state, 'data/runtime', scope === 'engine' ? 'engine-update-check.json' : 'update-check.json')
    assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).manifest.updateKind, scope)
  }
  await assert.rejects(readFile(path.join(state, 'environments/research/data/runtime/update-check.json')), { code: 'ENOENT' })
  const localManifest = path.join(root, 'unsigned.json')
  await writeFile(localManifest, JSON.stringify(manifests.product))
  await writeFile(localManifest + '.sig', 'invalid signature')
  await assert.rejects(run('check-update', 'product', ['--input', localManifest]), error => error.stderr.includes('UPDATE_LOCAL_PACKAGE_INVALID'))
  for (const command of ['start', 'update']) {
    await assert.rejects(run(command), error => error.stderr.includes('runtime-capsule.json') || error.stderr.includes('JSON'))
  }
  await rm(path.join(root, 'licenses/COMPONENTS.json'))
  await assert.rejects(run('defer-update'), error => error.stderr.includes('Installed component metadata'))
  assert.equal(await readFile(cache, 'utf8'), 'not a directory')
  assert.equal(await readFile(path.join(root, 'runtime-capsule.json'), 'utf8'), '{damaged')
})
