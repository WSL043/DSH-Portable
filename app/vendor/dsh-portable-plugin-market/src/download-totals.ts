import { marketFetch } from './net.ts'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export interface DownloadTotal { downloads: number; start: string; end: string; complete: boolean }
export interface DownloadTotalsTable {
  generatedAt: string
  complete: boolean
  /** The fixed lower bound and latest complete UTC day included in totals. */
  start: string
  end: string
  totals: Record<string, number>
}
const DAY = 86400000
const EARLIEST = '2015-01-10'
/** One bounded cumulative window keeps the whole-market refresh practical. */
export const DOWNLOAD_TOTALS_START = '2025-01-01'
/** 100 is below npm's documented 128-package bulk limit. */
export const DOWNLOAD_TOTALS_BATCH_SIZE = 100
export const DOWNLOAD_TOTALS_MAX_REQUESTS = 1280
export const DOWNLOAD_TOTALS_MAX_CONCURRENCY = 4
const DOWNLOAD_TOTALS_REQUEST_TIMEOUT_MS = 10_000
const DOWNLOAD_TOTALS_REFRESH_TIMEOUT_MS = 10 * 60_000
const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))

function utcDate(value: number): string { return new Date(value).toISOString().slice(0, 10) }
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
  const cost = periods.length
  const units = cost === 0 ? [] : allUnits.slice(0, Math.floor(maxRequests / cost))
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
  const maxRequests = options.maxRequests ?? DOWNLOAD_TOTALS_MAX_REQUESTS
  const requestTimeoutMs = options.requestTimeoutMs ?? DOWNLOAD_TOTALS_REQUEST_TIMEOUT_MS
  const refreshTimeoutMs = options.refreshTimeoutMs ?? DOWNLOAD_TOTALS_REFRESH_TIMEOUT_MS
  const memory = new Map<string, DownloadTotalsCache>()
  const pending = new Map<string, { signature: string; promise: Promise<DownloadTotalsTable> }>()

  const get = async (plugins: readonly { npm?: string | null }[], registryCacheFile?: string): Promise<DownloadTotalsTable> => {
    const names = [...new Set(plugins.flatMap(plugin => typeof plugin.npm === 'string' && plugin.npm.trim() !== '' ? [plugin.npm] : []))]
    const signature = namesDigest(names)
    const today = utcDate(now())
    const profileKey = registryCacheFile === undefined ? '<memory>' : resolve(registryCacheFile)
    const cachedMemory = memory.get(profileKey)
    if (cachedMemory?.generatedAt.slice(0, 10) === today && cachedMemory.namesDigest === signature) {
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
      if (cached?.generatedAt.slice(0, 10) === today && cached.namesDigest === signature) {
        memory.set(profileKey, cached)
        return publicTable(cached, names)
      }

      const sameDay = cached?.generatedAt.slice(0, 10) === today
      const totals: Record<string, number> = {}
      if (sameDay && cached !== null) {
        for (const name of names) if (Object.hasOwn(cached.totals, name)) totals[name] = cached.totals[name]
      }
      const remaining = names.filter(name => !Object.hasOwn(totals, name))
      const end = utcDate(now() - DAY) // npm settles complete download counts once per UTC day.
      const plan = remaining.length === 0
        ? { periods: [] as [string, string][], units: [] as DownloadTotalsWorkUnit[], bulkBatches: 0, scopePackages: 0, requestCount: 0, omittedPackages: [] as string[] }
        : planDownloadTotals(remaining, DOWNLOAD_TOTALS_START, end, maxRequests)
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
        start: DOWNLOAD_TOTALS_START,
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

/** npm accepts at most 18 months per single-package request; use calendar years. */
export function downloadPeriods(start: string, end: string): [string, string][] {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Invalid download period')
  const periods: [string, string][] = []
  for (let cursor = start; cursor <= end;) {
    const stop = `${cursor.slice(0, 4)}-12-31` < end ? `${cursor.slice(0, 4)}-12-31` : end
    periods.push([cursor, stop])
    cursor = new Date(Date.parse(stop) + DAY).toISOString().slice(0, 10)
  }
  return periods
}

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
      const metadata = await json(`https://registry.npmjs.org/${encoded}`)
      const created = String(metadata.time?.created ?? '').slice(0, 10)
      if (metadata.name !== name || !validDate(created)) throw new Error('Missing npm creation date')
      const latest = await json(`https://api.npmjs.org/downloads/point/last-day/${encoded}`)
      if (latest.package !== name || !validDate(latest.end)) throw new Error('Invalid npm cutoff')
      const end = latest.end
      const start = created < EARLIEST ? EARLIEST : created
      if (start > end) throw new Error('npm statistics have not settled yet')
      let downloads = 0
      for (const [from, to] of downloadPeriods(start, end)) {
        const result = await json(`https://api.npmjs.org/downloads/point/${from}:${to}/${encoded}`)
        if (result.package !== name || result.start !== from || result.end !== to
          || !Number.isSafeInteger(result.downloads) || result.downloads < 0) throw new Error('Incomplete npm statistics')
        downloads += result.downloads
      }
      if (!Number.isSafeInteger(downloads)) throw new Error('Invalid npm total')
      return { downloads, start, end, complete: created >= EARLIEST }
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
