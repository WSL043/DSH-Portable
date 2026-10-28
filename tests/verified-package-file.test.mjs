import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { verifiedPackageFile } from '../scripts/verified-package-file.mjs'
import { safeDataTarget } from '../launcher/data-paths.mjs'

test('package file lookup rejects traversal and symlinks outside the package', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-package-path-'))
  try {
    const root = path.join(parent, 'package')
    const outside = path.join(parent, 'package-other')
    await mkdir(path.join(root, 'licenses'), { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(root, 'licenses', 'COMPONENTS.json'), '{}')
    await writeFile(path.join(outside, 'secret'), 'outside')
    assert.equal(await verifiedPackageFile(root, 'licenses', 'COMPONENTS.json'), await realpath(path.join(root, 'licenses', 'COMPONENTS.json')))
    await assert.rejects(verifiedPackageFile(root, '..', 'package-other', 'secret'), /escapes its root/)
    if (process.platform !== 'win32') {
      await symlink(path.join(outside, 'secret'), path.join(root, 'licenses', 'redirect'))
      await assert.rejects(verifiedPackageFile(root, 'licenses', 'redirect'), /escapes its root/)
    }
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('acceptance reports stay inside the selected evidence root and reject pre-existing redirect links', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dsh-evidence-path-'))
  try {
    const evidence = path.join(parent, 'evidence')
    const outside = path.join(parent, 'outside')
    await mkdir(evidence)
    await mkdir(outside)
    const root = await realpath(evidence)
    const leaf = 'category-geometry.json'
    const target = await safeDataTarget(root, leaf)
    await writeFile(target, 'first', { flag: 'wx' })
    await writeFile(await verifiedPackageFile(root, leaf), 'updated')
    assert.equal(await readFile(target, 'utf8'), 'updated')
    await assert.rejects(safeDataTarget(root, '../outside/category-geometry.json'), /Unsafe/)
    const outsideFile = path.join(outside, leaf)
    await writeFile(outsideFile, 'outside stays unchanged')
    await rm(target)
    await symlink(process.platform === 'win32' ? outside : outsideFile, target,
      process.platform === 'win32' ? 'junction' : 'file')
    await assert.rejects(safeDataTarget(root, leaf), /Unsafe/)
    await assert.rejects(verifiedPackageFile(root, leaf), /escapes its root/)
    assert.equal(await readFile(outsideFile, 'utf8'), 'outside stays unchanged')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
