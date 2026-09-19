import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import { createDataArchive, inspectDataArchive, restoreDataArchive } from '../launcher/data-transfer.mjs'
import { dataPathKey, normalizeDataPath, safeDataTarget, writeDataFileAtomic } from '../launcher/data-paths.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-data-security-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const stateRoot = path.join(root, 'portable')
  const dataDir = path.join(stateRoot, 'data')
  const layout = { stateRoot, dataDir, dshHome: path.join(dataDir, 'dsh-home'), workspace: path.join(stateRoot, 'workspace') }
  await mkdir(layout.workspace, { recursive: true })
  return { root, layout }
}

function entry(archivePath, data = 'new', category = 'workspace') {
  const bytes = Buffer.from(data)
  return { path: archivePath, category, bytes: bytes.length, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function archive(root, files) {
  const filename = path.join(root, 'input.dshdata')
  const document = { format: 'dsh-portable-data', version: 1, categories: [...new Set(files.map(file => file.category))], files }
  await writeFile(filename, Buffer.concat([Buffer.from('DSHDAT1U'), gzipSync(JSON.stringify(document))]))
  return filename
}

async function link(t, target, filename, directory = false) {
  try { await symlink(target, filename, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file') } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('File symlink creation is unavailable for this Windows account')
      return false
    }
    throw error
  }
  return true
}

for (const unsafe of ['workspace/./note.txt', 'workspace//note.txt', 'workspace/nested/', 'workspace/nul\0name']) {
  test(`archive inspection rejects a non-canonical path ${JSON.stringify(unsafe)}`, async t => {
    const { root } = await fixture(t)
    const filename = await archive(root, [entry(unsafe)])
    await assert.rejects(inspectDataArchive(filename), /Unsafe data package path/)
  })
}

test('backslash entries are normalized before inspection, restore and validation callbacks', async t => {
  const { root, layout } = await fixture(t)
  const filename = await archive(root, [entry('workspace\\nested\\note.txt')])
  assert.deepEqual((await inspectDataArchive(filename)).files, ['workspace/nested/note.txt'])
  let changed
  await restoreDataArchive(layout, filename, { validate: async result => { changed = result.changed } })
  assert.equal(await readFile(path.join(layout.workspace, 'nested', 'note.txt'), 'utf8'), 'new')
  assert.deepEqual(changed, [{ path: 'workspace/nested/note.txt', category: 'workspace' }])
})

test('separator aliases cannot restore the same file twice', async t => {
  const { root, layout } = await fixture(t)
  const filename = await archive(root, [entry('workspace/note.txt'), entry('workspace\\note.txt')])
  await assert.rejects(restoreDataArchive(layout, filename), /Duplicate data package path/)
  assert.deepEqual(await readdir(layout.workspace), [])
})

test('Windows path policy rejects stream names, device names and trailing aliases on every test host', () => {
  for (const value of ['workspace/file:stream', 'workspace/CON', 'workspace/nul.txt', 'workspace/com¹.txt', 'workspace/LPT9', 'workspace/conin$', 'workspace/name.', 'workspace/name ', 'workspace/a?.txt', 'workspace/control\x01.txt']) {
    assert.throws(() => normalizeDataPath(value, 'win32'), /Unsafe data package path/, value)
  }
  for (const value of ['C:relative', '/absolute', '\\rooted', '\\\\server\\share', 'workspace/../escape']) {
    assert.throws(() => normalizeDataPath(value, 'linux'), /Unsafe data package path/, value)
  }
  assert.equal(normalizeDataPath('workspace/report:2026.txt', 'linux'), 'workspace/report:2026.txt')
  assert.equal(normalizeDataPath('workspace/日本語 notes.txt', 'win32'), 'workspace/日本語 notes.txt')
  assert.equal(dataPathKey('workspace/NOTE.txt', 'win32'), dataPathKey('workspace/note.txt', 'win32'))
})

test('Windows restore rejects case aliases before writing', { skip: process.platform !== 'win32' }, async t => {
  const { root, layout } = await fixture(t)
  const filename = await archive(root, [entry('workspace/Note.txt'), entry('workspace/note.txt')])
  await assert.rejects(restoreDataArchive(layout, filename), /Duplicate data package path/)
  assert.deepEqual(await readdir(layout.workspace), [])
})

test('restore rejects a dangling destination link and preserves the link', async t => {
  const { root, layout } = await fixture(t)
  const target = path.join(layout.workspace, 'note.txt')
  const external = path.join(root, 'missing.txt')
  if (!await link(t, external, target)) return
  const filename = await archive(root, [entry('workspace/note.txt')])
  await assert.rejects(restoreDataArchive(layout, filename), /Unsafe restore path/)
  assert.equal((await lstat(target)).isSymbolicLink(), true)
  await assert.rejects(lstat(external), { code: 'ENOENT' })
})

test('restore does not follow an existing parent directory link', async t => {
  const { root, layout } = await fixture(t)
  const external = path.join(root, 'external')
  await mkdir(external)
  if (!await link(t, external, path.join(layout.workspace, 'linked'), true)) return
  const filename = await archive(root, [entry('workspace/linked/note.txt')])
  await assert.rejects(restoreDataArchive(layout, filename), /Unsafe restore path/)
  assert.deepEqual(await readdir(external), [])
})

test('restore does not write through a pre-existing predictable staging link', async t => {
  const { root, layout } = await fixture(t)
  const external = path.join(root, 'external.txt')
  await writeFile(external, 'untouched')
  const stale = path.join(layout.workspace, `note.txt.dsh-import-${process.pid}`)
  if (!await link(t, external, stale)) return
  const filename = await archive(root, [entry('workspace/note.txt')])
  await restoreDataArchive(layout, filename)
  assert.equal(await readFile(external, 'utf8'), 'untouched')
  assert.equal((await lstat(stale)).isSymbolicLink(), true)
  assert.equal(await readFile(path.join(layout.workspace, 'note.txt'), 'utf8'), 'new')
})

test('export does not write through a pre-existing predictable staging link', async t => {
  const { root, layout } = await fixture(t)
  await writeFile(path.join(layout.workspace, 'note.txt'), 'data')
  const external = path.join(root, 'external.txt')
  await writeFile(external, 'untouched')
  const output = path.join(root, 'output.dshdata')
  const stale = `${output}.part-${process.pid}`
  if (!await link(t, external, stale)) return
  await createDataArchive(layout, output, { categories: ['workspace'] })
  assert.equal(await readFile(external, 'utf8'), 'untouched')
  assert.equal((await lstat(stale)).isSymbolicLink(), true)
  assert.deepEqual((await inspectDataArchive(output)).files, ['workspace/note.txt'])
})

test('replace mode rejects a linked backup parent without altering either tree', async t => {
  const { root, layout } = await fixture(t)
  const external = path.join(root, 'external-backups')
  await mkdir(external)
  await mkdir(layout.dataDir, { recursive: true })
  if (!await link(t, external, path.join(layout.dataDir, 'backups'), true)) return
  await writeFile(path.join(layout.workspace, 'note.txt'), 'old')
  const filename = await archive(root, [entry('workspace/note.txt')])
  await assert.rejects(restoreDataArchive(layout, filename, { conflict: 'replace' }), /Unsafe restore path/)
  assert.equal(await readFile(path.join(layout.workspace, 'note.txt'), 'utf8'), 'old')
  assert.deepEqual(await readdir(external), [])
})

test('generated-path preparation rejects a linked ancestor before moving content', async t => {
  const { root, layout } = await fixture(t)
  const external = path.join(root, 'external-profile')
  await mkdir(path.join(external, 'node_modules'), { recursive: true })
  await writeFile(path.join(external, 'node_modules', 'keep.txt'), 'untouched')
  if (!await link(t, external, path.join(layout.workspace, 'linked'), true)) return
  const filename = await archive(root, [entry('workspace/note.txt')])
  await assert.rejects(restoreDataArchive(layout, filename, { validate: async ({ transaction }) => {
    await transaction.prepareGeneratedPath(path.join(layout.workspace, 'linked', 'node_modules'))
  } }), /Unsafe restore path/)
  assert.equal(await readFile(path.join(external, 'node_modules', 'keep.txt'), 'utf8'), 'untouched')
  await assert.rejects(lstat(path.join(layout.workspace, 'note.txt')), { code: 'ENOENT' })
})

test('failed validation restores replaced files and generated directories', async t => {
  const { root, layout } = await fixture(t)
  await writeFile(path.join(layout.workspace, 'note.txt'), 'old')
  const generated = path.join(layout.workspace, 'generated')
  await mkdir(generated)
  await writeFile(path.join(generated, 'original.txt'), 'original')
  const filename = await archive(root, [entry('workspace/note.txt'), entry('workspace/new.txt')])
  await assert.rejects(restoreDataArchive(layout, filename, { conflict: 'replace', validate: async ({ transaction }) => {
    await transaction.prepareGeneratedPath(generated)
    await mkdir(generated)
    await writeFile(path.join(generated, 'installed.txt'), 'new')
    throw new Error('validation failed')
  } }), /validation failed/)
  assert.equal(await readFile(path.join(layout.workspace, 'note.txt'), 'utf8'), 'old')
  await assert.rejects(lstat(path.join(layout.workspace, 'new.txt')), { code: 'ENOENT' })
  assert.deepEqual(await readdir(generated), ['original.txt'])
})

test('generated dangling links survive a failed validation unchanged', async t => {
  const { root, layout } = await fixture(t)
  const generated = path.join(layout.workspace, 'generated')
  if (!await link(t, path.join(root, 'missing'), generated)) return
  const filename = await archive(root, [entry('workspace/note.txt')])
  await assert.rejects(restoreDataArchive(layout, filename, { validate: async ({ transaction }) => {
    await transaction.prepareGeneratedPath(generated)
    await mkdir(generated)
    throw new Error('validation failed')
  } }), /validation failed/)
  assert.equal((await lstat(generated)).isSymbolicLink(), true)
})

test('atomic writes clean up their own staging file when rename fails', async t => {
  const { root } = await fixture(t)
  const target = path.join(root, 'directory')
  await mkdir(target)
  await assert.rejects(writeDataFileAtomic(target, Buffer.from('data')))
  assert.equal((await lstat(target)).isDirectory(), true)
  assert.equal((await readdir(root)).some(name => name.startsWith('.dsh-data-')), false)
})

test('safe targets create ordinary directories and reject a directory as a file', async t => {
  const { layout } = await fixture(t)
  const target = await safeDataTarget(layout.stateRoot, 'workspace/new/note.txt')
  await writeDataFileAtomic(target, Buffer.from('hello'))
  assert.equal(await readFile(target, 'utf8'), 'hello')
  await assert.rejects(safeDataTarget(layout.stateRoot, 'workspace/new'), /Unsafe restore path/)
})

test('profile artifact directories cannot be imported through case aliases or the credentials category', async t => {
  const { root, layout } = await fixture(t)
  for (const [archivePath, category] of [
    ['data/dsh-home/profiles/web/NODE_MODULES/package.json', 'plugins'],
    ['data/dsh-home/profiles/web/.GIT/config.toml', 'credentials'],
  ]) {
    const filename = await archive(root, [entry(archivePath, 'data', category)])
    await assert.rejects(restoreDataArchive(layout, filename), /Data path does not belong/)
  }
})

test('POSIX filenames containing a literal backslash fail export rather than silently changing names', { skip: process.platform === 'win32' }, async t => {
  const { root, layout } = await fixture(t)
  await writeFile(path.join(layout.workspace, 'literal\\name.txt'), 'original')
  const output = path.join(root, 'existing.dshdata')
  await writeFile(output, 'existing backup')
  await assert.rejects(createDataArchive(layout, output, { categories: ['workspace'] }), /Unsupported filename/)
  assert.equal(await readFile(output, 'utf8'), 'existing backup')
  assert.equal(await readFile(path.join(layout.workspace, 'literal\\name.txt'), 'utf8'), 'original')
})

test('ordinary exports remain restorable and keep-mode conflicts preserve user data', async t => {
  const { root, layout } = await fixture(t)
  await writeFile(path.join(layout.workspace, '日本語 notes.txt'), 'original')
  const filename = path.join(root, 'output.dshdata')
  await createDataArchive(layout, filename, { categories: ['workspace'] })
  await writeFile(path.join(layout.workspace, '日本語 notes.txt'), 'local edit')
  const kept = await restoreDataArchive(layout, filename)
  assert.deepEqual(kept.conflicts, ['workspace/日本語 notes.txt'])
  assert.equal(kept.rollbackDirectory, null)
  assert.equal(await readFile(path.join(layout.workspace, '日本語 notes.txt'), 'utf8'), 'local edit')
  const replaced = await restoreDataArchive(layout, filename, { conflict: 'replace' })
  assert.equal(await readFile(path.join(layout.workspace, '日本語 notes.txt'), 'utf8'), 'original')
  assert.equal(await readFile(path.join(replaced.rollbackDirectory, 'workspace', '日本語 notes.txt'), 'utf8'), 'local edit')
  assert.equal((await readdir(layout.workspace)).some(name => name.startsWith('.dsh-data-')), false)
})

test('atomic writes leave private files on POSIX', { skip: process.platform === 'win32' }, async t => {
  const { root } = await fixture(t)
  const filename = path.join(root, 'private')
  await writeDataFileAtomic(filename, Buffer.from('private'))
  assert.equal((await lstat(filename)).mode & 0o777, 0o600)
})
