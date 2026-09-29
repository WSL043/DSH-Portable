import { marketFetch } from './net.ts'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Single-package fallback count over the same rolling window; complete means that full window was returned. */
export interface DownloadTotal { downloads: number; start: string; end: string; complete: boolean }
export interface DownloadTotalsTable {
  generatedAt: string
  /** True when every package selected for this table has a count in the stated window. */
  complete: boolean
  /** Inclusive rolling-window dates, both in UTC. */
  start: string
  end: string
  totals: Record<string, number>
}
const DAY = 86400000
/** Query one rolling 365-day window: today and the previous 364 UTC dates. */
export const DOWNLOAD_TOTALS_WINDOW_DAYS = 364
/** 100 is below npm's documented 128-package bulk limit. */
export const DOWNLOAD_TOTALS_BATCH_SIZE = 100
/** Keep a full catalog refresh near 120 calls, with a hard ceiling of 150. */
export const DOWNLOAD_TOTALS_MAX_REQUESTS = 150
export const DOWNLOAD_TOTALS_MAX_SCOPE_PACKAGES = 100
export const DOWNLOAD_TOTALS_MAX_CONCURRENCY = 4
export const DOWNLOAD_TOTALS_REQUEST_TIMEOUT_MS = 10_000
export const DOWNLOAD_TOTALS_REFRESH_TIMEOUT_MS = 120_000
const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))

function utcDate(value: number): string { return new Date(value).toISOString().slice(0, 10) }
/** UTC date range included in cumulative totals, with today's date as the endpoint. */
export function downloadTotalsWindow(now: number): [string, string] {
  const end = utcDate(now)
  return [utcDate(Date.parse(`${end}T00:00:00Z`) - DOWNLOAD_TOTALS_WINDOW_DAYS * DAY), end]
}

function isPackageName(value: string): boolean {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(value) && value.length <= 214
}

/** Inclusive periods of no more than 365 days, as required for npm bulk queries. */
export function downloadTotalsPeriods(start: string, end: string): [string, string][] {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Invalid download period')
  const periods: [string, string][] = []
  for (let cursor = Date.parse(`${start}T00:00:00Z`); utcDate(cursor) <= end;) {
    const last = Math.min(Date.parse(`${end}T00:00:00Z`), cursor + 364 * DAY)
    periods.push([utcDate(cursor), utcDate(last)])
    cursor = last + DAY
  }
  return periods
}

export interface DownloadTotalsWorkUnit { kind: 'bulk' | 'scope'; packages: string[] }
export interface DownloadTotalsPlan {
  periods: [string, string][]
  units: DownloadTotalsWorkUnit[]
  bulkBatches: number
  scopePackages: number
  requestCount: number
  omittedPackages: string[]
}

/** Keep every valid unscoped npm package; query only the catalog's top 100 scoped packages by 30-day downloads. */
export function selectDownloadTotalsPackages(plugins: readonly {
  npm?: string | null
  downloads?: number | null
  stars?: number | null
}[]): string[] {
  const plain = new Set<string>()
  const scoped = new Map<string, { downloads: number; stars: number }>()
  for (const plugin of plugins) {
    const name = typeof plugin.npm === 'string' ? plugin.npm.trim() : ''
    if (!isPackageName(name)) continue
    if (!name.startsWith('@')) {
      plain.add(name)
      continue
    }
    if (!Number.isSafeInteger(plugin.downloads) || (plugin.downloads as number) < 0) continue
    const candidate = {
      downloads: plugin.downloads as number,
      stars: Number.isSafeInteger(plugin.stars) && (plugin.stars as number) >= 0 ? plugin.stars as number : -1,
    }
    const current = scoped.get(name)
    if (current === undefined || candidate.downloads > current.downloads
      || (candidate.downloads === current.downloads && candidate.stars > current.stars)) {
      scoped.set(name, candidate)
    }
  }
  const topScoped = [...scoped]
    .sort(([leftName, left], [rightName, right]) => right.downloads - left.downloads
      || right.stars - left.stars || leftName.localeCompare(rightName))
    .slice(0, DOWNLOAD_TOTALS_MAX_SCOPE_PACKAGES)
    .map(([name]) => name)
  return [...plain, ...topScoped]
}

/** Pure planner shared by the bounded production scheduler and its fixtures. */
export function planDownloadTotals(packages: readonly string[], start: string, end: string, maxRequests = DOWNLOAD_TOTALS_MAX_REQUESTS): DownloadTotalsPlan {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0) throw new Error('Invalid request limit')
  const periods = downloadTotalsPeriods(start, end)
  const names = [...new Set(packages)].filter(isPackageName)
  const plain = names.filter(name => !name.startsWith('@'))
  const scoped = names.filter(name => name.startsWith('@'))
  const allUnits: DownloadTotalsWorkUnit[] = []
  for (let offset = 0; offset < plain.length; offset += DOWNLOAD_TOTALS_BATCH_SIZE) {
    allUnits.push({ kind: 'bulk', packages: plain.slice(offset, offset + DOWNLOAD_TOTALS_BATCH_SIZE) })
  }
  for (const name of scoped) allUnits.push({ kind: 'scope', packages: [name] })
  const requestLimit = Math.min(maxRequests, DOWNLOAD_TOTALS_MAX_REQUESTS)
  const cost = periods.length
  const units = cost === 0 ? [] : allUnits.slice(0, Math.floor(requestLimit / cost))
  const included = new Set(units.flatMap(unit => unit.packages))
  return {
    periods,
    units,
    bulkBatches: units.filter(unit => unit.kind === 'bulk').length,
    scopePackages: units.filter(unit => unit.kind === 'scope').length,
    requestCount: units.length * cost,
    omittedPackages: names.filter(name => !included.has(name)),
  }
}

export interface DownloadTotalsRefreshStats {
  packages: number
  periods: number
  bulkBatches: number
  scopePackages: number
  requestLimit: number
  scheduledRequests: number
  requests: number
  successfulRequests: number
  failedRequests: number
  peakConcurrency: number
  elapsedMs: number
}

interface DownloadTotalsCache extends DownloadTotalsTable {
  schemaVersion: 1
  namesDigest: string
}

export interface DownloadTotalsOptions {
  now?: () => number
  maxRequests?: number
  requestTimeoutMs?: number
  refreshTimeoutMs?: number
  onRefresh?: (stats: DownloadTotalsRefreshStats) => void
}

function totalsCacheFile(registryCacheFile: string): string {
  return join(dirname(registryCacheFile), 'download-totals-v1.json')
}

function namesDigest(names: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([...names].sort())).digest('hex')
}

function publicTable(cache: DownloadTotalsCache, names: readonly string[]): DownloadTotalsTable {
  const totals: Record<string, number> = {}
  for (const name of names) {
    const value = cache.totals[name]
    if (Number.isSafeInteger(value) && value >= 0) totals[name] = value
  }
  return {
    generatedAt: cache.generatedAt,
    complete: cache.complete && names.every(name => Object.hasOwn(totals, name)),
    start: cache.start,
    end: cache.end,
    totals,
  }
}

async function readTotalsCache(file: string): Promise<DownloadTotalsCache | null> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<DownloadTotalsCache>
    if (value.schemaVersion !== 1 || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
      || typeof value.namesDigest !== 'string' || !/^[a-f\d]{64}$/.test(value.namesDigest)
      || typeof value.complete !== 'boolean' || !validDate(value.start) || !validDate(value.end)
      || typeof value.totals !== 'object' || value.totals === null || Array.isArray(value.totals)) return null
    const totals: Record<string, number> = {}
    for (const [name, count] of Object.entries(value.totals)) {
      if (isPackageName(name) && Number.isSafeInteger(count) && (count as number) >= 0) totals[name] = count as number
    }
    return {
      schemaVersion: 1,
      generatedAt: value.generatedAt,
      namesDigest: value.namesDigest,
      complete: value.complete,
      start: value.start,
      end: value.end,
      totals,
    }
  } catch {
    return null
  }
}

async function writeTotalsCache(file: string, cache: DownloadTotalsCache, now: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.${String(now)}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(cache)}\n`, 'utf8')
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

/**
 * One table per current catalog: plain npm packages use bounded bulk calls,
 * scoped packages use single-package calls, and no failure blocks another
 * batch. Results are coalesced and cached per day in memory and beside the
 * profile's existing registry snapshot.
 */
export function createDownloadTotalsTable(fetcher = marketFetch, options: DownloadTotalsOptions = {}) {
  const now = options.now ?? Date.now
  const maxRequests = Math.min(options.maxRequests ?? DOWNLOAD_TOTALS_MAX_REQUESTS, DOWNLOAD_TOTALS_MAX_REQUESTS)
  const requestTimeoutMs = Math.min(options.requestTimeoutMs ?? DOWNLOAD_TOTALS_REQUEST_TIMEOUT_MS, DOWNLOAD_TOTALS_REQUEST_TIMEOUT_MS)
  const refreshTimeoutMs = Math.min(options.refreshTimeoutMs ?? DOWNLOAD_TOTALS_REFRESH_TIMEOUT_MS, DOWNLOAD_TOTALS_REFRESH_TIMEOUT_MS)
  const memory = new Map<string, DownloadTotalsCache>()
  const pending = new Map<string, { signature: string; promise: Promise<DownloadTotalsTable> }>()

  const get = async (plugins: readonly { npm?: string | null; downloads?: number | null; stars?: number | null }[], registryCacheFile?: string): Promise<DownloadTotalsTable> => {
    const names = selectDownloadTotalsPackages(plugins)
    const signature = namesDigest(names)
    const nowAtStart = now()
    const today = utcDate(nowAtStart)
    const [start, end] = downloadTotalsWindow(nowAtStart)
    const profileKey = registryCacheFile === undefined ? '<memory>' : resolve(registryCacheFile)
    const cachedMemory = memory.get(profileKey)
    if (cachedMemory?.generatedAt.slice(0, 10) === today && cachedMemory.start === start && cachedMemory.end === end
      && cachedMemory.namesDigest === signature) {
      return publicTable(cachedMemory, names)
    }
    const existing = pending.get(profileKey)
    if (existing !== undefined) {
      if (existing.signature === signature) return existing.promise
      await existing.promise.catch(() => {})
      return get(plugins, registryCacheFile)
    }

    const request = (async () => {
      const file = registryCacheFile === undefined ? undefined : totalsCacheFile(registryCacheFile)
      const cached = file === undefined ? memory.get(profileKey) ?? null : await readTotalsCache(file)
      if (cached?.generatedAt.slice(0, 10) === today && cached.start === start && cached.end === end
        && cached.namesDigest === signature) {
        memory.set(profileKey, cached)
        return publicTable(cached, names)
      }

      const sameDay = cached?.generatedAt.slice(0, 10) === today && cached.start === start && cached.end === end
      const totals: Record<string, number> = {}
      if (sameDay && cached !== null) {
        for (const name of names) if (Object.hasOwn(cached.totals, name)) totals[name] = cached.totals[name]
      }
      const remaining = names.filter(name => !Object.hasOwn(totals, name))
      const plan = remaining.length === 0
        ? { periods: [] as [string, string][], units: [] as DownloadTotalsWorkUnit[], bulkBatches: 0, scopePackages: 0, requestCount: 0, omittedPackages: [] as string[] }
        : planDownloadTotals(remaining, start, end, maxRequests)
      const startedAt = now()
      const periodResults = plan.units.map(() => plan.periods.map(() => null as Map<string, number> | null))
      const tasks = plan.units.flatMap((unit, unitIndex) => plan.periods.map((period, periodIndex) => ({ unit, unitIndex, period, periodIndex })))
      const deadline = AbortSignal.timeout(refreshTimeoutMs)
      let nextTask = 0
      let active = 0
      let peakConcurrency = 0
      let requests = 0
      let successfulRequests = 0
      let failedRequests = 0

      const fetchPeriod = async (unit: DownloadTotalsWorkUnit, [start, stop]: [string, string]): Promise<Map<string, number>> => {
        const packagePath = unit.kind === 'bulk'
          ? unit.packages.map(encodeURIComponent).join(',')
          : encodeURIComponent(unit.packages[0])
        const response = await fetcher(`https://api.npmjs.org/downloads/point/${start}:${stop}/${packagePath}`, {
          signal: AbortSignal.any([deadline, AbortSignal.timeout(requestTimeoutMs)]),
        })
        if (!response.ok) throw new Error(`npm statistics HTTP ${response.status}`)
        const body = await response.json() as Record<string, unknown>
        const values = new Map<string, number>()
        for (const name of unit.packages) {
          const result = unit.kind === 'bulk' ? body?.[name] : body
          if (typeof result !== 'object' || result === null) throw new Error(`Missing npm statistics for ${name}`)
          const record = result as { package?: unknown; start?: unknown; end?: unknown; downloads?: unknown }
          if (record.package !== name || record.start !== start || record.end !== stop
            || !Number.isSafeInteger(record.downloads) || (record.downloads as number) < 0) {
            throw new Error(`Invalid npm statistics for ${name}`)
          }
          values.set(name, record.downloads as number)
        }
        return values
      }

      const worker = async (): Promise<void> => {
        while (nextTask < tasks.length && !deadline.aborted) {
          const index = nextTask++
          const task = tasks[index]
          active++
          peakConcurrency = Math.max(peakConcurrency, active)
          requests++
          try {
            periodResults[task.unitIndex][task.periodIndex] = await fetchPeriod(task.unit, task.period)
            successfulRequests++
          } catch {
            failedRequests++
          } finally {
            active--
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(DOWNLOAD_TOTALS_MAX_CONCURRENCY, tasks.length) }, () => worker()))

      for (let unitIndex = 0; unitIndex < plan.units.length; unitIndex++) {
        const unitPeriods = periodResults[unitIndex]
        if (unitPeriods.some(period => period === null)) continue
        for (const name of plan.units[unitIndex].packages) {
          let sum = 0
          for (const period of unitPeriods) sum += period!.get(name) ?? 0
          if (Number.isSafeInteger(sum)) totals[name] = sum
        }
      }

      const table: DownloadTotalsCache = {
        schemaVersion: 1,
        generatedAt: new Date(now()).toISOString(),
        namesDigest: signature,
        complete: names.every(name => Object.hasOwn(totals, name)),
        start,
        end,
        totals,
      }
      memory.set(profileKey, table)
      if (file !== undefined) await writeTotalsCache(file, table, now()).catch(() => {})
      try {
        options.onRefresh?.({
          packages: names.length,
          periods: plan.periods.length,
          bulkBatches: plan.bulkBatches,
          scopePackages: plan.scopePackages,
          requestLimit: maxRequests,
          scheduledRequests: plan.requestCount,
          requests,
          successfulRequests,
          failedRequests,
          peakConcurrency,
          elapsedMs: Math.max(0, now() - startedAt),
        })
      } catch { /* Metrics are observational; they never fail a catalog response. */ }
      return publicTable(table, names)
    })().finally(() => {
      if (pending.get(profileKey)?.promise === request) pending.delete(profileKey)
    })
    pending.set(profileKey, { signature, promise: request })
    return request
  }

  return get
}

export const getDownloadTotalsTable = createDownloadTotalsTable()

/** Bounded, coalesced, daily cache. Statistics never block catalog delivery. */
export function createDownloadTotals(fetcher = marketFetch, now = Date.now) {
  const cache = new Map<string, { at: number; value: DownloadTotal }>()
  const pending = new Map<string, Promise<DownloadTotal>>()
  let active = 0
  const waiting: (() => void)[] = []
  async function json(url: string): Promise<any> {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`npm statistics HTTP ${response.status}`)
    return response.json()
  }
  async function calculate(name: string): Promise<DownloadTotal> {
    if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve))
    else active++
    try {
      const encoded = encodeURIComponent(name)
      const [start, end] = downloadTotalsWindow(now())
      const result = await json(`https://api.npmjs.org/downloads/point/${start}:${end}/${encoded}`)
      if (result.package !== name || result.start !== start || result.end !== end
        || !Number.isSafeInteger(result.downloads) || result.downloads < 0) throw new Error('Incomplete npm statistics')
      return { downloads: result.downloads, start, end, complete: true }
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
  return (name: string): Promise<DownloadTotal> => {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214) return Promise.reject(new Error('Invalid npm package'))
    const saved = cache.get(name)
    if (saved && now() - saved.at < DAY) return Promise.resolve(saved.value)
    const running = pending.get(name)
    if (running) return running
    if (pending.size >= 128) return Promise.reject(new Error('Statistics queue busy'))
    const task = calculate(name).then(value => {
      if (cache.size >= 256) cache.delete(cache.keys().next().value!)
      cache.set(name, { at: now(), value })
      return value
    }).finally(() => pending.delete(name))
    pending.set(name, task)
    return task
  }
}

export const getDownloadTotal = createDownloadTotals()
