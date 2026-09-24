import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findDshInstallDir, satisfiesRange } from './check.ts'
import { marketFetch } from './net.ts'

export type Manifest = {
  name?: string
  version?: string
  engines?: { dsh?: string }
  dsh?: { client?: { inject?: string[] } }
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

export function assessUpdateRequirements(manifest: Manifest, hostVersion: string | null, hostPeers: Record<string, string | null>) {
  const mismatches: Array<{ name: string; range: string; resolved: string }> = []
  const check = (name: string, range: unknown, resolved: string | null | undefined) => {
    if (typeof range === 'string' && typeof resolved === 'string' && satisfiesRange(resolved, range) === false) {
      mismatches.push({ name, range, resolved })
    }
  }
  check('dsh', manifest.engines?.dsh, hostVersion)
  const injected = new Set(manifest.dsh?.client?.inject ?? [])
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    // npm marks some client peers optional because DSH supplies them at run
    // time. A plugin that explicitly injects one still requires its declared
    // version; ignoring the optional flag offers a build for the wrong UI.
    if (name.startsWith('@deepseek-ai/dsh-')
      && (manifest.peerDependenciesMeta?.[name]?.optional !== true || injected.has(name))) {
      check(name, range, hostPeers[name])
    }
  }
  return mismatches
}

function versionAt(filename: string): string | null {
  try {
    const value = JSON.parse(readFileSync(filename, 'utf8')).version
    return typeof value === 'string' ? value : null
  } catch { return null }
}

/** Reuse metadata already fetched for a registry tag instead of fetching it again. */
export function assessPublishedManifest(
  name: string,
  version: string,
  manifest: Manifest,
  adapters = { findHost: findDshInstallDir, versionAt },
) {
  if (!manifest || manifest.name !== name || manifest.version !== version) {
    return { status: 'unknown' as const, mismatches: [] }
  }
  const host = adapters.findHost()
  if (!host) return { status: 'unknown' as const, mismatches: [] }
  const peers: Record<string, string | null> = {}
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (/^@deepseek-ai\/dsh-[a-z0-9._-]+$/.test(peer)) {
      peers[peer] = adapters.versionAt(join(host, 'node_modules', peer, 'package.json'))
    }
  }
  const mismatches = assessUpdateRequirements(manifest, adapters.versionAt(join(host, 'package.json')), peers)
  return { status: mismatches.length ? 'incompatible' as const : 'checked' as const, mismatches }
}

/** Inspect the exact npm release about to be installed against this running capsule. */
export async function preflightNpmUpdate(name: string, version: string, adapters = { findHost: findDshInstallDir, fetch: marketFetch, versionAt }) {
  if (!adapters.findHost()) return { status: 'unknown' as const, mismatches: [] }
  try {
    const response = await adapters.fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { status: 'unknown' as const, mismatches: [] }
    return assessPublishedManifest(name, version, await response.json() as Manifest, adapters)
  } catch { return { status: 'unknown' as const, mismatches: [] } }
}
