const REPOSITORY = 'deepseek-ai/deepseek-harness'
const RAW_BASE = `https://raw.githubusercontent.com/${REPOSITORY}`
const API_BASE = `https://api.github.com/repos/${REPOSITORY}`
const LANDLOCK_ENTRY = 'native/landlock-run/packages/entry/package.json'

const FAMILY_PATTERNS = Object.freeze({
  dsh: Object.freeze([
    'packages/!(experimental)/*/package.json',
    'apps/*/package.json',
  ]),
  vendor: Object.freeze(['vendor/*/package.json']),
})

const DSH_PACKAGE = /^packages\/([^/]+)\/([^/]+)\/package\.json$/
const APP_PACKAGE = /^apps\/[^/]+\/package\.json$/
const VENDOR_PACKAGE = /^vendor\/[^/]+\/package\.json$/

function assertCallbacks(callbacks) {
  if (callbacks === null || typeof callbacks !== 'object') {
    throw new TypeError('readOfficialSourceMetadata requires json and text callbacks')
  }
  if (typeof callbacks.json !== 'function' || typeof callbacks.text !== 'function') {
    throw new TypeError('readOfficialSourceMetadata requires json and text callbacks')
  }
}

function assertFamilyPatterns(source) {
  const expected = Object.values(FAMILY_PATTERNS).flat()
  const declarations = [...source.matchAll(/readonly\s+patterns\s*=\s*\[([\s\S]*?)\]/g)]
  if (declarations.length !== 2) throw new Error('unsupported official release family declarations')
  const declared = declarations.flatMap((match) => (
    [...match[1].matchAll(/(['"])(.*?)\1/g)].map((literal) => literal[2])
  ))

  for (const pattern of expected) {
    if (!source.includes(pattern)) {
      throw new Error(`official release family rule is missing the known glob: ${pattern}`)
    }
  }

  for (const pattern of declared) {
    if (!expected.includes(pattern)) {
      throw new Error(`unsupported official release family glob: ${pattern}`)
    }
  }
  for (const pattern of expected) {
    if (!declared.includes(pattern)) {
      throw new Error(`official release family declaration is missing the known glob: ${pattern}`)
    }
  }
}

function countPackedFamilies(tree) {
  if (tree?.truncated !== false) {
    throw new Error('official source tree is truncated; refusing to derive package counts')
  }
  if (!Array.isArray(tree.tree)) throw new Error('official source tree has no valid entry list')

  const entries = tree.tree
  if (entries.some((entry) => (
    entry === null || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.type !== 'string'
  ))) {
    throw new Error('official source tree contains an invalid entry')
  }

  const paths = entries.filter((entry) => entry.type === 'blob').map((entry) => entry.path)
  const dsh = paths.filter((entry) => {
    const packageMatch = DSH_PACKAGE.exec(entry)
    return (packageMatch !== null && packageMatch[1] !== 'experimental') || APP_PACKAGE.test(entry)
  }).length
  const vendor = paths.filter((entry) => VENDOR_PACKAGE.test(entry)).length
  if (!dsh || !vendor) throw new Error('official source tree has an empty release family')
  if (!paths.includes(LANDLOCK_ENTRY)) {
    throw new Error(`official source tree is missing ${LANDLOCK_ENTRY}`)
  }

  return { dsh, vendor, landlock: 1 }
}

/**
 * Read the source metadata that determines the official packed package set.
 *
 * @param {string} commit - Full immutable upstream commit SHA.
 * @param {{ json: (url: string) => Promise<unknown>, text: (url: string) => Promise<string> }} callbacks - Authenticated fetch wrappers.
 * @returns {Promise<{ packageManager: string, packedFamilies: { dsh: number, vendor: number, landlock: 1 } }>}
 */
export async function readOfficialSourceMetadata(commit, callbacks) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
    throw new Error(`official source metadata requires a full commit SHA: ${commit}`)
  }
  assertCallbacks(callbacks)

  const [packageManifest, familiesSource, tree] = await Promise.all([
    callbacks.json(`${RAW_BASE}/${commit}/package.json`),
    callbacks.text(`${RAW_BASE}/${commit}/scripts/release/families.ts`),
    callbacks.json(`${API_BASE}/git/trees/${commit}?recursive=1`),
  ])

  if (familiesSource === null || typeof familiesSource !== 'string') {
    throw new Error('official release families source is not text')
  }
  assertFamilyPatterns(familiesSource)

  const packageManager = packageManifest?.packageManager
  if (typeof packageManager !== 'string' || !/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)) {
    throw new Error(`official source packageManager must be pnpm@<major>.<minor>.<patch>: ${packageManager}`)
  }

  return {
    packageManager,
    packedFamilies: countPackedFamilies(tree),
  }
}
