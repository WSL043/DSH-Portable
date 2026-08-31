import { existsSync } from 'node:fs'
import path from 'node:path'

export const DEFAULT_PLUGINS = Object.freeze([])

// Retain the startup hook as a compatibility boundary. Portable no longer
// chooses or installs community plugins, and this function never mutates a
// user's profile. Discovery and installation remain ordinary market/DSH flows.
export async function seedDefaultPlugins(layout, adapters = {}) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const profile = 'web'
  const profileRoot = paths.join(layout.dshHome, 'profiles', profile)
  const exists = adapters.existsSync ?? existsSync
  if (exists(profileRoot)) return { status: 'skipped', profile, reason: 'profile-exists' }
  return { status: 'skipped', profile, reason: 'no-compatible-defaults' }
}
