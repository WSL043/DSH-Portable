import { useEffect, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UpdateStatus } from '../updates.ts'
import css from './PluginUpdates.module.css'
import { updateCompletion, updateCompletionLabel, type UpdateCompletion } from './update-completion.ts'
import { restartApp } from './restart-app.ts'

type Snapshot = { updates: Record<string, UpdateStatus>; checking: boolean; checked: boolean; error: string; busy: string; done: Record<string, UpdateCompletion>; failures: Record<string, string> }
// Shared across cards and navigation; one request and one mutation at a time.
let snapshot: Snapshot = { updates: {}, checking: false, checked: false, error: '', busy: '', done: {}, failures: {} }
let checkedAt = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const getSnapshot = () => snapshot
function publish(change: Partial<Snapshot>) { snapshot = { ...snapshot, ...change }; listeners.forEach(listener => listener()) }
async function check(force = false) {
  if (snapshot.checking || snapshot.busy || (!force && Date.now() - checkedAt < 300_000)) return
  publish({ checking: true, error: '' })
  try {
    const response = await fetch('/dsh-market/updates' + (force ? '?force=1' : ''), { signal: AbortSignal.timeout(30_000) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
    checkedAt = Date.now()
    publish({ updates: body.updates || {}, checked: true })
  } catch (error) { publish({ error: String(error) }) }
  finally { publish({ checking: false }) }
}
async function update(name: string, selectedVersion?: { betaVersion?: string; stableVersion?: string }) {
  if (snapshot.busy || snapshot.checking || snapshot.done[name]) return
  publish({ busy: name, failures: { ...snapshot.failures, [name]: '' } })
  try {
    const response = await fetch('/dsh-market/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ...selectedVersion }) })
    const body = await response.json()
    if (!response.ok || !body.ok) throw new Error(body.error || body.output || `HTTP ${response.status}`)
    publish({ done: { ...snapshot.done, [name]: updateCompletion(body) } })
    // Do not tear down the page during installation; report the server activation verdict.
  } catch (error) { publish({ failures: { ...snapshot.failures, [name]: String(error) } }) }
  finally { publish({ busy: '' }) }
}
async function activate(name: string) {
  if (snapshot.busy) return
  const action = snapshot.done[name]
  if (action !== 'restart' && action !== 'refresh') return
  publish({ busy: name, failures: { ...snapshot.failures, [name]: '' } })
  try {
    if (action === 'restart') await restartApp()
    else location.reload()
  } catch (error) { publish({ failures: { ...snapshot.failures, [name]: String(error) } }) }
  finally { publish({ busy: '' }) }
}
export function PluginUpdateStatus({ zh }: { zh: boolean }) {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  useEffect(() => {
    const refresh = () => { void check(true) }
    window.addEventListener('dsh-portable/refresh-plugins', refresh)
    void check()
    return () => window.removeEventListener('dsh-portable/refresh-plugins', refresh)
  }, [])
  const unresolved = Object.values(state.updates).some(status => (status.kind === 'npm' || status.kind === 'github') && status.latest === null)
  if (state.checking || (!state.error && !unresolved)) return null
  return <span className={css.hint} role="status" title={state.error}>{zh ? '部分版本检查失败，请刷新重试' : 'Some version checks failed. Refresh to retry.'}</span>
}
export function PluginUpdateRow({ zh, name, busy = false, view }: { zh: boolean; name: string; busy?: boolean; view: 'summary' | 'action' }) {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const status = state.updates[name]
  const done = state.done[name]
  if (!status?.updateAvailable && !status?.betaAvailable && !status?.stableAvailable && !done) return null
  const error = state.failures[name]
  if (view === 'action') {
    if (done === 'restart' || done === 'refresh') return <Button variant="outline" size="sm" disabled={busy || Boolean(state.busy)} onClick={() => void activate(name)}>{state.busy === name ? (zh ? '正在处理…' : 'Applying…') : done === 'restart' ? (zh ? '重启应用' : 'Restart app') : (zh ? '刷新页面' : 'Reload page')}</Button>
    if (done) return <span className={css.pending} role="status">{updateCompletionLabel(done, zh)}</span>
    return <span className={css.actions}>
      {status?.updateAvailable && <Button variant="outline" size="sm" disabled={busy || state.checking || Boolean(state.busy)} onClick={() => void update(name)}>{state.busy === name ? (zh ? '正在更新…' : 'Updating…') : error ? (zh ? '重试' : 'Retry') : (zh ? '更新' : 'Update')}</Button>}
      {status?.betaAvailable && <Button variant="outline" size="sm" disabled={busy || state.checking || Boolean(state.busy)} onClick={() => void update(name, { betaVersion: status.betaAvailable })}>{zh ? '试用 Beta' : 'Try Beta'}</Button>}
      {status?.stableAvailable && <Button variant="outline" size="sm" disabled={busy || state.checking || Boolean(state.busy)} onClick={() => void update(name, { stableVersion: status.stableAvailable })}>{zh ? '切回正式版' : 'Return to stable'}</Button>}
    </span>
  }
  if (done && !error) return null
  return <span className={css.row} data-portable-update={name}>
    {!done && status?.updateAvailable && <span className={css.version}>{`${status.version ?? ''} → ${status.latest ?? ''}`}</span>}
    {!done && status?.betaAvailable && <span className={css.version}>{`Beta ${status.betaAvailable}`}</span>}
    {!done && status?.stableAvailable && <span className={css.version}>{`Stable ${status.stableAvailable}`}</span>}
    {error && <span className={css.failure} role="alert" title={error}>{done ? (zh ? '未完成，请重试' : 'Could not apply. Please retry.') : (zh ? '更新失败，可重试' : 'Update failed. Retry available.')}</span>}
  </span>
}
