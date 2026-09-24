import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { verifiedPackageFile } from '../scripts/verified-package-file.mjs'

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
