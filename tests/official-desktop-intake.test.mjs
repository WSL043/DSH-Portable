import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopFiles, changesBetween } from '../scripts/check-official-desktop.mjs';

test('desktop intake includes host and package boundaries without unrelated app churn', () => {
  const paths = ['apps/desktop/src/main.ts', 'apps/desktop-host/config/a.yml', 'packages/desktop-ipc/index.ts', 'apps/web/index.ts', 'apps/desktop-other/index.ts'];
  const actual = desktopFiles({ tree: paths.map(path => ({ path, type: 'blob', sha: 'a' })) });
  assert.deepEqual(Object.keys(actual), paths.slice(0, 3));
});

test('desktop intake follows reviewed shared packages and locked external dependencies', () => {
  const included = [
    'packages/util/home-paths/src/index.ts',
    'packages/util/official-bundles/src/bundles.ts',
    'packages/util/official-bundles/src/plugin-manager.ts',
    'packages/boot/app-boot/src/profile-resolution/new-entry.ts',
    'packages/boot/plugin-manager/src/operations.ts',
    'packages/boot/plugin-market/src/index.ts',
    'packages/client/connection/src/api-request-trust.ts',
    'packages/client/ui-plugin-manager/src/client/slot-contract.ts',
    'packages/client/ui-plugin-market/src/client/index.ts',
    'packages/api/gateway/src/access.ts',
    'packages/host/webserver/src/index.ts',
    'packages/mcp/mcp-client/package.json',
    'packages/experimental/plugin-market-bundle/cordis.patch.yml',
    'pnpm-lock.yaml',
  ];
  const unrelated = ['packages/util/home-paths-extra/src/index.ts', 'packages/util/official-bundles-extra/src/index.ts', 'packages/boot/app-boot-other/package.json',
    'packages/client/other/src/index.ts', 'packages/mcp/mcp-client-extra/package.json',
    'examples/pnpm-lock.yaml', 'apps/web/index.ts'];
  const tree = { tree: [...included, ...unrelated].map(path => ({ path, type: 'blob', sha: 'a' })) };
  assert.deepEqual(Object.keys(desktopFiles(tree)), included);
});

test('shared path, official bundle lists, MCP and lock drift remains visible without desktop file changes', () => {
  const before = { tree: [
    { path: 'apps/desktop/src/main.ts', type: 'blob', sha: 'same' },
    { path: 'packages/util/home-paths/src/index.ts', type: 'blob', sha: 'old' },
    { path: 'packages/util/official-bundles/src/plugin-manager.ts', type: 'blob', sha: 'old' },
    { path: 'packages/mcp/mcp-client/package.json', type: 'blob', sha: 'old' },
    { path: 'pnpm-lock.yaml', type: 'blob', sha: 'old' },
  ] };
  const after = { tree: before.tree.map(entry => ({ ...entry, sha: entry.sha === 'old' ? 'new' : entry.sha })) };
  assert.deepEqual(changesBetween(desktopFiles(before), desktopFiles(after)), [
    { path: 'packages/mcp/mcp-client/package.json', status: 'modified' },
    { path: 'packages/util/home-paths/src/index.ts', status: 'modified' },
    { path: 'packages/util/official-bundles/src/plugin-manager.ts', status: 'modified' },
    { path: 'pnpm-lock.yaml', status: 'modified' },
  ]);
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
