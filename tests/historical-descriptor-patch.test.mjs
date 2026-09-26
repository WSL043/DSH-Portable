import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { patchDescriptorV2ReadMigration, prepareHistoricalDescriptor } from '../scripts/patch-historical-descriptor.mjs'

test('historical patch refuses unknown bytes instead of trusting a marker or version string', () => {
  for (const source of ['', 'released-v0-descriptor-v2-read-v1', 'function normalizeReleasedV0Event() {}']) {
    assert.throws(() => patchDescriptorV2ReadMigration(source), /Unreviewed migration bundle/)
  }
})

test('other core versions are untouched; reviewed version with wrong bytes fails without mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-patch-contract-'))
  try {
    const core = path.join(root, 'node_modules/@deepseek-ai/dsh')
    const migration = path.join(root, 'node_modules/@deepseek-ai/dsh-session-format-v0-to-v1/lib')
    await mkdir(core, { recursive: true })
    await mkdir(migration, { recursive: true })
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ version: '0.1.7-rc.2' }))
    await writeFile(path.join(migration, 'index.js'), 'unknown bundle')
    assert.equal((await prepareHistoricalDescriptor(root)).applied, false)
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ version: '0.1.7-alpha.1' }))
    await assert.rejects(prepareHistoricalDescriptor(root), /Unreviewed/)
    assert.equal(await readFile(path.join(migration, 'index.js'), 'utf8'), 'unknown bundle')
    await assert.rejects(readFile(path.join(root, 'portable-session-compatibility.json')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
