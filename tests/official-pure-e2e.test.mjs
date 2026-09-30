import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAcceptedIndex, buildPureE2EReport, expectedProtocolCommand, isPathOwnedByRoot, normalizeOfficialCandidate, packageFeedContract, REQUIRED_IDS, serializeCandidateFile } from '../experiments/official-payload/e2e/report.mjs';

const digest = Buffer.alloc(64, 7).toString('base64');
const oldCandidate = { version: '0.1.7-rc.2', url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.2-win-x64.exe', sha512: digest, size: 288245480 };
const newCandidate = { version: '0.2.0-rc.2', url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.0-rc.2-win-x64.exe', sha512: digest, size: 289313640 };

test('pure report treats missing evidence as failures and preserves explicit failures', () => {
  const missing = buildPureE2EReport();
  assert.equal(missing.results.length, REQUIRED_IDS.length);
  assert.equal(missing.overallPassed, false);
  assert.ok(missing.results.every(item => item.passed === false));
  assert.equal(missing.results.find(item => item.id === 'update-applied').evidence, 'Not run');
  const failed = buildPureE2EReport({ checks: { 'update-applied': { passed: false, evidence: { status: 'failed' } } } });
  assert.equal(failed.results.find(item => item.id === 'update-applied').evidence.status, 'failed');
  assert.equal(failed.overallPassed, false);
});

test('pure report passes only when every required evidence item passed', () => {
  const launcherPath = 'C:\\runner\\work\\portable\\DeepSeek Harness Portable.exe';
  const protocol = expectedProtocolCommand(launcherPath);
  const checks = Object.fromEntries(REQUIRED_IDS.map(id => [id, { passed: true, evidence: { source: id } }]));
  checks['old-app-running-from-root'].evidence = {
    portableRoot: 'C:\\runner\\work\\portable',
    primaryExecutablePath: 'C:\\runner\\work\\portable\\app\\0.1.7-rc.2\\DeepSeek Harness.exe',
    userDataInsidePortableRoot: true,
  };
  checks['protocol-owned-while-running'].evidence = {
    launcherPath,
    samples: [{ valueExists: true, value: protocol }, { valueExists: true, value: protocol }],
    linkHandoff: { passed: true, noNewOfficialInstance: true, noErrorDialog: true },
  };
  const report = buildPureE2EReport({ oldVersion: oldCandidate.version, newVersion: newCandidate.version, checks });
  assert.equal(report.overallPassed, true);
  assert.deepEqual(report.results.map(item => item.id), REQUIRED_IDS);
  assert.equal(buildPureE2EReport({ checks, failure: 'cache cleanup failed' }).overallPassed, false);
});

test('pure report rechecks process path ownership and the exact protocol command', () => {
  const launcherPath = 'C:\\runner\\work\\portable\\DeepSeek Harness Portable.exe';
  const protocol = expectedProtocolCommand(launcherPath);
  const checks = Object.fromEntries(REQUIRED_IDS.map(id => [id, { passed: true, evidence: {} }]));
  checks['old-app-running-from-root'].evidence = {
    portableRoot: 'C:\\runner\\work\\portable',
    primaryExecutablePath: 'C:\\runner\\work\\portable\\app\\0.1.7\\DeepSeek Harness.exe',
    userDataInsidePortableRoot: true,
  };
  checks['protocol-owned-while-running'].evidence = {
    launcherPath,
    samples: [{ valueExists: true, value: protocol }],
    linkHandoff: { passed: true, noNewOfficialInstance: true, noErrorDialog: true },
  };
  assert.equal(buildPureE2EReport({ checks }).overallPassed, true);
  checks['old-app-running-from-root'].evidence.primaryExecutablePath = 'C:\\runner\\work\\portable-other\\DeepSeek Harness.exe';
  checks['protocol-owned-while-running'].evidence.samples[0].value = '"C:\\other.exe" --open "%1"';
  const rejected = buildPureE2EReport({ checks });
  assert.equal(rejected.results.find(item => item.id === 'old-app-running-from-root').passed, false);
  assert.equal(rejected.results.find(item => item.id === 'protocol-owned-while-running').passed, false);
  assert.equal(rejected.overallPassed, false);
});

test('candidate files and the accepted index preserve both exact official installer identities', () => {
  const candidateFile = JSON.parse(serializeCandidateFile(oldCandidate));
  assert.deepEqual(candidateFile, normalizeOfficialCandidate(oldCandidate));
  assert.equal(candidateFile.url, oldCandidate.url);
  const index = buildAcceptedIndex(oldCandidate, newCandidate);
  assert.deepEqual(index.versions, [oldCandidate, newCandidate].map(candidate => ({
    version: candidate.version, installerUrl: candidate.url, sha512: candidate.sha512, size: candidate.size,
  })));
  assert.throws(() => buildAcceptedIndex(oldCandidate, oldCandidate), /must differ/);
  assert.throws(() => normalizeOfficialCandidate({ ...newCandidate, url: 'https://download.deepseek.com.evil.test/x.exe' }), /outside the official/);
});

test('process ownership uses a path boundary and protocol registration has the exact launcher command', () => {
  const root = 'C:\\runner\\work\\portable';
  assert.equal(isPathOwnedByRoot(root + '\\app\\0.1.7-rc.2\\DeepSeek Harness.exe', root), true);
  assert.equal(isPathOwnedByRoot(root + '-other\\app\\DeepSeek Harness.exe', root), false);
  assert.equal(isPathOwnedByRoot('C:\\runner\\work\\outside.exe', root), false);
  assert.equal(expectedProtocolCommand(root + '\\DeepSeek Harness Portable.exe'), '"' + root + '\\DeepSeek Harness Portable.exe" --open "%1"');
});

test('package follow.json feed and cache values must match the app-update.yml artifact', async () => {
  const source = await readFile(new URL('../experiments/official-payload/package-pure.ps1', import.meta.url), 'utf8');
  assert.match(source, /Expand-OfficialPayload\s+\$Installer\s+\$candidate\s+\$partial\s+\$SevenZip\s+\$FeedUrl\s+\$CacheDirName/);
  assert.match(source, /\$follow\s*=\s*\[ordered\]@\{\s*indexUrl=\$IndexUrl;\s*feedUrl=\$FeedUrl;\s*cacheDirName=\$CacheDirName\s*\}/);
  const follow = { indexUrl: 'http://127.0.0.1:42001/index.json', feedUrl: 'http://127.0.0.1:42002/', cacheDirName: 'dsh-pure-e2e-abc123' };
  const good = packageFeedContract(follow, 'provider: generic\nurl: http://127.0.0.1:42002/\nchannel: nightly\nupdaterCacheDirName: dsh-pure-e2e-abc123\n');
  assert.equal(good.passed, true);
  const bad = packageFeedContract(follow, 'provider: generic\nurl: http://127.0.0.1:49999/\nchannel: nightly\nupdaterCacheDirName: dsh-pure-e2e-abc123\n');
  assert.equal(bad.passed, false);
});

test('outside-write audit rejects leaked native-addon caches and Documents workspaces', async () => {
  const source = await readFile(new URL('../experiments/official-payload/e2e/run-pure-e2e.ps1', import.meta.url), 'utf8');
  assert.match(source, /function Test-ForbiddenOfficialExternalWrite\(/);
  assert.match(source, /node-addon-native-custom-loader\\native-cache/);
  assert.match(source, /Documents\\deepseek-harness/);
  assert.match(source, /-and -not \$forbiddenOfficialExternalWrite/);
});
