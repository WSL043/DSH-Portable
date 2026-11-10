import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateChannelHealth } from '../scripts/channel-health.mjs'

const sha = '4698325abcdef0123456789'
const release = { tag: 'v0.8.11', sha, publishedAt: '2026-10-13T09:29:00Z' }
const row = (version, status = 'success', source = sha) => ({ version, status, sourceSha: source })
const allGood = [row('0.2.1-alpha.2'), row('0.2.0-rc.2'), row('0.2.1-alpha.1')]
const soon = Date.parse('2026-10-13T10:00:00Z')
const contract = 4
const nodeVersion = '24.22.1'
const platforms = ['windows-x64', 'macos-arm64', 'macos-x64', 'linux-arm64', 'linux-x64']
const makeCatalogs = (state = allGood) => Object.fromEntries(platforms.map(platform => [platform, {
  schemaVersion: 1, channel: 'stable', platform,
  versions: state.filter(row => row.status === 'success').map(({ version }) => ({
    version, manifest: {
      platform, updateKind: 'engine', releaseChannel: 'stable', requiredShellContract: contract,
      component: { dshVersion: version, requiredNodeVersion: nodeVersion },
    },
  })),
}]))
const healthyInputs = { latestRelease: release, feedVersion: '0.8.11', state: allGood, catalogs: makeCatalogs(), contract, nodeVersion, now: soon }

test('a qualified signed core window stays healthy across shells with the same contract', () => {
  const state = allGood.map(core => ({ ...core, sourceSha: 'previous-shell' }))
  assert.deepEqual(evaluateChannelHealth({ ...healthyInputs, state }), { healthy: true, problems: [] })
})

test('a failed core or one missing from any platform catalog is a problem', () => {
  const catalogs = makeCatalogs()
  catalogs['macos-x64'].versions.pop()
  const failed = evaluateChannelHealth({ ...healthyInputs, catalogs,
    state: [row('0.2.1-alpha.2'), row('0.2.0-rc.2', 'failed'), row('0.2.1-alpha.1', 'success', 'cce3165')] })
  assert.equal(failed.healthy, false)
  assert.match(failed.problems.join('\n'), /0\.2\.0-rc\.2 is failed/)
  assert.match(failed.problems.join('\n'), /0\.2\.1-alpha\.1 is missing/)
})

test('a held feed is expected shortly after release and a problem once it overstays', () => {
  const held = evaluateChannelHealth({ latestRelease: release, feedVersion: '0.8.10', state: allGood, now: soon })
  assert.deepEqual(held, { healthy: true, problems: [], held: true })
  const stuck = evaluateChannelHealth({ latestRelease: release, feedVersion: '0.8.10', state: allGood, now: Date.parse('2026-10-13T14:00:00Z') })
  assert.equal(stuck.healthy, false)
  assert.match(stuck.problems[0], /offers 0\.8\.10 but 0\.8\.11 was published 5 h ago/)
})

test('missing release data is reported instead of passing', () => {
  assert.equal(evaluateChannelHealth({ latestRelease: null, feedVersion: '0.8.11', state: allGood }).healthy, false)
})

test('the default-plugin UI verifier ships with the shell it verifies', async () => {
  const { readFile } = await import('node:fs/promises')
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(ci, /node scripts\/verify-default-plugin-ui\.mjs/)
  assert.doesNotMatch(ci, /qualification-tools/)
  assert.doesNotMatch(ci, /Legacy core uses its existing plugin qualification/)
  await readFile(new URL('../scripts/verify-default-plugin-ui.mjs', import.meta.url), 'utf8')
})

test('a feed whose signature does not verify, or is missing on a signing release, is a problem', () => {
  const base = healthyInputs
  assert.equal(evaluateChannelHealth({ ...base, signature: 'invalid' }).healthy, false)
  assert.equal(evaluateChannelHealth({ ...base, signature: 'missing' }).healthy, true, 'releases before signing are fine')
  const signing = { ...base, feedVersion: '0.8.13', latestRelease: { ...release, tag: 'v0.8.13' } }
  assert.match(evaluateChannelHealth({ ...signing, signature: 'missing' }).problems.join(), /no signature/)
  assert.equal(evaluateChannelHealth({ ...signing, signature: 'valid' }).healthy, true)
})

test('a newest core that was blocked and never qualified anywhere does not hold the channel back', () => {
  const state = [row('0.2.1-alpha.3', 'blocked'), row('0.2.1-alpha.2'), row('0.2.0-rc.2')]
  assert.deepEqual(evaluateChannelHealth({ ...healthyInputs, state, catalogs: makeCatalogs(state) }), { healthy: true, problems: [] })
  const lost = [row('0.2.1-alpha.3', 'blocked'), row('0.2.1-alpha.3', 'success', 'cce3165'), row('0.2.1-alpha.2'), row('0.2.0-rc.2')]
  assert.equal(evaluateChannelHealth({ ...healthyInputs, state: lost, catalogs: makeCatalogs(lost) }).healthy, false, 'a core users could select must not be silently dropped')
})
