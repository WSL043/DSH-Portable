import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { configureDevelopmentPaths } from '../experiments/official-desktop/development-paths.mjs';
import { adaptDevelopmentSource } from '../experiments/official-desktop/prepare-development.mjs';

test('development refuses missing, relative, filesystem-root and late path configuration', () => {
  const app = { isReady: () => false };
  for (const value of [undefined, '.', resolve('/')]) {
    assert.throws(() => configureDevelopmentPaths(app, { DSH_PORTABLE_DEVELOPMENT_ROOT: value }));
  }
  assert.throws(() => configureDevelopmentPaths({ isReady: () => true }, { DSH_PORTABLE_DEVELOPMENT_ROOT: tmpdir() }), /before Electron/);
});
test('each development launch derives Electron and DSH storage from its current root', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-desktop-development-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const name of ['A', 'B']) {
    const paths = {};
    const app = { isReady: () => false, setPath: (key, path) => { paths[key] = path; }, setAppLogsPath: path => { paths.appLogs = path; } };
    const env = { DSH_PORTABLE_DEVELOPMENT_ROOT: join(temporary, name), DSH_HOME: 'do-not-reuse-production' };
    configureDevelopmentPaths(app, env);
    assert.equal(env.DSH_HOME, join(temporary, name, 'data', 'dsh-home'));
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

test('redirected storage is rejected before any directories or application state change', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-desktop-redirection-'));
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
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-desktop-file-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  mkdirSync(join(temporary, 'data'));
  writeFileSync(join(temporary, 'data', 'logs'), 'preserve');
  assert.throws(() => configureDevelopmentPaths({ isReady: () => false }, { DSH_PORTABLE_DEVELOPMENT_ROOT: temporary }), /unredirected directory/);
  assert.equal(existsSync(join(temporary, 'data', 'electron')), false);
});
