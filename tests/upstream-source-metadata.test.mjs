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

test('official releases may remove the standalone landlock package', async () => {
  const callbacks = fixture()
  const tree = await callbacks.json('/git/trees/fixture')
  tree.tree = tree.tree.filter(entry => !entry.path.startsWith('native/landlock-run/'))
  const metadata = await readOfficialSourceMetadata(commit, fixture({ tree }))
  assert.deepEqual(metadata.packedFamilies, { dsh: 2, vendor: 1, landlock: 0 })
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

test('public experimental exceptions join the release while private apps stay excluded', async () => {
  const callbacks = fixture({ families: familiesSource.replace("'apps/*/package.json'", "'apps/*/package.json', ...PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES.map(directory => `${directory}/package.json`)") })
  const originalJson = callbacks.json, originalText = callbacks.text
  callbacks.text = async url => url.endsWith('/experimental-package-policy.ts')
    ? "export const PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES = ['packages/experimental/skip'] as const"
    : originalText(url)
  callbacks.json = async url => url.endsWith('/apps/cli/package.json') ? { private: true } : originalJson(url)
  assert.equal((await readOfficialSourceMetadata(commit, callbacks)).packedFamilies.dsh, 2)
})
