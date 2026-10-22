import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm, symlink, unlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const evidenceCLI = fileURLToPath(new URL('../scripts/official-payload-security-evidence.mjs', import.meta.url));

test('shared authorization CLI rejects missing, blocked, stale, or mismatched security evidence', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-security-gate-')));
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const env = { ...process.env, SECURITY_DIRECTORY: directory, SECURITY_CANDIDATE: join(directory, 'selection.json'),
    SECURITY_EXPECTED_VERSION: '0.2.1-rc.2', SECURITY_KINDS: '["candidate"]', SECURITY_ASSETS: JSON.stringify([join(directory, 'portable.zip')]),
    GITHUB_REPOSITORY: 'example/portable', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };
  const candidate = JSON.stringify({ version: env.SECURITY_EXPECTED_VERSION, sha512: 'installer-identity', size: 42 });
  const asarHash = 'b'.repeat(64);
  const baseReport = { schemaVersion: 1, officialVersion: env.SECURITY_EXPECTED_VERSION,
    appASARPath: 'C:/accepted/app/' + env.SECURITY_EXPECTED_VERSION + '/resources/app.asar', appASARBytes: 1234, appASARsha256: asarHash,
    advisory: { id: 'GHSA-6prh-2h8m-c8cw', affected: false }, status: 'allowed-for-this-advisory', qualificationAllowed: true };
  const run = (overrides = {}) => spawnSync(process.execPath, [evidenceCLI, 'authorize'], { env: { ...env, ...overrides }, cwd: directory, encoding: 'utf8' });
  const fixture = async (mutate = () => {}) => {
    const report = structuredClone(baseReport), verified = { ...structuredClone(baseReport), verifiedReport: { passed: true } };
    const entry = { kind: 'candidate', appASARPath: report.appASARPath, appASARBytes: report.appASARBytes, appASARsha256: asarHash, qualificationAllowed: true };
    const provenance = { schemaVersion: 1, qualificationAllowed: true, repository: env.GITHUB_REPOSITORY,
      sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
      officialVersion: env.SECURITY_EXPECTED_VERSION, candidateSHA256: sha256(candidate), entries: [entry], assets: [{ name: 'portable.zip', sha256: sha256('package') }] };
    mutate({ report, verified, entry, provenance });
    const originalJSON = JSON.stringify(report), verifiedJSON = JSON.stringify(verified);
    entry.reportSHA256 = sha256(originalJSON); entry.verifiedSHA256 = sha256(verifiedJSON);
    await Promise.all([writeFile(env.SECURITY_CANDIDATE, candidate), writeFile(join(directory, 'candidate.json'), originalJSON),
      writeFile(join(directory, 'candidate-verified.json'), verifiedJSON), writeFile(join(directory, 'portable.zip'), 'package'),
      writeFile(join(directory, 'provenance.json'), JSON.stringify(provenance))]);
  };
  try {
    await fixture();
    const allowed = run();
    assert.equal(allowed.status, 0, allowed.stderr || 'a fully bound same-run allowed report passes');
    const cases = [
      ['blocked', ({ report }) => { report.qualificationAllowed = false; }],
      ['string true', ({ verified }) => { verified.qualificationAllowed = 'true'; }],
      ['unverified', ({ verified }) => { verified.verifiedReport.passed = false; }],
      ['unknown status', ({ report }) => { report.status = 'blocked'; }],
      ['affected advisory', ({ report }) => { report.advisory.affected = true; }],
      ['different advisory', ({ report }) => { report.advisory.id = 'another-advisory'; }],
      ['different version', ({ verified }) => { verified.officialVersion = '0.1.0'; }],
      ['different ASAR', ({ verified }) => { verified.appASARsha256 = 'c'.repeat(64); }],
      ['different ASAR length', ({ report }) => { report.appASARBytes++; }],
      ['wrong source', ({ provenance }) => { provenance.sourceSha = 'd'.repeat(40); }],
      ['old run', ({ provenance }) => { provenance.runId = '122'; }],
      ['old attempt', ({ provenance }) => { provenance.runAttempt = '1'; }],
      ['other repository', ({ provenance }) => { provenance.repository = 'other/repo'; }],
      ['other candidate', ({ provenance }) => { provenance.candidateSHA256 = 'e'.repeat(64); }],
      ['incomplete report set', ({ provenance }) => { provenance.entries = []; }],
      ['ASAR path mismatch', ({ entry }) => { entry.appASARPath = 'C:/not-accepted/app.asar'; }],
      ['blocked provenance', ({ provenance }) => { provenance.qualificationAllowed = false; }],
    ];
    for (const [name, mutate] of cases) { await fixture(mutate); assert.notEqual(run().status, 0, name); }
    await fixture(); await writeFile(join(directory, 'candidate-verified.json'), '{}');
    assert.notEqual(run().status, 0, 'report hash tampering');
    await fixture(); await writeFile(join(directory, 'portable.zip'), 'different-package');
    assert.notEqual(run().status, 0, 'package hash tampering');
    for (const name of ['candidate.json', 'candidate-verified.json', 'provenance.json']) {
      await fixture(); await rm(join(directory, name)); assert.notEqual(run().status, 0, 'missing ' + name);
    }
    await fixture();
    for (const overrides of [{ SECURITY_DIRECTORY: join(directory, '..') },
      { SECURITY_CANDIDATE: join(directory, '..', 'selection.json') },
      { SECURITY_ASSETS: JSON.stringify([join(directory, '..', 'portable.zip')]) }]) {
      const denied = run(overrides);
      assert.notEqual(denied.status, 0, JSON.stringify(overrides));
      assert.match(denied.stderr, /escapes the workspace/);
    }
    assert.notEqual(run({ SECURITY_KINDS: '["../candidate"]' }).status, 0, 'report names cannot traverse');
    await writeFile(env.SECURITY_CANDIDATE, JSON.stringify({ version: '../outside' }));
    assert.match(run().stderr, /Invalid official version/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('shared collection CLI retains blocked reports without changing the accepted ASAR or failing runtime artifacts', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-security-collection-')));
  const officialVersion = '0.2.1-rc.2', root = join(directory, 'accepted-root');
  const asarPath = join(root, 'app', officialVersion, 'resources', 'app.asar');
  const output = join(directory, 'security');
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  // Exercise the workflow's subprocess/report/provenance integration using a small real ASAR layout.
  const archive = version => {
    const header = { files: {} }, body = [];
    let offset = 0;
    for (const [path, pkg] of [['package.json', { name: '@deepseek-ai/dsh-desktop', version: officialVersion }],
      ...['client', 'core'].map(kind => ['node_modules/@modelcontextprotocol/' + kind + '/package.json', { name: '@modelcontextprotocol/' + kind, version }])]) {
      const bytes = Buffer.from(JSON.stringify(pkg)), parts = path.split('/');
      let node = header;
      for (const part of parts.slice(0, -1)) node = node.files[part] ??= { files: {} };
      node.files[parts.at(-1)] = { offset: String(offset), size: bytes.length, integrity: { algorithm: 'SHA256', hash: sha256(bytes) } };
      body.push(bytes); offset += bytes.length;
    }
    const json = Buffer.from(JSON.stringify(header)), headerSize = 8 + Math.ceil(json.length / 4) * 4;
    const prefix = Buffer.alloc(8 + headerSize);
    prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(headerSize, 4); prefix.writeUInt32LE(headerSize - 4, 8); prefix.writeUInt32LE(json.length, 12); json.copy(prefix, 16);
    return Buffer.concat([prefix, ...body]);
  };
  const env = { ...process.env, SECURITY_DIRECTORY: output, SECURITY_CANDIDATE: join(directory, 'selection.json'),
    SECURITY_ROOTS: JSON.stringify([['candidate', root]]), SECURITY_ASSETS: '[]', GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
    GITHUB_REPOSITORY: 'example/portable', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };
  try {
    await mkdir(join(root, 'app', officialVersion, 'resources'), { recursive: true });
    await writeFile(env.SECURITY_CANDIDATE, JSON.stringify({ version: officialVersion }));
    for (const version of ['2.3.0', '2.0.0']) {
      const bytes = archive(version); await writeFile(asarPath, bytes);
      const result = spawnSync(process.execPath, [evidenceCLI, 'collect'], { env,
        cwd: directory, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const provenance = JSON.parse(await readFile(join(output, 'provenance.json'), 'utf8'));
      const verified = JSON.parse(await readFile(join(output, 'candidate-verified.json'), 'utf8'));
      assert.equal(provenance.qualificationAllowed, version === '2.3.0');
      assert.equal(verified.verifiedReport.passed, version === '2.3.0');
      assert.equal(provenance.entries[0].appASARsha256, sha256(bytes));
      assert.deepEqual(await readFile(asarPath), bytes);
      assert.equal(JSON.parse(await readFile(join(output, 'selection.json'), 'utf8')).version, officialVersion);
      const authorization = spawnSync(process.execPath, [evidenceCLI, 'authorize'], { encoding: 'utf8',
        cwd: directory,
        env: { ...env, SECURITY_EXPECTED_VERSION: officialVersion, SECURITY_KINDS: '["candidate"]' } });
      assert.equal(authorization.status === 0, version === '2.3.0', authorization.stderr);
    }
    assert.match(await readFile(join(output, 'summary.md'), 'utf8'), /security blocked/);
    const linked = join(directory, 'linked-root');
    await symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const denied = spawnSync(process.execPath, [evidenceCLI, 'collect'], { cwd: directory, encoding: 'utf8',
        env: { ...env, SECURITY_ROOTS: JSON.stringify([['candidate', linked]]) } });
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /contains a link/);
      assert.deepEqual(await readFile(asarPath), archive('2.0.0'));
    } finally { await unlink(linked); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
