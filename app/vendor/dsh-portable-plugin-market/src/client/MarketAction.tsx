import { useCallback, useState } from 'react'
import { Button, IconCordisPluginOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarketErrorBoundary } from './MarketErrorBoundary.tsx'
import { MarketSection } from './MarketSection.tsx'
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
  const close = useCallback(() => {
    setOpen(false)
    props.refresh?.()
  }, [props.refresh])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={<IconCordisPluginOutline14 size={14} />}
        onClick={() => setOpen(true)}
      >{props.t('nav')}</Button>
      <Modal
        open={open}
        onClose={close}
        title={props.t('nav')}
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
