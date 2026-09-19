import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildBundleLayers } from '../app/vendor/dsh-portable-plugin-market/src/check.ts'
import { preflightPluginImports } from '../app/vendor/dsh-portable-plugin-market/src/import-preflight.ts'
import { resolvePackageRelativePath } from '../app/vendor/dsh-portable-plugin-market/src/package-path.ts'
import { bundlePatchTargets, entryArtifactExists } from '../app/vendor/dsh-portable-plugin-market/src/profile.ts'
import { carrierDisableIds } from '../app/vendor/dsh-portable-plugin-market/src/patch.ts'
import * as verify from '../app/vendor/dsh-portable-plugin-market/src/verify.ts'

test('declared bundle patches stay inside the package directory', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dshm-package-path-')))
  t.after(() => rm(root, { recursive: true, force: true }))

  const profile = root
  const packageDir = path.join(profile, 'node_modules', 'fixture')
  await mkdir(packageDir, { recursive: true })
  const outsidePatch = path.join(profile, 'node_modules', 'outside.yml')
  await writeFile(outsidePatch, '- id: escaped\n  disabled: true\n')
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { fixture: '1.0.0' },
    dsh: { profile: { bundles: ['fixture'] } },
  }))
  const manifestPath = path.join(packageDir, 'package.json')
  const writeManifest = async patch => writeFile(manifestPath, JSON.stringify({
    name: 'fixture',
    dsh: { bundle: { patch } },
  }))

  for (const patch of ['../outside.yml', '..\\outside.yml', outsidePatch]) {
    await writeManifest(patch)
    assert.deepEqual(bundlePatchTargets(packageDir), [])
    assert.deepEqual(carrierDisableIds(profile, 'fixture'), [])
    const result = buildBundleLayers(profile, ['fixture'], { fixture: '1.0.0' }, null)
    assert.equal(result.bundles[0]?.patchPath, null)
    assert.match(result.bundles[0]?.error ?? '', /package-relative path/)
    assert.deepEqual(await preflightPluginImports(profile, ['fixture'], { dshInstallDir: null }), { ok: true, checked: [] })
  }

  const internalPatch = path.join(packageDir, 'patch.yml')
  await writeFile(internalPatch, '- id: legal\n  name: legal\n')
  await writeManifest('./patch.yml')
  assert.deepEqual(bundlePatchTargets(packageDir), ['legal'])
  const legal = buildBundleLayers(profile, ['fixture'], { fixture: '1.0.0' }, null).bundles[0]
  assert.equal(legal?.patchPath, internalPatch)
  assert.equal(legal?.error, null)
})

test('package entry checks reject absolute and parent paths while keeping internal entries', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dshm-entry-path-')))
  t.after(() => rm(root, { recursive: true, force: true }))

  const packageDir = path.join(root, 'node_modules', 'fixture')
  await mkdir(packageDir, { recursive: true })
  const outsideEntry = path.join(root, 'node_modules', 'outside.js')
  await writeFile(outsideEntry, 'function {')
  const manifestPath = path.join(packageDir, 'package.json')
  const writeManifest = async exportsField => writeFile(manifestPath, JSON.stringify({
    name: 'fixture',
    dsh: { client: {} },
    exports: { './client': exportsField },
  }))

  assert.equal(resolvePackageRelativePath(packageDir, '../outside.js'), null)
  assert.equal(resolvePackageRelativePath(packageDir, outsideEntry), null)
  assert.equal(resolvePackageRelativePath(packageDir, './client.js'), path.join(packageDir, 'client.js'))

  await writeManifest('../outside.js')
  assert.equal(verify.clientBundlePath('../outside.js'), null)
  assert.equal(verify.checkClientBundle('web', 'fixture', root).ok, true)

  await writeManifest(outsideEntry)
  assert.equal(verify.clientBundlePath(outsideEntry), null)
  assert.equal(verify.checkClientBundle('web', 'fixture', root).ok, true)
  assert.equal(entryArtifactExists(packageDir), false)

  await writeFile(path.join(packageDir, 'client.js'), 'function {')
  await writeManifest('./client.js')
  assert.equal(verify.clientBundlePath('./client.js'), './client.js')
  assert.equal(verify.checkClientBundle('web', 'fixture', root).ok, false)
})
