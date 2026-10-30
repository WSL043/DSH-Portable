import { useSyncExternalStore } from 'react'
import { MarketErrorBoundary } from './MarketErrorBoundary.tsx'
import { PluginUpdateStatus } from './PluginUpdates.tsx'
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

/** The Portable adapter contributes update status, never a substitute manager. */
export function MarketAction(props: MarketActionProps) {
  const locale = useSyncExternalStore(
    callback => props.locale.subscribe(callback),
    () => props.locale.getSnapshot(),
  )
  return (
    <MarketErrorBoundary view="installed">
      <PluginUpdateStatus zh={locale.active.toLowerCase().startsWith('zh')} />
    </MarketErrorBoundary>
  )
}
