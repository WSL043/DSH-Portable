import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { incompatibleProfilePeers } from '../launcher/profile-compatibility.mjs'

const REQUIRED = ['dsh-chat-manager', 'dsh-image-viewer']

/** Fail before packaging when a default bundle would be paused on first boot. */
export async function verifyDefaultPluginPeers(stage, { appDir = path.join(stage, 'app') } = {}) {
  const archives = path.join(stage, 'default-plugins')
  const semver = createRequire(path.join(appDir, 'package.json'))('semver')
  const found = (await readdir(archives)).filter(name => name.endsWith('.tgz')).sort()
  assert.deepEqual(found, REQUIRED.map(name => `${name}.tgz`).sort(), 'packaged default plugin archives')
  const result = []
  for (const name of REQUIRED) {
    const archive = path.join(archives, `${name}.tgz`)
    const content = execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar',
      ['-xOf', archive, 'package/package.json'], { maxBuffer: 256 * 1024, windowsHide: true })
    const plugin = JSON.parse(content.toString('utf8'))
    assert.equal(plugin.name, name, `${name} packaged identity`)
    const incompatible = await incompatibleProfilePeers(plugin, async peer => {
      const filename = path.join(appDir, 'node_modules', ...peer.split('/'), 'package.json')
      const host = await readFile(filename, 'utf8').then(JSON.parse, error => {
        if (error?.code === 'ENOENT') return null
        throw error
      })
      return host?.version
    }, semver)
    assert.deepEqual(incompatible, [], `${name} would be paused by Portable profile compatibility check: ${JSON.stringify(incompatible)}`)
    result.push({ name, version: plugin.version })
  }
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node verify-default-plugin-peers.mjs <staged-product-directory>')
  console.log(JSON.stringify(await verifyDefaultPluginPeers(path.resolve(process.argv[2]))))
}
