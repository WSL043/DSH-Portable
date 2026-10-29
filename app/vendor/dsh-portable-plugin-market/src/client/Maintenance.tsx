import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, DisclosureRow, IconCordisPluginOutline14, MenuItemButton, Modal } from './primitives.ts'
import { Diagnostics } from './Diagnostics.tsx'
import css from './Market.module.css'
import type { InstalledPayload, Translate } from './market-data.ts'

interface Locale {
  subscribe(callback: () => void): () => void
  getSnapshot(): { active: string }
}

/** Private to this plugin lifetime; no sidebar pins or host navigation are changed. */
export function createMaintenanceController() {
  let open = false
  const listeners = new Set<() => void>()
  const change = (next: boolean) => {
    if (next === open) return
    open = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => open,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    show: () => change(true),
    hide: () => change(false),
  }
}

type Controller = ReturnType<typeof createMaintenanceController>
interface MaintenanceProps { t: Translate; locale: Locale; controller: Controller }

export function MaintenanceMenuAction(props: MaintenanceProps & { onDismiss: () => void }) {
  useSyncExternalStore(callback => props.locale.subscribe(callback), () => props.locale.getSnapshot())
  return (
    <MenuItemButton onSelect={() => { props.onDismiss(); props.controller.show() }}>
      {props.t('maintenanceTitle')}
    </MenuItemButton>
  )
}

/** The menu unmounts on dismissal; its dialog lives in the existing overlay seat. */
export function MaintenanceOverlay(props: MaintenanceProps) {
  const open = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot)
  useSyncExternalStore(callback => props.locale.subscribe(callback), () => props.locale.getSnapshot())
  return open ? <MaintenanceDialog t={props.t} onClose={props.controller.hide} /> : null
}


function ActivationSnapshot({ t }: { t: Translate }) {
  const [activation, setActivation] = useState<InstalledPayload['activation'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    const request = new AbortController()
    void fetch('/dsh-market/installed', { cache: 'no-store', signal: request.signal })
      .then(async response => {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return await response.json() as InstalledPayload
      })
      .then(result => { if (live) setActivation(result.activation) })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false; request.abort() }
  }, [])
  // Enabled/disabled controls belong to the official manager. Preserve the loader's verdict.
  const attention = Object.entries(activation ?? {}).filter(([, info]) => info.state !== 'live' && info.state !== 'disabled')
  const labels: Record<string, string> = {
    inert: t('stateInert'), restart: t('stateRestart'), broken: t('stateBroken'),
    'pending-disable': t('statePendingDisable'), missing: t('maintenanceMissing'),
  }
  return (
    <section className={css.diagSection} aria-label={t('maintenanceActivation')}>
      {error ? <p className={css.err} role="alert">{t('maintenanceSnapshotFailed')} {error}</p>
        : activation === null ? <p className={css.panelNote} role="status">{t('maintenanceSnapshotLoading')}</p>
          : activation === undefined ? <p className={css.panelNote}>{t('maintenanceSnapshotUnavailable')}</p>
            : (
                <>
                  <DisclosureRow icon={<IconCordisPluginOutline14 size={14} />}
                    title={t('maintenanceActivation') + ' (' + attention.length + ')'}
                    open={open} expandable={attention.length > 0} onToggle={() => setOpen(value => !value)}>
                    <div className={css.diagList}>
                      {attention.map(([name, info]) => (
                        <div key={name} className={css.diagBundle}>
                          <div className={css.diagRow}><strong>{name}</strong><span>{labels[info.state] ?? info.state}</span></div>
                          {info.reasons.map((reason, index) => <p className={css.panelNote} key={index}>{reason}</p>)}
                        </div>
                      ))}
                    </div>
                  </DisclosureRow>
                  {attention.length === 0 ? <p className={css.panelNote}>{t('maintenanceNoAttention')}</p> : null}
                </>
              )}
    </section>
  )
}

function MaintenanceDialog({ t, onClose }: { t: Translate; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [restoreErrors, setRestoreErrors] = useState<Array<{ name: string; error: string }>>([])

  const restore = async () => {
    if (!file || !confirming || running.current) return
    running.current = true
    setBusy(true)
    setMessage(null)
    setError(null)
    setRestoreErrors([])
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(t('maintenanceFileTooLarge'))
      let backup: unknown
      try { backup = JSON.parse(await file.text()) }
      catch { throw new Error(t('maintenanceInvalidBackup')) }
      const response = await fetch('/dsh-market/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backup }),
      })
      const result = await response.json().catch(() => null) as {
        ok?: boolean
        error?: string
        errors?: Array<{ name: string; error: string }>
        unportable?: unknown[]
      } | null
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'HTTP ' + response.status)
      const failures = Array.isArray(result.errors) ? result.errors : []
      setRestoreErrors(failures)
      setMessage(failures.length > 0
        ? t('maintenanceRestorePartial').replace('{0}', String(failures.length))
        : t('maintenanceRestored'))
      if (Array.isArray(result.unportable) && result.unportable.length > 0) {
        setError(t('maintenanceLocalSources').replace('{0}', String(result.unportable.length)))
      }
      setFile(null)
      setRevision(value => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      running.current = false
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <Modal open onClose={() => { if (!running.current) onClose() }}
      title={t('maintenanceTitle')} closeLabel={t('maintenanceClose')}
      className={css.maintenanceModal} contentClassName={css.managerModalContent}>
      <div className={css.maintenanceBody} aria-busy={busy}>
        <p className={css.panelNote}>{t('maintenanceIntro')}</p>
        <ActivationSnapshot key={revision} t={t} />
        <section className={css.diagSection} aria-label={t('maintenanceRecovery')}>
          <h3>{t('maintenanceRecovery')}</h3>
          <p className={css.panelNote}>{t('maintenanceBackupWarning')}</p>
          <div className={css.diagRow}>
            <a href="/dsh-market/backup" download aria-disabled={busy}
              onClick={event => { if (running.current) event.preventDefault() }}>
              {t('maintenanceExport')}
            </a>
          </div>
          <label className={css.diagList}>
            <span>{t('maintenanceChoose')}</span>
            <input key={revision} type="file" accept=".json,application/json" disabled={busy}
              onChange={event => {
                setFile(event.currentTarget.files?.[0] ?? null)
                setConfirming(false)
                setError(null)
                setMessage(null)
                setRestoreErrors([])
              }} />
          </label>
          {confirming ? (
            <div className={css.diagList} role="group" aria-label={t('maintenanceConfirmTitle')}>
              <p className={css.panelNote}>{t('maintenanceConfirmBody').replace('{0}', file?.name ?? '')}</p>
              <div className={css.diagRow}>
                <Button disabled={busy} onClick={() => { void restore() }}>{t('maintenanceConfirm')}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>{t('cancel')}</Button>
              </div>
            </div>
          ) : (
            <div className={css.diagRow}>
              <Button variant="outline" disabled={!file || busy} onClick={() => setConfirming(true)}>
                {t('maintenanceRestore')}
              </Button>
            </div>
          )}
          {busy ? <p role="status">{t('maintenanceRestoring')}</p> : null}
          {message ? <p className={css.panelNote} role="status">{message}</p> : null}
          {error ? <p className={css.err} role="alert">{error}</p> : null}
          {restoreErrors.slice(0, 5).map((failure, index) => (
            <p className={css.err} key={index}>{failure.name}: {failure.error}</p>
          ))}
        </section>
        {!busy ? <Diagnostics key={revision} t={t} readOnly /> : null}
      </div>
    </Modal>
  )
}
