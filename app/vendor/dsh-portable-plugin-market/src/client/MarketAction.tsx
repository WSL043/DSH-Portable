import { useCallback, useState, useSyncExternalStore } from 'react'
import { Button, IconCordisPluginOutline14, Modal } from './primitives.ts'
import { MarketErrorBoundary } from './MarketErrorBoundary.tsx'
import { MarketSection } from './MarketSection.tsx'
import { PluginUpdateStatus } from './PluginUpdates.tsx'
import { useOfficialMarket } from './official-market.ts'
import css from './Market.module.css'
import type { Translate } from './market-data.ts'

export interface MarketActionProps {
  t: Translate
  locale: {
    subscribe(callback: () => void): () => void
    getSnapshot(): { active: string }
  }
  refresh?: () => void
  openInstall?: () => void
  editInstallSpec?: (spec: string) => void
}

/** The modern manager toolbar entry contributed through the Portable adapter. */
export function MarketAction(props: MarketActionProps) {
  const [open, setOpen] = useState(false)
  const locale = useSyncExternalStore(
    callback => props.locale.subscribe(callback),
    () => props.locale.getSnapshot(),
  )
  const zh = locale.active.toLowerCase().startsWith('zh')
  const official = useOfficialMarket()
  const close = useCallback(() => {
    setOpen(false)
    props.refresh?.()
  }, [props.refresh])

  // With the official plugin market on, its Discover tab browses and installs. The Portable market stays one click away as
  // "Advanced": groups, themes, diagnostics and the repair tools the official page does not have.
  const label = official === 'active' ? props.t('navAdvanced') : props.t('nav')

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={<IconCordisPluginOutline14 size={14} />}
        onClick={() => setOpen(true)}
      >{label}</Button>
      <MarketErrorBoundary view="installed"><PluginUpdateStatus zh={zh} /></MarketErrorBoundary>
      <Modal
        open={open}
        onClose={close}
        title={label}
        closeLabel={props.t('cancel')}
        className={css.managerModal}
        contentClassName={css.managerModalContent}
      >
        <MarketErrorBoundary view="discover">
          <MarketSection t={props.t} locale={props.locale} view="discover"
            onOfficialInstall={props.openInstall && props.editInstallSpec ? spec => {
              setOpen(false)
              props.openInstall!()
              props.editInstallSpec!(spec)
            } : undefined} />
        </MarketErrorBoundary>
      </Modal>
    </>
  )
}
