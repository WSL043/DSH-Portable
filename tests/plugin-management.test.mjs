import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildPluginCliSpec,
  normalizeDshArgvForWindowsShell,
  profileNeedsRelink,
  resolveProductStateRoot,
} from '../launcher/dsh-cli.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('portable plugin CLI uses bundled Node, pnpm, and portable DSH_HOME without changing the system', async () => {
  const root = path.win32.resolve('D:\\USB Drive\\DSH-Portable')
  const stateRoot = await resolveProductStateRoot(root, 'win32', {}, {})
  const spec = buildPluginCliSpec(root, stateRoot, [
    'plugin', '--profile', 'research', 'add', 'git+https://example.test/third-party.git',
  ], 'win32', { PATH: 'C:\\Windows\\System32' })

  assert.equal(stateRoot, root)
  assert.equal(spec.command, path.win32.join(root, 'runtime', 'node', 'node.exe'))
  assert.deepEqual(spec.args, [
    path.win32.join(root, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    'plugin', '--profile', 'research', 'add', 'git+https://example.test/third-party.git',
  ])
  assert.equal(spec.env.DSH_HOME, path.win32.join(root, 'data', 'dsh-home'))
  assert.equal(spec.env.DSH_PORTABLE, '1')
  assert.equal(spec.env.pnpm_config_store_dir, path.win32.join(root, 'data', 'pnpm-store'))
  assert.deepEqual(spec.env.PATH.split(';').slice(0, 3), [
    path.win32.join(root, 'runtime', 'node'),
    path.win32.join(root, 'app', 'node_modules', '.bin'),
    'C:\\Windows\\System32',
  ])
  assert.equal(process.env.DSH_HOME, undefined)
})

test('installed plugin CLI expands installed-mode stateRoot and keeps the profile outside the app', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-installed-'))
  const root = path.join(temp, 'Program Files', 'DeepSeek-Herness')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'installed-mode.json'), JSON.stringify({
    schemaVersion: 1,
    stateRoot: '%LOCALAPPDATA%\\DeepSeek-Herness',
  }))

  const localAppData = path.join(temp, 'User Data', 'Local')
  const stateRoot = await resolveProductStateRoot(root, 'win32', { LOCALAPPDATA: localAppData }, {})
  const spec = buildPluginCliSpec(root, stateRoot, ['--profile', 'default', '--dump-config'], 'win32', {
    PATH: 'C:\\Windows\\System32',
  })

  assert.equal(stateRoot, path.win32.resolve(localAppData, 'DeepSeek-Herness'))
  assert.equal(spec.env.DSH_HOME, path.win32.join(stateRoot, 'data', 'dsh-home'))
  assert.equal(spec.env.pnpm_config_store_dir, path.win32.join(stateRoot, 'data', 'pnpm-store'))
  assert.deepEqual(spec.args.slice(1), ['--profile', 'default', '--dump-config'])
})

test('plugin profiles are relinked only when pnpm still points outside the current portable state root', () => {
  const profile = path.win32.resolve('E:\\Moved DSH\\data\\dsh-home\\profiles\\web')
  const store = path.win32.resolve('E:\\Moved DSH\\data\\pnpm-store')
  assert.equal(profileNeedsRelink(profile, store, {
    virtualStoreDir: path.win32.join(profile, 'node_modules', '.pnpm'),
    storeDir: path.win32.join(store, 'v11'),
  }, 'win32'), false)
  assert.equal(profileNeedsRelink(profile, store, {
    virtualStoreDir: 'D:\\Old DSH\\data\\dsh-home\\profiles\\web\\node_modules\\.pnpm',
    storeDir: 'C:\\Users\\User\\AppData\\Local\\pnpm\\store\\v11',
  }, 'win32'), true)
})

test('explicit state-root override wins without mutating caller environment', async () => {
  const root = path.win32.resolve('C:\\Apps\\DSH-Portable')
  const override = path.win32.resolve('E:\\DSH State')
  const source = { PATH: 'C:\\Windows\\System32', DSH_PORTABLE_STATE_ROOT: override }
  const stateRoot = await resolveProductStateRoot(root, 'win32', source, {})
  const spec = buildPluginCliSpec(root, stateRoot, ['plugin', 'list', '--depth', '0'], 'win32', source)

  assert.equal(stateRoot, override)
  assert.equal(source.DSH_HOME, undefined)
  assert.equal(source.PATH, 'C:\\Windows\\System32')
  assert.deepEqual(spec.args.slice(1), ['plugin', 'list', '--depth', '0'])
})

test('Windows plugin forwarding preserves a local path with spaces through the official pnpm shell hop', () => {
  assert.deepEqual(
    normalizeDshArgvForWindowsShell(
      ['plugin', '--profile', 'web', 'add', '.\\third party plugin'],
      'C:\\Users\\User Name\\Downloads',
    ),
    ['plugin', '--profile', 'web', 'add', '"C:\\Users\\User Name\\Downloads\\third party plugin"'],
  )
  assert.deepEqual(
    normalizeDshArgvForWindowsShell(['plugin', '--profile', 'web', 'list', '--depth', '0'], 'C:\\Work'),
    ['plugin', '--profile', 'web', 'list', '--depth', '0'],
  )
})

test('the product locks and packages the official pnpm required by arbitrary DSH plugins', async () => {
  const [manifest, lockfile, upstream, build, runtimeVerifier] = await Promise.all([
    readFile(path.join(repositoryRoot, 'app', 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'app', 'package-lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'upstream.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'scripts', 'build-windows.ps1'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'verify-runtime.mjs'), 'utf8'),
  ])

  assert.equal(manifest.dependencies.pnpm, '11.7.0')
  assert.equal(lockfile.packages['node_modules/pnpm'].version, '11.7.0')
  assert.equal(lockfile.packages['node_modules/pnpm'].integrity, upstream.pnpm.integrity)
  assert.equal(upstream.pnpm.version, '11.7.0')
  assert.match(build, /dsh-cli\.mjs/)
  assert.match(build, /DSH-Command\.cs/)
  assert.match(build, /dsh\.exe/)
  assert.match(build, /pnpm-LICENSE\.txt/)
  assert.match(runtimeVerifier, /pnpm(?:\.cmd)?/)
})
