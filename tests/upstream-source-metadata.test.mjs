import assert from 'node:assert/strict'
import test from 'node:test'
import { readOfficialSourceMetadata } from '../scripts/upstream-source-metadata.mjs'

const commit = 'a'.repeat(40)
const familiesSource = `
class DshFamily {
  readonly patterns = ['packages/!(experimental)/*/package.json', 'apps/*/package.json'] as const
}
class VendorFamily {
  readonly patterns = ['vendor/*/package.json'] as const
}
`

function fixture(overrides = {}) {
  const tree = overrides.tree ?? {
    truncated: false,
    tree: [
      { path: 'packages/core/one/package.json', type: 'blob' },
      { path: 'packages/experimental/skip/package.json', type: 'blob' },
      { path: 'packages/core/deeper/path/package.json', type: 'blob' },
      { path: 'apps/cli/package.json', type: 'blob' },
      { path: 'vendor/one/package.json', type: 'blob' },
      { path: 'native/landlock-run/packages/entry/package.json', type: 'blob' },
    ],
  }
  return {
    json: async (url) => {
      if (url.endsWith('/package.json')) return { packageManager: 'pnpm@11.7.0' }
      if (url.includes('/git/trees/')) return tree
      throw new Error(`unexpected JSON URL ${url}`)
    },
    text: async (url) => {
      if (url.endsWith('/scripts/release/families.ts')) return overrides.families ?? familiesSource
      throw new Error(`unexpected text URL ${url}`)
    },
  }
}

test('counts exact release paths while excluding experimental and deeper packages', async () => {
  const metadata = await readOfficialSourceMetadata(commit, fixture())
  assert.deepEqual(metadata, {
    packageManager: 'pnpm@11.7.0',
    packedFamilies: { dsh: 2, vendor: 1, landlock: 1 },
  })
})

test('rejects a truncated official source tree', async () => {
  await assert.rejects(
    readOfficialSourceMetadata(commit, fixture({ tree: { truncated: true, tree: [] } })),
    /tree is truncated/,
  )
})

test('rejects an unknown release family glob instead of guessing its count', async () => {
  const unknownFamilies = familiesSource.replace(
    "readonly patterns = ['vendor/*/package.json'] as const",
    "readonly patterns = ['vendor/*/package.json', 'vendor/**/package.json'] as const",
  )
  await assert.rejects(
    readOfficialSourceMetadata(commit, fixture({ families: unknownFamilies })),
    /unsupported official release family glob/,
  )
})
