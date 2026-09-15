import test from 'node:test'
import assert from 'node:assert/strict'
import { supportedVersions, replaceSupport } from '../scripts/update-readme-core-support.mjs'

test('support list excludes other baselines and mismatched core manifests', () => {
  const entry = (portableVersion, version = '0.1.5-rc.2') => ({ version, manifest: { updateKind: 'engine', portableVersion, platform: 'windows-x64', releaseChannel: 'stable', component: { dshVersion: version } } })
  const index = { schemaVersion: 1, platform: 'windows-x64', channel: 'stable', versions: [entry('0.6.8'), entry('0.6.9'), { version: '0.1.6-alpha.1' }] }
  assert.deepEqual(supportedVersions(index, '0.6.9', 'windows-x64', 'stable'), ['0.1.5-rc.2'])
  assert.throws(() => supportedVersions(index, '0.6.9', 'linux-x64', 'stable'))
})
test('generated table preserves surrounding README and fails on absent markers', () => {
  const source = 'before\n<!-- core-support:start -->\nold\n<!-- core-support:end -->\nafter'
  const next = replaceSupport(source, 'new')
  assert.equal(next, 'before\n<!-- core-support:start -->\nnew\n<!-- core-support:end -->\nafter')
  assert.equal(replaceSupport(next, 'new'), next)
  assert.throws(() => replaceSupport('no markers', 'new'))
})
