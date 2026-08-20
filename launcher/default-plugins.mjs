import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDshEnv } from './portable-core.mjs'

export const DEFAULT_PLUGINS = Object.freeze([Object.freeze({
  name: 'dsh-native-session-delete',
  version: '1.0.0',
  filename: 'dsh-native-session-delete.tgz',
  url: 'https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.0/dsh-native-session-delete.tgz',
  sha256: 'e51bbe07ca27f87b742438d15afc16319074a338688f8e28480bff084d74462e',
  integrity: 'sha512-PMcKj2vxJQbmWiXTnuuYRcAKWVqmGY1dRnbzYQDNgBhrgK2HmODWloFHFiS9t4EuWpSp7q5SsPfSjzlhdigYzg==',
  license: 'MIT',
  reviewedCommit: '5842dc611884da08c8a95e306a9e41ac0bcb7c7e',
})])

async function verifyPackagedArchive(filename, expectedSha256, adapters) {
  const load = adapters.readFile ?? readFile
  const actual = createHash('sha256').update(await load(filename)).digest('hex')
  if (actual !== expectedSha256) throw new Error('The packaged default plugin archive failed its integrity check.')
  return true
}

export async function seedDefaultPlugins(layout, adapters = {}) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const profile = 'web'
  const profilesRoot = paths.join(layout.dshHome, 'profiles')
  const profileRoot = paths.join(profilesRoot, profile)
  const seedMarker = paths.join(profileRoot, '.dsh-portable-default-seed.json')
  const exists = adapters.existsSync ?? existsSync
  const recoveringInterruptedSeed = exists(profileRoot) && exists(seedMarker)
  if (exists(profileRoot) && !recoveringInterruptedSeed) return { status: 'skipped', profile, reason: 'profile-exists' }

  const plugin = DEFAULT_PLUGINS[0]
  const packagedArchive = paths.join(layout.root, 'default-plugins', plugin.filename)
  const archiveRoot = paths.join(profileRoot, '.dsh-portable-archives')
  const profileArchive = paths.join(archiveRoot, plugin.filename)
  const makeDirectory = adapters.mkdir ?? mkdir
  const copy = adapters.copyFile ?? copyFile
  const remove = adapters.rm ?? rm
  const save = adapters.writeFile ?? writeFile
  const run = adapters.spawnSync ?? spawnSync
  const verify = adapters.verifyArchive ?? ((filename) => verifyPackagedArchive(filename, plugin.sha256, adapters))
  let createdProfile = false

  try {
    await verify(packagedArchive)
    if (recoveringInterruptedSeed) await remove(profileRoot, { recursive: true, force: true })
    await makeDirectory(profilesRoot, { recursive: true })
    try {
      await makeDirectory(profileRoot)
      createdProfile = true
    } catch (error) {
      if (error?.code === 'EEXIST') return { status: 'skipped', profile, reason: 'profile-exists' }
      throw error
    }
    await save(seedMarker, `${JSON.stringify({ schemaVersion: 1, plugin: plugin.name })}\n`, 'utf8')
    await makeDirectory(archiveRoot, { recursive: true })
    await copy(packagedArchive, profileArchive)
    const relativeArchive = `file:${paths.relative(profileRoot, profileArchive).replaceAll('\\', '/')}`
    const result = run(layout.nodeExe, [
      layout.dshBin,
      'plugin', '--profile', profile, 'add', relativeArchive,
    ], {
      cwd: profileRoot,
      env: buildDshEnv(layout),
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result?.error) throw result.error
    if (result?.status !== 0) throw new Error(`Official DSH plugin add exited with status ${result?.status ?? 'unknown'}.`)
    await remove(seedMarker, { force: true })
    return { status: 'seeded', profile, plugins: [plugin.name] }
  } catch (error) {
    if (createdProfile) await remove(profileRoot, { recursive: true, force: true }).catch(() => {})
    return {
      status: 'warning',
      code: 'default_plugin_seed_failed',
      profile,
      profileRolledBack: createdProfile && !exists(profileRoot),
      message: error?.message ?? String(error),
    }
  }
}
