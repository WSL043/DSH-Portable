// Adopt the newest published default-plugin releases that declare support for the locked core.
// Each release must carry npm SLSA provenance built from the plugin's own repository; its integrity,
// sha256 and source commit are recorded exactly as a hand-reviewed pin would be. Nothing is adopted
// when no newer compatible release exists.
//   node scripts/adopt-default-plugins.mjs [--write] [--lock upstream.lock.json]
// Select upstream.preview.lock.json to update only preview pins and its store.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
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
    pin: { ...pin, releaseChannel: 'stable', version, spec: version, url, sha256: createHash('sha256').update(bytes).digest('hex'), integrity, reviewedCommit },
  }
}

/** Rewrite one known literal, retaining stable as the default for existing callers. */
export function rewriteDefaultPluginsModule(source, pins, exportName = 'DEFAULT_PLUGINS') {
  if (!['DEFAULT_PLUGINS', 'PREVIEW_DEFAULT_PLUGINS'].includes(exportName)) throw new Error(`Unknown default-plugin export: ${exportName}`)
  const declaration = `export const ${exportName} = Object.freeze([`
  const start = source.indexOf(declaration)
  const end = source.indexOf('].map(Object.freeze))', start)
  if (start < 0 || end < 0) throw new Error(`${exportName} literal not found`)
  const entries = pins.map(pin => ({ name: pin.package, version: pin.version, spec: pin.spec, url: pin.url, sha256: pin.sha256,
    integrity: pin.integrity, license: pin.license, reviewedCommit: pin.reviewedCommit, filename: pin.filename }))
  const literal = JSON.stringify(entries, null, 2).slice(1, -1).replace(/^\n/, '').replace(/\n$/, '')
  return `${source.slice(0, start)}${declaration}\n${literal}\n${source.slice(end)}`
}

async function refreshStoreLock(pins, archives, lockFile) {
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
    await copyFile(lockFile, path.join(temporary, 'pnpm-lock.yaml'))
    const result = spawnSync(process.execPath, [pnpm, 'install', '--lockfile-only', '--ignore-scripts',
      '--config.auto-install-peers=false', '--config.minimum-release-age=0'], { cwd: temporary, encoding: 'utf8', timeout: 180_000, windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Default-plugin store lock refresh failed: ${result.stderr || result.stdout}`)
    return await readFile(path.join(temporary, 'pnpm-lock.yaml'), 'utf8')
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

export async function main(args = process.argv.slice(2), adapters = {}) {
  const projectRoot = adapters.root ?? root
  const { values } = parseArgs({ args, strict: true, options: {
    write: { type: 'boolean', default: false }, lock: { type: 'string', default: 'upstream.lock.json' },
  } })
  const write = values.write
  const lockPath = path.resolve(projectRoot, values.lock)
  const relativeLock = path.relative(projectRoot, lockPath)
  const preview = relativeLock === 'upstream.preview.lock.json'
  if (write && relativeLock !== 'upstream.lock.json' && !preview) throw new Error('Unknown adoption write target: ' + values.lock)
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  const coreVersion = lock.dsh.version
  const keys = Object.keys(lock.defaultPlugins)
  const results = await Promise.all(keys.map(key => adoptOne(lock.defaultPlugins[key], coreVersion)))
  const changed = results.some(result => result.changed)
  const summary = results.map(result => `${result.pin.package}@${result.pin.version}${result.changed ? (write ? ' (adopted)' : ' (selected)') : ''}`)
  const waiting = results.filter(result => result.waiting).map(result => result.pin.package)
  if (write && changed) {
    const pins = results.map(result => result.pin)
    const modulePath = path.join(projectRoot, 'launcher/default-plugins.mjs')
    const moduleSource = rewriteDefaultPluginsModule(await readFile(modulePath, 'utf8'), pins,
      preview ? 'PREVIEW_DEFAULT_PLUGINS' : 'DEFAULT_PLUGINS')
    const storeLockPath = path.join(projectRoot, 'scripts/default-plugin-store', preview ? 'pnpm-lock.preview.yaml' : 'pnpm-lock.yaml')
    const archives = new Map()
    for (const result of results) {
      const bytes = result.bytes ?? Buffer.from(await (await fetch(result.pin.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer())
      if (createHash('sha256').update(bytes).digest('hex') !== result.pin.sha256) throw new Error(`${result.pin.package}@${result.pin.version} archive does not match its pin`)
      archives.set(result.pin.package, bytes)
    }
    const storeLock = await (adapters.refreshStoreLock ?? refreshStoreLock)(pins, archives, storeLockPath)
    keys.forEach((key, index) => { lock.defaultPlugins[key] = results[index].pin })
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    await writeFile(modulePath, moduleSource)
    await writeFile(storeLockPath, storeLock)
  }
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    const lines = [`changed=${changed}`, `waiting=${waiting.join(',')}`, `plugins=${summary.join(', ')}`]
    await writeFile(outputFile, `${lines.join('\n')}\n`, { flag: 'a' })
  }
  console.log(JSON.stringify({ core: coreVersion, plugins: summary, changed, waiting }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
