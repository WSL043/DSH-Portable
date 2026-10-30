import { useRef, useState, useSyncExternalStore } from 'react'
import { Button, MenuItemButton, Modal } from './primitives.ts'
import css from './Market.module.css'
import type { Translate } from './market-data.ts'

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


function MaintenanceDialog({ t, onClose }: { t: Translate; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
        files?: number
        error?: string
        errors?: Array<{ name: string; error: string }>
        unportable?: unknown[]
      } | null
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'HTTP ' + response.status)
      const failures = Array.isArray(result.errors) ? result.errors : []
      setRestoreErrors(failures)
      if (result.files === 0 && failures.length > 0) {
        setError(t('maintenanceRestoreRolledBack'))
        return
      }
      setMessage(failures.length > 0
        ? t('maintenanceRestorePartial').replace('{0}', String(failures.length))
        : t('maintenanceRestored'))
      if (Array.isArray(result.unportable) && result.unportable.length > 0) {
        setError(t('maintenanceLocalSources').replace('{0}', String(result.unportable.length)))
      }
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
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
      className={css.maintenanceModal} contentClassName={css.maintenanceModalContent}>
      <div className={css.maintenanceBody} aria-busy={busy}>
        <p className={css.panelNote}>{t('maintenanceIntro')}</p>
        <section className={css.maintenanceRecovery} aria-label={t('maintenanceTitle')}>
          <div className={css.maintenanceActions}>
            <Button variant="outline" disabled={busy} onClick={() => {
              if (running.current || !fileInput.current) return
              fileInput.current.value = ''
              fileInput.current.click()
            }}>
              {t('maintenanceChoose')}
            </Button>
          </div>
          <input ref={fileInput} hidden type="file" accept=".json,application/json" disabled={busy}
            aria-label={t('maintenanceChoose')}
            onChange={event => {
              if (running.current) return
              const selected = event.currentTarget.files?.[0] ?? null
              setFile(selected)
              setConfirming(selected !== null)
              setError(null)
              setMessage(null)
              setRestoreErrors([])
            }} />
          <p className={css.panelNote}>{t('maintenanceBackupWarning')}</p>
          {confirming ? (
            <div className={css.maintenanceConfirmation} role="group" aria-label={t('maintenanceConfirmTitle')}>
              <p className={css.panelNote}>{t('maintenanceConfirmBody').replace('{0}', file?.name ?? '')}</p>
              <div className={css.maintenanceActions}>
                <Button disabled={busy} onClick={() => { void restore() }}>{t('maintenanceConfirm')}</Button>
                <Button variant="outline" disabled={busy} onClick={() => {
                  if (running.current) return
                  setConfirming(false)
                  setFile(null)
                  if (fileInput.current) fileInput.current.value = ''
                }}>{t('cancel')}</Button>
              </div>
            </div>
          ) : null}
          {busy ? <p className={css.panelNote} role="status">{t('maintenanceRestoring')}</p> : null}
          {message ? <p className={css.panelNote} role="status">{message}</p> : null}
          {error ? <p className={css.err} role="alert">{error}</p> : null}
          {restoreErrors.slice(0, 5).map((failure, index) => (
            <p className={css.err} key={index}>{failure.name}: {failure.error}</p>
          ))}
        </section>
      </div>
    </Modal>
  )
}
