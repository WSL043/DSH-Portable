import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { configureDevelopmentPaths } from '../experiments/official-desktop/development-paths.mjs';
import { adaptDevelopmentSource } from '../experiments/official-desktop/prepare-development.mjs';

// macOS exposes its temporary directory through /var -> /private/var. Positive
// fixtures use the physical path so they do not trip the redirection guard.
const temporaryRoot = realpathSync(tmpdir());

test('development refuses missing, relative, filesystem-root and late path configuration', () => {
  const app = { isReady: () => false };
  for (const value of [undefined, '.', resolve('/')]) {
    assert.throws(() => configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: value }));
  }
  assert.throws(() => configureDevelopmentPaths({ isReady: () => true }, { DSH_PORTABLE_DEVELOPMENT_ROOT: tmpdir() }), /before Electron/);
});
test('each development launch derives Electron and DSH storage from its current root', t => {
  const temporary = mkdtempSync(join(temporaryRoot, 'dsh-desktop-development-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const name of ['A', 'B']) {
    const paths = {};
    const app = { isReady: () => false, setPath: (key, path) => { paths[key] = path; }, setAppLogsPath: path => { paths.appLogs = path; } };
    const env = { DSH_PORTABLE_DEVELOPMENT_ROOT: join(temporary, name), DSH_HOME: 'do-not-reuse-production' };
    configureDevelopmentPaths(app, env);
    assert.equal(env.DSH_HOME, join(temporary, name, 'data', 'dsh-home'));
    assert.equal(env.pnpm_config_store_dir, join(temporary, name, 'data', 'pnpm-store'));
    assert.equal(paths.userData, join(temporary, name, 'data', 'electron'));
    assert.equal(paths.sessionData, paths.userData);
    assert.equal(paths.logs, paths.appLogs);
    assert.equal(env.DSH_DESKTOP_UPDATE_JOURNAL_DIR, join(paths.logs, 'desktop-update'));
  }
});
test('source adapter refuses unknown or modified official files before writing', () => {
  assert.throws(() => adaptDevelopmentSource('main.ts', Buffer.from('new upstream')), /Unreviewed/);
  assert.throws(() => adaptDevelopmentSource('unknown.ts', Buffer.from('')), /Unreviewed/);
  assert.throws(() => adaptDevelopmentSource('main.ts', Buffer.from('new upstream'), 'rc2'), /Unreviewed/);
  assert.throws(() => adaptDevelopmentSource('main.ts', Buffer.from('new upstream'), 'future'), /Unknown official desktop profile/);
});

test('alpha rejects foreign data without mutating it and resumes its own moved data', t => {
  const root = mkdtempSync(join(temporaryRoot, 'dsh-alpha-layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = { isReady: () => false, setPath: () => {}, setAppLogsPath: () => {} };
  const old = join(root, 'old');
  mkdirSync(join(old, 'data'), { recursive: true });
  writeFileSync(join(old, 'data', 'important.txt'), 'keep');
  assert.throws(() => configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: old }), /fresh folder/);
  assert.equal(readFileSync(join(old, 'data', 'important.txt'), 'utf8'), 'keep');
  assert.equal(existsSync(join(old, 'data', 'electron')), false);
  const first = join(root, 'first');
  configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: first });
  const modules = join(first, 'data', 'dsh-home', 'profiles', 'desktop', 'node_modules');
  mkdirSync(modules, { recursive: true });
  writeFileSync(join(modules, '.modules.yaml'), JSON.stringify({
    packageManager: 'pnpm@11.7.0', nodeLinker: 'hoisted',
    storeDir: join(first, 'data', 'pnpm-store', 'v11'), virtualStoreDir: join(modules, '.pnpm'),
  }));
  const moved = join(root, 'moved');
  renameSync(first, moved);
  assert.equal(configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: moved }).root, moved);
  const relocated = JSON.parse(readFileSync(join(moved, 'data', 'dsh-home', 'profiles', 'desktop', 'node_modules', '.modules.yaml')));
  assert.equal(relocated.storeDir, join(moved, 'data', 'pnpm-store', 'v11'));
  assert.equal(relocated.virtualStoreDir, join(moved, 'data', 'dsh-home', 'profiles', 'desktop', 'node_modules', '.pnpm'));
  writeFileSync(join(moved, 'data', 'portable-alpha.json'), '{"schemaVersion":999}');
  assert.throws(() => configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: moved }), /Unsupported/);
});

test('standalone alpha derives its data root from the executable instead of the working directory', t => {
  const root = mkdtempSync(join(temporaryRoot, 'dsh-standalone-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = {};
  const app = { isPackaged: true, isReady: () => false, getPath: name => {
    assert.equal(name, 'exe'); return join(root, 'DSH-Portable-Alpha.exe');
  }, setPath: (key, value) => { paths[key] = value; }, setAppLogsPath: () => {} };
  const env = { DSH_HOME: 'do-not-use' };
  const result = configureDevelopmentPaths(app, env);
  assert.equal(result.root, root);
  assert.equal(paths.userData, join(root, 'data', 'electron'));
  assert.equal(env.DSH_HOME, join(root, 'data', 'dsh-home'));
});

test('moving refuses an unmanaged dependency store without rewriting metadata', t => {
  const root = mkdtempSync(join(temporaryRoot, 'dsh-alpha-foreign-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = { isReady: () => false, setPath: () => {}, setAppLogsPath: () => {} };
  const first = join(root, 'first');
  configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: first });
  const modules = join(first, 'data', 'dsh-home', 'profiles', 'desktop', 'node_modules');
  mkdirSync(modules, { recursive: true });
  const before = JSON.stringify({ packageManager: 'pnpm@11.7.0', nodeLinker: 'hoisted', storeDir: join(root, 'external') });
  writeFileSync(join(modules, '.modules.yaml'), before);
  const moved = join(root, 'moved');
  renameSync(first, moved);
  assert.throws(() => configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: moved }), /outside the managed/);
  assert.equal(readFileSync(join(moved, 'data', 'dsh-home', 'profiles', 'desktop', 'node_modules', '.modules.yaml'), 'utf8'), before);
});

test('redirected storage is rejected before any directories or application state change', t => {
  const temporary = mkdtempSync(join(temporaryRoot, 'dsh-desktop-redirection-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const outside = join(temporary, 'outside');
  mkdirSync(outside);
  const root = join(temporary, 'candidate');
  mkdirSync(join(root, 'data'), { recursive: true });
  symlinkSync(outside, join(root, 'data', 'dsh-home'), process.platform === 'win32' ? 'junction' : 'dir');
  const env = { DSH_PORTABLE_DEVELOPMENT_ROOT: root, DSH_HOME: 'original' };
  const app = { isReady: () => false, setPath: () => assert.fail('must not change Electron paths') };
  assert.throws(() => configureDevelopmentPaths(app, env), /unredirected directory/);
  assert.equal(env.DSH_HOME, 'original');
  assert.equal(existsSync(join(root, 'data', 'electron')), false);
  assert.equal(existsSync(join(outside, 'electron')), false);
});

test('a file at a managed directory rejects the entire path setup', t => {
  const temporary = mkdtempSync(join(temporaryRoot, 'dsh-desktop-file-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  mkdirSync(join(temporary, 'data'));
  writeFileSync(join(temporary, 'data', 'logs'), 'preserve');
  assert.throws(() => configureDevelopmentPaths({ isReady: () => false }, { DSH_PORTABLE_DEVELOPMENT_ROOT: temporary }), /unredirected directory/);
  assert.equal(existsSync(join(temporary, 'data', 'electron')), false);
});
