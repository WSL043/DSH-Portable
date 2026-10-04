// Adopt the newest published default-plugin releases that declare support for the locked core.
// Each release must carry npm SLSA provenance built from the plugin's own repository; its integrity,
// sha256 and source commit are recorded exactly as a hand-reviewed pin would be. Nothing is adopted
// when no newer compatible release exists.
//   node scripts/adopt-default-plugins.mjs [--write] [--lock upstream.lock.json]
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { comparePortableVersions } from '../launcher/update-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = 'https://registry.npmjs.org/'
const SLSA = 'https://slsa.dev/provenance/v1'
// Default plugins ship only final plugin releases; beta tags stay opt-in.
const RELEASE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

/** Peer ranges are exact `a || b || c` lists; a release supports a core when every DSH peer lists it. */
export function supportsCore(manifest, coreVersion) {
  const peers = Object.entries(manifest?.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
  return peers.length > 0 && peers.every(([, range]) => String(range).split('||').map(item => item.trim()).includes(coreVersion))
}

/** Newest non-deprecated final release (no dist-tag guessing) whose peers include the core. */
export function selectRelease(packument, coreVersion) {
  return Object.entries(packument?.versions ?? {})
    .filter(([version, manifest]) => RELEASE.test(version) && !manifest?.deprecated && typeof manifest?.dist?.integrity === 'string'
      && supportsCore(manifest, coreVersion))
    .sort(([left], [right]) => comparePortableVersions(right, left))
    .map(([version, manifest]) => ({ version, manifest }))[0] ?? null
}

/** Source commit from the npm SLSA provenance, bound to the tarball digest and the expected repository. */
export function provenanceCommit(attestations, { name, version, integrity, repository }) {
  const slsa = attestations?.attestations?.find(item => item.predicateType === SLSA)
  if (!slsa) throw new Error(`${name}@${version} has no SLSA provenance`)
  const statement = JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64').toString('utf8'))
  const subject = statement.subject?.find(item => item.name === `pkg:npm/${name}@${version}`)
  const expectedDigest = Buffer.from(integrity.replace(/^sha512-/, ''), 'base64').toString('hex')
  if (subject?.digest?.sha512 !== expectedDigest) throw new Error(`${name}@${version} provenance does not describe the published tarball`)
  const source = statement.predicate?.buildDefinition?.resolvedDependencies?.[0]
  if (!String(source?.uri ?? '').startsWith(`git+https://github.com/${repository}@`)) throw new Error(`${name}@${version} was not built from ${repository}`)
  const commit = source?.digest?.gitCommit
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error(`${name}@${version} provenance has no source commit`)
  return commit
}

async function adoptOne(pin, coreVersion) {
  const packument = await json(`${REGISTRY}${encodeURIComponent(pin.package)}`)
  const selected = selectRelease(packument, coreVersion)
  // A new core usually arrives hours before the plugin's compatibility release; keep the pin and report it.
  if (!selected) return { pin, changed: false, waiting: true }
  if (comparePortableVersions(selected.version, pin.version) <= 0) return { pin, changed: false }
  const { version, manifest } = selected
  const url = `${REGISTRY}${pin.package}/-/${pin.package}-${version}.tgz`
  if (manifest.dist.tarball !== url) throw new Error(`${pin.package}@${version} tarball is not at the canonical registry path`)
  const bytes = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer())
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (integrity !== manifest.dist.integrity) throw new Error(`${pin.package}@${version} tarball integrity mismatch`)
  const reviewedCommit = provenanceCommit(await json(`${REGISTRY}-/npm/v1/attestations/${pin.package}@${version}`),
    { name: pin.package, version, integrity, repository: pin.repository })
  return {
    changed: true,
    bytes,
    pin: { ...pin, version, spec: version, url, sha256: createHash('sha256').update(bytes).digest('hex'), integrity, reviewedCommit },
  }
}

/** Rewrite the DEFAULT_PLUGINS (or PREVIEW_DEFAULT_PLUGINS) literal, keeping its field order and formatting. */
export function rewriteDefaultPluginsModule(source, pins, literalName = 'DEFAULT_PLUGINS') {
  const start = source.indexOf(`export const ${literalName} = Object.freeze([`)
  const end = source.indexOf('].map(Object.freeze))', start)
  if (start < 0 || end < 0) throw new Error(`${literalName} literal not found`)
  const entries = pins.map(pin => ({ name: pin.package, version: pin.version, spec: pin.spec, url: pin.url, sha256: pin.sha256,
    integrity: pin.integrity, license: pin.license, reviewedCommit: pin.reviewedCommit, filename: pin.filename }))
  const literal = JSON.stringify(entries, null, 2).slice(1, -1).replace(/^\n/, '').replace(/\n$/, '')
  return `${source.slice(0, start)}export const ${literalName} = Object.freeze([\n${literal}\n${source.slice(end)}`
}

async function refreshStoreLock(pins, archives, lockName = 'pnpm-lock.yaml') {
  const pnpmRoot = path.join(root, 'app/node_modules/pnpm')
  const pnpm = path.join(pnpmRoot, JSON.parse(await readFile(path.join(pnpmRoot, 'package.json'), 'utf8')).bin.pnpm)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-adopt-plugins-'))
  try {
    await mkdir(path.join(temporary, '.dsh-portable-archives'))
    const dependencies = {}
    for (const pin of pins) {
      await writeFile(path.join(temporary, '.dsh-portable-archives', pin.filename), archives.get(pin.package))
      dependencies[pin.package] = `file:.dsh-portable-archives/${pin.filename}`
    }
    await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ private: true, dependencies }))
    const lockFile = path.join(root, 'scripts/default-plugin-store', lockName)
    await copyFile(lockFile, path.join(temporary, 'pnpm-lock.yaml'))
    const result = spawnSync(process.execPath, [pnpm, 'install', '--lockfile-only', '--ignore-scripts',
      '--config.auto-install-peers=false', '--config.minimum-release-age=0'], { cwd: temporary, encoding: 'utf8', timeout: 180_000, windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Default-plugin store lock refresh failed: ${result.stderr || result.stdout}`)
    await copyFile(path.join(temporary, 'pnpm-lock.yaml'), lockFile)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function main() {
  const write = process.argv.includes('--write')
  const lockArg = process.argv.indexOf('--lock')
  const lockPath = path.join(root, lockArg > 0 ? process.argv[lockArg + 1] : 'upstream.lock.json')
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  const coreVersion = lock.dsh.version
  const keys = Object.keys(lock.defaultPlugins)
  const results = await Promise.all(keys.map(key => adoptOne(lock.defaultPlugins[key], coreVersion)))
  const summary = results.map(result => `${result.pin.package}@${result.pin.version}${result.changed ? ' (adopted)' : ''}`)
  const waiting = results.filter(result => result.waiting).map(result => result.pin.package)
  console.log(JSON.stringify({ core: coreVersion, plugins: summary, changed: results.some(result => result.changed), waiting }))
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    const lines = [`changed=${results.some(result => result.changed)}`, `waiting=${waiting.join(',')}`, `plugins=${summary.join(', ')}`]
    await writeFile(outputFile, `${lines.join('\n')}\n`, { flag: 'a' })
  }
  if (!write || !results.some(result => result.changed)) return
  keys.forEach((key, index) => { lock.defaultPlugins[key] = results[index].pin })
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  const modulePath = path.join(root, 'launcher/default-plugins.mjs')
  // The candidate lock pins its own reviewed plugins and offline store lock; the stable ones stay untouched.
  const preview = path.basename(lockPath) === 'upstream.preview.lock.json'
  await writeFile(modulePath, rewriteDefaultPluginsModule(await readFile(modulePath, 'utf8'), results.map(result => result.pin),
    preview ? 'PREVIEW_DEFAULT_PLUGINS' : 'DEFAULT_PLUGINS'))
  const archives = new Map()
  for (const result of results) {
    const bytes = result.bytes ?? Buffer.from(await (await fetch(result.pin.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== result.pin.sha256) throw new Error(`${result.pin.package}@${result.pin.version} archive does not match its pin`)
    archives.set(result.pin.package, bytes)
  }
  await refreshStoreLock(results.map(result => result.pin), archives, preview ? 'pnpm-lock.preview.yaml' : 'pnpm-lock.yaml')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
