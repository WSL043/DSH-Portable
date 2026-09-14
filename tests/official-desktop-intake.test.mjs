import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopFiles, changesBetween } from '../scripts/check-official-desktop.mjs';

test('desktop intake includes host and package boundaries without unrelated app churn', () => {
  const paths = ['apps/desktop/src/main.ts', 'apps/desktop-host/config/a.yml', 'packages/desktop-ipc/index.ts', 'apps/web/index.ts', 'apps/desktop-other/index.ts'];
  const actual = desktopFiles({ tree: paths.map(path => ({ path, type: 'blob', sha: 'a' })) });
  assert.deepEqual(Object.keys(actual), paths.slice(0, 3));
});
test('incomplete source inventory fails instead of reporting no changes', () => {
  assert.throws(() => desktopFiles({ truncated: true, tree: [] }), /Incomplete/);
  assert.throws(() => desktopFiles({}), /Incomplete/);
});
test('review preserves additions, removals and modifications; identical snapshots are quiet', () => {
  assert.deepEqual(changesBetween({ a: '1', b: '2', d: '4' }, { a: '3', c: '3', d: '4' }), [
    { path: 'a', status: 'modified' }, { path: 'b', status: 'removed' }, { path: 'c', status: 'added' },
  ]);
  assert.deepEqual(changesBetween({ a: '1' }, { a: '1' }), []);
});
