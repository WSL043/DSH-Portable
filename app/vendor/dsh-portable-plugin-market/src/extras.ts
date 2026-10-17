import type { Registry, RegistryPlugin } from './registry.ts'

/** What the Awesome DSH catalog knows about a plugin that the official index format has no field for. */
export interface OfficialExtra {
  /** npm downloads in the last 30 days. */
  d?: number
  stars?: number
  /** Curated preview images (https, GitHub-hosted, no SVG). */
  shots?: string[]
}

export interface OfficialExtras {
  byName: Record<string, OfficialExtra>
  /** Lower-case `owner/repo`, only for entries that own their whole repository. */
  byRepo: Record<string, OfficialExtra>
}

// A screenshot URL is a request carrying the user's IP, so only GitHub's own image hosting is accepted (same gate as the
// market's own cards).
const SHOT_HOSTS = new Set(['raw.githubusercontent.com', 'user-images.githubusercontent.com', 'camo.githubusercontent.com', 'github.com'])
const MAX_SHOTS = 20

function safeShots(urls: unknown): string[] {
  if (!Array.isArray(urls)) return []
  const shots: string[] = []
  for (const value of urls) {
    if (typeof value !== 'string') continue
    let parsed: URL
    try { parsed = new URL(value) } catch { continue }
    if (parsed.protocol !== 'https:' || !SHOT_HOSTS.has(parsed.hostname) || /\.svg$/iu.test(parsed.pathname)) continue
    if (!shots.includes(value)) shots.push(value)
    if (shots.length >= MAX_SHOTS) break
  }
  return shots
}

function extraOf(plugin: RegistryPlugin): OfficialExtra | null {
  const extra: OfficialExtra = {}
  if (typeof plugin.downloads === 'number' && Number.isFinite(plugin.downloads) && plugin.downloads > 0) extra.d = Math.round(plugin.downloads)
  if (typeof plugin.stars === 'number' && Number.isFinite(plugin.stars) && plugin.stars > 0) extra.stars = Math.round(plugin.stars)
  const shots = safeShots(plugin.screenshots)
  if (shots.length > 0) extra.shots = shots
  return Object.keys(extra).length === 0 ? null : extra
}

/** The repository a catalog entry owns completely, as `owner/repo`; null for a sub-directory of a larger repository. */
function ownRepo(url: string): string | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(url)
  return match === null ? null : `${match[1]}/${match[2]}`.toLowerCase()
}

export function buildOfficialExtras(registry: Pick<Registry, 'plugins'>): OfficialExtras {
  const byName: Record<string, OfficialExtra> = {}
  const byRepo: Record<string, OfficialExtra> = {}
  for (const plugin of registry.plugins) {
    const extra = extraOf(plugin)
    if (extra === null) continue
    if (typeof plugin.npm === 'string' && plugin.npm !== '' && !Object.hasOwn(byName, plugin.npm)) byName[plugin.npm] = extra
    const repo = typeof plugin.url === 'string' ? ownRepo(plugin.url) : null
    if (repo !== null && !Object.hasOwn(byRepo, repo)) byRepo[repo] = extra
  }
  return { byName, byRepo }
}
