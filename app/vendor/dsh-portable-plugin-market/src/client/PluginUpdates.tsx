import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UpdateStatus } from '../updates.ts'

/** Update-only supplement; the official page retains installation and enablement. */
export function PluginUpdates({ zh, open, onClose, onChanged }: { zh: boolean; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [updates, setUpdates] = useState<Record<string, UpdateStatus>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState<string[]>([])
  async function load() {
    setLoading(true); setError('')
    try {
      const response = await fetch('/dsh-market/updates?force=1')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setUpdates(body.updates || {})
    } catch (reason) { setError(String(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (open && !busy) void load() }, [open])
  async function update(name: string) {
    setBusy(name); setError('')
    try {
      const response = await fetch('/dsh-market/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error || body.output || `HTTP ${response.status}`)
      setDone(previous => [...previous, name]); onChanged()
    } catch (reason) { setError(String(reason)) }
    finally { setBusy('') }
  }
  const entries = Object.entries(updates).filter(([, status]) => status.updateAvailable)
  const unresolved = Object.values(updates).some(status => status.kind === 'npm' && status.latest === null)
  return <Modal open={open} onClose={onClose} title={zh ? '插件更新' : 'Plugin updates'} closeLabel={zh ? '关闭' : 'Close'}><div aria-busy={loading || Boolean(busy)}>
    <p>{zh ? '逐个更新已安装插件。更新不会自动启用已停用的插件；完成后请回到官方插件页检查启用状态。' : 'Update installed plugins individually. Disabled plugins stay disabled; check their enabled state on the official plugin page afterwards.'}</p>
    <Button variant="outline" size="sm" disabled={loading || Boolean(busy)} onClick={() => void load()}>{zh ? '检查更新' : 'Check for updates'}</Button>
    {loading && <p role="status">{zh ? '正在检查…' : 'Checking…'}</p>}
    {error && <p role="alert" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error}</p>}
    {!loading && !error && entries.length === 0 && <p>{unresolved ? (zh ? '部分插件版本检查失败，请检查网络后重试。' : 'Some version checks failed. Check your connection and retry.') : (zh ? '没有发现可更新的版本。' : 'No updates found.')}</p>}
    {entries.map(([name, status]) => <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBlock: 12 }}>
      <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><strong>{name}</strong><div>{status.version} → {status.latest}</div></div>
      <Button variant="outline" size="sm" disabled={Boolean(busy) || done.includes(name)} onClick={() => void update(name)}>{done.includes(name) ? (zh ? '已更新' : 'Updated') : busy === name ? (zh ? '正在更新…' : 'Updating…') : (zh ? '更新' : 'Update')}</Button>
    </div>)}
    {done.length > 0 && <p role="status">{zh ? '更新完成。请保存当前工作并重启 Portable，然后在插件页确认插件已启用。' : 'Updated. Save your work and restart Portable, then verify that the plugin is enabled.'}</p>}
  </div></Modal>
}
