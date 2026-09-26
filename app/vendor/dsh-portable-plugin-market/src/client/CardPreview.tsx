import { useState } from 'react'
import { safeScreenshots, pluginName, type RegistryPlugin, type Translate } from './market-data.ts'
import css from './Market.module.css'

/** Catalog images only: browsing never fans out into README requests. */
export function CardPreview({ plugin, t, onOpen }: {
  plugin: RegistryPlugin
  t: Translate
  onOpen: (shots: string[], index: number) => void
}) {
  const [broken, setBroken] = useState<string[]>([])
  const shots = safeScreenshots(plugin.screenshots).filter(src => !broken.includes(src))
  if (!shots.length) return null
  return <div className={css.cardPreviews}>
    {shots.slice(0, 1).map((src, index) => <button
      key={src} type="button" className={css.cardPreview}
      aria-label={t('previewScreenshot').replace('{0}', pluginName(plugin.name)).replace('{1}', String(index + 1))}
      onClick={() => onOpen(shots, index)}
    >
      <img src={src} alt="" loading="lazy" decoding="async" fetchPriority="low" referrerPolicy="no-referrer"
        onError={() => setBroken(previous => previous.includes(src) ? previous : [...previous, src])} />
      {shots.length > 1 && <span className={css.previewMore}>+{shots.length - 1}</span>}
    </button>)}
  </div>
}
