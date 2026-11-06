// Enables the official market bundle once for the Portable web profile.
// Discover indexes belong to the user; Portable never adds or edits them.
// Keep the existing opt-out and historical-core suspend/restore compatibility.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadOfficialProfileBundles } from './official-profile-bundles.mjs'

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

async function loadProfileInitialization(layout) {
  // Resolve the CLI's declared dependencies, including a strict pnpm layout.
  // Profile initialization does not require plugin-manager operations exports.
  const require = createRequire(layout.dshBin)
  const bootEntry = require.resolve('@deepseek-ai/dsh-app-boot')
  const bootRequire = createRequire(bootEntry)
  const [boot, atomic] = await Promise.all([
    import(pathToFileURL(bootEntry).href),
    import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href),
  ])
  if (typeof boot.initProfile !== 'function' || typeof atomic.withFileLock !== 'function') {
    throw new Error('Selected runtime has no official profile initialization API.')
  }
  const load = name => import(pathToFileURL(bootRequire.resolve(name)).href)
  return { initProfile: boot.initProfile, withFileLock: atomic.withFileLock,
    ...await loadOfficialProfileBundles(load, boot) }
}

export async function ensureOfficialMarket(layout, adapters = {}) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const exists = adapters.existsSync ?? existsSync
  const load = adapters.readFile ?? readFile
  const save = adapters.writeFile ?? writeFile
  const move = adapters.rename ?? rename
  const makeDirectory = adapters.mkdir ?? mkdir
  // Escape hatch for testing and support: leave the profile exactly as it is.
  if ((adapters.env ?? process.env).DSH_PORTABLE_OFFICIAL_MARKET === '0') return { status: 'skipped', reason: 'disabled-by-environment' }
  const profileRoot = paths.join(layout.dshHome, 'profiles', 'web')
  const manifestPath = paths.join(profileRoot, 'package.json')
  const shipped = exists(paths.join(paths.dirname(layout.dshBin), '..', '..', '..', ...OFFICIAL_MARKET_BUNDLE.split('/'), 'package.json'))
  if (!exists(manifestPath)) {
    if (!shipped) return { status: 'skipped', reason: 'no-profile' }
    const api = await (adapters.loadProfileInitialization ?? loadProfileInitialization)(layout)
    await makeDirectory(profileRoot, { recursive: true })
    return api.withFileLock(manifestPath, async () => {
      if (!exists(manifestPath)) {
        await api.initProfile(profileRoot, api.PROFILE_TEMPLATES.web?.bundles ?? api.DEFAULT_PROFILE_BUNDLES)
      }
      if (!exists(manifestPath)) throw new Error('Official profile initialization did not create its manifest.')
      // Continue the existing one-time offer while the official writer lock is
      // held. A profile created by another writer keeps its bundles and choices.
      return ensureOfficialMarket(layout, adapters)
    }, { waitMs: 0 })
  }

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

  }
  if (manifestChanged) await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, save, move)
  if (stateChanged) await writeAtomic(statePath, `${JSON.stringify({ schemaVersion: 1, ...state })}\n`, save, move)
  return { status: actions.length > 0 ? 'configured' : 'unchanged', actions }
}
