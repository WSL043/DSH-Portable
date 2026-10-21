import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { peerManifestPath, verifyDefaultPluginPeers } from '../scripts/verify-default-plugin-peers.mjs'

test('default plugin peer lookup stays under the staged package tree', () => {
  const app = path.resolve('staged-app')
  assert.equal(peerManifestPath(app, 'semver'), path.join(app, 'node_modules', 'semver', 'package.json'))
  assert.equal(peerManifestPath(app, '@deepseek-ai/cordis'), path.join(app, 'node_modules', '@deepseek-ai', 'cordis', 'package.json'))
  for (const peer of ['../secret', '@scope/../secret', 'foo/bar/baz', 'foo\\..\\secret', 'C:secret', '/absolute']) {
    assert.throws(() => peerManifestPath(app, peer), /Invalid peer package name/)
  }
})

test('packaged default plugins use real semver to accept compatible prerelease hosts and reject incompatible peers', async t => {
  const stage = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-plugin-semver-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  const appDir = path.join(stage, 'app')
  const archives = path.join(stage, 'default-plugins')
  const source = path.join(stage, 'source')
  const peer = '@deepseek-ai/dsh-client-ui-settings'
  const hostRoot = path.dirname(peerManifestPath(appDir, peer))
  await mkdir(hostRoot, { recursive: true })
  await mkdir(archives, { recursive: true })
  await mkdir(path.join(source, 'package'), { recursive: true })
  await writeFile(path.join(hostRoot, 'package.json'), JSON.stringify({ version: '0.2.1-rc.2' }))
  const appRequire = createRequire(new URL('../app/package.json', import.meta.url))
  await cp(path.dirname(appRequire.resolve('semver/package.json')), path.join(appDir, 'node_modules', 'semver'), { recursive: true })
  const pack = async (name, range) => {
    await writeFile(path.join(source, 'package', 'package.json'), JSON.stringify({ name, version: '1.0.0', peerDependencies: { [peer]: range } }))
    execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-czf', path.join(archives, `${name}.tgz`), '-C', source, 'package'], { windowsHide: true })
  }
  await pack('dsh-chat-manager', '>=0.2.0-rc.0 <0.3.0')
  await pack('dsh-image-viewer', '^0.2.0')
  assert.deepEqual(await verifyDefaultPluginPeers(stage), [
    { name: 'dsh-chat-manager', version: '1.0.0' },
    { name: 'dsh-image-viewer', version: '1.0.0' },
  ])

  for (const range of ['0.2.1-alpha.5', '^0.3.0']) {
    await pack('dsh-chat-manager', range)
    await assert.rejects(verifyDefaultPluginPeers(stage), error => {
      assert.match(error.message, /dsh-chat-manager would be paused/)
      assert.ok(error.message.includes(range))
      return true
    })
  }
})
