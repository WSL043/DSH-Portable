import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_PLUGINS } from '../launcher/default-plugins.mjs'
import {
  evaluateDefaultPluginUpstream,
} from '../scripts/check-default-plugin-upstream.mjs'

const pinned = DEFAULT_PLUGINS.find(plugin => plugin.name === 'dsh-image-viewer')

function registry({
  latest = '0.0.9',
  beta = pinned.version,
  next,
  alpha,
  rc,
  versions = {},
  pinnedIntegrity = pinned.integrity,
} = {}) {
  const tags = { latest, beta, next, alpha, rc }
  const entries = {
    [pinned.version]: { dist: { integrity: pinnedIntegrity } },
  }
  for (const version of Object.values(tags).filter(Boolean)) {
    entries[version] = { dist: { integrity: version === pinned.version ? pinnedIntegrity : `sha512-${version}` } }
  }
  for (const [version, metadata] of Object.entries(versions)) entries[version] = metadata
  return { name: pinned.name, 'dist-tags': tags, versions: entries }
}

test('a stable latest behind a beta pin never causes a downgrade', () => {
  const result = evaluateDefaultPluginUpstream({
    pinned,
    registry: registry({ latest: '0.0.9', beta: pinned.version }),
  })

  assert.deepEqual(result, {
    name: 'dsh-image-viewer',
    pinned: '0.1.0-beta.10',
    selected: '0.1.0-beta.10',
    channel: 'prerelease',
    tag: 'beta',
    changed: false,
    requiresCompatibilityReview: false,
  })
})

test('the highest newer candidate is selected and marked for compatibility review', () => {
  const result = evaluateDefaultPluginUpstream({
    pinned,
    registry: registry({
      latest: '0.1.0-beta.7',
      beta: '0.1.0-beta.11',
      next: '0.1.0-beta.8',
    }),
  })

  assert.equal(result.name, pinned.name)
  assert.equal(result.pinned, pinned.version)
  assert.equal(result.selected, '0.1.0-beta.11')
  assert.equal(result.channel, 'prerelease')
  assert.equal(result.tag, 'beta')
  assert.equal(result.changed, true)
  assert.equal(result.requiresCompatibilityReview, true)
})

test('a missing or changed pinned dist integrity fails closed', () => {
  assert.throws(
    () => evaluateDefaultPluginUpstream({ pinned, registry: registry({ pinnedIntegrity: 'sha512-replaced' }) }),
    /integrity changed/i,
  )
  assert.throws(
    () => evaluateDefaultPluginUpstream({
      pinned,
      registry: registry({ versions: { [pinned.version]: { dist: {} } } }),
    }),
    /missing dist integrity/i,
  )
})

test('deprecated tagged versions are ignored when selecting the upstream candidate', () => {
  const result = evaluateDefaultPluginUpstream({
    pinned,
    registry: registry({
      beta: '0.1.0-beta.11',
      next: '0.1.0-beta.8',
      versions: {
        '0.1.0-beta.11': { deprecated: 'broken package', dist: { integrity: 'sha512-deprecated' } },
      },
    }),
  })

  assert.equal(result.selected, '0.1.0-beta.10')
  assert.equal(result.tag, null)
  assert.equal(result.changed, false)
  assert.equal(result.requiresCompatibilityReview, false)
})
