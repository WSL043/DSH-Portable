/**
 * The market's own settings namespace: the half that makes `allowRestart`
 * a switch on the plugin configuration page instead of a line the user has
 * to hand-write into cordis.yml.
 *
 * `allowRestart: false` is the documented answer for a host owned by
 * systemd, launchd or pm2 — a supervisor restarts it, so the market's
 * one-click restart must not launch a second one. Until now the only way to
 * say that was editing YAML in the right place with the right indentation,
 * where a stray space stops the profile booting.
 *
 * Only `allowRestart` is exposed. `profile` names which profile this
 * instance manages: it is decided at mount from the composition or the
 * command line, and a running instance cannot switch to another one, so
 * offering it as a field would promise something the write cannot deliver.
 *
 * The release channel is NOT here either, and that is a correction rather
 * than an omission. It was, briefly, and it made this namespace a second
 * writer for a value the market already stores in its own state.json: the
 * mount read the user's saved channel off disk, then `onChange` assigned
 * `source().channel` — which knows nothing about that file — straight back
 * over it. The choice survived exactly until the next settings event.
 *
 * Only a real host could show that; the unit lane mounts the routes without
 * this layer at all. `allowRestart` needs this door because its only other
 * one is hand-edited YAML. The channel has a control of its own on the
 * plugin configuration page, so a second door bought nothing and cost the
 * setting its memory.
 *
 * The stable host exports installSettingsSection; Alpha 2 moved the same
 * optional-service wiring onto ctx.settings.installSection. Both ride the
 * scoped fiber, so a host with no settings service simply never runs any of
 * this and the entry configuration stands as composed.
 */

import type { Context } from '@deepseek-ai/cordis'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Namespace the card on the browser side keys itself to. */
export const MARKET_SETTINGS_NS = 'dsh-market'

/** The market settings a user may edit at runtime. */
export interface MarketSettings {
  allowRestart: boolean
}

export const MarketSettings: z<MarketSettings> = z.object({
  allowRestart: z.boolean().default(true),
})

/**
 * Wire the namespace so a saved change reaches the routes immediately.
 *
 * The routes read `allowRestart` off this object on every request (the
 * status route reports the capability, the restart route enforces it), so
 * updating it in place is what makes a toggle take effect without a
 * restart — which would be a poor thing to require of a setting whose whole
 * subject is restarting.
 *
 * @param ctx - the plugin context owning the wiring.
 * @param resolved - the live config object the routes read.
 */
export function installMarketSettings(ctx: Context, resolved: { allowRestart?: boolean }): void {
  // `!== false` is the routes' own reading: an absent value allows restart,
  // so the entry layer this registers must say the same thing rather than
  // presenting "unset" as "off".
  const entry = { allowRestart: resolved.allowRestart !== false }
  let source = (): MarketSettings => entry
  const hooks = {
    setSource: (current: () => MarketSettings) => { source = current },
    // Assigns ONLY what this namespace owns. Writing back a field the
    // market stores elsewhere is how the channel lost its memory.
    onChange: () => { resolved.allowRestart = source().allowRestart },
  }
  const legacyInstall = Reflect.get(dshSettings, 'installSettingsSection')
  if (typeof legacyInstall === 'function') {
    legacyInstall(ctx, MARKET_SETTINGS_NS, MarketSettings, entry, hooks)
    return
  }
  ctx.inject(['settings'], (settingsCtx) => {
    const installSection = Reflect.get(settingsCtx.settings, 'installSection')
    if (typeof installSection !== 'function') throw new Error('settings service has no installSection compatibility seam')
    installSection.call(settingsCtx.settings, ctx, MARKET_SETTINGS_NS, MarketSettings, entry, hooks)
  })
}
