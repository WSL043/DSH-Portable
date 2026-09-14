// Execute pinned upstream path/updater modules with explicit host doubles.
// This proves module behavior, not native updater installation or DSH startup.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const sourceRoot = resolve(process.argv[2] || 'build/official-desktop-research');
const output = resolve(process.argv[3] || 'build/official-desktop-probe/source.json');
const commit = (await readFile(join(sourceRoot, 'commit.txt'), 'utf8')).trim();
async function load(source, imports, env = {}) {
  const context = vm.createContext({ process: { env, resourcesPath: 'probe-resources' } });
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'transform' }), { context });
  await module.link(id => {
    if (!Object.hasOwn(imports, id)) throw new Error(`Unexpected upstream dependency: ${id}`);
    return new vm.SyntheticModule(Object.keys(imports[id]), function () {
      for (const [key, value] of Object.entries(imports[id])) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}
const read = name => readFile(join(sourceRoot, name.replaceAll('/', '__')), 'utf8');
const dataRoot = resolve('build/official-desktop-probe/synthetic/data');
const home = await load(await read('packages/util/home-paths/src/index.ts'), {
  'node:fs/promises': require('node:fs/promises'), 'node:os': require('node:os'), 'node:path': require('node:path'),
}, { DSH_HOME: dataRoot });
const paths = (await load(await read('apps/desktop/src/paths.ts'), {
  'node:path': require('node:path'), '@deepseek-ai/dsh-home-paths': home,
})).resolveDesktopPaths();
assert.equal(paths.profile, join(dataRoot, 'profiles', 'desktop'));
assert.equal(paths.pnpm.store, join(dataRoot, 'desktop', 'pnpm', 'store'));
const source = await read('apps/desktop/src/update-coordinator.ts');
const cases = [];
for (const configured of [false, true]) {
  const calls = [];
  const updater = {
    async checkForUpdates() { calls.push('check'); return { isUpdateAvailable: true, updateInfo: { version: '999.0.0' } }; },
    async downloadUpdate() { calls.push('download'); }, quitAndInstall() { calls.push('install'); },
  };
  const { DesktopUpdateCoordinator } = await load(source, {
    'node:fs': { existsSync: () => configured }, 'node:path': require('node:path'),
    electron: { app: { isPackaged: true } }, 'electron-updater': { default: { autoUpdater: updater } },
  }, { DSH_HOME: dataRoot, PORTABLE_EXECUTABLE_DIR: dataRoot });
  const coordinator = new DesktopUpdateCoordinator(state => state);
  const state = await coordinator.check();
  assert.equal(state.phase, configured ? 'available' : 'idle');
  assert.equal(calls.length, configured ? 1 : 0);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  if (configured) { await coordinator.install(); assert.deepEqual(calls, ['check', 'download', 'install']); }
  else await assert.rejects(() => coordinator.install(), /no verified update/);
  cases.push({ configured, state, calls, autoDownload: updater.autoDownload, autoInstallOnAppQuit: updater.autoInstallOnAppQuit });
}
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify({ commit, evidence: 'Original upstream modules transpiled with host doubles; no real update downloaded or installed', paths, cases }, null, 2));
console.log('Upstream path and updater module probes passed. Native artifact qualification remains separate.');
