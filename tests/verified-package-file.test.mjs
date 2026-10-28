import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifiedPackageFile } from '../scripts/verified-package-file.mjs'
import { safeDataTarget } from '../launcher/data-paths.mjs'
import { marketEvidenceLocation, prepareMarketEvidenceOutput } from '../scripts/smoke-windows-market-categories.mjs'

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

test('market evidence permits its real temporary fixture and fixed repository storage branch only', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-market-evidence-'))
  try {
    const output = path.join(temporary, 'new', 'evidence')
    assert.equal(await prepareMarketEvidenceOutput(output), await realpath(output))
    const repository = fileURLToPath(new URL('../', import.meta.url))
    const storage = path.join(repository, 'complete-evidence', 'storage')
    assert.ok(marketEvidenceLocation(storage))
    assert.ok(marketEvidenceLocation(path.join(storage, 'nested')))
    const outside = path.join(path.parse(os.tmpdir()).root, path.basename(temporary))
    await assert.rejects(prepareMarketEvidenceOutput(outside), /must be below an actual temporary root/)
    await assert.rejects(access(outside), { code: 'ENOENT' })
    const previousActions = process.env.GITHUB_ACTIONS
    const previousRunnerTemp = process.env.RUNNER_TEMP
    try {
      process.env.GITHUB_ACTIONS = 'true'
      const forgedRoot = `${outside}-forged-runner`
      process.env.RUNNER_TEMP = forgedRoot
      const forgedOutput = path.join(forgedRoot, 'evidence')
      await assert.rejects(prepareMarketEvidenceOutput(forgedOutput), /must be below an actual temporary root/)
      await assert.rejects(access(forgedOutput), { code: 'ENOENT' })
    } finally {
      if (previousActions === undefined) delete process.env.GITHUB_ACTIONS
      else process.env.GITHUB_ACTIONS = previousActions
      if (previousRunnerTemp === undefined) delete process.env.RUNNER_TEMP
      else process.env.RUNNER_TEMP = previousRunnerTemp
    }
    assert.throws(() => marketEvidenceLocation(os.tmpdir()), /must be below an actual temporary root/)
    for (const relative of ['docs', 'complete-evidence-other/storage', 'complete-evidence/storage-other']) {
      assert.throws(() => marketEvidenceLocation(path.join(repository, relative)), /must be below an actual temporary root/)
    }
    const linked = path.join(temporary, 'redirect')
    await symlink(repository, linked, process.platform === 'win32' ? 'junction' : 'dir')
    const escapeLeaf = `${path.basename(temporary)}-not-created`
    await assert.rejects(prepareMarketEvidenceOutput(path.join(linked, escapeLeaf)), /Unsafe/)
    await assert.rejects(access(path.join(repository, escapeLeaf)), { code: 'ENOENT' })
    const dangling = path.join(temporary, 'dangling')
    await symlink(path.join(temporary, 'missing-target'), dangling, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(prepareMarketEvidenceOutput(path.join(dangling, 'must-not-create')), /Unsafe/)
    await assert.rejects(access(path.join(temporary, 'missing-target')), { code: 'ENOENT' })
  } finally {
    await rm(temporary, { recursive: true, force: true })
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
