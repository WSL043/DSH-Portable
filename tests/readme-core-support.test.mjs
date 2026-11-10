import test from 'node:test'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { publishedShellState, supportedVersions, renderSupportSection, replaceSupport } from '../scripts/update-readme-core-support.mjs'

test('support list uses the published shell and the same compatibility rules as the app', () => {
  const platform = 'windows-x64'
  const component = { kind: 'dsh-runtime-capsule', dshVersion: '0.2.1-rc.5', requiredNodeVersion: '24.22.1', runtimeLayout: 'capsule-v1', bytes: 42, sha256: 'a'.repeat(64), urls: ['https://example.test/core.zip'] }
  const product = { schemaVersion: 1, portableVersion: '0.9.12', platform, releaseChannel: 'stable', minimumUpdaterSchema: 1, requiredShellSchema: 25, requiredShellFingerprint: 'a'.repeat(64), component }
  const products = { schemaVersion: 1, releaseChannel: 'stable', versions: [{ version: '0.9.12', manifest: product }] }
  const installed = publishedShellState(products, '0.9.12', platform, 4)
  const entry = (version, manifest = {}, changes = {}) => ({ version, manifest: {
    ...product, portableVersion: '0.9.11', updateKind: 'engine', requiredShellContract: 4,
    requiredShellFingerprint: 'b'.repeat(64), ...manifest, component: { ...component, dshVersion: version, ...changes },
  } })
  const index = { schemaVersion: 1, platform, channel: 'stable', versions: [
    entry('0.2.2-rc.1'),
    entry('0.2.1-rc.5'),
    entry('0.2.2-alpha.3', { requiredShellContract: 5 }),
    entry('0.2.2-alpha.2', {}, { requiredNodeVersion: '24.19.0' }),
    entry('0.2.2-alpha.1', { targetRuntimeLayout: 'expanded-v1' }),
    entry('0.2.1-rc.4', { requiredShellContract: undefined }),
    entry('0.2.1-rc.3', { portableVersion: '0.9.12', requiredShellContract: undefined, requiredShellFingerprint: 'a'.repeat(64) }),
    entry('0.2.1-rc.2', {}, { dshVersion: '0.2.1-rc.1' }),
  ] }
  assert.deepEqual(supportedVersions(index, installed, platform), ['0.2.2-rc.1', '0.2.1-rc.5', '0.2.1-rc.3'])
  assert.throws(() => publishedShellState(products, '0.9.13', platform, 4), /Missing compatibility metadata/)
  assert.throws(() => supportedVersions(index, installed, 'linux-x64'), /Invalid published core index/)
  assert.throws(() => supportedVersions({ ...index, channel: 'candidate' }, installed, platform), /Invalid published core index/)
})
test('README support output distinguishes the five-core window from qualified availability', () => {
  const rows = ['| Windows x64 | [0.2.0-rc.2](stable-index) |']
  const en = renderSupportSection('0.8.3', rows, false)
  const zh = renderSupportSection('0.8.3', rows, true)
  assert.match(en, /Optional cores \(up to 5 verified versions\)/)
  assert.match(en, /at least two release candidates or finals/)
  assert.match(en, /may contain fewer than five/)
  assert.match(en, /\| Platform \| Available cores \|/)
  assert.doesNotMatch(en, /Candidate channel|Stable channel/)
  assert.match(zh, /可选内核（最多 5 个已验证版本）/)
  assert.match(zh, /至少保留 2 个 RC 或正式版/)
  assert.match(zh, /可能少于 5 个/)
  assert.match(zh, /\| 平台 \| 可选内核 \|/)
})

test('generated table preserves surrounding README and fails on absent markers', () => {
  const source = 'before\n<!-- core-support:start -->\nold\n<!-- core-support:end -->\nafter'
  const next = replaceSupport(source, 'new')
  assert.equal(next, 'before\n<!-- core-support:start -->\nnew\n<!-- core-support:end -->\nafter')
  assert.equal(replaceSupport(next, 'new'), next)
  assert.throws(() => replaceSupport('no markers', 'new'))
})

test('the core-support updater accepts both compact landing pages without network access', async () => {
  for (const name of ['../README.zh-CN.md', '../README.md']) {
    const source = await readFile(new URL(name, import.meta.url), 'utf8')
    const next = replaceSupport(source, 'generated support fixture')
    assert.match(next, /<!-- core-support:start -->\ngenerated support fixture\n<!-- core-support:end -->/)
    assert.equal((next.match(/<!-- core-support:start -->/g) || []).length, 1)
  }
})
