import { marketFetch } from './net.ts'

export interface DownloadTotal { downloads: number; start: string; end: string; complete: boolean }
const DAY = 86400000
const EARLIEST = '2015-01-10'
const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))

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
