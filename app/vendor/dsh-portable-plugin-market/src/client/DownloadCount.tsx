import { useEffect, useState } from 'react'
import type { DownloadTotal } from '../download-totals.ts'
import { formatCount } from './market-data.ts'

/** Mounted only for visible cards/details; lifetime statistics are separate from catalog monthly counts. */
export function DownloadCount({ name, chinese, className }: { name: string; chinese: boolean; className: string }) {
  const [state, setState] = useState<DownloadTotal | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setState(null); setFailed(false)
    fetch(`/dsh-market/download-total?name=${encodeURIComponent(name)}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('unavailable'); return response.json() })
      .then(value => { if (!controller.signal.aborted) setState(value) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [name])
  const label = chinese ? 'npm 累计下载' : 'npm total downloads'
  const title = state
    ? `${label}: ${state.downloads}\n${state.start} – ${state.end}${state.complete ? '' : (chinese ? '（可用历史范围）' : ' (available history)')}\n${chinese ? '下载次数，不是用户数；按日结算' : 'Downloads, not unique users; settled daily'}`
    : failed ? (chinese ? '累计下载暂不可用' : 'Total downloads unavailable') : (chinese ? '正在查询累计下载' : 'Loading total downloads')
  return <span className={className} title={title} aria-label={title}>
    {'↓ ' + (state ? formatCount(state.downloads) + (state.complete ? '' : '+') : failed ? '—' : '…')}
  </span>
}
