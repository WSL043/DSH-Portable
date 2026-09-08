import { appendFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_PLUGINS } from '../launcher/default-plugins.mjs'
import { comparePortableVersions } from '../launcher/update-core.mjs'

const REGISTRY_BASE = 'https://registry.npmjs.org/'
const REGISTRY_TIMEOUT_MS = 30_000
const DIST_TAGS = ['latest', 'beta', 'next', 'alpha', 'rc']
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const REGISTRY_HEADERS = {
  accept: 'application/json',
  'user-agent': 'DSH-Portable-default-plugin-upstream-report',
}

function versionsOf(registry) {
  return registry?.versions !== null && typeof registry?.versions === 'object' ? registry.versions : {}
}

function publishedVersion(registry, tag) {
  const version = registry?.['dist-tags']?.[tag]
  if (typeof version !== 'string' || !SEMVER.test(version)) return null
  const metadata = versionsOf(registry)[version]
  if (metadata === null || typeof metadata !== 'object' || metadata.deprecated || metadata.dist?.deprecated) return null
  try {
    comparePortableVersions(version, version)
  } catch {
    return null
  }
  return { version, tag }
}

function selectUpstream(registry) {
  let selected = null
  for (const tag of DIST_TAGS) {
    const candidate = publishedVersion(registry, tag)
    if (candidate !== null && (selected === null || comparePortableVersions(candidate.version, selected.version) > 0)) {
      selected = candidate
    }
  }
  return selected
}

function verifyPinnedIntegrity(pinned, registry) {
  const observed = versionsOf(registry)[pinned.version]?.dist?.integrity
  if (typeof observed !== 'string' || observed.length === 0) {
    throw new Error(`Registry metadata is missing dist integrity for pinned default plugin ${pinned.name}@${pinned.version}.`)
  }
  if (observed !== pinned.integrity) {
    throw new Error(`Registry dist integrity changed for pinned default plugin ${pinned.name}@${pinned.version}.`)
  }
}

/**
 * Evaluate one reviewed default plugin against an npm packument.  This is a
 * read-only decision: a newer result only requests compatibility review.
 */
export function evaluateDefaultPluginUpstream({ pinned, registry } = {}) {
  if (pinned === null || typeof pinned !== 'object' || typeof pinned.name !== 'string' || typeof pinned.version !== 'string') {
    throw new TypeError('A pinned default plugin is required.')
  }
  if (!SEMVER.test(pinned.version)) throw new Error(`Pinned default plugin ${pinned.name} has an invalid semantic version.`)
  if (typeof pinned.integrity !== 'string' || pinned.integrity.length === 0) {
    throw new Error(`Pinned default plugin ${pinned.name}@${pinned.version} has no recorded integrity.`)
  }
  verifyPinnedIntegrity(pinned, registry)

  const selected = selectUpstream(registry)
  const newer = selected !== null && comparePortableVersions(selected.version, pinned.version) > 0
  return {
    name: pinned.name,
    pinned: pinned.version,
    selected: newer ? selected.version : pinned.version,
    channel: newer ? (selected.version.includes('-') ? 'prerelease' : 'stable') : (pinned.version.includes('-') ? 'prerelease' : 'stable'),
    tag: selected && comparePortableVersions(selected.version, pinned.version) >= 0 ? selected.tag : null,
    changed: newer,
    requiresCompatibilityReview: newer,
  }
}

async function fetchRegistry(name) {
  const url = `${REGISTRY_BASE}${encodeURIComponent(name)}`
  const response = await fetch(url, {
    headers: { ...REGISTRY_HEADERS },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

function outputPath(argv) {
  const index = argv.indexOf('--output')
  if (index >= 0) {
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--output requires a file path.')
    return argv[index + 1]
  }
  const inline = argv.find(value => value.startsWith('--output='))
  if (inline === undefined) return null
  const value = inline.slice('--output='.length)
  if (!value) throw new Error('--output requires a file path.')
  return value
}

async function main(argv = process.argv.slice(2)) {
  const report = []
  for (const pinned of DEFAULT_PLUGINS) report.push(evaluateDefaultPluginUpstream({ pinned, registry: await fetchRegistry(pinned.name) }))
  const json = `${JSON.stringify(report, null, 2)}\n`
  const destination = outputPath(argv)
  if (destination) await writeFile(path.resolve(destination), json, 'utf8')
  process.stdout.write(json)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${json}\`\`\`\n`, 'utf8')
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
