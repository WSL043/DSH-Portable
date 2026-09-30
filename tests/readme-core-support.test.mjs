import test from 'node:test'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { supportedVersions, renderSupportSection, replaceSupport } from '../scripts/update-readme-core-support.mjs'

test('support list excludes other baselines and mismatched core manifests', () => {
  const entry = (portableVersion, version = '0.1.5-rc.2') => ({ version, manifest: { updateKind: 'engine', portableVersion, platform: 'windows-x64', releaseChannel: 'stable', component: { dshVersion: version } } })
  const index = { schemaVersion: 1, platform: 'windows-x64', channel: 'stable', versions: [entry('0.6.8'), entry('0.6.9'), { version: '0.1.6-alpha.1' }] }
  assert.deepEqual(supportedVersions(index, '0.6.9', 'windows-x64'), ['0.1.5-rc.2'])
  assert.throws(() => supportedVersions(index, '0.6.9', 'linux-x64'))
  assert.throws(() => supportedVersions({ ...index, channel: 'candidate' }, '0.6.9', 'windows-x64'), /Invalid published core index/)
})
test('README support output is one stable column with the latest three verified cores', () => {
  const rows = ['| Windows x64 | [0.2.0-rc.2](stable-index) |']
  const en = renderSupportSection('0.8.3', rows, false)
  const zh = renderSupportSection('0.8.3', rows, true)
  assert.match(en, /Optional cores \(latest 3 verified versions\)/)
  assert.match(en, /\| Platform \| Available cores \|/)
  assert.doesNotMatch(en, /Candidate channel|Stable channel/)
  assert.match(zh, /可选内核（最新 3 个已验证版本）/)
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
  for (const name of ['../README.md', '../README.en.md']) {
    const source = await readFile(new URL(name, import.meta.url), 'utf8')
    const next = replaceSupport(source, 'generated support fixture')
    assert.match(next, /<!-- core-support:start -->\ngenerated support fixture\n<!-- core-support:end -->/)
    assert.equal((next.match(/<!-- core-support:start -->/g) || []).length, 1)
  }
})
