import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { rewriteAppUpdateYml } from '../experiments/official-payload/contract/update-config.mjs';

const contractDir = new URL('../experiments/official-payload/contract/', import.meta.url);

test('feed publishes version, stub SHA-512, size, URL, and logs 404 routes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-contract-feed-'));
  const stub = join(root, 'stub.exe');
  const log = join(root, 'requests.jsonl');
  await writeFile(stub, Buffer.from('contract stub bytes'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('feed.mjs', contractDir)), '0.2.1-contract.0', stub, '0', log], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('feed did not print its ready JSON')), 5000);
    const lines = createInterface({ input: child.stdout });
    lines.once('line', line => { clearTimeout(timer); lines.close(); resolve(JSON.parse(line)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => { if (String(chunk).trim()) reject(new Error(String(chunk))); });
  });
  assert.ok(ready.port > 0);
  const ymlResponse = await fetch(`${ready.baseUrl}nightly.yml`);
  assert.equal(ymlResponse.status, 200);
  const yml = await ymlResponse.text();
  assert.match(yml, /version: 0\.2\.1-contract\.0/);
  assert.match(yml, /url: deepseek-harness-0\.2\.1-contract\.0-win-x64\.exe/);
  assert.match(yml, /sha512: [A-Za-z0-9+/]+=*/);
  assert.match(yml, /size: 19/);
  assert.match(yml, /path: deepseek-harness-0\.2\.1-contract\.0-win-x64\.exe/);
  assert.match(yml, /releaseDate:/);
  assert.equal(ready.size, 19);
  const binary = await fetch(new URL(ready.filename, ready.baseUrl));
  assert.equal(binary.status, 200);
  assert.equal(Buffer.from(await binary.arrayBuffer()).toString(), 'contract stub bytes');
  const missing = await fetch(`${ready.baseUrl}deepseek-harness-0.2.1-contract.0-win-x64.exe.blockmap`);
  assert.equal(missing.status, 404);
  const logged = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(logged.map(({ path, status }) => [path, status]), [
    ['/nightly.yml', 200],
    [`/${ready.filename}`, 200],
    [`/${ready.filename}.blockmap`, 404],
  ]);
});

test('app-update rewrite preserves channel, removes publisher, and is stable', () => {
  const source = [
    'provider: generic',
    'url: https://download.deepseek.com/dsh-desk/feeds/win-x64/',
    'channel: nightly',
    "updaterCacheDirName: '@deepseek-aidsh-desktop-updater'",
    'publisherName:',
    '  - CN=Hangzhou DeepSeek',
    '',
  ].join('\n');
  const expected = [
    'provider: generic',
    'url: http://127.0.0.1:45321/',
    'channel: nightly',
    'updaterCacheDirName: dsh-contract-probe-abc123',
    '',
  ].join('\n');
  const first = rewriteAppUpdateYml(source, 'http://127.0.0.1:45321/', 'dsh-contract-probe-abc123');
  assert.equal(first, expected);
  assert.equal(rewriteAppUpdateYml(first, 'http://127.0.0.1:45321/', 'dsh-contract-probe-abc123'), expected);
  assert.doesNotMatch(first, /^publisherName:/m);
});
