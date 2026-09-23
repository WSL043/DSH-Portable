import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { layoutForRoot } from '../launcher/portable-core.mjs'
import { incompatibleProfilePeers, pauseIncompatibleProfileBundles } from '../launcher/profile-compatibility.mjs'

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
