// Keep only rollback compatibility for profiles that already enabled the official market.
// New profiles, bundle enablement and Discover indexes belong to official DSH/user settings.
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const OFFICIAL_MARKET_BUNDLE = '@deepseek-ai/dsh-experimental-plugin-market-bundle'
const STATE_FILE = '.dsh-portable-official-market.json'

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
  // Escape hatch for testing and support: leave the profile exactly as it is.
  if ((adapters.env ?? process.env).DSH_PORTABLE_OFFICIAL_MARKET === '0') return { status: 'skipped', reason: 'disabled-by-environment' }
  const profileRoot = paths.join(layout.dshHome, 'profiles', 'web')
  const manifestPath = paths.join(profileRoot, 'package.json')
  const shipped = exists(paths.join(paths.dirname(layout.dshBin), '..', '..', '..', ...OFFICIAL_MARKET_BUNDLE.split('/'), 'package.json'))
  if (!exists(manifestPath)) return { status: 'skipped', reason: 'no-profile' }

  const manifest = await readJson(manifestPath, null, load)
  if (manifest === null || typeof manifest !== 'object') return { status: 'skipped', reason: 'unreadable-profile' }
  const statePath = paths.join(profileRoot, STATE_FILE)
  const state = await readJson(statePath, {}, load)
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
  } else if (state.suspended === true) {
    if (!bundles.includes(OFFICIAL_MARKET_BUNDLE)) {
      manifest.dsh.profile.bundles = [...bundles, OFFICIAL_MARKET_BUNDLE]
      manifestChanged = true
      actions.push('enabled-bundle')
    }
    delete state.suspended
    stateChanged = true
  }
  if (manifestChanged) await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, save, move)
  if (stateChanged) await writeAtomic(statePath, `${JSON.stringify({ schemaVersion: 1, ...state })}\n`, save, move)
  return { status: actions.length > 0 ? 'configured' : 'unchanged', actions }
}
