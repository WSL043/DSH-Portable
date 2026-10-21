import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { incompatibleProfilePeers, pauseIncompatibleProfileBundles, satisfiesHostPeer } from '../launcher/profile-compatibility.mjs'

const appRequire = createRequire(new URL('../app/package.json', import.meta.url))
const semver = appRequire('semver')

test('packaging and startup agree on the Cordis peer that would pause a default plugin', async () => {
  const hostVersion = async name => name === '@deepseek-ai/cordis' ? '4.0.4' : null
  const satisfies = (version, range) => range.split(' || ').includes(version)
  const old = await incompatibleProfilePeers({ peerDependencies: { '@deepseek-ai/cordis': '4.0.3' } }, hostVersion, { satisfies })
  assert.deepEqual(old, [{ peer: '@deepseek-ai/cordis', required: '4.0.3', installed: '4.0.4' }])
  const updated = await incompatibleProfilePeers({ peerDependencies: { '@deepseek-ai/cordis': '4.0.3 || 4.0.4' } }, hostVersion, { satisfies })
  assert.deepEqual(updated, [])
})

test('compatibility scan leaves a missing profile untouched', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-profile-compat-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  const result = await pauseIncompatibleProfileBundles(layout)
  assert.deepEqual(result, { status: 'skipped', paused: [] })
  assert.equal(existsSync(path.join(layout.dshHome, 'profiles')), false)
})

test('startup pauses only active third-party bundles whose declared host peers exclude the current runtime', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-profile-compat-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  const profile = path.join(layout.dshHome, 'profiles', 'web')
  const peer = '@deepseek-ai/dsh-client-ui-settings'
  const pluginRoot = path.join(profile, 'node_modules', 'old-plugin')
  const currentRoot = path.join(profile, 'node_modules', 'current-plugin')
  const malformedRoot = path.join(profile, 'node_modules', 'malformed-plugin')
  const hostRoot = path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings')
  const outsideRoot = path.join(root, 'trap')
  for (const directory of [pluginRoot, currentRoot, malformedRoot, hostRoot, outsideRoot]) await mkdir(directory, { recursive: true })
  const manifestFile = path.join(profile, 'package.json')
  await writeFile(manifestFile, `${JSON.stringify({
    dependencies: { 'old-plugin': '1.0.0', 'current-plugin': '2.0.0', 'malformed-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'old-plugin', 'current-plugin', 'malformed-plugin'] } },
  })}\n`)
  await writeFile(path.join(pluginRoot, 'package.json'), JSON.stringify({ version: '1.0.0', peerDependencies: { [peer]: '0.1.6-alpha.1' } }))
  await writeFile(path.join(currentRoot, 'package.json'), JSON.stringify({ version: '2.0.0', peerDependencies: { [peer]: '0.1.7-alpha.1' } }))
  await writeFile(path.join(malformedRoot, 'package.json'), JSON.stringify({ version: '1.0.0', peerDependencies: { '@deepseek-ai/../../../trap': '0.1.6-alpha.1' } }))
  await writeFile(path.join(hostRoot, 'package.json'), JSON.stringify({ version: '0.1.7-alpha.1' }))
  await writeFile(path.join(outsideRoot, 'package.json'), JSON.stringify({ version: '0.1.7-alpha.1' }))

  const result = await pauseIncompatibleProfileBundles(layout, { satisfies: (version, range) => version === range })
  assert.equal(result.status, 'paused')
  assert.deepEqual(result.paused.map(item => item.name), ['old-plugin'])
  assert.deepEqual(result.paused[0].incompatiblePeers, [{ peer, required: '0.1.6-alpha.1', installed: '0.1.7-alpha.1' }])
  const updated = JSON.parse(await readFile(manifestFile, 'utf8'))
  assert.deepEqual(updated.dsh.profile.bundles, ['@deepseek-ai/dsh-web-app', 'current-plugin', 'malformed-plugin'])
  assert.equal(updated.dependencies['old-plugin'], '1.0.0')
  assert.equal(existsSync(path.join(pluginRoot, 'package.json')), true)
  assert.deepEqual((await pauseIncompatibleProfileBundles(layout, { satisfies: (version, range) => version === range })).paused, [])
})

test('host peer checks include prerelease host versions', () => {
  const calls = []
  const semver = {
    satisfies(version, range, options) {
      calls.push({ version, range, options })
      return options?.includePrerelease === true
    },
  }
  assert.equal(satisfiesHostPeer(semver, '0.2.1-rc.2', '>=0.2.0-rc.0 <0.3.0'), true)
  assert.deepEqual(calls, [{ version: '0.2.1-rc.2', range: '>=0.2.0-rc.0 <0.3.0', options: { includePrerelease: true } }])
})

test('real semver accepts broad host ranges without accepting incompatible prereleases or releases', () => {
  for (const range of ['>=0.2.0-rc.0 <0.3.0', '^0.2.0', '>=0.2.0 <0.3.0']) {
    assert.equal(satisfiesHostPeer(semver, '0.2.1-rc.2', range), true, range)
  }
  for (const range of ['0.2.1-alpha.5', '^0.3.0']) {
    assert.equal(satisfiesHostPeer(semver, '0.2.1-rc.2', range), false, range)
  }
})

test('repeated startup preserves compatible prerelease plugins and dependencies while pausing incompatible plugins', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-profile-compat-semver-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const layout = layoutForRoot(root)
  const profile = path.join(layout.dshHome, 'profiles', 'web')
  const peer = '@deepseek-ai/dsh-client-ui-settings'
  const ranges = {
    'broad-plugin': '>=0.2.0-rc.0 <0.3.0',
    'caret-plugin': '^0.2.0',
    'exact-alpha-plugin': '0.2.1-alpha.5',
    'next-release-plugin': '^0.3.0',
  }
  const dependencies = Object.fromEntries(Object.keys(ranges).map(name => [name, '1.0.0']))
  for (const [name, range] of Object.entries(ranges)) {
    const directory = path.join(profile, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', peerDependencies: { [peer]: range } }))
  }
  const hostRoot = path.join(layout.appDir, 'node_modules', ...peer.split('/'))
  await mkdir(hostRoot, { recursive: true })
  await writeFile(path.join(hostRoot, 'package.json'), JSON.stringify({ version: '0.2.1-rc.2' }))
  await cp(path.dirname(appRequire.resolve('semver/package.json')), path.join(layout.appDir, 'node_modules', 'semver'), { recursive: true })
  const manifestFile = path.join(profile, 'package.json')
  await writeFile(manifestFile, JSON.stringify({ dependencies, dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', ...Object.keys(ranges)] } } }))

  const first = await pauseIncompatibleProfileBundles(layout)
  assert.equal(first.status, 'paused')
  assert.deepEqual(first.paused.map(item => item.name), ['exact-alpha-plugin', 'next-release-plugin'])
  const updatedText = await readFile(manifestFile, 'utf8')
  const updated = JSON.parse(updatedText)
  assert.deepEqual(updated.dsh.profile.bundles, ['@deepseek-ai/dsh-web-app', 'broad-plugin', 'caret-plugin'])
  assert.deepEqual(updated.dependencies, dependencies)
  for (const name of Object.keys(ranges)) assert.equal(existsSync(path.join(profile, 'node_modules', name, 'package.json')), true)

  assert.deepEqual(await pauseIncompatibleProfileBundles(layout), { status: 'passed', paused: [] })
  assert.equal(await readFile(manifestFile, 'utf8'), updatedText)
})
