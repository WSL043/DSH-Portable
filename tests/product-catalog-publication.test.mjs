import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  mergeProductCatalog,
  prepareProductCatalog,
  validateProductArtifact,
} from '../scripts/prepare-product-catalog.mjs'
import { comparePortableVersions } from '../launcher/update-core.mjs'

const platform = 'windows-x64'
const repository = 'https://github.com/WSL043/DSH-Portable'
const policy = {
  schemaVersion: 1,
  minimumSelectableVersion: '0.6.5-rc.1',
  blockedVersions: ['0.6.5-rc.3'],
}

function componentUrl(channel, version = '0.6.5-rc.1', targetPlatform = platform) {
  return `${repository}/releases/download/update-channel-${channel}/DSH-Portable-update-${targetPlatform}-${version}.zip`
}

function manifest(version, channel = 'candidate', targetPlatform = platform, overrides = {}) {
  return {
    schemaVersion: 1,
    portableVersion: version,
    releaseChannel: channel,
    platform: targetPlatform,
    minimumUpdaterSchema: 1,
    requiredShellSchema: 1,
    component: {
      kind: 'dsh-app',
      dshVersion: '0.1.0',
      dshCommit: 'a'.repeat(40),
      requiredNodeVersion: '24.19.0',
      bytes: 1,
      sha256: 'b'.repeat(64),
      urls: [componentUrl(channel, version, targetPlatform)],
    },
    ...overrides,
  }
}

function entry(version, channel = 'candidate', overrides = {}) {
  return {
    version,
    manifestUrl: `${repository}/releases/download/update-channel-${channel}/portable-update-${platform}-${version}.json`,
    manifest: manifest(version, channel),
    ...overrides,
  }
}

test('mergeProductCatalog sorts descending, replaces the current version, and caps at 20', () => {
  const oldEntries = []
  for (let index = 1; index <= 22; index += 1) oldEntries.push(entry(`0.6.5-rc.${index}`))
  oldEntries.push(entry('0.6.5-rc.23', 'candidate', { manifest: manifest('0.6.5-rc.23', 'candidate', platform, { component: { ...manifest('0.6.5-rc.23').component, dshVersion: 'old' } }) }))
  const current = entry('0.6.5-rc.23', 'candidate', { manifest: manifest('0.6.5-rc.23') })
  const result = mergeProductCatalog({
    existingEntries: oldEntries,
    currentEntry: current,
    releaseChannel: 'candidate',
    policy: { ...policy, blockedVersions: [] },
    platform,
  })
  assert.equal(result.length, 20)
  assert.equal(result[0].version, '0.6.5-rc.23')
  assert.equal(result[0].manifest.component.dshVersion, '0.1.0')
  for (let index = 1; index < result.length; index += 1) {
    assert.ok(comparePortableVersions(result[index - 1].version, result[index].version) > 0)
  }
})

test('mergeProductCatalog removes below-minimum and blocked versions', () => {
  const result = mergeProductCatalog({
    existingEntries: [entry('0.6.4'), entry('0.6.5-rc.3'), entry('0.6.5-rc.4')],
    currentEntry: entry('0.6.5-rc.5'),
    releaseChannel: 'candidate',
    policy,
    platform,
  })
  assert.deepEqual(result.map(({ version }) => version), ['0.6.5-rc.5', '0.6.5-rc.4'])
})

test('stable catalog removes prerelease entries', () => {
  const result = mergeProductCatalog({
    existingEntries: [entry('0.6.6-rc.1'), entry('0.6.6', 'stable')],
    currentEntry: entry('0.6.7', 'stable'),
    releaseChannel: 'stable',
    policy: { ...policy, blockedVersions: [] },
    platform,
  })
  assert.deepEqual(result.map(({ version }) => version), ['0.6.7', '0.6.6'])
})

test('cross-repository manifest URLs are rejected', () => {
  assert.throws(() => mergeProductCatalog({
    existingEntries: [entry('0.6.5-rc.2', 'candidate', { manifestUrl: 'https://example.invalid/portable-update-windows-x64-0.6.5-rc.2.json' })],
    currentEntry: entry('0.6.5-rc.4'),
    releaseChannel: 'candidate',
    policy,
    platform,
  }), /outside the Portable update channels/i)
})

test('same-version archive byte or digest mismatch fails validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-product-catalog-'))
  try {
    const archivePath = path.join(root, 'DSH-Portable-update-windows-x64.zip')
    const bytes = Buffer.from('fixture archive')
    await writeFile(archivePath, bytes)
    const good = manifest('0.6.5-rc.1')
    good.component.bytes = bytes.length
    good.component.sha256 = createHash('sha256').update(bytes).digest('hex')
    await assert.doesNotReject(validateProductArtifact({ manifest: good, archivePath, platform, expectedVersion: '0.6.5-rc.1' }))
    good.component.sha256 = '0'.repeat(64)
    await assert.rejects(validateProductArtifact({ manifest: good, archivePath, platform, expectedVersion: '0.6.5-rc.1' }), /digest mismatch/i)
    good.component.sha256 = createHash('sha256').update(bytes).digest('hex')
    good.component.bytes += 1
    await assert.rejects(validateProductArtifact({ manifest: good, archivePath, platform, expectedVersion: '0.6.5-rc.1' }), /byte count mismatch/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('versioned output manifest retains its fields while using one immutable archive URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-product-catalog-fields-'))
  try {
    const archivePath = path.join(root, 'archive.zip')
    await writeFile(archivePath, 'fixture')
    const bytes = await readFile(archivePath)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const source = manifest('0.6.5-rc.1')
    source.component.bytes = bytes.length
    source.component.sha256 = digest
    const result = await validateProductArtifact({ manifest: source, archivePath, platform, expectedVersion: '0.6.5-rc.1' })
    assert.deepEqual(result, { bytes: bytes.length, sha256: digest, version: '0.6.5-rc.1', platform })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('stable publication writes stable and candidate indexes whose current entry uses the stable immutable URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-product-catalog-stable-'))
  try {
    const assets = path.join(root, 'update-assets')
    const output = path.join(root, 'product-catalog')
    await mkdir(assets, { recursive: true })
    const version = '0.6.5'
    for (const targetPlatform of ['windows-x64', 'macos-arm64', 'macos-x64', 'linux-arm64', 'linux-x64']) {
      const archive = Buffer.from(`archive:${targetPlatform}`)
      const current = manifest(version, 'stable', targetPlatform)
      current.component.bytes = archive.length
      current.component.sha256 = createHash('sha256').update(archive).digest('hex')
      await writeFile(path.join(assets, `DSH-Portable-update-${targetPlatform}.zip`), archive)
      await writeFile(path.join(assets, `portable-update-${targetPlatform}.json`), `${JSON.stringify(current)}\n`)
    }
    await prepareProductCatalog({
      updateAssetsDir: assets,
      outputDir: output,
      releaseChannel: 'stable',
      version,
      policy: { schemaVersion: 1, minimumSelectableVersion: '0.6.5-rc.1', blockedVersions: [] },
      fetchImpl: async () => ({ status: 404, ok: false, body: null }),
    })
    const stable = JSON.parse(await readFile(path.join(output, 'stable', 'portable-index-windows-x64.json'), 'utf8'))
    const candidate = JSON.parse(await readFile(path.join(output, 'candidate', 'portable-index-windows-x64.json'), 'utf8'))
    const stableUrl = `${repository}/releases/download/update-channel-stable/portable-update-windows-x64-${version}.json`
    const componentUrlStable = `${repository}/releases/download/update-channel-stable/DSH-Portable-update-windows-x64-${version}.zip`
    assert.equal(stable.versions[0].manifestUrl, stableUrl)
    assert.equal(candidate.versions[0].manifestUrl, stableUrl)
    assert.deepEqual(candidate.versions[0].manifest.component.urls, [componentUrlStable])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
