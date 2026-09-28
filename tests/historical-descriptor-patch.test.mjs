import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { descriptorV2PatchIdentityFor, patchDescriptorV2ReadMigration, prepareHistoricalDescriptor } from '../scripts/patch-historical-descriptor.mjs'

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
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ version: '0.1.7-rc.3' }))
    await writeFile(path.join(migration, 'index.js'), 'unknown bundle')
    assert.equal((await prepareHistoricalDescriptor(root)).applied, false)
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ version: '0.1.7-alpha.1' }))
    await assert.rejects(prepareHistoricalDescriptor(root), /Unreviewed/)
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ version: '0.1.7-rc.2' }))
    await assert.rejects(prepareHistoricalDescriptor(root), /Unreviewed/)
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ version: '0.2.0-rc.1' }))
    await assert.rejects(prepareHistoricalDescriptor(root), /Unreviewed/)
    assert.equal(await readFile(path.join(migration, 'index.js'), 'utf8'), 'unknown bundle')
    await assert.rejects(readFile(path.join(root, 'portable-session-compatibility.json')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('0.2.0-rc.1 has a separate exact digest-bound identity', () => {
  const identity = descriptorV2PatchIdentityFor('0.2.0-rc.1')
  assert.equal(identity.dshVersion, '0.2.0-rc.1')
  assert.equal(identity.sourceSha256, '1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1')
  assert.equal(identity.patchedSha256, '18a9dbd15694de23a89a9db8787f336e9da1ddf70a32f2ecd9c2918011c833d6')
  assert.equal(descriptorV2PatchIdentityFor('0.2.0-rc.2'), null)
})
