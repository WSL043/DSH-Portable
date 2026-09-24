import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UpdateStatus } from '../updates.ts'
import css from './PluginUpdates.module.css'
import { updateCompletion, updateCompletionLabel, type UpdateCompletion } from './update-completion.ts'
import { restartApp } from './restart-app.ts'
import { pluginStateNote, type PluginStateNote } from './plugin-state-note.ts'

type InstalledSnapshot = { bundles: string[]; activation: Record<string, { state?: string }> }
type Snapshot = { updates: Record<string, UpdateStatus>; checking: boolean; checked: boolean; error: string; busy: string; done: Record<string, UpdateCompletion>; failures: Record<string, string>; installed: InstalledSnapshot | null }
// Shared across cards and navigation; one request and one mutation at a time.
let snapshot: Snapshot = { updates: {}, checking: false, checked: false, error: '', busy: '', done: {}, failures: {}, installed: null }
let checkedAt = 0
let installedRequest: Promise<void> | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const getSnapshot = () => snapshot
function publish(change: Partial<Snapshot>) { snapshot = { ...snapshot, ...change }; listeners.forEach(listener => listener()) }

async function refreshInstalled(afterPending = false): Promise<void> {
  if (installedRequest) {
    await installedRequest
    if (!afterPending) return
  }
  const request = (async () => {
    try {
      const response = await fetch('/dsh-market/installed', { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (!Array.isArray(body.bundles) || !body.activation || typeof body.activation !== 'object' || Array.isArray(body.activation)) throw new Error('Invalid installed inventory')
      publish({ installed: { bundles: body.bundles, activation: body.activation } })
    } catch {
      // The official switch remains usable; do not display a stale verdict.
      publish({ installed: null })
    }
  })()
  installedRequest = request
  try { await request } finally { if (installedRequest === request) installedRequest = null }
}

const noteCopy: Record<PluginStateNote, { zh: string; en: string; zhTitle: string; enTitle: string }> = {
  'running-outside-switch': {
    zh: '关闭后仍在运行', en: 'Running outside switch',
    zhTitle: '该插件还被自定义配置加载。要真正停用，请到配置文件移除额外的加载项。',
    enTitle: 'A custom configuration still loads this plugin. Remove the extra mount in the configuration file to stop it.',
  },
  'stopped-despite-switch': {
    zh: '开启但未运行', en: 'Enabled but inactive',
    zhTitle: '自定义配置停用了该插件。要让开关生效，请到配置文件移除对应的停用项。',
    enTitle: 'A custom configuration disables this plugin. Remove its disable entry in the configuration file to make the switch effective.',
  },
  'pending-stop': {
    zh: '停用待生效', en: 'Disable pending',
    zhTitle: '已请求停用，但当前进程仍加载着此插件；需要刷新或重启后再确认。',
    enTitle: 'Disable was requested, but the current process still loads this plugin. Refresh or restart, then verify.',
  },
}
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
    void refreshInstalled(true)
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
    const refresh = () => { void check(true); void refreshInstalled(true) }
    window.addEventListener('dsh-portable/refresh-plugins', refresh)
    void check()
    void refreshInstalled(true)
    return () => window.removeEventListener('dsh-portable/refresh-plugins', refresh)
  }, [])
  const unresolved = Object.values(state.updates).some(status => (status.kind === 'npm' || status.kind === 'github') && status.latest === null)
  if (state.checking || (!state.error && !unresolved)) return null
  return <span className={css.hint} role="status" title={state.error}>{zh ? '部分版本检查失败，请刷新重试' : 'Some version checks failed. Refresh to retry.'}</span>
}
export function PluginUpdateRow({ zh, name, busy = false, view }: { zh: boolean; name: string; busy?: boolean; view: 'summary' | 'action' }) {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (view !== 'summary') return
    if (busy) wasBusy.current = true
    else if (wasBusy.current) {
      wasBusy.current = false
      void refreshInstalled(true)
    }
  }, [busy, view])
  const status = state.updates[name]
  const done = state.done[name]
  const note = pluginStateNote(state.installed?.bundles.includes(name), state.installed?.activation[name]?.state)
  if (!status?.updateAvailable && !status?.betaAvailable && !status?.stableAvailable && !done && !note) return null
  const error = state.failures[name]
  if (view === 'action') {
    if (done === 'restart' || done === 'refresh') return <Button variant="outline" size="sm" disabled={busy || Boolean(state.busy)} onClick={() => void activate(name)}>{state.busy === name ? (zh ? '正在处理…' : 'Applying…') : done === 'restart' ? (zh ? '重启应用' : 'Restart app') : (zh ? '刷新页面' : 'Reload page')}</Button>
    if (done) return <span className={css.pending} role="status">{updateCompletionLabel(done, zh)}</span>
    if (!status?.updateAvailable && !status?.betaAvailable && !status?.stableAvailable) return null
    return <span className={css.actions}>
      {status?.updateAvailable && <Button variant="outline" size="sm" disabled={busy || state.checking || Boolean(state.busy)} onClick={() => void update(name)}>{state.busy === name ? (zh ? '正在更新…' : 'Updating…') : error ? (zh ? '重试' : 'Retry') : (zh ? '更新' : 'Update')}</Button>}
      {status?.betaAvailable && <Button variant="outline" size="sm" disabled={busy || state.checking || Boolean(state.busy)} onClick={() => void update(name, { betaVersion: status.betaAvailable })}>{zh ? '试用 Beta' : 'Try Beta'}</Button>}
      {status?.stableAvailable && <Button variant="outline" size="sm" disabled={busy || state.checking || Boolean(state.busy)} onClick={() => void update(name, { stableVersion: status.stableAvailable })}>{zh ? '切回正式版' : 'Return to stable'}</Button>}
    </span>
  }
  if (done && !error && !note) return null
  return <span className={css.row} data-portable-update={name}>
    {!done && status?.updateAvailable && <span className={css.version}>{`${status.version ?? ''} → ${status.latest ?? ''}`}</span>}
    {!done && status?.betaAvailable && <span className={css.version}>{`Beta ${status.betaAvailable}`}</span>}
    {!done && status?.stableAvailable && <span className={css.version}>{`Stable ${status.stableAvailable}`}</span>}
    {note && <span className={css.effectiveNote} role="status" title={zh ? noteCopy[note].zhTitle : noteCopy[note].enTitle}>{zh ? noteCopy[note].zh : noteCopy[note].en}</span>}
    {error && <span className={css.failure} role="alert" title={error}>{done ? (zh ? '未完成，请重试' : 'Could not apply. Please retry.') : (zh ? '更新失败，可重试' : 'Update failed. Retry available.')}</span>}
  </span>
}
