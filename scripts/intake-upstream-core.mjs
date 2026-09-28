import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { descriptorV2PatchIdentity, readHistoricalDescriptorVersions } from './patch-historical-descriptor.mjs'
import { patchPluginManagerActions } from './patch-native-settings-command.mjs'
import { readOfficialSourceMetadata } from './upstream-source-metadata.mjs'
import { upstreamRequestHeaders } from './upstream-request-headers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCK_PATH = path.join(ROOT, 'upstream.lock.json')
const HISTORICAL_DESCRIPTOR_VERSIONS_PATH = path.join(ROOT, 'config', 'historical-descriptor-versions.json')
const REPOSITORY = 'deepseek-ai/deepseek-harness'
const API_BASE = `https://api.github.com/repos/${REPOSITORY}`
const RAW_BASE = `https://raw.githubusercontent.com/${REPOSITORY}`
const PACKAGE_REGISTRY_HOST = 'registry.npmjs.org'
const LOCK_FIELDS = Object.freeze([
  'version', 'tag', 'reviewedCommit', 'integrity', 'noticesSha256', 'packedFamilies',
])

// These are the reviewed Git blob identities recorded by the 0.2.0-rc.1 intake.
// A change is an explicit human-review boundary, never an invitation to widen a patch.
export const HISTORICAL_VALIDATION_BLOBS = Object.freeze({
  'packages/session/session-format-v0-to-v1/src/validation.ts': '762ed963f73c7159f5309176cc69b11db25ac634',
  'packages/session/session-format-v0-to-v1/src/payload-validation.ts': '5b19f7cc6668d8e9bfc1c75806d3898132eb94ee',
})

const isCommit = value => /^[0-9a-f]{40}$/.test(value ?? '')
const isIntegrity = value => /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value ?? '')
const isSha256 = value => /^[0-9a-f]{64}$/.test(value ?? '')
const isExactVersion = value => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value ?? '')
const sha256 = value => createHash('sha256').update(value).digest('hex')

function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(path.dirname(process.execPath)), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  const candidate = candidates.find(value => value.endsWith('.js'))
  if (process.platform === 'win32' && !candidate) {
    throw new Error('npm CLI was not found beside the active Node runtime')
  }
  return candidate
}

function runChild(command, args, label) {
  let result
  try {
    result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
    })
  } catch {
    throw new Error(`${label} could not start; network or CLI access is unavailable`)
  }
  if (result.error || result.status !== 0) {
    const status = result.status === null ? 'no exit status' : `exit ${result.status}`
    throw new Error(`${label} failed (${status}); network or CLI access is unavailable or the request was rejected`)
  }
  return result.stdout.trim()
}

function runGhApi(endpoint) {
  const output = runChild('gh', ['api', endpoint], `gh api ${endpoint}`)
  try { return JSON.parse(output) } catch {
    throw new Error(`gh api ${endpoint} returned invalid JSON`)
  }
}

function runNpmView(spec, field) {
  const cli = npmCli()
  const output = process.platform === 'win32'
    ? runChild(process.execPath, [cli, 'view', spec, field, '--json'], `npm view ${spec} ${field}`)
    : runChild('npm', ['view', spec, field, '--json'], `npm view ${spec} ${field}`)
  try { return JSON.parse(output) } catch {
    return output
  }
}

export async function resolveOfficialTagCommit(version, ghApi = runGhApi) {
  const tag = `dsh-v${version}`
  const ref = await ghApi(`repos/${REPOSITORY}/git/ref/tags/${tag}`)
  let object = ref?.object
  if (object?.type === 'tag' && isCommit(object.sha)) {
    const annotated = await ghApi(`repos/${REPOSITORY}/git/tags/${object.sha}`)
    object = annotated?.object
  }
  if (object?.type !== 'commit' || !isCommit(object.sha)) {
    throw new Error(`official tag ${tag} did not resolve to a full commit SHA`)
  }
  return object.sha
}

async function fetchResponse(url) {
  let response
  try {
    response = await fetch(url, {
      headers: upstreamRequestHeaders(url),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error(`network request failed for ${url}; no value was inferred`)
  }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}; no value was inferred`)
  return response
}

function cachedReaders() {
  const cache = new Map()
  const bytesFor = url => {
    if (!cache.has(url)) cache.set(url, fetchResponse(url).then(async response => Buffer.from(await response.arrayBuffer())))
    return cache.get(url)
  }
  return {
    json: async url => JSON.parse((await bytesFor(url)).toString('utf8')),
    text: async url => (await bytesFor(url)).toString('utf8'),
    bytes: async url => Buffer.from(await bytesFor(url)),
  }
}

function assertNpmTarballUrl(value, packageName, version) {
  let url
  try { url = new URL(value) } catch {
    throw new Error(`npm view ${packageName}@${version} returned an invalid dist.tarball URL`)
  }
  if (url.protocol !== 'https:' || url.hostname !== PACKAGE_REGISTRY_HOST) {
    throw new Error(`npm view ${packageName}@${version} returned a non-registry dist.tarball URL`)
  }
  return url.href
}

function readTarMember(tarball, memberName) {
  const archive = gunzipSync(tarball)
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '')
    const fullName = prefix ? `${prefix}/${name}` : name
    const sizeText = header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim()
    const size = Number.parseInt(sizeText || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('npm tarball contains an invalid member size')
    const bodyStart = offset + 512
    if (fullName === memberName) {
      const type = String.fromCharCode(header[156] || 48)
      if (type !== '0') throw new Error(`npm tarball member ${memberName} is not a regular file`)
      return archive.subarray(bodyStart, bodyStart + size)
    }
    offset = bodyStart + Math.ceil(size / 512) * 512
  }
  throw new Error(`npm tarball did not contain ${memberName}`)
}

async function npmPackageMember(readers, packageName, version, memberName) {
  const spec = `${packageName}@${version}`
  const tarball = runNpmView(spec, 'dist.tarball')
  const url = assertNpmTarballUrl(tarball, packageName, version)
  const bytes = await readers.bytes(url)
  return readTarMember(bytes, memberName)
}

function treeBlob(tree, filename) {
  const match = tree?.tree?.find(entry => entry?.path === filename && entry?.type === 'blob')
  if (!match || !/^[0-9a-f]{40}$/.test(match.sha ?? '')) {
    throw new Error(`official source tree is missing a valid blob for ${filename}`)
  }
  return match.sha
}

function sourceManifestPath(tree, suffix) {
  const matches = tree?.tree?.filter(entry => entry?.type === 'blob'
    && entry.path.endsWith(suffix)) ?? []
  if (matches.length !== 1) throw new Error(`expected one official source manifest ending ${suffix}, found ${matches.length}`)
  return matches[0].path
}

async function collectHistory(commit, tree, readers) {
  const validationBlobs = Object.fromEntries(Object.keys(HISTORICAL_VALIDATION_BLOBS)
    .map(filename => [filename, treeBlob(tree, filename)]))
  const sessionManifestPath = sourceManifestPath(tree, '/session-format-v0-to-v1/package.json')
  const sessionManifest = await readers.json(`${RAW_BASE}/${commit}/${sessionManifestPath}`)
  if (sessionManifest?.name !== '@deepseek-ai/dsh-session-format-v0-to-v1'
    || typeof sessionManifest.version !== 'string') {
    throw new Error(`official source manifest ${sessionManifestPath} has an unexpected identity`)
  }
  const indexBytes = await npmPackageMember(
    readers,
    sessionManifest.name,
    sessionManifest.version,
    'package/lib/index.js',
  )
  return {
    validationBlobs,
    inputSha256: sha256(indexBytes),
  }
}

async function collectPluginManager(commit, tree, readers) {
  const manifestPath = sourceManifestPath(tree, '/client/ui-plugin-manager/package.json')
  const manifest = await readers.json(`${RAW_BASE}/${commit}/${manifestPath}`)
  if (manifest?.name !== '@deepseek-ai/dsh-client-ui-plugin-manager'
    || typeof manifest.version !== 'string') {
    throw new Error(`official source manifest ${manifestPath} has an unexpected identity`)
  }
  const bundle = await npmPackageMember(readers, manifest.name, manifest.version, 'package/lib/client.js')
  return { source: bundle.toString('utf8'), sha256: sha256(bundle), packageVersion: manifest.version }
}

function validPackedFamilies(value) {
  return value !== null && typeof value === 'object'
    && Number.isSafeInteger(value.dsh) && value.dsh > 0
    && Number.isSafeInteger(value.vendor) && value.vendor > 0
    && Number.isSafeInteger(value.landlock) && value.landlock >= 0
}

function jsonSame(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function projectedDsh(dsh) {
  return Object.fromEntries(LOCK_FIELDS.map(field => [field, dsh?.[field]]))
}

function errorEvidence(error) {
  return error instanceof Error ? error.message : String(error)
}

export function createIntakeReport(input) {
  const {
    version, lock, tagCommit, npmIntegrity, noticesSha256, packedFamilies,
    history, pluginManagerBundle, failures = {}, lockName = 'upstream.lock.json',
  } = input
  const checks = []
  const add = (id, title, pass, evidence) => checks.push({ id, title, status: pass ? 'PASS' : 'FAIL', evidence })

  const sourceIdentityValid = isCommit(tagCommit)
  const packageIdentityValid = isIntegrity(npmIntegrity)
  add('1', 'Official tag commit and npm dist.integrity',
    !failures.tag && !failures.npm && sourceIdentityValid && packageIdentityValid,
    failures.tag || failures.npm
      ? [failures.tag && `tag: ${errorEvidence(failures.tag)}`, failures.npm && `npm: ${errorEvidence(failures.npm)}`].filter(Boolean).join('; ')
      : `tag dsh-v${version} -> ${tagCommit}; npm @deepseek-ai/dsh@${version} dist.integrity=${npmIntegrity}; independently observed, not a provenance claim`)

  const candidateFields = {
    version,
    tag: `dsh-v${version}`,
    reviewedCommit: tagCommit,
    integrity: npmIntegrity,
    noticesSha256,
    packedFamilies,
  }
  const haveLockInputs = sourceIdentityValid && packageIdentityValid
    && isSha256(noticesSha256) && validPackedFamilies(packedFamilies)
  const lockDifferences = haveLockInputs && lock?.dsh
    ? LOCK_FIELDS.filter(field => !jsonSame(lock.dsh[field], candidateFields[field]))
      .map(field => ({ field, current: lock.dsh[field], candidate: candidateFields[field] }))
    : null
  add('2', `Differences from ${lockName}`,
    !failures.lock && haveLockInputs && lockDifferences !== null,
    failures.lock
      ? errorEvidence(failures.lock)
      : lockDifferences === null
        ? 'insufficient candidate or lock data; comparison was not guessed'
        : lockDifferences.length
          ? `${lockDifferences.length} field(s) differ: ${JSON.stringify(lockDifferences)}`
          : 'zero differences across version, tag, reviewedCommit, integrity, noticesSha256, packedFamilies')

  let historyEvidence = failures.history ? errorEvidence(failures.history) : ''
  let historyMatches = false
  if (!failures.history && history) {
    const blobLines = Object.entries(HISTORICAL_VALIDATION_BLOBS).map(([filename, expected]) =>
      `${filename}=${history.validationBlobs?.[filename] ?? 'missing'} (expected ${expected})`)
    const indexMatch = history.inputSha256 === descriptorV2PatchIdentity.sourceSha256
    const blobsMatch = Object.entries(HISTORICAL_VALIDATION_BLOBS)
      .every(([filename, expected]) => history.validationBlobs?.[filename] === expected)
    const exactVersion = isExactVersion(version)
    historyMatches = blobsMatch && indexMatch && exactVersion
    historyEvidence = `${blobLines.join('; ')}; lib/index.js sha256=${history.inputSha256 ?? 'missing'} (expected ${descriptorV2PatchIdentity.sourceSha256}); candidate version=${version} (${exactVersion ? 'exact version string' : 'not an exact version string'}); migration inputs=${historyMatches ? 'same-shape' : 'different or incomplete'}`
    if (!historyMatches) historyEvidence += '; needs human patch review; automatic identity relaxation is forbidden'
  } else if (!historyEvidence) {
    historyEvidence = 'historical migration identities were not collected; no patch relaxation was attempted'
  }
  add('3', 'Historical-session migration identities', historyMatches, historyEvidence)

  const oldFamilies = lock?.dsh?.packedFamilies
  const familiesReady = !failures.families && validPackedFamilies(packedFamilies) && validPackedFamilies(oldFamilies)
  add('4', 'Official release package-family counts', familiesReady,
    failures.families
      ? errorEvidence(failures.families)
      : familiesReady
        ? `lock old=${JSON.stringify(oldFamilies)}; official candidate=${JSON.stringify(packedFamilies)}`
        : 'official family counts or old lock counts are invalid; no count was inferred')

  let anchorEvidence = failures.anchor ? errorEvidence(failures.anchor) : ''
  let anchorPassed = false
  if (!failures.anchor && pluginManagerBundle?.source !== undefined) {
    try {
      if (pluginManagerBundle.source.includes('dsh-portable-plugin-refresh-v1')) {
        throw new Error('official bundle already contains the Portable refresh marker; anchor count cannot be assessed')
      }
      patchPluginManagerActions(pluginManagerBundle.source)
      anchorPassed = true
      anchorEvidence = `patchPluginManagerActions accepted the official bundle; package version=${pluginManagerBundle.packageVersion ?? 'unknown'}; bundle sha256=${pluginManagerBundle.sha256 ?? sha256(pluginManagerBundle.source)}`
    } catch (error) {
      anchorEvidence = errorEvidence(error)
    }
  } else if (!anchorEvidence) {
    anchorEvidence = 'official Plugin Manager bundle was not collected; anchor count was not guessed'
  }
  add('5', 'patch-native-settings-command.mjs Plugin Manager anchors', anchorPassed, anchorEvidence)

  const shapeChecks = checks.filter(check => ['3', '4', '5'].includes(check.id))
  const firstShapeFailure = shapeChecks.find(check => check.status !== 'PASS')
  const sameShape = firstShapeFailure === undefined
  return {
    version,
    checks,
    passed: checks.every(check => check.status === 'PASS'),
    sameShape,
    verdict: sameShape ? 'same-shape' : `needs-review:${firstShapeFailure.id}`,
    lockDifferences,
    candidateFields,
  }
}

export function formatIntakeReport(report, {
  writeRequested = false,
  recordShapeRequested = false,
  lockName = 'upstream.lock.json',
  actionEvidence = '',
} = {}) {
  const lines = [
    `Upstream core intake: ${report.version}`,
    `Lock: ${lockName}`,
    `Mode: ${writeRequested ? '--write (gated by all checks)' : recordShapeRequested ? '--record-shape (gated by all checks)' : 'read-only'}`,
  ]
  for (const check of report.checks) lines.push(`[${check.status}] ${check.id}. ${check.title} — ${check.evidence}`)
  lines.push(`Decision: ${report.passed ? 'PASS' : 'FAIL'}`)
  if (writeRequested) lines.push(`Lock write: ${report.passed ? 'authorized after checks' : 'not applied because checks failed'}`)
  if (actionEvidence) lines.push(actionEvidence)
  lines.push('稳定线采用前仍需人工接入记录；stable-release-readiness.json 的证据要求不变。')
  lines.push(`VERDICT=${report.verdict}`)
  return `${lines.join('\n')}\n`
}

export function formatIntakeMarkdown(report, {
  recordShapeRequested = false,
  lockName = 'upstream.lock.json',
  actionEvidence = '',
} = {}) {
  const lines = [
    `# Upstream core intake: ${report.version}`,
    '',
    `- Compared lock: \`${lockName}\``,
    `- Mode: ${recordShapeRequested ? '`--record-shape` (all five checks required)' : 'read-only'}`,
    `- Overall checks: **${report.passed ? 'PASS' : 'FAIL'}**`,
    `- Intake verdict: \`${report.verdict}\``,
    '',
    '## Checks',
    '',
  ]
  for (const check of report.checks) {
    lines.push(`### ${check.id}. ${check.title} — ${check.status}`, '', check.evidence, '')
  }
  lines.push('## Stable-line note', '', '稳定线采用前仍需人工接入记录；stable-release-readiness.json 的证据要求不变。', '')
  if (actionEvidence) lines.push(actionEvidence, '')
  lines.push(`VERDICT=${report.verdict}`)
  return `${lines.join('\n')}\n`
}

export function intakeExitCode(report, { failedOperation = false } = {}) {
  return report.passed && !failedOperation ? 0 : 1
}

export function updateDshLock(lock, candidateFields) {
  const updated = structuredClone(lock)
  for (const field of LOCK_FIELDS) updated.dsh[field] = candidateFields[field]
  return updated
}

export async function recordHistoricalDescriptorVersion(version, report, {
  filePath = HISTORICAL_DESCRIPTOR_VERSIONS_PATH,
} = {}) {
  if (!isExactVersion(version)) throw new Error('cannot record a non-exact historical descriptor version')
  if (!report.sameShape || !report.passed) {
    return { changed: false, skipped: true, reason: 'all intake checks, including checks 3-5, must PASS' }
  }
  const versions = readHistoricalDescriptorVersions(filePath)
  if (versions.includes(version)) return { changed: false, skipped: false }

  const updated = `${JSON.stringify([...versions, version], null, 2)}\n`
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, updated, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true })
  }
  return { changed: true, skipped: false }
}

export async function writeIntakeMarkdown(filePath, report, options = {}) {
  const resolvedPath = path.resolve(filePath)
  await mkdir(path.dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, formatIntakeMarkdown(report, options), 'utf8')
  return resolvedPath
}

export function parseIntakeArgs(argv) {
  if (!Array.isArray(argv) || argv.length < 1 || !isExactVersion(argv[0])) return null
  const options = {
    version: argv[0],
    lockPath: 'upstream.lock.json',
    markdownPath: null,
    writeRequested: false,
    recordShapeRequested: false,
  }
  const seen = new Set()
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--write' || flag === '--record-shape') {
      if (seen.has(flag)) return null
      seen.add(flag)
      if (flag === '--write') options.writeRequested = true
      else options.recordShapeRequested = true
      continue
    }
    if (flag === '--lock' || flag === '--markdown') {
      if (seen.has(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) return null
      seen.add(flag)
      const value = argv[++index]
      if (flag === '--lock') options.lockPath = value
      else options.markdownPath = value
      continue
    }
    return null
  }
  if (options.writeRequested && options.recordShapeRequested) return null
  if (options.writeRequested && options.lockPath !== 'upstream.lock.json') return null
  return options
}

async function collectCandidate(version, lockPath) {
  const readers = cachedReaders()
  const failures = {}
  const resolvedLockPath = path.resolve(ROOT, lockPath)
  const [lock, tagResult, integrityResult] = await Promise.all([
    readFile(resolvedLockPath, 'utf8').then(JSON.parse),
    resolveOfficialTagCommit(version).then(value => ({ value }), error => ({ error })),
    Promise.resolve().then(() => runNpmView(`@deepseek-ai/dsh@${version}`, 'dist.integrity'))
      .then(value => ({ value }), error => ({ error })),
  ])
  const tagCommit = tagResult.value
  const npmIntegrity = integrityResult.value
  if (tagResult.error) failures.tag = tagResult.error
  if (integrityResult.error) failures.npm = integrityResult.error

  let noticesSha256
  let packedFamilies
  let history
  let pluginManagerBundle
  if (tagCommit) {
    const treeUrl = `${API_BASE}/git/trees/${tagCommit}?recursive=1`
    try {
      const sourceMetadata = await readOfficialSourceMetadata(tagCommit, readers)
      packedFamilies = sourceMetadata.packedFamilies
      const tree = await readers.json(treeUrl)
      const [notices, historyResult, pluginResult] = await Promise.all([
        readers.bytes(`${RAW_BASE}/${tagCommit}/THIRD_PARTY_NOTICES.md`).then(value => ({ value }), error => ({ error })),
        collectHistory(tagCommit, tree, readers).then(value => ({ value }), error => ({ error })),
        collectPluginManager(tagCommit, tree, readers).then(value => ({ value }), error => ({ error })),
      ])
      if (notices.error) failures.lock = notices.error
      else noticesSha256 = sha256(notices.value)
      if (historyResult.error) failures.history = historyResult.error
      else history = historyResult.value
      if (pluginResult.error) failures.anchor = pluginResult.error
      else pluginManagerBundle = pluginResult.value
    } catch (error) {
      failures.families = error
      failures.history = error
      failures.anchor = error
    }
  } else {
    failures.families = failures.tag
    failures.history = failures.tag
    failures.anchor = failures.tag
  }
  return { lock, tagCommit, npmIntegrity, noticesSha256, packedFamilies, history, pluginManagerBundle, failures }
}

async function writeLock(lock, candidateFields) {
  const original = `${JSON.stringify(lock, null, 2)}\n`
  const updated = `${JSON.stringify(updateDshLock(lock, candidateFields), null, 2)}\n`
  if (original === updated) return { changed: false }
  const evidenceDirectory = path.join(ROOT, 'build', 'orch-080', 'T12')
  await mkdir(evidenceDirectory, { recursive: true })
  const temporary = path.join(evidenceDirectory, `upstream.lock.json.${process.pid}.tmp`)
  await writeFile(temporary, updated, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, LOCK_PATH)
  return { changed: true }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseIntakeArgs(argv)
  if (!options) {
    console.error('usage: node scripts/intake-upstream-core.mjs <version> [--lock <path>] [--record-shape] [--markdown <file>] [--write]')
    process.exitCode = 2
    return
  }
  const { version, lockPath, markdownPath, writeRequested, recordShapeRequested } = options
  let failedOperation = false
  let collected
  let report
  try {
    collected = await collectCandidate(version, lockPath)
    report = createIntakeReport({ version, ...collected, lockName: lockPath })
  } catch (error) {
    report = createIntakeReport({
      version,
      lock: null,
      lockName: lockPath,
      failures: { tag: error, npm: error, lock: error, history: error, families: error, anchor: error },
    })
  }

  const actionEvidence = []
  if (writeRequested && report.passed) {
    try {
      const result = await writeLock(collected.lock, report.candidateFields)
      actionEvidence.push(result.changed
        ? '--write applied the six dsh fields in upstream.lock.json'
        : '--write made zero changes to upstream.lock.json (byte-identical serialization)')
    } catch (error) {
      failedOperation = true
      actionEvidence.push(`--write failed: ${errorEvidence(error)}`)
    }
  }
  if (recordShapeRequested) {
    try {
      const result = await recordHistoricalDescriptorVersion(version, report)
      actionEvidence.push(result.changed
        ? `--record-shape added exact version ${version} to config/historical-descriptor-versions.json`
        : result.skipped
          ? `--record-shape did not write: ${result.reason}`
          : `--record-shape left config/historical-descriptor-versions.json unchanged; ${version} is already present`)
    } catch (error) {
      failedOperation = true
      actionEvidence.push(`--record-shape failed closed: ${errorEvidence(error)}`)
    }
  }

  const reportOptions = {
    writeRequested,
    recordShapeRequested,
    lockName: lockPath,
    actionEvidence: actionEvidence.join('\n'),
  }
  if (markdownPath) {
    try {
      await writeIntakeMarkdown(path.resolve(ROOT, markdownPath), report, reportOptions)
    } catch (error) {
      failedOperation = true
      actionEvidence.push(`--markdown failed: ${errorEvidence(error)}`)
      reportOptions.actionEvidence = actionEvidence.join('\n')
    }
  }
  process.stdout.write(formatIntakeReport(report, reportOptions))
  process.exitCode = intakeExitCode(report, { failedOperation })
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) await main()
