// Separate clean-install alpha gate. Never feeds the Native product/core catalog.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredChecks = ['windowsStart', 'inputText', 'pluginCycle', 'relocation', 'gracefulExit', 'runtimePayload', 'visualLight', 'foreignDataRejected', 'coexistence'];
export function assertAlphaEvidence(metadata, evidence) {
  assert.match(metadata.version, /^1\.0\.0-alpha\.\d+$/);
  assert.equal(metadata.distribution, 'clean-install-alpha');
  assert.equal(metadata.publicRelease, true);
  assert.equal(metadata.publicUpdates, false);
  assert.equal(metadata.coreVersion, '0.1.7-rc.2');
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.version, metadata.version);
  for (const field of ['appArchiveSha256', 'executableSha256', 'compiledMainSha256', 'compiledHostSha256']) {
    assert.match(metadata[field], /^[a-f0-9]{64}$/);
    assert.equal(evidence[field], metadata[field], `${field}: evidence must describe this exact artifact`);
  }
  for (const check of requiredChecks) assert.equal(evidence.checks?.[check], 'passed', `Missing alpha check: ${check}`);
  assert.equal(evidence.legacyMigration, 'unsupported');
  assert.equal(evidence.updateCatalog, 'excluded');
  assert.ok(Array.isArray(evidence.limitations) && evidence.limitations.length > 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.argv[2]);
  const metadata = JSON.parse(await readFile(join(root, 'development.json')));
  const evidence = JSON.parse(await readFile(resolve(process.argv[3])));
  assertAlphaEvidence(metadata, evidence);
  const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
  assert.equal(await sha(join(root, 'resources', 'app.asar')), metadata.appArchiveSha256);
  assert.equal(await sha(join(root, 'DSH-Portable-Alpha.exe')), metadata.executableSha256);
  for (const path of ['data', 'probe-os', 'resources/app-update.yml']) {
    await assert.rejects(lstat(join(root, path)), { code: 'ENOENT' }, `Release must not contain ${path}`);
  }
  let files = 0;
  async function inspect(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!item.isSymbolicLink(), `External or redirected link: ${item.name}`);
      if (item.isDirectory()) await inspect(join(directory, item.name));
      else { assert.ok(item.isFile()); files++; }
    }
  }
  await inspect(root);
  console.log(JSON.stringify({ alphaQualified: true, files, version: metadata.version, publicUpdates: false }));
}
