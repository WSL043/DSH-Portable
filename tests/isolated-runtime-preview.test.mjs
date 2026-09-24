import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRuntimeCapsule } from '../scripts/create-runtime-capsule.mjs'
import { prepareIsolatedRuntimePreview } from '../scripts/prepare-isolated-runtime-preview.mjs'
import { ensureRuntimeCapsule } from '../launcher/runtime-capsule.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')

test('two previews receive independent identities and survive cache re-materialization', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-preview-boundary-'))
  try {
    const base = path.join(temporary, 'base')
    const app = path.join(temporary, 'app-source')
    const target = 'node_modules/@deepseek-ai/example/lib/client.js'
    await mkdir(path.dirname(path.join(app, target)), { recursive: true })
    await mkdir(path.join(base, 'runtime', 'node'), { recursive: true })
    await mkdir(path.join(base, 'launcher'), { recursive: true })
    await mkdir(path.join(base, 'data'), { recursive: true })
    await writeFile(path.join(app, 'package.json'), '{}')
    await writeFile(path.join(app, ...target.split('/')), 'baseline')
    await writeFile(path.join(base, 'runtime', 'node', 'node.exe'), 'node fixture')
    await writeFile(path.join(base, 'launcher', 'runtime-entry.mjs'), 'launcher fixture')
    await writeFile(path.join(base, 'data', 'private.txt'), 'never copy user data')
    const original = await createRuntimeCapsule(app, path.join(base, 'runtime', 'DSH-App.dshpack'),
      path.join(base, 'runtime-capsule.json'), { level: 1, required: ['app/package.json'] })
    const originalPack = await readFile(path.join(base, 'runtime', 'DSH-App.dshpack'))
    const replacements = []
    for (const [name, content] of [['one', 'candidate one'], ['two', 'candidate two']]) {
      const source = path.join(temporary, `${name}.js`)
      await writeFile(source, content)
      replacements.push(await prepareIsolatedRuntimePreview({
        baseRoot: base, outputParent: path.join(temporary, 'previews'),
        replacements: [{ target, source }],
      }))
    }
    const [first, second] = replacements
    assert.equal(sha256(await readFile(path.join(base, 'runtime', 'DSH-App.dshpack'))), original.sha256)
    assert.deepEqual(await readFile(path.join(base, 'runtime', 'DSH-App.dshpack')), originalPack)
    assert.notEqual(first.receipt.previewCapsuleSha256, original.sha256)
    assert.notEqual(second.receipt.previewCapsuleSha256, original.sha256)
    assert.notEqual(first.receipt.previewCapsuleSha256, second.receipt.previewCapsuleSha256)
    await assert.rejects(readFile(path.join(first.output, 'data', 'private.txt')), { code: 'ENOENT' })
    for (const [candidate, expected] of [[first, 'candidate one'], [second, 'candidate two']]) {
      const env = { ...process.env, DSH_PORTABLE_RUNTIME_CACHE: path.join(candidate.output, 'preview-runtime-cache') }
      const loaded = await ensureRuntimeCapsule(candidate.output, { env })
      assert.equal(await readFile(path.join(loaded.runtimeRoot, 'app', ...target.split('/')), 'utf8'), expected)
      assert.equal((await ensureRuntimeCapsule(candidate.output, { env })).reused, true)
      // Re-materialization from the candidate pack must restore its own bytes.
      assert.equal(path.dirname(loaded.runtimeRoot), path.join(candidate.output, 'preview-runtime-cache'))
      await rm(loaded.runtimeRoot, { recursive: true, force: true })
      const rematerialized = await ensureRuntimeCapsule(candidate.output, { env })
      assert.equal(rematerialized.reused, false)
      assert.equal(await readFile(path.join(rematerialized.runtimeRoot, 'app', ...target.split('/')), 'utf8'), expected)
    }
    await assert.rejects(prepareIsolatedRuntimePreview({ baseRoot: base,
      outputParent: path.join(base, 'bad-output'), replacements: [{ target, source: path.join(temporary, 'one.js') }],
    }), /disjoint/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('a linked output parent cannot redirect preview writes into the source product', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-preview-link-boundary-'))
  try {
    const base = path.join(temporary, 'base')
    const alias = path.join(temporary, 'alias')
    await mkdir(base)
    try { await symlink(base, alias, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('directory links are unavailable'); return }
      throw error
    }
    await assert.rejects(prepareIsolatedRuntimePreview({ baseRoot: base,
      outputParent: path.join(alias, 'nested'), replacements: [{ target: 'example.js', source: 'unused' }],
    }), /disjoint/)
    await assert.rejects(readFile(path.join(base, 'nested', 'anything')), { code: 'ENOENT' })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
