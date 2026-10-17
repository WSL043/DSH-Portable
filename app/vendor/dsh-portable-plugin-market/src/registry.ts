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
 * How long to wait for the catalog to START answering.
 *
 * Headers arrive in one burst or not at all, so a fixed budget still fits
 * them. This used to cover the whole fetch, which was fine at 282KB and is
 * wrong now that the catalog runs past a megabyte: on a lossy proxied link
 * the body keeps trickling long after 15s, and a total timer cuts off a
 * download that was still moving and would have finished (measured: killed
 * at 15s on both attempts, 89.9s end-to-end when allowed to run). The body
 * is read under a stall watchdog instead — see readBodyWhileProgressing.
 */
const HEADERS_TIMEOUT_MS = 15_000

/**
 * How long the body may stay SILENT before we give up on it.
 *
 * Deliberately not a total budget. As long as bytes keep arriving, however
 * slowly, the read continues; the watchdog only fires on a download that has
 * actually stopped, which is the one failure a slow link cannot fake.
 */
const BODY_STALL_TIMEOUT_MS = 15_000

/**
 * How long the whole body may take, however much progress it keeps making.
 *
 * The stall watchdog can only act on a pause, so a mirror that sends one
 * byte inside every 15s window would hold the read open forever. 10 minutes
 * is ~7x the slowest measured full download (89.9s); a body still going
 * after that is broken, not slow, and the byte count in the message says
 * which of the two it was.
 */
const BODY_TOTAL_CEILING_MS = 600_000

/**
 * The most body bytes to accept before declaring the response not a catalog.
 *
 * The catalog passed 5 MB in September 2026; 256 MB is ~48x that — years of
 * headroom — and still a hard bound on memory, because the whole body is
 * buffered before parsing and a mirror streaming garbage at line speed
 * would otherwise grow that buffer until the process dies. backup.ts and
 * gist.ts cap their downloads for the same reason.
 */
const MAX_CATALOG_BODY_BYTES = 256 * 1024 * 1024

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
 * A verified snapshot is also persisted per profile for immediate/offline
 * display. The UI labels failed revalidation as stale; fetching a current
 * catalog does not imply its upstream GitHub/npm metrics are real-time.
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

      // Headers and body run on different clocks (dsh-market #766): the fixed budget covers only the wait for the
      // response to START; the body is read under a stall watchdog, because the catalog (now over 5 MB) takes longer
      // than any honest fixed budget on a slow link, and "bytes still moving" separates slow from stuck.
      const controller = new AbortController()
      const headersDeadline = setTimeout(() => {
        controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
      }, HEADERS_TIMEOUT_MS)
      let res: Response
      try {
        res = await marketFetch(REGISTRY_URL, { signal: controller.signal, headers })
      } finally {
        clearTimeout(headersDeadline)
      }
      if (res.status === 304) {
        // Only reachable when we sent a validator, so `served` is present.
        // Guarded anyway: answering a 304 with nothing to reuse would
        // otherwise surface as a confusing parse error on an empty body.
        if (snapshot === null) throw new Error('the catalog answered "not modified" with nothing to revalidate')
        return { registry: snapshot.registry, changed: false, checkedAt: new Date().toISOString() }
      }
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      const data = JSON.parse(new TextDecoder().decode(await readBodyWhileProgressing(res, BODY_STALL_TIMEOUT_MS))) as Registry
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

/**
 * Read a catalog body under a stall watchdog instead of a total budget.
 *
 * One timer for the whole fetch was the mistake both before and after #188:
 * at 4s it hid slowness behind a stale snapshot, at 15s it kills downloads
 * that are still moving. On a lossy proxied link the catalog body trickles
 * for far longer than 15s while never once going silent — measured 89.9s
 * end-to-end for a body the 15s cutoff had declared dead twice. This reader
 * lets a moving body run as long as it keeps moving, in either direction's
 * sense of "slow", and ends one that goes quiet for `stallMs` with a message
 * that says what actually happened and how much had arrived.
 *
 * The rejection comes from here, not from an abort: undici's abort message
 * ("This operation was aborted") cannot tell a user anything actionable, and
 * a bug report containing this string will contain the byte count too.
 *
 * Two backstops keep "still moving" from meaning "forever", because the
 * watchdog can only see pauses: a total ceiling for a body that trickles
 * without ever pausing, and a size cap for one that outruns any catalog.
 */
export function readBodyWhileProgressing(res: Response, stallMs: number): Promise<Uint8Array> {
  // The stand-in closes at once, so an absent body reads as "no body"
  // below instead of parking this reader on a stream that never ends.
  const reader = (res.body ?? new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })).getReader()
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let received = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      clearTimeout(ceiling)
      // Tell the origin we are done with the socket; its refusal is not ours to report.
      reader.cancel().catch(() => {})
      if (error !== undefined) reject(error)
      // An empty body otherwise surfaces as a JSON parse error, which tells
      // the user nothing about the network that caused it.
      else if (received === 0) reject(new Error('the catalog response carried no body'))
      else resolve(concatBytes(chunks))
    }
    const ceiling = setTimeout(
      () => {
        finish(new DOMException(
          `the catalog download did not finish within ${String(Math.round(BODY_TOTAL_CEILING_MS / 1000))}s (received ${String(received)} bytes)`,
          'TimeoutError',
        ))
      },
      BODY_TOTAL_CEILING_MS,
    )
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(
        () => {
          finish(new DOMException(
            `no new data for ${String(Math.round(stallMs / 1000))}s while downloading the catalog (received ${String(received)} bytes)`,
            'TimeoutError',
          ))
        },
        stallMs,
      )
    }
    const step = (): void => {
      reader.read().then((r) => {
        if (settled) return
        if (r.done || r.value === undefined) {
          finish()
          return
        }
        chunks.push(r.value)
        received += r.value.byteLength
        if (received > MAX_CATALOG_BODY_BYTES) {
          finish(new Error(
            `the catalog response grew past ${String(MAX_CATALOG_BODY_BYTES / 1024 / 1024)} MB without ending (received ${String(received)} bytes)`,
          ))
          return
        }
        arm()
        step()
      }, (error: unknown) => {
        finish(error instanceof Error ? error : new Error(String(error)))
      })
    }
    arm()
    step()
  })
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return all
}
