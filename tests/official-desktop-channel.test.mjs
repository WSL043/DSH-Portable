import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generateChannel } from '../experiments/official-payload/channel/build-channel.mjs';
import { CHANNEL_BASE_URL, CHANNEL_INDEX_URL } from '../experiments/official-payload/channel/constants.mjs';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const yaml = requireApp('js-yaml');
const digest = Buffer.alloc(64, 9).toString('base64');
const installer = version => `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-${version}-win-x64.exe`;
const entry = (version, overrides = {}) => ({ version, installerUrl: installer(version), sha512: digest, size: 1_000_000, qualifiedAt: '2026-09-29T12:00:00.000Z', ...overrides });

test('channel versions use semver order, deduplicate, and retain the newest 20 including latest two', () => {
  const result = generateChannel({
    existingIndex: { schemaVersion: 1, versions: [entry('0.2.0'), entry('0.2.0-rc.10'), entry('0.2.0-rc.2'), entry('0.2.0-rc.2')] },
    candidate: entry('0.2.1-rc.1'), launcherBytes: Buffer.from('launcher'), qualifiedAt: '2026-09-30T00:00:00.000Z',
  });
  assert.deepEqual(result.index.versions.map(item => item.version), ['0.2.0-rc.2', '0.2.0-rc.10', '0.2.0', '0.2.1-rc.1']);

  const many = Array.from({ length: 21 }, (_, i) => entry(`1.0.${i}`));
  const capped = generateChannel({ existingIndex: { schemaVersion: 1, versions: many }, candidate: entry('1.0.21'), launcherBytes: Buffer.from('launcher') });
  assert.equal(capped.index.versions.length, 20);
  assert.equal(capped.index.versions[0].version, '1.0.2');
  assert.deepEqual(capped.launcherFiles, ['deepseek-harness-1.0.20-win-x64.exe', 'deepseek-harness-1.0.21-win-x64.exe']);
});

test('same-version identity changes are rejected, while an empty missing index is supported', () => {
  assert.throws(() => generateChannel({ existingIndex: { schemaVersion: 1, versions: [entry('0.2.0-rc.2')] }, candidate: entry('0.2.0-rc.2', { size: 1_000_001 }), launcherBytes: Buffer.from('launcher') }), /identity changed/);
  assert.throws(() => generateChannel({ existingIndex: { schemaVersion: 1, versions: [entry('0.2.0-rc.2')] }, candidate: entry('0.2.0-rc.2', { sha512: Buffer.alloc(64, 8).toString('base64') }), launcherBytes: Buffer.from('launcher') }), /identity changed/);
  const empty = generateChannel({ candidate: entry('0.2.0-rc.2'), launcherBytes: Buffer.from('launcher') });
  assert.deepEqual(empty.index.versions.map(item => item.version), ['0.2.0-rc.2']);
});

test('installer URL host and path exactly match the PowerShell official payload allowlist', async () => {
  const payload = await readFile(new URL('../experiments/official-payload/Payload.psm1', import.meta.url), 'utf8');
  assert.match(payload, /\$script:OfficialInstallerPrefix\s*=\s*'([^']+)'/);
  const prefix = payload.match(/\$script:OfficialInstallerPrefix\s*=\s*'([^']+)'/)[1];
  assert.equal(prefix, '/dsh-desk/bin/win-x64/');
  assert.match(payload, /\$uri\.Host\s+-cne\s+'download\.deepseek\.com'/);
  assert.throws(() => generateChannel({ candidate: entry('0.2.0', { installerUrl: 'https://download.deepseek.com.evil.test/dsh-desk/bin/win-x64/a.exe' }), launcherBytes: Buffer.from('x') }), /Untrusted installer URL/);
  assert.throws(() => generateChannel({ candidate: entry('0.2.0', { installerUrl: 'https://download.deepseek.com/elsewhere/a.exe' }), launcherBytes: Buffer.from('x') }), /Untrusted installer URL/);
});

test('generated generic feed parses, includes required fields, and names a launcher-recognized update copy', async () => {
  const launcherBytes = Buffer.from('mock launcher bytes');
  const result = generateChannel({ candidate: entry('0.2.0-rc.2'), launcherBytes, qualifiedAt: '2026-09-30T00:00:00.000Z' });
  const feed = yaml.load(result.feed);
  const expectedName = 'deepseek-harness-0.2.0-rc.2-win-x64.exe';
  assert.equal(feed.version, '0.2.0-rc.2');
  assert.equal(feed.files[0].url, `${CHANNEL_BASE_URL}${expectedName}`);
  assert.equal(feed.files[0].sha512, result.launcherSha512);
  assert.equal(feed.files[0].size, launcherBytes.length);
  assert.equal(feed.path, expectedName);
  assert.equal(feed.sha512, result.launcherSha512);
  assert.equal(feed.releaseDate, '2026-09-30T00:00:00.000Z');
  const launcher = await readFile(new URL('../experiments/official-payload/Launcher.cs', import.meta.url), 'utf8');
  const pattern = launcher.match(/UpdatedName\s*=\s*new Regex\(@"([^\"]+)"/);
  assert.ok(pattern, 'could not extract UpdatedName regex from Launcher.cs');
  assert.match(expectedName, new RegExp(pattern[1], 'i'));
});

test('production channel URLs are centralized and flow into package-pure follow.json', async () => {
  assert.equal(CHANNEL_INDEX_URL, `${CHANNEL_BASE_URL}index.json`);
  const packageScript = await readFile(new URL('../experiments/official-payload/package-pure.ps1', import.meta.url), 'utf8');
  assert.match(packageScript, /\$follow\s*=\s*\[ordered\]\s*@\{\s*indexUrl=\$IndexUrl;\s*feedUrl=\$FeedUrl;/);
  assert.match(packageScript, /Expand-OfficialPayload\s+\$Installer\s+\$candidate\s+\$partial\s+\$SevenZip\s+\$FeedUrl\s+\$CacheDirName/);
});

test('generator CLI writes an index, generic feed, and launcher copies from a missing index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'official-channel-'));
  try {
    const launcher = join(directory, 'launcher.exe');
    const candidate = join(directory, 'candidate.json');
    const output = join(directory, 'out');
    await writeFile(launcher, Buffer.from('launcher mock'));
    await writeFile(candidate, JSON.stringify({ ...entry('0.2.0-rc.2'), url: installer('0.2.0-rc.2'), installerUrl: undefined }));
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../experiments/official-payload/channel/build-channel.mjs', import.meta.url)), '--candidate', candidate, '--launcher', launcher, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const index = JSON.parse(await readFile(join(output, 'index.json'), 'utf8'));
    assert.equal(index.versions[0].version, '0.2.0-rc.2');
    assert.equal(yaml.load(await readFile(join(output, 'nightly.yml'), 'utf8')).version, '0.2.0-rc.2');
    assert.deepEqual(result.stdout && JSON.parse(result.stdout).launcherFiles, ['deepseek-harness-0.2.0-rc.2-win-x64.exe']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
