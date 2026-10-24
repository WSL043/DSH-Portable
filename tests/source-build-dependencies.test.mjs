import test from 'node:test';
import assert from 'node:assert/strict';
import { patchDshDependencyLock } from '../scripts/prepare-reviewed-source-dependencies.mjs';

const identity = { version: '4.6.7', integrity: 'sha512-REVIEWED==' };
const workspace = 'overrides:\n  other: 1.0.0\n';
const lock = `overrides:
  other: 1.0.0
importers:
  .:
    dependencies:
      zod:
        specifier: 4.4.3
        version: 4.4.3
      other:
        specifier: 4.4.3
        version: 4.4.3
packages:
  zod@4.4.3:
    resolution: {integrity: sha512-OLD==}
  other@4.4.3:
    resolution: {integrity: sha512-OTHER==}
snapshots:
  consumer@1.0.0(zod@4.4.3):
    dependencies:
      zod: 4.4.3
  zod@4.4.3: {}
`;

test('applies the pinned Zod override without re-resolving unrelated dependencies', () => {
  const patched = patchDshDependencyLock({ workspace, lock, ...identity });
  assert.equal(patched.status, 'patched');
  assert.match(patched.lock, /zod:\n        specifier: 4\.6\.7\n        version: 4\.6\.7/);
  assert.match(patched.lock, /consumer@1\.0\.0\(zod@4\.6\.7\)/);
  assert.match(patched.lock, /other@4\.4\.3:\n    resolution: \{integrity: sha512-OTHER==\}/);
  assert.match(patched.lock, /other:\n        specifier: 4\.4\.3\n        version: 4\.4\.3/);
  assert.equal(patchDshDependencyLock({ ...patched, ...identity }).lock, patched.lock);
});

test('refuses ambiguous dependency copies and unfamiliar source-lock layouts', () => {
  assert.throws(() => patchDshDependencyLock({ workspace, lock: lock + '\n  zod@4.3.0:\n', ...identity }), /Multiple/);
  assert.throws(() => patchDshDependencyLock({ workspace, lock: lock.replace('    resolution: {integrity: sha512-OLD==}', '    tarball: unexpected'), ...identity }), /Unrecognized/);
});

test('does not downgrade a newer upstream copy', () => {
  const newer = lock.replaceAll('4.4.3', '4.7.0');
  assert.equal(patchDshDependencyLock({ workspace, lock: newer, ...identity }).lock, newer);
});
