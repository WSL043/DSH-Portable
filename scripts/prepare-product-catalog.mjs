import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { comparePortableVersions } from '../launcher/update-core.mjs'

const PRODUCT_PLATFORMS = [
  'windows-x64',
  'macos-arm64',
  'macos-x64',
  'linux-arm64',
  'linux-x64',
]
const PRODUCT_CATALOG_SCHEMA_VERSION = 1
const PRODUCT_CATALOG_MAX_VERSIONS = 20
const PRODUCT_CATALOG_MAX_BYTES = 256 * 1024
const PRODUCT_CATALOG_TIMEOUT_MS = 5000
const PRODUCT_REPOSITORY = 'WSL043/DSH-Portable'

const repositoryUrl = `https://github.com/${PRODUCT_REPOSITORY}`

function fail(message) {
  throw new Error(message)
}

function assertChannel(channel) {
  if (channel !== 'stable' && channel !== 'candidate') fail(`Unsupported release channel: ${channel}`)
  return channel
}

function assertVersion(version, label = 'version') {
  const value = String(version ?? '')
  if (!value) fail(`${label} is missing.`)
  try {
    comparePortableVersions(value, value)
  } catch (error) {
    throw new Error(`${label} is invalid: ${value}`, { cause: error })
  }
  return value
}

function hasPrerelease(version) {
  return String(version).split('+', 1)[0].includes('-')
}

function readPolicy(policy) {
  if (!policy || policy.schemaVersion !== 1) fail('Product release policy schema is unsupported.')
  const minimumSelectableVersion = assertVersion(policy.minimumSelectableVersion, 'minimumSelectableVersion')
  if (!Array.isArray(policy.blockedVersions)) fail('Product release policy blockedVersions must be an array.')
  const blockedVersions = policy.blockedVersions.map((version) => assertVersion(version, 'blockedVersions entry'))
  return { minimumSelectableVersion, blockedVersions: new Set(blockedVersions) }
}

function assertSha256(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) fail(`${label} must be a SHA-256 digest.`)
  return String(value).toLowerCase()
}

function assertPositiveBytes(value, label) {
  const bytes = Number(value)
  if (!Number.isSafeInteger(bytes) || bytes <= 0) fail(`${label} must be a positive byte count.`)
  return bytes
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function expectedManifestUrl(channel, platform, version) {
  return `${repositoryUrl}/releases/download/update-channel-${channel}/portable-update-${platform}-${version}.json`
}

function expectedComponentUrl(channel, platform, version) {
  return `${repositoryUrl}/releases/download/update-channel-${channel}/DSH-Portable-update-${platform}-${version}.zip`
}

function parseVersionedUrl(value, kind, platform) {
  let url
  try {
    url = new URL(String(value))
  } catch (error) {
    throw new Error(`Catalog ${kind} URL is invalid.`, { cause: error })
  }
  if (url.origin !== 'https://github.com' || url.search || url.hash || url.username || url.password) {
    fail(`Catalog ${kind} URL is outside the Portable update channels: ${value}`)
  }
  const pattern = kind === 'manifest'
    ? new RegExp(`^/WSL043/DSH-Portable/releases/download/update-channel-(stable|candidate)/portable-update-${platform}-(.+)\\.json$`)
    : new RegExp(`^/WSL043/DSH-Portable/releases/download/update-channel-(stable|candidate)/DSH-Portable-update-${platform}-(.+)\\.zip$`)
  const match = pattern.exec(url.pathname)
  if (!match) fail(`Catalog ${kind} URL is not a versioned Portable update URL: ${value}`)
  assertVersion(match[2], `${kind} URL version`)
  return { url, channel: match[1], version: match[2] }
}

function validateCatalogManifest(manifest, platform, version, { requireVersionedUrls = true } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('Catalog manifest is not an object.')
  if (manifest.schemaVersion !== PRODUCT_CATALOG_SCHEMA_VERSION) fail('Catalog manifest schema is unsupported.')
  if (manifest.portableVersion !== version) fail(`Catalog manifest version mismatch: ${manifest.portableVersion} != ${version}`)
  if (manifest.platform !== platform) fail(`Catalog manifest platform mismatch: ${manifest.platform} != ${platform}`)
  if ((manifest.updateKind ?? 'product') !== 'product') fail('Catalog entry is not a product update.')
  if (manifest.releaseChannel != null) assertChannel(manifest.releaseChannel)
  const component = manifest.component
  if (!component || typeof component !== 'object' || Array.isArray(component)) fail('Catalog manifest component is missing.')
  if (!['dsh-app', 'dsh-runtime-capsule'].includes(component.kind)) fail('Catalog manifest component kind is invalid.')
  if (!component.requiredNodeVersion) fail('Catalog manifest component requiredNodeVersion is missing.')
  assertPositiveBytes(component.bytes, 'Catalog manifest component.bytes')
  assertSha256(component.sha256, 'Catalog manifest component.sha256')
  if (!Array.isArray(component.urls) || component.urls.length === 0) fail('Catalog manifest component.urls is missing.')
  for (const value of component.urls) {
    if (requireVersionedUrls) {
      const parsed = parseVersionedUrl(value, 'component', platform)
      if (parsed.version !== version) fail(`Catalog component URL version mismatch: ${parsed.version} != ${version}`)
    }
    else if (typeof value !== 'string' || !value) fail('Catalog manifest component URL is invalid.')
  }
}

function validateCatalogEntry(entry, platform, { current = false } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Product catalog entry is not an object.')
  const version = assertVersion(entry.version, 'Catalog entry version')
  const manifestUrl = String(entry.manifestUrl ?? '')
  if (!manifestUrl) fail('Product catalog entry manifestUrl is missing.')
  const parsedManifestUrl = parseVersionedUrl(manifestUrl, 'manifest', platform)
  if (parsedManifestUrl.version !== version) fail(`Catalog entry URL version mismatch: ${parsedManifestUrl.version} != ${version}`)
  validateCatalogManifest(entry.manifest, platform, version)
  return { version, manifestUrl: parsedManifestUrl.url.href, manifest: entry.manifest, urlChannel: parsedManifestUrl.channel, current }
}

function shouldKeepVersion(version, releaseChannel, policy) {
  if (comparePortableVersions(version, policy.minimumSelectableVersion) < 0) return false
  if (policy.blockedVersions.has(version)) return false
  if (releaseChannel === 'stable' && hasPrerelease(version)) return false
  return true
}

/**
 * Merge a current product entry with a previously published index.
 */
export function mergeProductCatalog({ existingEntries, currentEntry, releaseChannel, policy, platform }) {
  const channel = assertChannel(releaseChannel)
  const selectedPlatform = String(platform ?? '')
  if (!PRODUCT_PLATFORMS.includes(selectedPlatform)) fail(`Unsupported product platform: ${selectedPlatform}`)
  const configuredPolicy = readPolicy(policy)
  if (!Array.isArray(existingEntries)) fail('Existing product catalog entries must be an array.')

  const entries = new Map()
  for (const rawEntry of existingEntries) {
    const entry = validateCatalogEntry(rawEntry, selectedPlatform)
    if (shouldKeepVersion(entry.version, channel, configuredPolicy)) entries.set(entry.version, cloneJson(rawEntry))
  }
  const current = validateCatalogEntry(currentEntry, selectedPlatform, { current: true })
  if (shouldKeepVersion(current.version, channel, configuredPolicy)) entries.set(current.version, cloneJson(currentEntry))

  return [...entries.values()]
    .sort((left, right) => comparePortableVersions(right.version, left.version))
    .slice(0, PRODUCT_CATALOG_MAX_VERSIONS)
}

async function sha256File(filename) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest('hex')
}

/** Validate one input update manifest and its matching archive before publication. */
export async function validateProductArtifact({ manifest, archivePath, platform, expectedVersion }) {
  if (!PRODUCT_PLATFORMS.includes(platform)) fail(`Unsupported product platform: ${platform}`)
  const version = assertVersion(expectedVersion, 'expected product version')
  validateCatalogManifest(manifest, platform, version, { requireVersionedUrls: false })
  const archiveInfo = await stat(archivePath).catch(() => null)
  if (!archiveInfo?.isFile() || archiveInfo.size === 0) fail(`Product update archive is missing or empty: ${archivePath}`)
  const digest = await sha256File(archivePath)
  const component = manifest.component
  if (Number(component.bytes) !== archiveInfo.size) fail(`Product update archive byte count mismatch: expected ${component.bytes}, received ${archiveInfo.size}`)
  if (String(component.sha256).toLowerCase() !== digest) fail(`Product update archive digest mismatch: expected ${component.sha256}, received ${digest}`)
  return { bytes: archiveInfo.size, sha256: digest, version, platform }
}

async function readJsonFile(filename) {
  return JSON.parse(await readFile(filename, 'utf8'))
}

async function readRemoteCatalog(url, { fetchImpl = fetch, timeoutMs = PRODUCT_CATALOG_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  let timer
  try {
    const request = Promise.resolve().then(() => fetchImpl(url, { signal: controller.signal, redirect: 'follow' }))
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`Product catalog request timed out after ${timeoutMs} ms.`))
      }, timeoutMs)
    })
    const response = await Promise.race([request, timeout])
    if (response.status === 404) return null
    if (!response.ok || !response.body && typeof response.arrayBuffer !== 'function') fail(`Product catalog request failed: HTTP ${response.status}`)
    const declared = Number(response.headers?.get?.('content-length') ?? 0)
    if (declared > PRODUCT_CATALOG_MAX_BYTES) fail('Product catalog is too large.')
    let bytes
    if (response.body?.getReader) {
      const reader = response.body.getReader()
      const chunks = []
      let size = 0
      while (true) {
        const next = await reader.read()
        if (next.done) break
        const chunk = Buffer.from(next.value)
        size += chunk.length
        if (size > PRODUCT_CATALOG_MAX_BYTES) {
          await reader.cancel().catch(() => {})
          fail('Product catalog is too large.')
        }
        chunks.push(chunk)
      }
      bytes = Buffer.concat(chunks)
    } else {
      bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > PRODUCT_CATALOG_MAX_BYTES) fail('Product catalog is too large.')
    }
    return JSON.parse(bytes.toString('utf8'))
  } finally {
    clearTimeout(timer)
  }
}

function validateOldCatalog(index, channel, platform) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) fail('Existing product catalog is not an object.')
  if (index.schemaVersion !== PRODUCT_CATALOG_SCHEMA_VERSION || index.releaseChannel !== channel || !Array.isArray(index.versions)) {
    fail(`Existing product catalog shape is invalid for ${channel}/${platform}.`)
  }
  return index.versions
}

function currentEntryFor(channel, platform, version, manifest) {
  return {
    version,
    manifestUrl: expectedManifestUrl(channel, platform, version),
    manifest,
  }
}

async function readCurrentArtifact(updateAssetsDir, platform, version) {
  const manifestPath = path.join(updateAssetsDir, `portable-update-${platform}.json`)
  const archivePath = path.join(updateAssetsDir, `DSH-Portable-update-${platform}.zip`)
  const sourceManifest = await readJsonFile(manifestPath)
  // Input manifests are built for the non-versioned channel asset. Their old
  // URL is intentionally replaced after all local integrity checks pass.
  await validateProductArtifact({ manifest: sourceManifest, archivePath, platform, expectedVersion: version })
  return { manifestPath, archivePath, manifest: cloneJson(sourceManifest) }
}

async function prepareForChannel({ artifacts, outputDir, publishChannel, targetChannel, version, policy, fetchImpl, timeoutMs }) {
  const entries = await Promise.all(PRODUCT_PLATFORMS.map(async (platform) => {
    const indexUrl = `${repositoryUrl}/releases/download/update-channel-${targetChannel}/portable-index-${platform}.json`
    const remote = await readRemoteCatalog(indexUrl, { fetchImpl, timeoutMs })
    const oldEntries = remote === null ? [] : validateOldCatalog(remote, targetChannel, platform)
    const artifact = artifacts.get(platform)
    const manifest = cloneJson(artifact.manifest)
    manifest.component.urls = [expectedComponentUrl(publishChannel, platform, version)]
    const current = currentEntryFor(publishChannel, platform, version, manifest)
    const merged = mergeProductCatalog({
      existingEntries: oldEntries,
      currentEntry: current,
      releaseChannel: targetChannel,
      policy,
      platform,
    })
    return { platform, merged }
  }))
  const targetDir = path.join(outputDir, targetChannel)
  await mkdir(targetDir, { recursive: true })
  for (const { platform, merged } of entries) {
    await writeFile(
      path.join(targetDir, `portable-index-${platform}.json`),
      `${JSON.stringify({ schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION, releaseChannel: targetChannel, versions: merged }, null, 2)}\n`,
      'utf8',
    )
  }
}

export async function prepareProductCatalog({ updateAssetsDir, outputDir, releaseChannel, version, policy, fetchImpl, timeoutMs = PRODUCT_CATALOG_TIMEOUT_MS }) {
  const publishChannel = assertChannel(releaseChannel)
  const productVersion = assertVersion(version, 'product version')
  readPolicy(policy)
  const targets = publishChannel === 'stable' ? ['stable', 'candidate'] : ['candidate']
  const artifacts = new Map(await Promise.all(PRODUCT_PLATFORMS.map(async (platform) => [
    platform,
    await readCurrentArtifact(updateAssetsDir, platform, productVersion),
  ])))
  const immutableDir = path.join(outputDir, 'immutable')
  await mkdir(immutableDir, { recursive: true })
  await Promise.all([...artifacts].map(async ([platform, artifact]) => {
    await copyFile(artifact.archivePath, path.join(immutableDir, `DSH-Portable-update-${platform}-${productVersion}.zip`))
    await writeFile(
      path.join(immutableDir, `portable-update-${platform}-${productVersion}.json`),
      `${JSON.stringify({ ...artifact.manifest, component: { ...artifact.manifest.component, urls: [expectedComponentUrl(publishChannel, platform, productVersion)] } }, null, 2)}\n`,
      'utf8',
    )
  }))
  for (const targetChannel of targets) {
    await prepareForChannel({
      artifacts,
      outputDir,
      publishChannel,
      targetChannel,
      version: productVersion,
      policy,
      fetchImpl,
      timeoutMs,
    })
  }
  return { version: productVersion, releaseChannel: publishChannel, channels: targets, platforms: [...PRODUCT_PLATFORMS] }
}

async function main() {
  const [updateAssetsDirArg, outputDirArg, releaseChannelArg] = process.argv.slice(2)
  if (!updateAssetsDirArg || !outputDirArg || !releaseChannelArg) {
    fail('Usage: node scripts/prepare-product-catalog.mjs <update-assets-dir> <output-dir> <stable|candidate>')
  }
  const root = path.resolve(import.meta.dirname, '..')
  const packageManifest = await readJsonFile(path.join(root, 'package.json'))
  const policy = await readJsonFile(path.join(root, 'product-release-policy.json'))
  const result = await prepareProductCatalog({
    updateAssetsDir: path.resolve(updateAssetsDirArg),
    outputDir: path.resolve(outputDirArg),
    releaseChannel: releaseChannelArg,
    version: packageManifest.version,
    policy,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
