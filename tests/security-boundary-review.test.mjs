import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isSafePackageRelativePath, resolvePackageRelativePath } from '../app/vendor/dsh-portable-plugin-market/src/package-path.ts'
import { boundedTimeout } from '../app/vendor/dsh-portable-plugin-market/src/timeout.ts'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-reviewed-boundary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pkg = path.join(root, 'package')
  const outside = path.join(root, 'outside')
  await mkdir(pkg)
  await mkdir(outside)
  await writeFile(path.join(pkg, 'client.js'), 'globalThis.clientLoaded = true')
  await writeFile(path.join(outside, 'secret.js'), 'private fixture')
  return { root, pkg, outside }
}

const directoryLink = process.platform === 'win32' ? 'junction' : 'dir'

async function linkIfSupported(t, target, filename, type) {
  try { await symlink(target, filename, type) } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
      t.skip('File symlink creation is unavailable for this Windows account')
      return false
    }
    throw error
  }
  return true
}

test('package-declared file symlinks cannot read outside the real package root', async t => {
  const { pkg, outside } = await fixture(t)
  if (!await linkIfSupported(t, path.join(outside, 'secret.js'), path.join(pkg, 'leak.js'), 'file')) return
  assert.equal(resolvePackageRelativePath(pkg, './leak.js'), null)
  assert.equal(await readFile(path.join(outside, 'secret.js'), 'utf8'), 'private fixture')
})

test('package-declared directory links cannot lead to outside files', async t => {
  const { pkg, outside } = await fixture(t)
  await symlink(outside, path.join(pkg, 'linked'), directoryLink)
  assert.equal(resolvePackageRelativePath(pkg, './linked/secret.js'), null)
  assert.equal(resolvePackageRelativePath(pkg, './linked/missing.js'), null)
})

test('a dangling link is not mistaken for a missing ordinary bundle', async t => {
  const { pkg, outside } = await fixture(t)
  if (!await linkIfSupported(t, path.join(outside, 'absent.js'), path.join(pkg, 'dangling.js'), 'file')) return
  assert.equal(resolvePackageRelativePath(pkg, './dangling.js'), null)
})

test('an internal link is resolved and remains usable', async t => {
  const { pkg } = await fixture(t)
  if (!await linkIfSupported(t, path.join(pkg, 'client.js'), path.join(pkg, 'alias.js'), 'file')) return
  assert.equal(resolvePackageRelativePath(pkg, './alias.js'), await realpath(path.join(pkg, 'client.js')))
})

test('pnpm-style linked package roots keep their own physical boundary', async t => {
  const { root, pkg, outside } = await fixture(t)
  const linkedRoot = path.join(root, 'node_modules', 'fixture')
  await mkdir(path.dirname(linkedRoot))
  await symlink(pkg, linkedRoot, directoryLink)
  assert.equal(resolvePackageRelativePath(linkedRoot, './client.js'), await realpath(path.join(pkg, 'client.js')))
  await symlink(outside, path.join(pkg, 'external'), directoryLink)
  assert.equal(resolvePackageRelativePath(linkedRoot, './external/secret.js'), null)
})

test('ordinary missing files stay distinguishable from unsafe paths', async t => {
  const { pkg } = await fixture(t)
  assert.equal(resolvePackageRelativePath(pkg, './future/client.js'), path.join(await realpath(pkg), 'future', 'client.js'))
  for (const value of ['../outside/secret.js', '..\\outside\\secret.js', 'C:secret.js', '/secret.js', '\\\\server\\share\\secret.js']) {
    assert.equal(resolvePackageRelativePath(pkg, value), null, value)
  }
})

test('both separator styles address the same ordinary package file', async t => {
  const { pkg } = await fixture(t)
  await mkdir(path.join(pkg, 'nested'))
  await writeFile(path.join(pkg, 'nested', 'entry.js'), 'fixture')
  assert.equal(resolvePackageRelativePath(pkg, '.\\nested\\entry.js'), await realpath(path.join(pkg, 'nested', 'entry.js')))
})

test('timer overrides remain finite positive integers within the actual product ceilings', () => {
  for (const [fallback, maximum] of [[10_000, 60_000], [900_000, 3_600_000]]) {
    for (const value of [undefined, null, '', '-1', '0', 'NaN', 'Infinity', '1e309', -Infinity, NaN, 0, -1]) {
      assert.equal(boundedTimeout(value, fallback, maximum), fallback, String(value))
    }
    for (const value of ['1', '1.5', '2147483648', '1e100', Number.MAX_VALUE, maximum + 1]) {
      const duration = boundedTimeout(value, fallback, maximum)
      assert.ok(Number.isSafeInteger(duration) && duration >= 1 && duration <= maximum, String(value))
    }
    assert.equal(boundedTimeout('2147483648', fallback, maximum), maximum)
    assert.equal(boundedTimeout('1.5', fallback, maximum), 1)
  }
})

test('the full updater copy uses an unpredictable name and never overwrites an existing target', async () => {
  const source = await readFile(new URL('../launcher/windows/DSH-Portable.cs', import.meta.url), 'utf8')
  const start = source.indexOf('private void StartFullPackageUpdate(')
  assert.ok(start >= 0)
  const method = source.slice(start, source.indexOf('private static bool IsTrustedProductManifestUrl', start))
  assert.match(method, /"DSH-FullUpdater-" \+ Guid\.NewGuid\(\)\.ToString\("N"\)/)
  assert.match(method, /File\.Copy\(source, helper, false\)/)
})

test('detached native executables do not need the Windows shell resolver', async () => {
  const source = await readFile(new URL('../launcher/windows/PortableProcessJob.cs', import.meta.url), 'utf8')
  const start = source.indexOf('internal static void StartDetachedProcess(')
  assert.ok(start >= 0)
  const method = source.slice(start, source.indexOf('internal static void StartDetachedUpdater(', start))
  assert.match(method, /UseShellExecute = false/)
  assert.doesNotMatch(method, /UseShellExecute = true/)
  assert.match(method, /argumentList\.Select\(QuoteArgument\)/)
})


test('Windows package paths reject parent aliases, devices and alternate streams', () => {
  for (const value of ['.. /private', '.. ./private', 'nested/../private', 'file:stream',
    'con', 'aux.txt', 'nested/lpt¹.txt', 'conout$', 'file.', 'file ', 'nested/.. /private']) {
    assert.equal(isSafePackageRelativePath(value, 'win32'), false, value)
  }
  for (const value of ['./client.js', '.\\client.js', 'nested/中文 file.js', 'nested/.hidden.js']) {
    assert.equal(isSafePackageRelativePath(value, 'win32'), true, value)
  }
})

test('Windows package resolution rejects trailing-space parent aliases before lookup', {
  skip: process.platform !== 'win32',
}, async t => {
  const { root, pkg } = await fixture(t)
  const outside = path.join(root, 'outside.js')
  await writeFile(outside, 'private')
  assert.equal(resolvePackageRelativePath(pkg, '.. /outside.js'), null)
  assert.equal(resolvePackageRelativePath(pkg, '.. ./outside.js'), null)
  assert.equal(await readFile(outside, 'utf8'), 'private')
})
