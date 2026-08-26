import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { configuredProxy, marketFetch } from './net.ts'

export interface RegistryPlugin {
  name: string
  owner: string
  url: string
  page?: string
  category: string | string[]
  description: Record<string, string>
  npm?: string | null
  /** Optional prebuilt archive published by this entry's own GitHub repository. */
  tarball?: string | null
  stars?: number | null
  /**
   * npm downloads in the last 30 days, when the entry has a published
   * package. `null`/absent means "no npm package" — a coverage gap, not a
   * zero — so sorting must not read it as "less popular than 0".
   */
  downloads?: number | null
  install: string
  added: string
  /**
   * Catalog-side deprecation flags (#60): supplied by awesome-dsh-plugin,
   * absent for every normal entry — the market only consumes them, so a
   * catalog without the fields behaves exactly as before.
   */
  deprecated?: boolean
  /** Catalog name of the suggested replacement plugin, when deprecated. */
  replacement?: string
  screenshots?: string[]
}

export interface Registry {
  updated: string
  count: number
  categories: Record<string, Record<string, string>>
  plugins: RegistryPlugin[]
}

/** Tolerate the catalog's legacy single category and future multi-category form. */
export function hasPluginCategory(plugin: Pick<RegistryPlugin, 'category'>, category: string): boolean {
  return Array.isArray(plugin.category) ? plugin.category.includes(category) : plugin.category === category
}

/**
 * Where the curated list comes from. Overridable through the process
 * environment ONLY — the layer-3 e2e points it at a local fixture catalog so
 * the install route can be driven end to end without publishing anything.
 *
 * This does not weaken the install route's registry check. That check exists
 * to stop a malicious PAGE from POSTing an arbitrary source at the local
 * server; a page cannot set environment variables, and anyone who can set
 * this process's environment already controls the process. What the override
 * changes is WHICH list is curated, never WHETHER the check runs.
 */
const REGISTRY_URL = process.env.DSHM_REGISTRY_URL ?? 'https://awesome-dsh-plugin.com/plugins.json'

/**
 * How long to wait for the catalog.
 *
 * Generous on purpose. It used to be 4s with a bundled snapshot behind it,
 * so a slow link quietly became a 39%-smaller catalog. Now that a failure is
 * reported rather than papered over, cutting off a link that WOULD have
 * answered is the expensive mistake — 282KB over TLS from a far-away network
 * is not a 4-second job.
 */
const FETCH_TIMEOUT_MS = 15_000

/**
 * The catalog we were last served, with the validator identifying it.
 *
 * This is NOT the cache that was removed, and the difference is the whole
 * point. That cache SKIPPED the request for an hour and answered from
 * memory — it asserted freshness without ever asking. This asks the origin
 * every single time; the validator only lets the origin answer "still the
 * same" (304) instead of resending a megabyte. Freshness is verified on
 * every call either way, so `data` below is only ever returned when the
 * server has just confirmed it is current.
 *
 * In memory rather than on disk: a restart is rare enough that paying one
 * full download for it costs nothing, and a file would be one more thing
 * that can be found on a machine and mistaken for the catalog itself.
 *
 * Measured against the live origin (GitHub Pages behind Fastly, which
 * serves both `etag` and `last-modified`): 295 KB and 1.3s unconditional,
 * 0 bytes and 0.5s for a 304. The reporter whose fetch took 9.9s was
 * downloading the full 1.07 MB every time they opened the market.
 */
interface RegistrySnapshot {
  schemaVersion: 1
  source: string
  savedAt: string
  etag: string | null
  modified: string | null
  digest: string
  registry: Registry
}

export interface RegistryRevalidation {
  registry: Registry
  changed: boolean
  checkedAt: string
}

const served = new Map<string, RegistrySnapshot>()
const inflight = new Map<string, Promise<RegistryRevalidation>>()

function cacheKey(cacheFile?: string): string {
  return cacheFile === undefined ? '<memory>' : resolve(cacheFile)
}

function validRegistry(value: unknown): value is Registry {
  return typeof value === 'object' && value !== null
    && Array.isArray((value as Registry).plugins)
    && (value as Registry).plugins.length > 0
}

function registryDigest(registry: Registry): string {
  return createHash('sha256').update(JSON.stringify(registry)).digest('hex')
}

async function readSnapshotFile(cacheFile: string): Promise<RegistrySnapshot | null> {
  try {
    const value = JSON.parse(await readFile(cacheFile, 'utf8')) as Partial<RegistrySnapshot>
    if (value.schemaVersion !== 1 || value.source !== REGISTRY_URL || !validRegistry(value.registry)) return null
    if (typeof value.savedAt !== 'string' || typeof value.digest !== 'string') return null
    if (registryDigest(value.registry) !== value.digest) return null
    return {
      schemaVersion: 1,
      source: REGISTRY_URL,
      savedAt: value.savedAt,
      etag: typeof value.etag === 'string' ? value.etag : null,
      modified: typeof value.modified === 'string' ? value.modified : null,
      digest: value.digest,
      registry: value.registry,
    }
  } catch {
    return null
  }
}

async function currentSnapshot(cacheFile?: string): Promise<RegistrySnapshot | null> {
  const key = cacheKey(cacheFile)
  const memory = served.get(key)
  if (memory !== undefined) return memory
  if (cacheFile === undefined) return null
  const disk = await readSnapshotFile(cacheFile)
  if (disk !== null) served.set(key, disk)
  return disk
}

async function writeSnapshotFile(cacheFile: string, snapshot: RegistrySnapshot): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true })
  const temporary = `${cacheFile}.${String(process.pid)}.${String(Date.now())}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, 'utf8')
    await rename(temporary, cacheFile)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

/**
 * Drop what we remember, so the next call is unconditional.
 *
 * Exists for tests: the memo is module state, and a spec that asserted a
 * 304 would otherwise leak a validator into the next one.
 */
export function forgetCatalog(): void {
  served.clear()
  inflight.clear()
}

/**
 * Read the last verified catalog without doing network I/O. This is a display
 * snapshot only: install and update routes still revalidate before trusting a
 * catalog entry.
 */
export async function readRegistrySnapshot(cacheFile?: string): Promise<{ registry: Registry; savedAt: string } | null> {
  const snapshot = await currentSnapshot(cacheFile)
  return snapshot === null ? null : { registry: snapshot.registry, savedAt: snapshot.savedAt }
}

/** Revalidate the catalog once, coalescing concurrent callers per profile. */
export async function revalidateRegistry(options: { cacheFile?: string } = {}): Promise<RegistryRevalidation> {
  const key = cacheKey(options.cacheFile)
  const pending = inflight.get(key)
  if (pending !== undefined) return pending

  const request = revalidateRegistryInner(options.cacheFile).finally(() => {
    if (inflight.get(key) === request) inflight.delete(key)
  })
  inflight.set(key, request)
  return request
}

async function revalidateRegistryInner(cacheFile?: string): Promise<RegistryRevalidation> {
  const started = Date.now()
  let last: unknown
  const key = cacheKey(cacheFile)
  let snapshot = await currentSnapshot(cacheFile)
  // Two attempts. A catalog fetch crossing a long, lossy path fails
  // transiently often enough that one retry is worth more than the second
  // or two it costs — and with nothing behind this call any more, a
  // transient failure is a market with no plugins in it.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // ETag first: it is exact, while a date has one-second resolution and
      // a catalog republished twice within the same second would validate
      // as unchanged. Only one is sent — an origin given both must satisfy
      // both, which turns a weak ETag match into an unnecessary 200.
      const headers: Record<string, string> = {}
      if (snapshot?.etag != null) headers['if-none-match'] = snapshot.etag
      else if (snapshot?.modified != null) headers['if-modified-since'] = snapshot.modified

      const res = await marketFetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers })
      if (res.status === 304) {
        // Only reachable when we sent a validator, so `served` is present.
        // Guarded anyway: answering a 304 with nothing to reuse would
        // otherwise surface as a confusing parse error on an empty body.
        if (snapshot === null) throw new Error('the catalog answered "not modified" with nothing to revalidate')
        return { registry: snapshot.registry, changed: false, checkedAt: new Date().toISOString() }
      }
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      const data = (await res.json()) as Registry
      if (!validRegistry(data)) throw new Error('the catalog came back empty')
      const digest = registryDigest(data)
      const next: RegistrySnapshot = {
        schemaVersion: 1,
        source: REGISTRY_URL,
        savedAt: new Date().toISOString(),
        etag: res.headers.get('etag'),
        modified: res.headers.get('last-modified'),
        digest,
        registry: data,
      }
      const changed = snapshot?.digest !== digest
      served.set(key, next)
      snapshot = next
      if (cacheFile !== undefined) await writeSnapshotFile(cacheFile, next)
      return { registry: data, changed, checkedAt: next.savedAt }
    } catch (error) {
      last = error
    }
  }
  throw new Error(describeFetchFailure(last, Date.now() - started))
}

/** Revalidate and return the verified catalog. */
export async function loadRegistry(options: { cacheFile?: string } = {}): Promise<Registry> {
  return (await revalidateRegistry(options)).registry
}

/**
 * A catalog failure with the facts needed to classify it, in the message
 * itself.
 *
 * The market shows this string and the log export carries it, so it is the
 * whole of what a bug report will contain. "The operation was aborted due to
 * timeout" alone cannot distinguish a slow link from a blocked one from a
 * proxy this process cannot use — and Node's `fetch` ignores HTTP_PROXY
 * entirely (measured on Node 25), so a machine whose only route out is a
 * proxy fails here every time while every other tool on it works.
 */
export function describeFetchFailure(error: unknown, elapsedMs: number): string {
  const reason = error instanceof Error ? error.message : String(error)
  const proxy = configuredProxy()
  const parts = [`${reason} (${String(Math.round(elapsedMs / 1000))}s, 2 attempts)`]
  if (proxy !== null) {
    parts.push(`tried through the configured proxy ${proxy.replace(/\/\/[^@]*@/u, '//***@')}`)
  }
  return parts.join(' · ')
}
