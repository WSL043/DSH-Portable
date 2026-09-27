import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readRetainedArchive, isSupportedVirtualStore } from '../launcher/store-maintenance.mjs'

test('pnpm relative virtual stores resolve beside modules metadata, including recovery directories', () => {
  const profile = path.resolve('fixture-profile')
  const current = path.join(profile, 'node_modules', '.modules.yaml')
  const recovered = path.join(profile, 'node_modules.dsh-portable-recovery-test', '.modules.yaml')
  assert.equal(isSupportedVirtualStore(current, '.pnpm'), true)
  assert.equal(isSupportedVirtualStore(current, path.join(profile, 'node_modules/.pnpm')), true)
  assert.equal(isSupportedVirtualStore(recovered, '.pnpm'), true)
  assert.equal(isSupportedVirtualStore(recovered, path.join(profile, 'node_modules/.pnpm')), true)
  assert.equal(isSupportedVirtualStore(current, '../../foreign/.pnpm'), false)
  assert.equal(isSupportedVirtualStore(current, undefined), false)
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-retained-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const relative = '.dsh-portable-archives/dsh-image-viewer.tgz'
  const file = path.join(root, relative)
  await mkdir(path.dirname(file))
  const bytes = Buffer.from('immutable fixture archive bytes')
  await writeFile(file, bytes)
  const spec = `file:${relative}`
  const lock = { packages: { [`dsh-image-viewer@${spec}`]: { version: '0.1.2', resolution: {
    tarball: spec, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
  } } } }
  return { root, relative, file, spec, lock }
}

test('retained default archive accepts the exact locked bytes and normalized Windows specifier', async t => {
  const f = await fixture(t)
  assert.deepEqual(await readRetainedArchive(f.lock, 'dsh-image-viewer', f.spec.replaceAll('/', '\\'), f.root),
    { source: f.file, relative: f.relative, version: '0.1.2' })
})

test('a named archive is never trusted when bytes, identity or declared integrity disagree', async t => {
  const f = await fixture(t)
  await assert.rejects(readRetainedArchive(f.lock, 'other-plugin', f.spec, f.root), { code: 'STORE_ARCHIVE_IDENTITY' })
  const altered = structuredClone(f.lock)
  altered.packages[`dsh-image-viewer@${f.spec}`].resolution.integrity = 'sha256-unreviewed'
  await assert.rejects(readRetainedArchive(altered, 'dsh-image-viewer', f.spec, f.root), { code: 'STORE_ARCHIVE_IDENTITY' })
  await writeFile(f.file, 'replaced archive')
  await assert.rejects(readRetainedArchive(f.lock, 'dsh-image-viewer', f.spec, f.root), { code: 'STORE_ARCHIVE_IDENTITY' })
})

test('retention rejects traversal and arbitrary local tarball paths', async t => {
  const f = await fixture(t)
  for (const spec of ['file:../external.tgz', 'file:.dsh-portable-archives/../external.tgz', 'file:/tmp/archive.tgz', 'file:.dsh-portable-archives/unmanaged.tgz']) {
    await assert.rejects(readRetainedArchive(f.lock, 'dsh-image-viewer', spec, f.root), { code: 'STORE_EXTERNAL_REFERENCE' })
  }
})

test('a linked archive directory cannot redirect retention outside the profile', async t => {
  const f = await fixture(t)
  const outside = path.join(f.root, 'outside')
  await mkdir(outside)
  await rm(path.dirname(f.file), { recursive: true })
  await symlink(outside, path.dirname(f.file), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(f.file, 'redirected bytes')
  await assert.rejects(readRetainedArchive(f.lock, 'dsh-image-viewer', f.spec, f.root), { code: 'STORE_EXTERNAL_REFERENCE' })
})
