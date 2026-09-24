import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { peerManifestPath } from '../scripts/verify-default-plugin-peers.mjs'

test('default plugin peer lookup stays under the staged package tree', () => {
  const app = path.resolve('staged-app')
  assert.equal(peerManifestPath(app, 'semver'), path.join(app, 'node_modules', 'semver', 'package.json'))
  assert.equal(peerManifestPath(app, '@deepseek-ai/cordis'), path.join(app, 'node_modules', '@deepseek-ai', 'cordis', 'package.json'))
  for (const peer of ['../secret', '@scope/../secret', 'foo/bar/baz', 'foo\\..\\secret', 'C:secret', '/absolute']) {
    assert.throws(() => peerManifestPath(app, peer), /Invalid peer package name/)
  }
})
