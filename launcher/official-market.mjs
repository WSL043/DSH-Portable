// Enables the official experimental plugin market (shipped inside @deepseek-ai/dsh 0.2.1-alpha.4 and later) in the
// Portable profile and gives it the Awesome DSH catalog as its first index source.
//
// Both steps are done once per profile, not on every start: the official Plugins page turns the bundle off by removing
// it from `dsh.profile.bundles`, and an index source can be removed in its Discover tab, so a user's choice has to stick.
// The one thing done on every start is suspending the bundle when the active core does not ship it (0.2.0-rc.2): the
// profile must never name a bundle its core cannot resolve.
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const OFFICIAL_MARKET_BUNDLE = '@deepseek-ai/dsh-experimental-plugin-market-bundle'
// A raw.githubusercontent.com file is served without a redirect, which the official market requires of an index.
export const AWESOME_INDEX_URL = 'https://raw.githubusercontent.com/WSL043/DSH-Portable-Updates/market-index/awesome-index.json'
const STATE_FILE = '.dsh-portable-official-market.json'
const PLUGIN_MARKET_ROW = /^-[ \t]+id:[ \t]*['"]?plugin-market['"]?[ \t]*$/mu

function emptyPatch(text) {
  return text.split(/\r?\n/u).every(line => /^\s*(?:#.*)?$/u.test(line) || /^\s*\[\s*\]\s*$/u.test(line))
}

/** The patch file with the Awesome index added as a new `plugin-market` row; null when the user already owns that row. */
export function withAwesomeIndex(text, url = AWESOME_INDEX_URL) {
  if (PLUGIN_MARKET_ROW.test(text)) return null
  const row = `- id: plugin-market\n  config:\n    indexes:\n      - ${url}\n`
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const block = row.replaceAll('\n', eol)
  if (emptyPatch(text)) {
    const header = text.split(/\r?\n/u).filter(line => /^\s*#/u.test(line)).join(eol)
    return `${header ? `${header}${eol}` : ''}${block}`
  }
  return `${text.endsWith('\n') ? text : `${text}${eol}`}${block}`
}

async function readJson(filename, fallback, load) {
  try {
    return JSON.parse(await load(filename, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return fallback
    throw error
  }
}

async function writeAtomic(filename, content, save, move) {
  const temporary = `${filename}.${process.pid}.tmp`
  await save(temporary, content, 'utf8')
  await move(temporary, filename)
}

export async function ensureOfficialMarket(layout, adapters = {}) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const exists = adapters.existsSync ?? existsSync
  const load = adapters.readFile ?? readFile
  const save = adapters.writeFile ?? writeFile
  const move = adapters.rename ?? rename
  const makeDirectory = adapters.mkdir ?? mkdir
  const profileRoot = paths.join(layout.dshHome, 'profiles', 'web')
  const manifestPath = paths.join(profileRoot, 'package.json')
  if (!exists(manifestPath)) return { status: 'skipped', reason: 'no-profile' }

  const manifest = await readJson(manifestPath, null, load)
  if (manifest === null || typeof manifest !== 'object') return { status: 'skipped', reason: 'unreadable-profile' }
  const statePath = paths.join(profileRoot, STATE_FILE)
  const state = await readJson(statePath, {}, load)
  const shipped = exists(paths.join(paths.dirname(layout.dshBin), '..', '..', '..', ...OFFICIAL_MARKET_BUNDLE.split('/'), 'package.json'))
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : null
  if (bundles === null) return { status: 'skipped', reason: 'profile-without-bundle-list' }

  let manifestChanged = false
  let stateChanged = false
  const actions = []
  if (!shipped) {
    if (bundles.includes(OFFICIAL_MARKET_BUNDLE)) {
      manifest.dsh.profile.bundles = bundles.filter(name => name !== OFFICIAL_MARKET_BUNDLE)
      state.suspended = true
      manifestChanged = stateChanged = true
      actions.push('suspended-bundle')
    }
  } else {
    // First time on a core that ships it, or coming back to one after a suspension, the bundle is switched on.
    if (state.bundleOffered !== true || state.suspended === true) {
      if (!bundles.includes(OFFICIAL_MARKET_BUNDLE)) {
        manifest.dsh.profile.bundles = [...bundles, OFFICIAL_MARKET_BUNDLE]
        manifestChanged = true
        actions.push('enabled-bundle')
      }
      state.bundleOffered = true
      delete state.suspended
      stateChanged = true
    }
    if (state.indexOffered !== true) {
      const patchPath = paths.join(profileRoot, 'cordis.patch.yml')
      const current = exists(patchPath) ? await load(patchPath, 'utf8') : ''
      const next = withAwesomeIndex(current)
      if (next !== null) {
        await makeDirectory(profileRoot, { recursive: true })
        await writeAtomic(patchPath, next, save, move)
        actions.push('added-index')
      }
      state.indexOffered = true
      stateChanged = true
    }
  }
  if (manifestChanged) await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, save, move)
  if (stateChanged) await writeAtomic(statePath, `${JSON.stringify({ schemaVersion: 1, ...state })}\n`, save, move)
  return { status: actions.length > 0 ? 'configured' : 'unchanged', actions }
}
