import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  descriptorV2PatchIdentityFor,
  patchDescriptorV2ReadMigration,
  prepareHistoricalDescriptor,
  readHistoricalDescriptorVersions,
} from '../scripts/patch-historical-descriptor.mjs'

const TEST_TEMP_ROOT = fileURLToPath(new URL('../build/orch-080/T14/test-fixtures/', import.meta.url))
const EXPECTED_IDENTITY = {
  id: 'released-v0-descriptor-v2-read-v1',
  sourceSha256: '1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1',
  patchedSha256: '18a9dbd15694de23a89a9db8787f336e9da1ddf70a32f2ecd9c2918011c833d6',
}

test('historical patch refuses unknown bytes instead of trusting a marker or version string', () => {
  for (const source of ['', 'released-v0-descriptor-v2-read-v1', 'function normalizeReleasedV0Event() {}']) {
    assert.throws(() => patchDescriptorV2ReadMigration(source), /Unreviewed migration bundle/)
  }
})

test('other core versions are untouched; reviewed version with wrong bytes fails without mutation', async () => {
  await mkdir(TEST_TEMP_ROOT, { recursive: true })
  const root = await mkdtemp(path.join(TEST_TEMP_ROOT, 'dsh-patch-contract-'))
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

test('historical descriptor versions come from a unique exact-string allowlist', () => {
  assert.deepEqual(readHistoricalDescriptorVersions(), ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1'])
  for (const version of ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1']) {
    assert.deepEqual(descriptorV2PatchIdentityFor(version), { ...EXPECTED_IDENTITY, dshVersion: version })
  }
  for (const version of ['0.1.7-rc.20', '0.2.0-rc.10', '^0.2.0-rc.1', '0.2.0-*']) {
    assert.equal(descriptorV2PatchIdentityFor(version), null)
  }
})

test('historical descriptor identity fails closed when its allowlist is missing or malformed', async t => {
  await mkdir(TEST_TEMP_ROOT, { recursive: true })
  for (const [name, contents, expected] of [
    ['missing', null, /allowlist is missing/],
    ['invalid-json', '{', /allowlist is unreadable or invalid JSON/],
    ['range-entry', '["^0.2.0-rc.1"]', /unique exact version strings/],
  ]) {
    await t.test(name, async () => {
      const root = await mkdtemp(path.join(TEST_TEMP_ROOT, 'allowlist-'))
      try {
        const moduleDirectory = path.join(root, 'scripts')
        const modulePath = path.join(moduleDirectory, 'patch-historical-descriptor.mjs')
        await mkdir(moduleDirectory, { recursive: true })
        await copyFile(new URL('../scripts/patch-historical-descriptor.mjs', import.meta.url), modulePath)
        if (contents !== null) {
          const configPath = path.join(root, 'config', 'historical-descriptor-versions.json')
          await mkdir(path.dirname(configPath), { recursive: true })
          await writeFile(configPath, contents)
        }
        const source = `import { descriptorV2PatchIdentityFor } from ${JSON.stringify(pathToFileURL(modulePath).href)}; descriptorV2PatchIdentityFor('0.1.7-alpha.1')`
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, expected)
      } finally { await rm(root, { recursive: true, force: true }) }
    })
  }
})
