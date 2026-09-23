import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createProfileBackup, restoreProfileBackup, validatedBackup } from '../app/vendor/dsh-portable-plugin-market/src/backup.ts'
import { canonicalBackupPath, writeBackupFileAtomic } from '../app/vendor/dsh-portable-plugin-market/src/backup-files.ts'
import { writeJsonAtomic } from '../launcher/portable-core.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-backup-write-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = path.join(root, 'profile')
  await mkdir(profile)
  await writeFile(path.join(profile, 'package.json'), '{"dependencies":{"fixture":"1.0.0"}}\n')
  await writeFile(path.join(profile, 'config.toml'), 'private original')
  return { root, profile }
}
const document = paths => ({ format: 'dsh-profile-backup', version: 0.2, profile: 'web', createdAt: '2026-09-19',
  files: [{ path: 'package.json', json: { dependencies: { fixture: '2.0.0' } } }, ...paths.map(p => ({ path: p, lines: ['restored'] }))] })
const dirLink = process.platform === 'win32' ? 'junction' : 'dir'

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

for (const p of ['config/./key', 'config//key', 'config/', '../escape', 'C:escape', 'nul\0name', 'NODE_MODULES/a', '.GIT/config', 'PACKAGE.JSON']) {
  test(`backup rejects ambiguous or excluded path ${JSON.stringify(p)} before changing files`, async t => {
    const { profile } = await fixture(t)
    assert.throws(() => restoreProfileBackup('web', document([p]), profile), /unsafe|excluded|invalid/i)
    assert.equal(await readFile(path.join(profile, 'config.toml'), 'utf8'), 'private original')
    assert.equal(JSON.parse(await readFile(path.join(profile, 'package.json'))).dependencies.fixture, '1.0.0')
  })
}

test('backup separator normalization is used by validation and actual writes', async t => {
  const { profile } = await fixture(t)
  const d = document(['nested\\配置 file.txt'])
  assert.equal(validatedBackup(d).files[1].path, 'nested/配置 file.txt')
  restoreProfileBackup('web', d, profile)
  assert.equal(await readFile(path.join(profile, 'nested', '配置 file.txt'), 'utf8'), 'restored')
  assert.throws(() => validatedBackup(document(['nested/key', 'nested\\key'])), /duplicate/)
})

test('Windows backup names reject streams, devices, trailing dot and trailing space', () => {
  for (const p of ['settings:stream', 'aux.txt', 'nul', 'lpt1.txt', 'conin$', 'key.', 'key ']) {
    assert.throws(() => canonicalBackupPath(p, 'win32'), /unsafe/)
  }
  assert.equal(canonicalBackupPath('普通 配置.txt', 'win32'), '普通 配置.txt')
})

test('backup rejects a dangling destination link and rolls back prior files', async t => {
  const { root, profile } = await fixture(t)
  const target = path.join(profile, 'dangling.txt')
  const outside = path.join(root, 'outside.txt')
  if (!await linkIfSupported(t, outside, target, 'file')) return
  assert.throws(() => restoreProfileBackup('web', document(['dangling.txt']), profile), /not a file/)
  assert.equal((await lstat(target)).isSymbolicLink(), true)
  assert.equal(existsSync(outside), false)
  assert.equal(JSON.parse(await readFile(path.join(profile, 'package.json'))).dependencies.fixture, '1.0.0')
})

test('backup refuses an existing parent directory link', async t => {
  const { root, profile } = await fixture(t)
  const outside = path.join(root, 'outside')
  await mkdir(outside)
  await symlink(outside, path.join(profile, 'redirect'), dirLink)
  assert.throws(() => restoreProfileBackup('web', document(['redirect/key']), profile), /unsafe/)
  assert.equal(existsSync(path.join(outside, 'key')), false)
})

test('backup staging cannot overwrite a predictable preplaced link', async t => {
  const { root, profile } = await fixture(t)
  const external = path.join(root, 'private.txt')
  await writeFile(external, 'untouched')
  const trap = path.join(profile, `config.toml.dsh-restore-${process.pid}`)
  if (!await linkIfSupported(t, external, trap, 'file')) return
  const restore = restoreProfileBackup('web', document(['config.toml']), profile)
  assert.equal(await readFile(external, 'utf8'), 'untouched')
  assert.equal((await lstat(trap)).isSymbolicLink(), true)
  restore.rollback()
  assert.equal(await readFile(path.join(profile, 'config.toml'), 'utf8'), 'private original')
  assert.equal(await readFile(external, 'utf8'), 'untouched')
})

test('ordinary profile backups restore and roll back without changing secrets or adding dependencies', async t => {
  const { profile } = await fixture(t)
  const source = createProfileBackup('web', profile)
  await writeFile(path.join(profile, 'config.toml'), 'second original')
  const restore = restoreProfileBackup('web', source, profile)
  assert.equal(await readFile(path.join(profile, 'config.toml'), 'utf8'), 'private original')
  restore.rollback()
  assert.equal(await readFile(path.join(profile, 'config.toml'), 'utf8'), 'second original')
  assert.deepEqual((await readdir(profile)).sort(), ['config.toml', 'package.json'])
})

test('failed atomic profile rename cleans up only its own staging file', async t => {
  const { profile } = await fixture(t)
  const directory = path.join(profile, 'blocked')
  await mkdir(directory)
  assert.throws(() => writeBackupFileAtomic(directory, 'fixture'))
  assert.equal((await lstat(directory)).isDirectory(), true)
  assert.equal((await readdir(profile)).some(n => n.startsWith('.dsh-profile-')), false)
})

test('shared JSON writes do not follow predictable temporary links', async t => {
  const { root, profile } = await fixture(t)
  const target = path.join(profile, 'state.json')
  const external = path.join(root, 'private.txt')
  await writeFile(external, 'untouched')
  const trap = `${target}.portable-${process.pid}.tmp`
  if (!await linkIfSupported(t, external, trap, 'file')) return
  await writeJsonAtomic(target, { complete: true })
  assert.deepEqual(JSON.parse(await readFile(target)), { complete: true })
  assert.equal(await readFile(external, 'utf8'), 'untouched')
  assert.equal((await lstat(trap)).isSymbolicLink(), true)
})

test('concurrent shared writes use independent staging paths and leave a whole JSON document', async t => {
  const { profile } = await fixture(t)
  const target = path.join(profile, 'state.json')
  await Promise.all(Array.from({ length: 12 }, (_, index) => writeJsonAtomic(target, { index, text: 'x'.repeat(4096) })))
  const value = JSON.parse(await readFile(target))
  assert.ok(value.index >= 0 && value.index < 12)
  assert.equal(value.text, 'x'.repeat(4096))
  assert.equal((await readdir(profile)).some(n => n.startsWith('.dsh-data-')), false)
})
