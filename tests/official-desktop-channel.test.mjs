import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generateChannel, needsChannelPublication } from '../experiments/official-payload/channel/build-channel.mjs';
import { CHANNEL_BASE_URL, CHANNEL_INDEX_URL } from '../experiments/official-payload/channel/constants.mjs';
import { fetchOfficialDesktopCandidate } from '../experiments/official-payload/feed.mjs';

const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const yaml = requireApp('js-yaml');
const digest = Buffer.alloc(64, 9).toString('base64');
const installer = version => `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-${version}-win-x64.exe`;
const entry = (version, overrides = {}) => ({ version, installerUrl: installer(version), sha512: digest, size: 1_000_000, qualifiedAt: '2026-09-29T12:00:00.000Z', ...overrides });

test('channel versions use semver order, deduplicate, and retain the newest 20 while generating only the candidate launcher', () => {
  const result = generateChannel({
    existingIndex: { schemaVersion: 1, versions: [entry('0.2.0'), entry('0.2.0-rc.10'), entry('0.2.0-rc.2'), entry('0.2.0-rc.2')] },
    candidate: entry('0.2.1-rc.1'), launcherBytes: Buffer.from('launcher'), qualifiedAt: '2026-09-30T00:00:00.000Z',
  });
  assert.deepEqual(result.index.versions.map(item => item.version), ['0.2.0-rc.2', '0.2.0-rc.10', '0.2.0', '0.2.1-rc.1']);

  const many = Array.from({ length: 21 }, (_, i) => entry(`1.0.${i}`));
  const capped = generateChannel({ existingIndex: { schemaVersion: 1, versions: many }, candidate: entry('1.0.21'), launcherBytes: Buffer.from('launcher') });
  assert.equal(capped.index.versions.length, 20);
  assert.equal(capped.index.versions[0].version, '1.0.2');
  assert.deepEqual(capped.launcherFiles, ['deepseek-harness-1.0.21-win-x64.exe']);
});

test('an older candidate cannot put new launcher bytes in the latest version feed', () => {
  assert.throws(() => generateChannel({ existingIndex: { schemaVersion: 1, versions: [entry('0.2.1-rc.2')] },
    candidate: entry('0.2.0-rc.2'), launcherBytes: Buffer.from('new launcher') }), /Candidate is older/);
});

test('same-version identity changes are rejected, while an empty missing index is supported', () => {
  assert.throws(() => generateChannel({ existingIndex: { schemaVersion: 1, versions: [entry('0.2.0-rc.2')] }, candidate: entry('0.2.0-rc.2', { size: 1_000_001 }), launcherBytes: Buffer.from('launcher') }), /identity changed/);
  assert.throws(() => generateChannel({ existingIndex: { schemaVersion: 1, versions: [entry('0.2.0-rc.2')] }, candidate: entry('0.2.0-rc.2', { sha512: Buffer.alloc(64, 8).toString('base64') }), launcherBytes: Buffer.from('launcher') }), /identity changed/);
  const empty = generateChannel({ candidate: entry('0.2.0-rc.2'), launcherBytes: Buffer.from('launcher') });
  assert.deepEqual(empty.index.versions.map(item => item.version), ['0.2.0-rc.2']);
});

test('publication skips an already served or older version and resumes an incomplete channel', () => {
  const candidate = entry('0.2.2-rc.1');
  const index = { schemaVersion: 1, versions: [candidate] };
  const feed = { version: candidate.version, url: CHANNEL_BASE_URL + 'deepseek-harness-0.2.2-rc.1-win-x64.exe' };
  assert.equal(needsChannelPublication(index, candidate, feed), false);
  assert.equal(needsChannelPublication(index, entry('0.2.1'), feed), false);
  assert.equal(needsChannelPublication(index, entry('0.2.2'), feed), true);
  assert.equal(needsChannelPublication(index, candidate), true);
  assert.equal(needsChannelPublication(index, candidate, { ...feed, version: '0.2.1' }), true);
  assert.equal(needsChannelPublication(index, candidate, { ...feed, url: installer(candidate.version) }), true);
  assert.throws(() => needsChannelPublication(index, { ...candidate, size: candidate.size + 1 }, feed), /identity changed/);
  const launcherBytes = Buffer.from('immutable launcher');
  assert.deepEqual(generateChannel({ existingIndex: index, candidate, launcherBytes, qualifiedAt: '2026-11-11T00:00:00Z' }),
    generateChannel({ existingIndex: index, candidate, launcherBytes, qualifiedAt: '2026-11-12T00:00:00Z' }));
});

test('stable and nightly retain independent qualified versions and forbid stable prereleases', () => {
  const launcherBytes = Buffer.from('launcher');
  const nightly = entry('0.3.0-rc.1');
  const stable = entry('0.2.2');
  const index = { schemaVersion: 1, versions: [nightly] };
  const result = generateChannel({ existingIndex: index, candidate: stable, launcherBytes, channel: 'stable' });
  assert.equal(yaml.load(result.feed).version, stable.version);
  assert.equal(result.index.stableVersion, stable.version);
  assert.equal(result.index.nightlyVersion, nightly.version);
  assert.equal(needsChannelPublication(result.index, stable, { version: stable.version, url: CHANNEL_BASE_URL + 'deepseek-harness-0.2.2-win-x64.exe' }, 'stable'), false);
  assert.equal(needsChannelPublication(result.index, entry('0.2.1'), undefined, 'stable'), false);
  assert.throws(() => generateChannel({ existingIndex: index, candidate: nightly, launcherBytes, channel: 'stable' }), /requires a final version/);
  const history = Array.from({ length: 20 }, (_, i) => entry(`1.0.${i}`));
  const latest = generateChannel({ existingIndex: { ...result.index, versions: [...result.index.versions, ...history] }, candidate: entry('1.1.0'), launcherBytes });
  assert.equal(latest.index.versions.length, 20);
  assert.ok(latest.index.versions.some(item => item.version === stable.version));
  assert.equal(yaml.load(latest.feed).version, '1.1.0');
});

test('the official stable feed can be absent and accepts only an official final installer', async () => {
  assert.equal(await fetchOfficialDesktopCandidate('stable', async () => new Response(null, { status: 404 })), null);
  const makeFeed = version => [
    `version: ${version}`, `  - url: ${installer(version)}`, `    sha512: ${digest}`, '    size: 1000000',
  ].join('\n');
  const candidate = await fetchOfficialDesktopCandidate('stable', async (url, options) => {
    assert.match(url, /\/win-x64\/stable\.yml$/);
    assert.equal(options.redirect, 'error');
    return new Response(makeFeed('0.2.2'));
  });
  assert.equal(candidate.version, '0.2.2');
  await assert.rejects(fetchOfficialDesktopCandidate('stable', async () => new Response(makeFeed('0.2.2-rc.2'))), /Invalid official Desktop stable candidate/);
});

test('installer URL host and path exactly match the PowerShell official payload allowlist', async () => {
  const payload = await readFile(new URL('../experiments/official-payload/Payload.psm1', import.meta.url), 'utf8');
  assert.match(payload, /\$script:OfficialInstallerPrefix\s*=\s*'([^']+)'/);
  const prefix = payload.match(/\$script:OfficialInstallerPrefix\s*=\s*'([^']+)'/)[1];
  assert.equal(prefix, '/dsh-desk/bin/win-x64/');
  // The installer must come from exactly https://download.deepseek.com:443 under the prefix; the only other accepted form is the
  // explicit loopback test switch (http, 127.0.0.1), the same kind of switch the feed URL policy already has.
  assert.match(payload, /\$officialUrl\s*=\s*\$uri\.Scheme\s+-ceq\s+'https'\s+-and\s+\$uri\.Host\s+-ceq\s+'download\.deepseek\.com'\s+-and\s+\$uri\.Port\s+-eq\s+443/);
  assert.match(payload, /\$testLocalUrl\s*=\s*\$env:DSH_PORTABLE_TEST_ALLOW_LOCAL_INSTALLER\s+-ceq\s+'1'\s+-and\s+\$uri\.Scheme\s+-ceq\s+'http'\s+-and\s+\$uri\.Host\s+-ceq\s+'127\.0\.0\.1'/);
  assert.match(payload, /if\s+\(-not\s+\$officialUrl\s+-and\s+-not\s+\$testLocalUrl\)\s+\{\s+throw\s+'Untrusted installer URL'\s+\}/);
  assert.throws(() => generateChannel({ candidate: entry('0.2.0', { installerUrl: 'https://download.deepseek.com.evil.test/dsh-desk/bin/win-x64/a.exe' }), launcherBytes: Buffer.from('x') }), /Untrusted installer URL/);
  assert.throws(() => generateChannel({ candidate: entry('0.2.0', { installerUrl: 'https://download.deepseek.com/elsewhere/a.exe' }), launcherBytes: Buffer.from('x') }), /Untrusted installer URL/);
});

test('generated generic feed parses, includes required fields, and names a launcher-recognized update copy', async () => {
  const launcherBytes = Buffer.from('mock launcher bytes');
  const result = generateChannel({ candidate: entry('0.2.0-rc.2', { qualifiedAt: '2026-09-30T00:00:00.000Z' }), launcherBytes });
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

test('a new candidate preserves historical installer identities without regenerating old immutable launcher names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'official-channel-history-'));
  try {
    const launcher = join(directory, 'launcher.exe');
    const candidate = join(directory, 'candidate.json');
    const previous = join(directory, 'index.json');
    const output = join(directory, 'out');
    const historical = entry('0.2.0-rc.2');
    const oldAssetName = 'deepseek-harness-0.2.0-rc.2-win-x64.exe';
    const oldAsset = Buffer.from('historical immutable launcher');
    await writeFile(join(directory, oldAssetName), oldAsset);
    await writeFile(launcher, Buffer.from('new candidate launcher'));
    await writeFile(candidate, JSON.stringify(entry('0.2.1-rc.2')));
    await writeFile(previous, JSON.stringify({ schemaVersion: 1, versions: [historical] }));
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../experiments/official-payload/channel/build-channel.mjs', import.meta.url)),
      '--candidate', candidate, '--launcher', launcher, '--index', previous, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const index = JSON.parse(await readFile(join(output, 'index.json'), 'utf8'));
    assert.deepEqual(index.versions.map(item => item.version), ['0.2.0-rc.2', '0.2.1-rc.2']);
    assert.deepEqual(index.versions[0], historical);
    assert.deepEqual((await readdir(output)).sort(), ['deepseek-harness-0.2.1-rc.2-win-x64.exe', 'index.json', 'nightly.yml']);
    assert.deepEqual(await readFile(join(directory, oldAssetName)), oldAsset);
    const feed = yaml.load(await readFile(join(output, 'nightly.yml'), 'utf8'));
    assert.equal(feed.version, '0.2.1-rc.2');
    assert.equal(feed.path, 'deepseek-harness-0.2.1-rc.2-win-x64.exe');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('every step output a workflow reads has a step with that id', async () => {
  const { readdir, readFile: read } = await import('node:fs/promises');
  const { resolve: join } = await import('node:path');
  const dir = join(process.cwd(), '.github/workflows');
  const problems = [];
  for (const name of (await readdir(dir)).filter(item => /^official-.*\.yml$/.test(item))) {
    const text = await read(join(dir, name), 'utf8');
    const ids = new Set([...text.matchAll(/^\s*(?:-\s+)?id:\s*([A-Za-z0-9_-]+)\s*$/gm)].map(match => match[1]));
    for (const match of text.matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs/g)) {
      if (!ids.has(match[1])) problems.push(`${name}: steps.${match[1]}.outputs has no step id`);
    }
  }
  assert.deepEqual(problems, []);
});
