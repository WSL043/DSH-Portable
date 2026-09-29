import { useEffect, useState } from 'react'
import type { DownloadTotal, DownloadTotalsTable } from '../download-totals.ts'
import { formatCount } from './market-data.ts'

/** Mounted only for visible cards/details; lifetime statistics are separate from catalog monthly counts. */
export function DownloadCount({ name, chinese, className, totals, totalsSettled = false }: {
  name: string
  chinese: boolean
  className: string
  totals?: DownloadTotalsTable | null
  totalsSettled?: boolean
}) {
  const [state, setState] = useState<DownloadTotal | null>(null)
  const [failed, setFailed] = useState(false)
  const sharedTotal = totals?.totals[name]
  useEffect(() => {
    if (typeof sharedTotal === 'number' || !totalsSettled) {
      setState(null); setFailed(false)
      return
    }
    const controller = new AbortController()
    setState(null); setFailed(false)
    fetch(`/dsh-market/download-total?name=${encodeURIComponent(name)}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('unavailable'); return response.json() })
      .then(value => { if (!controller.signal.aborted) setState(value) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [name, sharedTotal, totalsSettled])
  const label = chinese ? 'npm 累计下载' : 'npm total downloads'
  const title = typeof sharedTotal === 'number'
    ? `${label}: ${sharedTotal}\n${totals!.start} – ${totals!.end}\n${chinese ? '完整表' : 'Table complete'}: ${totals!.complete}\n${chinese ? '下载次数，不是用户数；按日结算' : 'Downloads, not unique users; settled daily'}`
    : state
      ? `${label}: ${state.downloads}\n${state.start} – ${state.end}\n${chinese ? '完整' : 'Complete'}: ${state.complete}\n${chinese ? '下载次数，不是用户数；按日结算' : 'Downloads, not unique users; settled daily'}`
      : failed ? (chinese ? '累计下载暂不可用' : 'Total downloads unavailable') : (chinese ? '正在查询累计下载' : 'Loading total downloads')
  const downloads = typeof sharedTotal === 'number' ? sharedTotal : state?.downloads
  const complete = typeof sharedTotal === 'number' ? totals!.complete : state?.complete
  return <span className={className} title={title} aria-label={title}>
    {'↓ ' + (downloads !== undefined ? formatCount(downloads) + (complete ? '' : '+') : failed ? '—' : '…')}
  </span>
}
