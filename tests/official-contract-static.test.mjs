import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNsisUpdater } from '../experiments/official-payload/contract/static-check.mjs';

test('static matcher accepts updater invocation and publisher-null bypass contracts', () => {
  const sample = `
    const args = ["--updated"];
    if (options.isForceRunAfter) { args.push("--force-run"); }
    async verifySignature() {
      let publisherName;
      publisherName = (await this.configOnDisk.value).publisherName;
      if (publisherName == null) { return null; }
    }
  `;
  assert.deepEqual(checkNsisUpdater(sample), { passed: true, failures: [] });
});

test('static matcher names a changed update contract', () => {
  const result = checkNsisUpdater('const args = ["--updated"]; async verifySignature(){ if (publisherName != null) { return null; } }');
  assert.equal(result.passed, false);
  assert.match(result.failures.join('; '), /no longer appends --force-run/);
  assert.match(result.failures.join('; '), /no longer skips signature verification when publisherName is null/);
});
