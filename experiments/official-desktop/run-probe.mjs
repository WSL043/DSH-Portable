import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('build/official-desktop-probe');
const runtime = join(root, 'runtime', 'electron.exe');
const runRoot = join(root, `run-${Date.now()}`);
await mkdir(runRoot, { recursive: true });
async function run(directory, name) {
  const output = join(runRoot, `${name}.json`);
  const env = { ...process.env, DSH_HOME: join(directory, 'data', 'dsh-home'), PORTABLE_PROBE_OUTPUT: output };
  delete env.ELECTRON_RUN_AS_NODE;
  await mkdir(env.DSH_HOME, { recursive: true });
  await new Promise((accept, reject) => {
    const child = spawn(runtime, [resolve('experiments/official-desktop/probe.cjs'), `--user-data-dir=${join(directory, 'data', 'browser')}`],
      { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8000); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Hidden Electron probe timed out')); }, 30_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? accept() : reject(new Error(`Probe exited ${code}: ${errors}`)); });
  });
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.visible, false);
  return result;
}
const a = join(runRoot, 'A');
const b = join(runRoot, 'B');
const first = await run(a, 'first');
assert.equal(first.before, null);
await rename(a, b);
const moved = await run(b, 'moved');
assert.equal(moved.before, 'synthetic-test-value');
const cookieRetained = moved.cookiesBefore.some(c => c.name === 'portable-probe' && c.value === 'synthetic-cookie');
const pathsOutsideRoot = Object.entries(moved.paths).filter(([, path]) => {
  const rel = relative(b, path);
  return rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel);
});
const result = { evidence: 'Electron 44 substrate only, hidden window; not official DSH desktop or complete filesystem-write audit',
  first, moved, localStorageRetained: true, cookieRetained, pathsOutsideRoot };
await writeFile(join(runRoot, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ runRoot, localStorageRetained: true, cookieRetained, pathsOutsideRoot }, null, 2));
