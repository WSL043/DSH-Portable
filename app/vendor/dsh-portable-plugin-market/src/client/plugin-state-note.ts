/** An official bundle switch describes intent, not every loader patch layer. */
export type PluginStateNote = 'running-outside-switch' | 'stopped-despite-switch' | 'pending-stop'

export function pluginStateNote(bundleEnabled: boolean | undefined, activation: string | undefined): PluginStateNote | null {
  if (bundleEnabled === undefined || activation === undefined) return null
  if (!bundleEnabled && activation === 'live') return 'running-outside-switch'
  if (bundleEnabled && activation === 'disabled') return 'stopped-despite-switch'
  if (activation === 'pending-disable') return 'pending-stop'
  return null
}
