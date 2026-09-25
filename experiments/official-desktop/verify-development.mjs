import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { resolve, join } from 'node:path';

// Executes the reviewed, adapted real coordinator with inert update I/O.
const directory = resolve(process.argv[2]);
const source = await readFile(join(directory, 'update-coordinator.ts'), 'utf8');
const mainSource = await readFile(join(directory, 'main.ts'), 'utf8');
const pathSetup = mainSource.indexOf('configureDevelopmentPaths(app)');
const electronLogSetup = mainSource.indexOf('app.setAppLogsPath()');
assert.ok(pathSetup >= 0 && (electronLogSetup < 0 || electronLogSetup > pathSetup), 'Portable paths must be configured before Electron chooses its log directory');
assert.equal(mainSource.split('configureDevelopmentPaths(app)').length - 1, 1);
assert.doesNotMatch(mainSource, /'dshMandatoryUpdatePolicy' in manifest/, 'development must not inherit packaged mandatory-update policy');
const compiled = stripTypeScriptTypes(source.replace(/^import .*\n/gm, '').replace('const { autoUpdater } = electronUpdater', 'const autoUpdater = {}').replace('export class ', 'class '), { mode: 'transform' });
const Coordinator = vm.runInNewContext(`${compiled}\nDesktopUpdateCoordinator`, {
  app: { getVersion: () => '0.1.6-alpha.2' },
  DesktopUpdatePreparationError: class extends Error {},
});
const updater = new EventEmitter();
let calls = 0;
for (const name of ['checkForUpdates', 'downloadUpdate', 'quitAndInstall']) updater[name] = () => { calls++; throw new Error('Official update I/O must not run'); };
const coordinator = new Coordinator(state => state, async () => true, updater);
const check = await coordinator.check();
assert.equal(check.phase, 'error');
assert.match(check.message, /no packaged update source/);
await assert.rejects(() => coordinator.download());
await assert.rejects(() => coordinator.install());
assert.equal(calls, 0);
coordinator.dispose();
// Parse all generated TypeScript as a syntax check; this is not a full upstream build.
for (const name of ['main.ts', 'portable-development.ts']) stripTypeScriptTypes(await readFile(join(directory, name), 'utf8'), { mode: 'transform' });
try {
  const developmentLauncher = await readFile(join(directory, 'dev.ts'), 'utf8');
  assert.match(developmentLauncher, /if \(values\['prepare-only'\]\) return/);
  stripTypeScriptTypes(developmentLauncher, { mode: 'transform' });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log(JSON.stringify({ qualified: false, updaterIoCalls: calls, generatedSyntax: 'passed', evidence: 'Actual adapted coordinator with inert I/O; not Electron application acceptance' }));
