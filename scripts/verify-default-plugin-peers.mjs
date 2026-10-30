import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { incompatibleProfilePeers, satisfiesHostPeer } from '../launcher/profile-compatibility.mjs'

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9._~-]*\/)?[a-z0-9-~][a-z0-9._~-]*$/i

export function peerManifestPath(appDir, peer) {
  if (typeof peer !== 'string' || !PACKAGE_NAME.test(peer)) {
    throw new Error(`Invalid peer package name in reviewed default plugin: ${String(peer)}`)
  }
  return path.join(appDir, 'node_modules', ...peer.split('/'), 'package.json')
}

/** Fail before packaging when a default bundle has incompatible host peers on first boot. */
export async function verifyDefaultPluginPeers(stage, { appDir = path.join(stage, 'app'), defaultPlugins } = {}) {
  defaultPlugins ??= Object.values(JSON.parse(await readFile(new URL('../upstream.lock.json', import.meta.url), 'utf8')).defaultPlugins ?? {})
  const required = defaultPlugins.map(plugin => plugin.package)
  const archives = path.join(stage, 'default-plugins')
  const found = (await readdir(archives)).filter(name => name.endsWith('.tgz')).sort()
  assert.deepEqual(found, required.map(name => `${name}.tgz`).sort(), 'packaged default plugin archives')
  if (required.length === 0) return []
  const semver = createRequire(path.join(appDir, 'package.json'))('semver')
  const result = []
  for (const name of required) {
    const archive = path.join(archives, `${name}.tgz`)
    const content = execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-xOf', archive, 'package/package.json'], { maxBuffer: 256 * 1024, windowsHide: true })
    const plugin = JSON.parse(content.toString('utf8'))
    assert.equal(plugin.name, name, `${name} packaged identity`)
    const incompatible = await incompatibleProfilePeers(plugin, async peer => {
      const filename = peerManifestPath(appDir, peer)
      const host = await readFile(filename, 'utf8').then(JSON.parse, error => {
        if (error?.code === 'ENOENT') return null
        throw error
      })
      return host?.version
    }, { satisfies: (version, range) => satisfiesHostPeer(semver, version, range), validRange: semver.validRange })
    assert.deepEqual(incompatible, [], `${name} has incompatible Portable host peers: ${JSON.stringify(incompatible)}`)
    result.push({ name, version: plugin.version })
  }
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node verify-default-plugin-peers.mjs <staged-product-directory>')
  const lock = JSON.parse(await readFile(process.argv[3] || new URL('../upstream.lock.json', import.meta.url), 'utf8'))
  console.log(JSON.stringify(await verifyDefaultPluginPeers(path.resolve(process.argv[2]), { defaultPlugins: Object.values(lock.defaultPlugins ?? {}) })))
}
