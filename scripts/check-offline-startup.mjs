// Backend-only acceptance. Network scope is the accompanying Node TCP fixture,
// not the operating system, native processes, or local-model inference.
import { ensureRuntimeCapsule } from '../launcher/runtime-capsule.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '');
const evidence = path.resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) throw Error('Provide package root and new evidence directory.');
await mkdir(evidence); // Never reuse old state for a first-start claim.
const guard = path.resolve(import.meta.dirname, 'offline-loopback-guard.cjs');
const env = { ...process.env, NODE_OPTIONS: `--require "${guard.replaceAll('\\', '/')}"`,
  DSH_PORTABLE_STATE_ROOT: evidence,
  DSH_PORTABLE_RUNTIME_CACHE: path.join(evidence, 'runtime-cache'),
  DSH_OFFLINE_EVIDENCE: path.join(evidence, 'blocked-connections.jsonl'),
};
for (const key of Object.keys(env)) if (/^(https?|all|no)_proxy$/i.test(key)) delete env[key];
env.NODE_USE_ENV_PROXY = '0';
process.env.DSH_OFFLINE_EVIDENCE = env.DSH_OFFLINE_EVIDENCE;
await import(pathToFileURL(guard).href);
let denied = false;
try { net.connect({ host: '192.0.2.1', port: 80 }); } catch (error) { denied = error.code === 'ENETUNREACH'; }
if (!denied) throw Error('Negative control did not block an external connection.');
const prepared = await ensureRuntimeCapsule(root, { env });
env.DSH_PORTABLE_RUNTIME_ROOT = prepared.runtimeRoot;
const executable = path.join(root, 'runtime/node/node.exe');
const cli = path.join(root, 'launcher/portable-cli.mjs');
function command(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [cli, name, '--no-browser', '--json'], {env,windowsHide:true});
    let out = '', err = '';
    child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    child.on('error', reject); child.on('exit', code => {
      if (code !== 0) reject(Error(`${name} failed (${code}): ${err}`));
      else resolve(JSON.parse(out.trim().split('\n').at(-1)));
    });
  });
}
let started;
try {
  started = await command('start');
  const endpoint = new URL(started.url);
  const token = endpoint.searchParams.get('token');
  const response = await fetch(endpoint, {headers: token ? {authorization:`Bearer ${token}`} : {}});
  // The protected root may require the browser cookie exchange, even though
  // Portable has already verified backend readiness. Do not claim UI acceptance.
  if (![200,401].includes(response.status)) throw Error(`Local HTTP readiness failed: ${response.status}`);
  if(started.defaultPlugins?.status !== 'seeded') throw Error('Default plugins did not seed successfully.');
  const blocked = (await readFile(env.DSH_OFFLINE_EVIDENCE, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const unexpected = blocked.filter(event => event.pid !== process.pid || event.blockedHost !== '192.0.2.1');
  if (unexpected.length) throw Error(`Startup attempted ${unexpected.length} external connections. See blocked-connections.jsonl.`);
  const result = {status:'passed',scope:'Node non-loopback TCP denied; backend startup only',
    os:process.platform,externalProbeDenied:denied,runtimeCacheReused:prepared.reused,
    httpStatus:response.status,defaultPlugins:started.defaultPlugins,externalConnectionAttempts:unexpected.length,localModelInference:'not verified'};
  await writeFile(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { if(started) await command('stop'); }
