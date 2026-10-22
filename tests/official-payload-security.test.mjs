import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ADVISORY, inspectOfficialPayloadSecurity } from '../scripts/check-official-payload-security.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checker = fileURLToPath(new URL('../scripts/check-official-payload-security.mjs', import.meta.url));

// A real ASAR index/payload layout, not a mock of the inspection function.
function archive(version, { missing, corrupt, noIntegrity, nestedOldClient = false } = {}) {
  const contents = [
    ['package.json', { name: '@deepseek-ai/dsh-desktop', version: '0.2.1-rc.2' }],
    ['dsh/node_modules/@modelcontextprotocol/client/package.json', { name: '@modelcontextprotocol/client', version }],
    ['dsh/node_modules/@modelcontextprotocol/core/package.json', { name: '@modelcontextprotocol/core', version }],
  ].filter(([path]) => !missing || !path.includes(`/${missing}/`));
  if (nestedOldClient) contents.push(['dsh/node_modules/example/node_modules/@modelcontextprotocol/client/package.json', { name: '@modelcontextprotocol/client', version: '2.0.0' }]);
  const header = { files: {} }, body = [];
  let offset = 0;
  for (const [path, pkg] of contents) {
    const bytes = Buffer.from(JSON.stringify(pkg));
    const parts = path.split('/');
    let dir = header;
    for (const part of parts.slice(0, -1)) dir = dir.files[part] ??= { files: {} };
    const entry = { size: bytes.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: hash(bytes), blockSize: 4 * 1024 * 1024, blocks: [hash(bytes)] } };
    if (corrupt && path.includes(`/${corrupt}/`)) entry.integrity.hash = '0'.repeat(64);
    if (noIntegrity && path.includes(`/${noIntegrity}/`)) delete entry.integrity;
    dir.files[parts.at(-1)] = entry;
    body.push(bytes);
    offset += bytes.length;
  }
  const json = Buffer.from(JSON.stringify(header));
  const headerSize = 8 + Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(8 + headerSize);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(headerSize - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  return Buffer.concat([prefix, ...body]);
}

async function fixture(t, bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-asar-security-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'app.asar');
  await writeFile(path, bytes);
  return { dir, path };
}

test('actual package bytes reject MCP 2.0 and 2.2; 2.3 is allowed only for this advisory', async t => {
  for (const version of ['2.0.0', '2.2.0', '2.3.0']) {
    const bytes = archive(version), { path } = await fixture(t, bytes);
    const report = await inspectOfficialPayloadSecurity(path);
    const allowed = version === '2.3.0';
    assert.equal(report.qualificationAllowed, allowed);
    assert.equal(report.advisory.affected, !allowed);
    assert.equal(report.advisory.id, ADVISORY.id);
    assert.equal(report.officialVersion, '0.2.1-rc.2');
    assert.equal(report.appASARsha256, hash(bytes));
    assert.equal(report.packages.filter(pkg => ['client', 'core'].includes(pkg.kind)).length, 2);
    assert.ok(report.packages.every(pkg => pkg.integrity.verified));
    assert.deepEqual(await readFile(path), bytes, 'official bytes remain unchanged');
  }
});

test('missing, corrupt, truncated and unknown inventories fail closed', async t => {
  for (const bytes of [archive('2.3.0', { missing: 'core' }), archive('2.3.0', { missing: 'client' }),
    archive('2.3.0', { corrupt: 'client' }), archive('2.3.0', { noIntegrity: 'core' }),
    archive('2.3.0-rc.1'), archive('unknown'), archive('2.3.0').subarray(0, 40)]) {
    const { path } = await fixture(t, bytes);
    const report = await inspectOfficialPayloadSecurity(path);
    assert.equal(report.qualificationAllowed, false);
    assert.equal(report.status, 'blocked');
    assert.ok(report.findings.length);
  }
  const report = await inspectOfficialPayloadSecurity(join(tmpdir(), 'dsh-asar-security-nonexistent', 'app.asar'));
  assert.equal(report.qualificationAllowed, false);
  assert.equal(report.appASARsha256, null);
});

test('a nested affected client blocks an otherwise repaired inventory', async t => {
  const { path } = await fixture(t, archive('2.3.0', { nestedOldClient: true }));
  const report = await inspectOfficialPayloadSecurity(path);
  assert.equal(report.advisory.affected, true);
  assert.equal(report.qualificationAllowed, false);
  assert.equal(report.packages.filter(pkg => pkg.kind === 'client').length, 2);
});

test('report-only changes exit status without granting qualification', async t => {
  const { dir, path } = await fixture(t, archive('2.2.0'));
  const output = join(dir, 'report.json');
  const refused = spawnSync(process.execPath, [checker, path, '--output', output], { encoding: 'utf8' });
  assert.equal(refused.status, 1, refused.stderr);
  const collected = spawnSync(process.execPath, [checker, path, '--output', output, '--report-only'], { encoding: 'utf8' });
  assert.equal(collected.status, 0, collected.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.qualificationAllowed, false);
  assert.equal(report.status, 'blocked');
  const verified = spawnSync(process.execPath, [checker, path, '--verify-report', output, '--report-only'], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).verifiedReport.passed, false);
  assert.equal(JSON.parse(verified.stdout).qualificationAllowed, false);
});

test('offline report verification binds qualification to actual ASAR identity', async t => {
  const { dir, path } = await fixture(t, archive('2.3.0'));
  const output = join(dir, 'report.json');
  const report = await inspectOfficialPayloadSecurity(path);
  await writeFile(output, JSON.stringify(report));
  const verified = await inspectOfficialPayloadSecurity(path, { verifyReport: output });
  assert.equal(verified.verifiedReport.passed, true);
  assert.equal(verified.qualificationAllowed, true);
  await writeFile(path, archive('2.2.0'));
  const substituted = await inspectOfficialPayloadSecurity(path, { verifyReport: output });
  assert.equal(substituted.verifiedReport.passed, false);
  assert.equal(substituted.qualificationAllowed, false);
  await writeFile(output, JSON.stringify({ ...report, officialVersion: '0.0.0' }));
  await writeFile(path, archive('2.3.0'));
  assert.equal((await inspectOfficialPayloadSecurity(path, { verifyReport: output })).qualificationAllowed, false);
});
