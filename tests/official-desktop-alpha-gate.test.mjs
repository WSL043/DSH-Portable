import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAlphaEvidence, requiredChecks } from '../experiments/official-desktop/qualify-alpha.mjs';

const metadata = { version: '1.0.0-alpha.1', distribution: 'clean-install-alpha', publicRelease: true, publicUpdates: false, coreVersion: '0.1.7-rc.2', appArchiveSha256: 'a'.repeat(64), executableSha256: 'b'.repeat(64), compiledMainSha256: 'c'.repeat(64), compiledHostSha256: 'd'.repeat(64) };
const evidence = { ...metadata, schemaVersion: 1, checks: Object.fromEntries(requiredChecks.map(k => [k, 'passed'])), legacyMigration: 'unsupported', updateCatalog: 'excluded', limitations: ['No migration'] };
test('alpha gate requires exact artifact evidence and excludes automatic updates', () => {
  assert.doesNotThrow(() => assertAlphaEvidence(metadata, evidence));
  assert.throws(() => assertAlphaEvidence(metadata, { ...evidence, appArchiveSha256: 'd'.repeat(64) }));
  assert.throws(() => assertAlphaEvidence({ ...metadata, publicUpdates: true }, evidence));
  assert.throws(() => assertAlphaEvidence({ ...metadata, version: '1.0.0' }, evidence));
  for (const check of requiredChecks) assert.throws(() => assertAlphaEvidence(metadata, { ...evidence, checks: { ...evidence.checks, [check]: 'pending' } }));
  assert.throws(() => assertAlphaEvidence(metadata, { ...evidence, legacyMigration: 'passed' }));
});
