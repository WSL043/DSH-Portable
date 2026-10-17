/**
 * The two install-spec shapes the official plugin market writes for an index entry that is not on npm: a GitHub
 * repository pinned to one commit (optionally a sub-directory of it) and a GitHub release tarball. Both name their origin
 * exactly, so the Portable market can look for the next one and roll back to the previous one. Pure string logic.
 */

export type IndexSource =
  | { kind: 'git'; repo: string; commit: string; path: string | null }
  | { kind: 'tarball'; url: string; repo: string }

const PINNED_GIT = /^git\+https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?#([0-9a-f]{40})(?:&path:\/([A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*))?$/u
const RELEASE_TARBALL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\/download\/[^/]+\/[^/]+\.(?:tgz|tar\.gz)$/iu

export function indexSourceOf(spec: string): IndexSource | null {
  const git = PINNED_GIT.exec(spec)
  if (git !== null) {
    const path = git[4] ?? null
    if (path !== null && path.split('/').some(segment => segment === '.' || segment === '..')) return null
    return { kind: 'git', repo: `${git[1]}/${git[2]}`, commit: git[3]!, path }
  }
  const tarball = RELEASE_TARBALL.exec(spec)
  if (tarball !== null) return { kind: 'tarball', url: spec, repo: `${tarball[1]}/${tarball[2]}` }
  return null
}

/** The spec that installs the same repository (and sub-directory) at another commit. */
export function indexGitTarget(source: Extract<IndexSource, { kind: 'git' }>, commit: string): string {
  return `git+https://github.com/${source.repo}.git#${commit}${source.path === null ? '' : `&path:/${source.path}`}`
}

/** The newest release tarball the catalog lists for the repository an installed tarball came from, or null. */
export function latestCatalogTarball(source: Extract<IndexSource, { kind: 'tarball' }>, entries: ReadonlyArray<{ tarball?: unknown }>): string | null {
  const wanted = source.repo.toLowerCase()
  const candidates: string[] = []
  for (const entry of entries) {
    if (typeof entry.tarball !== 'string') continue
    const candidate = indexSourceOf(entry.tarball)
    if (candidate !== null && candidate.kind === 'tarball' && candidate.repo.toLowerCase() === wanted) candidates.push(candidate.url)
  }
  // The same repository can host several plugins; stay on the tarball whose file name matches the installed one.
  const base = (url: string): string => url.slice(url.lastIndexOf('/') + 1).replace(/-\d[^/]*$/u, '')
  const same = candidates.filter(url => base(url) === base(source.url))
  const pool = same.length > 0 ? same : candidates
  return pool.length === 1 ? pool[0]! : null
}
