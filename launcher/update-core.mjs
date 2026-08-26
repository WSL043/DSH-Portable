import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

import { writeJsonAtomic } from './portable-core.mjs'

export const UPDATE_SCHEMA_VERSION = 1
export const UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000
export const UPDATE_FAILURE_TTL_MS = 60 * 60 * 1000
const execFileAsync = promisify(execFile)
const UPDATE_LICENSE_FILES = [
  'COMPONENTS.json',
  'DeepSeek-Harness-LICENSE.txt',
  'DeepSeek-Harness-THIRD_PARTY_NOTICES.md',
  'dsh-market-LICENSE.txt',
  'pnpm-LICENSE.txt',
]

export function platformUpdateKey(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return `macos-${arch}`
  if (platform === 'linux' && ['arm64', 'x64'].includes(arch)) return `linux-${arch}`
  throw new Error(`Unsupported update platform: ${platform}-${arch}`)
}

function releaseChannelForVersion(value) {
  return parseSemanticVersion(value).prerelease ? 'candidate' : 'stable'
}

function normalizeReleaseChannel(value, portableVersion) {
  const releaseChannel = value || releaseChannelForVersion(portableVersion)
  if (!['stable', 'candidate'].includes(releaseChannel)) throw new Error(`Unsupported release channel: ${releaseChannel}`)
  return releaseChannel
}

export function defaultUpdateManifestUrl(releaseChannel = 'stable', platform = process.platform, arch = process.arch) {
  normalizeReleaseChannel(releaseChannel, '0.0.0')
  return `https://github.com/WSL043/DSH-Portable/releases/download/update-channel-${releaseChannel}/portable-update-${platformUpdateKey(platform, arch)}.json`
}

export function defaultEngineUpdateManifestUrl(releaseChannel = 'stable', platform = process.platform, arch = process.arch) {
  normalizeReleaseChannel(releaseChannel, '0.0.0')
  return `https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-${releaseChannel}/dsh-core-update-${platformUpdateKey(platform, arch)}.json`
}

function parseSemanticVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(String(value ?? ''))
  if (!match) throw new Error(`${value} is not a valid semantic version.`)
  const portablePreview = /^rc\.(\d+)-portable\.(\d+)$/.exec(match[4] ?? '')
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: portablePreview
      ? ['rc', portablePreview[1], 'portable', portablePreview[2]]
      : match[4] ? match[4].split('.') : null,
  }
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number(left) === Number(right) ? 0 : Number(left) < Number(right) ? -1 : 1
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

export function comparePortableVersions(leftValue, rightValue) {
  const left = parseSemanticVersion(leftValue)
  const right = parseSemanticVersion(rightValue)
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1
  }
  if (!left.prerelease || !right.prerelease) {
    if (!left.prerelease && !right.prerelease) return 0
    return left.prerelease ? -1 : 1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1
    if (right.prerelease[index] === undefined) return 1
    const compared = compareIdentifier(left.prerelease[index], right.prerelease[index])
    if (compared) return compared
  }
  return 0
}

function assertManifestShape(manifest) {
  if (!manifest || manifest.schemaVersion !== UPDATE_SCHEMA_VERSION) throw new Error('Unsupported update manifest schema.')
  if (!manifest.portableVersion || !manifest.platform) throw new Error('Update manifest is incomplete.')
  if (!Number.isSafeInteger(Number(manifest.minimumUpdaterSchema)) || Number(manifest.minimumUpdaterSchema) < 1
    || !Number.isSafeInteger(Number(manifest.requiredShellSchema)) || Number(manifest.requiredShellSchema) < 1) {
    throw new Error('Update manifest compatibility metadata is invalid.')
  }
  parseSemanticVersion(manifest.portableVersion)
  normalizeReleaseChannel(manifest.releaseChannel, manifest.portableVersion)
  if (manifest.updateKind != null && !['product', 'engine'].includes(manifest.updateKind)) {
    throw new Error(`Unsupported update kind: ${manifest.updateKind}`)
  }
}

export function evaluateUpdate(manifest, installed, platform) {
  assertManifestShape(manifest)
  const updateKind = manifest.updateKind || 'product'
  const installedReleaseChannel = normalizeReleaseChannel(installed.releaseChannel, installed.portableVersion)
  const manifestReleaseChannel = normalizeReleaseChannel(manifest.releaseChannel, manifest.portableVersion)
  const engineCurrent = String(installed.dshVersion ?? '')
  const engineLatest = String(manifest.component?.dshVersion ?? engineCurrent)
  const releaseTag = `v${manifest.portableVersion}`
  const updateIdentity = updateKind === 'engine'
    ? `engine:${engineLatest}:${String(manifest.component?.dshCommit || manifest.component?.sha256 || '')}`
    : `product:${manifest.portableVersion}`
  const describe = (status, delivery) => ({
    status,
    updateKind,
    updateIdentity,
    current: installed.portableVersion,
    latest: manifest.portableVersion,
    productCurrent: installed.portableVersion,
    productLatest: manifest.portableVersion,
    engineCurrent,
    engineLatest,
    delivery,
    releaseChannel: manifestReleaseChannel,
    releaseUrl: `https://github.com/WSL043/DSH-Portable/releases/tag/${releaseTag}`,
    fullPackageManifestUrl: `https://github.com/WSL043/DSH-Portable/releases/download/${releaseTag}/portable-manifest.json`,
    product: {
      name: 'DSH-Portable',
      current: installed.portableVersion,
      latest: manifest.portableVersion,
    },
    engine: {
      name: 'DeepSeek Harness',
      current: engineCurrent,
      latest: engineLatest,
      changed: Boolean(engineCurrent && engineLatest && engineCurrent !== engineLatest),
    },
  })
  if (manifest.platform !== platform) return describe('wrong-platform', 'none')
  if (installedReleaseChannel === 'stable' && manifestReleaseChannel !== 'stable') {
    return describe('channel-mismatch', 'none')
  }
  const productComparison = comparePortableVersions(installed.portableVersion, manifest.portableVersion)
  if (updateKind === 'engine') {
    if (productComparison !== 0) return describe('core-incompatible', 'none')
    if (engineCurrent && comparePortableVersions(engineCurrent, engineLatest) >= 0) return describe('current', 'none')
  } else if (productComparison >= 0) {
    return describe('current', 'none')
  }
  if (Number(manifest.minimumUpdaterSchema) > Number(installed.updaterSchema ?? 0)
    || !['dsh-app', 'dsh-runtime-capsule'].includes(manifest.component?.kind)) {
    return describe('full-package-required', 'full-package')
  }
  const component = manifest.component
  if (
    Number(manifest.requiredShellSchema ?? 0) > Number(installed.shellSchema ?? 0)
    || (manifest.targetRuntimeLayout && manifest.targetRuntimeLayout !== (installed.runtimeLayout || 'expanded-v1'))
    || !component.requiredNodeVersion
    || component.requiredNodeVersion !== installed.nodeVersion
    || (component.runtimeLayout && component.runtimeLayout !== (installed.runtimeLayout || 'expanded-v1'))
  ) {
    return describe('full-package-required', 'full-package')
  }
  if (!component.dshVersion || !Array.isArray(component.urls) || component.urls.length === 0) throw new Error('Update component is incomplete.')
  if (!Number.isSafeInteger(Number(component.bytes)) || Number(component.bytes) <= 0) throw new Error('Update component size is invalid.')
  if (!/^[a-f0-9]{64}$/i.test(String(component.sha256 ?? ''))) throw new Error('Update component digest is invalid.')
  return {
    ...describe('available', 'component'),
    platform: manifest.platform,
    minimumUpdaterSchema: Number(manifest.minimumUpdaterSchema),
    requiredShellSchema: Number(manifest.requiredShellSchema),
    component,
  }
}

function updateCacheForScope(layout, scope) {
  if (scope === 'engine') return layout.engineUpdateCheckCache
  if (scope === 'product') return layout.productUpdateCheckCache || layout.updateCheckCache
  throw new Error(`Unsupported update scope: ${scope}`)
}

function validateRemoteUrl(value, allowHttp) {
  const url = new URL(value)
  if (url.protocol === 'https:') return url
  if (allowHttp && url.protocol === 'http:') return url
  throw new Error(`Update URL must use HTTPS: ${url}`)
}

export async function downloadVerifiedComponent({
  urls,
  destination,
  bytes,
  sha256,
  allowHttp = false,
  fetchImpl = fetch,
  timeoutMs = 120000,
  onProgress = () => {},
}) {
  if (!Array.isArray(urls) || urls.length === 0) throw new Error('No update download routes are available.')
  await mkdir(path.dirname(destination), { recursive: true })
  const failures = []
  for (let index = 0; index < urls.length; index += 1) {
    const url = validateRemoteUrl(urls[index], allowHttp)
    const temporary = `${destination}.route-${process.pid}-${index}.part`
    await rm(temporary, { force: true })
    const controller = new AbortController()
    let timer
    const armInactivityTimeout = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), timeoutMs)
    }
    armInactivityTimeout()
    const report = (receivedBytes) => onProgress({
      phase: 'downloading',
      route: index + 1,
      routeCount: urls.length,
      receivedBytes,
      totalBytes: Number(bytes),
      percent: Math.max(0, Math.min(100, Math.floor(receivedBytes * 100 / Number(bytes)))),
    })
    report(0)
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const digest = createHash('sha256')
      let received = 0
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          armInactivityTimeout()
          received += chunk.length
          if (received > Number(bytes)) {
            callback(new Error(`component size exceeds the declared ${bytes} bytes`))
            return
          }
          digest.update(chunk)
          report(received)
          callback(null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, { flags: 'wx' }))
      if (received !== Number(bytes)) throw new Error(`component size mismatch: expected ${bytes}, received ${received}`)
      const actual = digest.digest('hex')
      if (actual !== String(sha256).toLowerCase()) throw new Error(`component digest mismatch: expected ${sha256}, received ${actual}`)
      await rm(destination, { force: true })
      await rename(temporary, destination)
      return { bytes: received, sha256: actual, url: url.toString() }
    } catch (error) {
      failures.push(`${url}: ${error?.message ?? error}`)
      await rm(temporary, { force: true }).catch(() => {})
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Update download failed: ${failures.join(' | ')}`)
}

export function validateArchiveEntries(entries) {
  const allowedLicenses = new Set([
    'licenses/COMPONENTS.json',
    'licenses/DeepSeek-Harness-LICENSE.txt',
    'licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md',
    'licenses/dsh-market-LICENSE.txt',
    'licenses/pnpm-LICENSE.txt',
  ])
  for (const rawEntry of entries) {
    const source = String(rawEntry ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
    if (!source || source === '.') continue
    const segments = source.split('/')
    if (source.startsWith('/') || /^[A-Za-z]:/.test(source) || segments.includes('..') || source.includes('\0')) {
      throw new Error(`Unsafe update archive entry: ${rawEntry}`)
    }
    if (source === 'component.json'
      || source === 'app' || source.startsWith('app/')
      || source === 'runtime-capsule.json'
      || source === 'runtime' || source === 'runtime/DSH-App.dshpack'
      || source === 'licenses' || allowedLicenses.has(source)) continue
    throw new Error(`Update archive entry is not allowed: ${rawEntry}`)
  }
}

export async function extractUpdateArchive(archive, stagedRoot, {
  platform = process.platform,
  exec = execFileAsync,
  windowsExtractor = path.join(import.meta.dirname, 'DSH-UpdateExtractor.exe'),
} = {}) {
  if (platform === 'win32') {
    if (!existsSync(windowsExtractor)) throw new Error('Windows update extractor is missing.')
    await exec(windowsExtractor, [archive, stagedRoot], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true })
    return stagedRoot
  }
  if (platform === 'linux') {
    const listed = await exec('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    validateArchiveEntries(String(listed.stdout ?? listed).split(/\r?\n/))
    await mkdir(path.dirname(stagedRoot), { recursive: true })
    await exec('unzip', ['-q', archive, '-d', stagedRoot], { encoding: 'utf8' })
    return stagedRoot
  }
  const listed = await exec('tar', ['-t', '-f', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  validateArchiveEntries(String(listed.stdout ?? listed).split(/\r?\n/))
  await mkdir(path.dirname(stagedRoot), { recursive: true })
  await exec('ditto', ['-x', '-k', archive, stagedRoot], { encoding: 'utf8' })
  return stagedRoot
}

async function readJson(filename, fallback = null) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

async function fetchJson(urlValue, { allowHttp, fetchImpl, timeoutMs }) {
  const url = validateRemoteUrl(urlValue, allowHttp)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > 256 * 1024) throw new Error('Update manifest is too large.')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 256 * 1024) throw new Error('Update manifest is too large.')
    return JSON.parse(bytes.toString('utf8'))
  } finally {
    clearTimeout(timer)
  }
}

export async function readInstalledUpdateState(layout) {
  const components = await readJson(path.join(layout.root, 'licenses', 'COMPONENTS.json'), null)
  if (!components?.portableVersion || !components?.dshVersion) throw new Error('Installed component metadata is missing or incomplete.')
  return {
    portableVersion: components.portableVersion,
    releaseChannel: normalizeReleaseChannel(components.releaseChannel, components.portableVersion),
    dshVersion: components.dshVersion,
    updaterSchema: Number(components.updaterSchema ?? 0),
    shellSchema: Number(components.shellSchema ?? 0),
    nodeVersion: components.nodeVersion ?? '',
    runtimeLayout: components.runtimeLayout || 'expanded-v1',
  }
}

export async function checkForUpdate({
  layout,
  manifestUrl,
  scope = 'product',
  allowHttp = false,
  force = false,
  fetchImpl = fetch,
  timeoutMs = 5000,
  now = Date.now(),
}) {
  const installed = await readInstalledUpdateState(layout)
  const updateCheckCache = updateCacheForScope(layout, scope)
  manifestUrl ||= scope === 'engine'
    ? defaultEngineUpdateManifestUrl(installed.releaseChannel, layout.platform, process.arch)
    : defaultUpdateManifestUrl(installed.releaseChannel, layout.platform, process.arch)
  const platform = platformUpdateKey(layout.platform, process.arch)
  const cached = await readJson(updateCheckCache, null)
  if (!force && cached?.manifestUrl === manifestUrl && cached?.retryAfter > now) {
    return {
      status: 'unavailable', updateKind: scope,
      current: scope === 'engine' ? installed.dshVersion : installed.portableVersion,
      cached: true, checkedAt: cached.checkedAt, message: cached.error,
    }
  }
  const cachedKind = cached?.manifest?.updateKind || 'product'
  if (!force && cachedKind === scope && cached?.manifest && cached?.manifestUrl === manifestUrl && cached?.checkedAt && now - cached.checkedAt < UPDATE_CHECK_TTL_MS) {
    const evaluated = evaluateUpdate(cached.manifest, installed, platform)
    const ignoredIdentity = cached.ignoredIdentity || (cached.ignoredVersion ? `product:${cached.ignoredVersion}` : '')
    if (evaluated.updateIdentity && ignoredIdentity === evaluated.updateIdentity) {
      return { ...evaluated, status: 'ignored', cached: true, checkedAt: cached.checkedAt }
    }
    if (evaluated.status === 'available' && cached.deferredUntil > now) {
      return { ...evaluated, status: 'deferred', cached: true, checkedAt: cached.checkedAt, deferredUntil: cached.deferredUntil }
    }
    return { ...evaluated, cached: true, checkedAt: cached.checkedAt }
  }
  try {
    const manifest = await fetchJson(manifestUrl, { allowHttp, fetchImpl, timeoutMs })
    const manifestKind = manifest.updateKind || 'product'
    if (manifestKind !== scope) throw new Error(`Update kind mismatch: expected ${scope}, received ${manifestKind}.`)
    const result = evaluateUpdate(manifest, installed, platform)
    const cachedResult = cached?.manifest ? evaluateUpdate(cached.manifest, installed, platform) : null
    const deferredUntil = cachedResult?.updateIdentity === result.updateIdentity ? Number(cached.deferredUntil ?? 0) : 0
    const ignoredIdentity = (cached?.ignoredIdentity || (cached?.ignoredVersion ? `product:${cached.ignoredVersion}` : '')) === result.updateIdentity
      ? result.updateIdentity
      : ''
    await writeJsonAtomic(updateCheckCache, { schemaVersion: 2, checkedAt: now, manifestUrl, manifest, deferredUntil, ignoredIdentity })
    if (!force && result.updateIdentity && ignoredIdentity === result.updateIdentity) {
      return { ...result, status: 'ignored', cached: false, checkedAt: now }
    }
    if (!force && result.status === 'available' && deferredUntil > now) {
      return { ...result, status: 'deferred', cached: false, checkedAt: now, deferredUntil }
    }
    return { ...result, cached: false, checkedAt: now }
  } catch (error) {
    const message = error?.message ?? String(error)
    await writeJsonAtomic(updateCheckCache, {
      schemaVersion: 2,
      checkedAt: now,
      manifestUrl,
      error: message,
      retryAfter: now + UPDATE_FAILURE_TTL_MS,
    }).catch(() => {})
    return {
      status: 'unavailable',
      updateKind: scope,
      current: scope === 'engine' ? installed.dshVersion : installed.portableVersion,
      cached: false,
      checkedAt: now,
      message,
    }
  }
}

export async function deferUpdate(layout, { now = Date.now(), durationMs = 24 * 60 * 60 * 1000, scope = 'product' } = {}) {
  const updateCheckCache = updateCacheForScope(layout, scope)
  const cached = await readJson(updateCheckCache, null)
  if (!cached?.manifest) return { status: 'none' }
  const deferredUntil = now + Math.max(60 * 1000, Number(durationMs) || 0)
  await writeJsonAtomic(updateCheckCache, { ...cached, deferredUntil, ignoredIdentity: '', ignoredVersion: '' })
  const latest = scope === 'engine' ? cached.manifest.component?.dshVersion : cached.manifest.portableVersion
  return { status: 'deferred', updateKind: scope, latest, deferredUntil }
}

export async function ignoreUpdate(layout, version = '', { scope = 'product' } = {}) {
  const updateCheckCache = updateCacheForScope(layout, scope)
  const cached = await readJson(updateCheckCache, null)
  const latest = String(version || (scope === 'engine' ? cached?.manifest?.component?.dshVersion : cached?.manifest?.portableVersion) || '')
  if (!latest) return { status: 'none' }
  parseSemanticVersion(latest)
  const evaluatedIdentity = cached?.manifest
    ? (scope === 'engine'
        ? `engine:${cached.manifest.component?.dshVersion}:${String(cached.manifest.component?.dshCommit || cached.manifest.component?.sha256 || '')}`
        : `product:${cached.manifest.portableVersion}`)
    : `${scope}:${latest}`
  await writeJsonAtomic(updateCheckCache, { ...cached, schemaVersion: 2, ignoredIdentity: evaluatedIdentity, ignoredVersion: '', deferredUntil: 0 })
  return { status: 'ignored', updateKind: scope, latest }
}

function operationFromStage(layout, stagedRoot) {
  const operationRoot = path.dirname(path.resolve(stagedRoot))
  const relative = path.relative(path.resolve(layout.updateDir), operationRoot)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error('Update staging directory is outside the product update area.')
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(relative)) throw new Error('Update operation identifier is invalid.')
  return { operationId: relative, operationRoot }
}

function transactionPaths(layout, operationId) {
  const operationRoot = path.join(layout.updateDir, operationId)
  const backupRoot = path.join(operationRoot, 'backup')
  return {
    operationRoot,
    backupApp: path.join(backupRoot, 'app'),
    backupCapsuleManifest: path.join(backupRoot, 'runtime-capsule.json'),
    backupCapsuleFile: path.join(backupRoot, 'DSH-App.dshpack'),
    backupLicenses: path.join(backupRoot, 'licenses'),
    rootCapsuleManifest: path.join(layout.root, 'runtime-capsule.json'),
    rootCapsuleFile: path.join(layout.root, 'runtime', 'DSH-App.dshpack'),
    rootLicenses: path.join(layout.root, 'licenses'),
  }
}

async function writeJournal(layout, value) {
  await writeJsonAtomic(layout.updateJournal, { schemaVersion: UPDATE_SCHEMA_VERSION, ...value })
}

export async function rollbackPendingAppUpdate(layout, { beforeRestore = async () => {} } = {}) {
  const journal = await readJson(layout.updateJournal, null)
  if (!journal) return { status: 'none' }
  if (journal.schemaVersion !== UPDATE_SCHEMA_VERSION || !/^[A-Za-z0-9._-]{1,100}$/.test(String(journal.operationId ?? ''))) {
    throw new Error('Update recovery journal is invalid.')
  }
  const paths = transactionPaths(layout, journal.operationId)
  if (journal.phase === 'committed') {
    await rm(paths.operationRoot, { recursive: true, force: true })
    await rm(layout.updateJournal, { force: true })
    return { status: 'committed-cleaned', operationId: journal.operationId }
  }
  await beforeRestore(journal)
  if (journal.kind === 'dsh-runtime-capsule') {
    await rm(paths.rootCapsuleManifest, { force: true })
    await rm(paths.rootCapsuleFile, { force: true })
    if (existsSync(paths.backupCapsuleManifest)) await rename(paths.backupCapsuleManifest, paths.rootCapsuleManifest)
    if (existsSync(paths.backupCapsuleFile)) {
      await mkdir(path.dirname(paths.rootCapsuleFile), { recursive: true })
      await rename(paths.backupCapsuleFile, paths.rootCapsuleFile)
    }
  } else if (existsSync(paths.backupApp)) {
    await rm(layout.appDir, { recursive: true, force: true })
    await rename(paths.backupApp, layout.appDir)
  }
  const hadLicenses = new Set(Array.isArray(journal.hadLicenses)
    ? journal.hadLicenses
    : journal.hadComponents ? ['COMPONENTS.json'] : [])
  await mkdir(paths.rootLicenses, { recursive: true })
  for (const name of UPDATE_LICENSE_FILES) {
    const rootFile = path.join(paths.rootLicenses, name)
    const backupFile = path.join(paths.backupLicenses, name)
    if (existsSync(backupFile)) {
      await rm(rootFile, { force: true })
      await rename(backupFile, rootFile)
    } else if (!hadLicenses.has(name)) {
      await rm(rootFile, { force: true })
    }
  }
  await rm(paths.operationRoot, { recursive: true, force: true })
  await rm(layout.updateJournal, { force: true })
  return { status: 'rolled-back', operationId: journal.operationId }
}

export async function resetManagedProfileModuleFallback(layout) {
  const fallback = path.join(layout.dshHome, 'profiles', 'node_modules')
  await rm(fallback, { recursive: true, force: true })
  return fallback
}

export async function applyStagedAppUpdate({ layout, stagedRoot, healthCheck, beforeRollback = async () => {} }) {
  if (await readJson(layout.updateJournal, null)) throw new Error('A prior update must be recovered before another update can start.')
  const metadata = await readJson(path.join(stagedRoot, 'component.json'), null)
  if (metadata?.schemaVersion !== UPDATE_SCHEMA_VERSION || metadata.kind !== 'dsh-app') throw new Error('Staged update metadata is invalid.')
  const stagedApp = path.join(stagedRoot, 'app')
  const stagedDsh = path.join(stagedApp, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const stagedLicenses = path.join(stagedRoot, 'licenses')
  const stagedComponents = await readJson(path.join(stagedLicenses, 'COMPONENTS.json'), null)
  if (!stagedComponents
    || stagedComponents.portableVersion !== metadata.portableVersion
    || stagedComponents.dshVersion !== metadata.dshVersion
    || (metadata.dshCommit && stagedComponents.dshCommit !== metadata.dshCommit)) {
    throw new Error('Staged component metadata does not agree with its application payload.')
  }
  if (!existsSync(stagedDsh) || UPDATE_LICENSE_FILES.some((name) => !existsSync(path.join(stagedLicenses, name)))) {
    throw new Error('Staged update is incomplete.')
  }
  if (!existsSync(layout.appDir)) throw new Error('The current DSH application is missing.')

  const { operationId, operationRoot } = operationFromStage(layout, stagedRoot)
  const paths = transactionPaths(layout, operationId)
  const hadLicenses = UPDATE_LICENSE_FILES.filter((name) => existsSync(path.join(paths.rootLicenses, name)))
  await mkdir(path.dirname(paths.backupApp), { recursive: true })
  await mkdir(paths.backupLicenses, { recursive: true })
  await writeJournal(layout, { operationId, phase: 'prepared', hadLicenses })

  try {
    await rename(layout.appDir, paths.backupApp)
    await writeJournal(layout, { operationId, phase: 'app-backed-up', hadLicenses })
    await rename(stagedApp, layout.appDir)
    await mkdir(paths.rootLicenses, { recursive: true })
    for (const name of UPDATE_LICENSE_FILES) {
      const rootFile = path.join(paths.rootLicenses, name)
      if (existsSync(rootFile)) await rename(rootFile, path.join(paths.backupLicenses, name))
      await rename(path.join(stagedLicenses, name), rootFile)
    }
    await resetManagedProfileModuleFallback(layout)
    await writeJournal(layout, { operationId, phase: 'testing', hadLicenses })

    const healthy = await healthCheck(metadata)
    if (!healthy) throw new Error('The updated DSH runtime did not pass its health check.')
    await writeJournal(layout, { operationId, phase: 'committed', hadLicenses })
  } catch (error) {
    if (error?.leavePending) throw error
    await beforeRollback(error)
    await rollbackPendingAppUpdate(layout)
    throw new Error(`Update failed and was rolled back: ${error?.message ?? error}`, { cause: error })
  }
  let cleanupPending = false
  try {
    await rm(operationRoot, { recursive: true, force: true })
    await rm(layout.updateJournal, { force: true })
  } catch {
    cleanupPending = true
  }
  return { status: 'updated', portableVersion: metadata.portableVersion, dshVersion: metadata.dshVersion, cleanupPending }
}

export async function applyStagedCapsuleUpdate({ layout, stagedRoot, healthCheck, beforeRollback = async () => {} }) {
  if (await readJson(layout.updateJournal, null)) throw new Error('A prior update must be recovered before another update can start.')
  if (!layout.capsuleMode) throw new Error('A compact runtime update cannot be applied to an expanded installation.')
  const metadata = await readJson(path.join(stagedRoot, 'component.json'), null)
  if (metadata?.schemaVersion !== UPDATE_SCHEMA_VERSION || metadata.kind !== 'dsh-runtime-capsule') {
    throw new Error('Staged compact runtime metadata is invalid.')
  }
  const stagedManifestFile = path.join(stagedRoot, 'runtime-capsule.json')
  const stagedCapsuleFile = path.join(stagedRoot, 'runtime', 'DSH-App.dshpack')
  const stagedManifest = await readJson(stagedManifestFile, null)
  const stagedLicenses = path.join(stagedRoot, 'licenses')
  const stagedComponents = await readJson(path.join(stagedLicenses, 'COMPONENTS.json'), null)
  if (!stagedManifest || stagedManifest.schemaVersion !== 1
    || stagedManifest.filename !== 'runtime/DSH-App.dshpack'
    || !/^[a-f0-9]{64}$/i.test(String(stagedManifest.sha256 ?? ''))
    || !Number.isSafeInteger(Number(stagedManifest.bytes)) || Number(stagedManifest.bytes) <= 0
    || !Array.isArray(stagedManifest.required) || stagedManifest.required.length === 0) {
    throw new Error('Staged compact runtime manifest is invalid.')
  }
  if (!stagedComponents
    || stagedComponents.portableVersion !== metadata.portableVersion
    || stagedComponents.dshVersion !== metadata.dshVersion
    || stagedComponents.runtimeLayout !== 'capsule-v1'
    || (metadata.dshCommit && stagedComponents.dshCommit !== metadata.dshCommit)) {
    throw new Error('Staged component metadata does not agree with its compact runtime payload.')
  }
  if (!existsSync(stagedCapsuleFile) || UPDATE_LICENSE_FILES.some((name) => !existsSync(path.join(stagedLicenses, name)))) {
    throw new Error('Staged compact runtime update is incomplete.')
  }
  const capsuleBytes = await readFile(stagedCapsuleFile)
  if (capsuleBytes.length !== Number(stagedManifest.bytes)
    || createHash('sha256').update(capsuleBytes).digest('hex') !== stagedManifest.sha256) {
    throw new Error('Staged compact runtime failed integrity verification.')
  }

  const { operationId, operationRoot } = operationFromStage(layout, stagedRoot)
  const paths = transactionPaths(layout, operationId)
  const hadLicenses = UPDATE_LICENSE_FILES.filter((name) => existsSync(path.join(paths.rootLicenses, name)))
  await mkdir(path.dirname(paths.backupCapsuleManifest), { recursive: true })
  await mkdir(paths.backupLicenses, { recursive: true })
  await writeJournal(layout, { operationId, kind: metadata.kind, phase: 'prepared', hadLicenses })

  try {
    if (existsSync(paths.rootCapsuleManifest)) await rename(paths.rootCapsuleManifest, paths.backupCapsuleManifest)
    if (existsSync(paths.rootCapsuleFile)) await rename(paths.rootCapsuleFile, paths.backupCapsuleFile)
    await writeJournal(layout, { operationId, kind: metadata.kind, phase: 'runtime-backed-up', hadLicenses })
    await mkdir(path.dirname(paths.rootCapsuleFile), { recursive: true })
    await rename(stagedManifestFile, paths.rootCapsuleManifest)
    await rename(stagedCapsuleFile, paths.rootCapsuleFile)
    await mkdir(paths.rootLicenses, { recursive: true })
    for (const name of UPDATE_LICENSE_FILES) {
      const rootFile = path.join(paths.rootLicenses, name)
      if (existsSync(rootFile)) await rename(rootFile, path.join(paths.backupLicenses, name))
      await rename(path.join(stagedLicenses, name), rootFile)
    }
    await writeJournal(layout, { operationId, kind: metadata.kind, phase: 'testing', hadLicenses })
    if (!await healthCheck(metadata)) throw new Error('The updated compact DSH runtime did not pass its health check.')
    await writeJournal(layout, { operationId, kind: metadata.kind, phase: 'committed', hadLicenses })
  } catch (error) {
    if (error?.leavePending) throw error
    await beforeRollback(error)
    await rollbackPendingAppUpdate(layout)
    throw new Error(`Update failed and was rolled back: ${error?.message ?? error}`, { cause: error })
  }
  let cleanupPending = false
  try {
    await rm(operationRoot, { recursive: true, force: true })
    await rm(layout.updateJournal, { force: true })
  } catch {
    cleanupPending = true
  }
  return { status: 'updated', portableVersion: metadata.portableVersion, dshVersion: metadata.dshVersion, cleanupPending }
}

export async function installAvailableAppUpdate({
  layout,
  update,
  allowHttp = false,
  healthCheck,
  beforeRollback,
  download = downloadVerifiedComponent,
  extract = extractUpdateArchive,
  onProgress = () => {},
}) {
  if (update?.status !== 'available' || !['dsh-app', 'dsh-runtime-capsule'].includes(update.component?.kind)) {
    throw new Error('No compatible application update is available.')
  }
  if (layout.capsuleMode !== (update.component.kind === 'dsh-runtime-capsule')) {
    throw new Error('The update runtime layout is not compatible with this installation.')
  }
  if (typeof healthCheck !== 'function') throw new Error('Update health check is required.')
  const operationId = randomUUID()
  const operationRoot = path.join(layout.updateDir, operationId)
  const archive = path.join(operationRoot, 'component.zip')
  const stagedRoot = path.join(operationRoot, 'staged')
  await mkdir(operationRoot, { recursive: true })
  try {
    onProgress({ phase: 'preparing' })
    await download({
      urls: update.component.urls,
      destination: archive,
      bytes: update.component.bytes,
      sha256: update.component.sha256,
      allowHttp,
      onProgress,
    })
    onProgress({ phase: 'verifying' })
    await extract(archive, stagedRoot)
    const metadata = await readJson(path.join(stagedRoot, 'component.json'), null)
    const components = await readJson(path.join(stagedRoot, 'licenses', 'COMPONENTS.json'), null)
    if (metadata?.schemaVersion !== UPDATE_SCHEMA_VERSION || metadata.kind !== update.component.kind) throw new Error('Downloaded update metadata is invalid.')
    if (metadata.portableVersion !== update.latest || metadata.dshVersion !== update.component.dshVersion) throw new Error('Downloaded update version does not match its manifest.')
    if (metadata.releaseChannel !== update.releaseChannel) throw new Error('Downloaded update channel does not match its manifest.')
    if (update.component.dshCommit && metadata.dshCommit !== update.component.dshCommit) throw new Error('Downloaded update commit does not match its manifest.')
    if (!components
      || components.nodeVersion !== update.component.requiredNodeVersion
      || components.releaseChannel !== update.releaseChannel
      || components.platform !== update.platform
      || Number(components.updaterSchema) < Number(update.minimumUpdaterSchema)
      || Number(components.shellSchema) < Number(update.requiredShellSchema)) {
      throw new Error('Downloaded component compatibility metadata does not match its manifest.')
    }
    onProgress({ phase: 'installing' })
    const applied = metadata.kind === 'dsh-runtime-capsule'
      ? await applyStagedCapsuleUpdate({ layout, stagedRoot, healthCheck, beforeRollback })
      : await applyStagedAppUpdate({ layout, stagedRoot, healthCheck, beforeRollback })
    onProgress({ phase: 'complete', percent: 100 })
    return { ...applied, updateKind: update.updateKind || 'product' }
  } catch (error) {
    if (!await readJson(layout.updateJournal, null)) await rm(operationRoot, { recursive: true, force: true })
    throw error
  }
}
