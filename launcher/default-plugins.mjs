import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDshEnv } from './portable-core.mjs'

export const DEFAULT_PLUGINS = Object.freeze([Object.freeze({
  name: 'dsh-native-session-delete',
  version: '1.0.7',
  filename: 'dsh-native-session-delete.tgz',
  url: 'https://registry.npmjs.org/dsh-native-session-delete/-/dsh-native-session-delete-1.0.7.tgz',
  sha256: '7b6660552ea6f14796f3e54b4d05caec2ae3cb9c3e9a9e22bed616ab84f440f9',
  integrity: 'sha512-7x9B9CX3DMeiKhODBje/rat2pnYQUwVUNk5r+YOBXpS/Yv8XV48mm6ou+Eod9KA9sggTmdP3tv9de/z0Z9D6og==',
  license: 'MIT',
  reviewedCommit: '38c77d3765d81d5702202e68ed7b77f5ea0afe04',
})])

async function promoteBundledPluginToRegistryLifecycle(profileRoot, plugin, adapters = {}) {
  const load = adapters.readFile ?? readFile
  const save = adapters.writeFile ?? writeFile
  const move = adapters.rename ?? rename
  const manifestPath = path.join(profileRoot, 'package.json')
  const temporary = `${manifestPath}.${process.pid}.tmp`
  const manifest = JSON.parse(await load(manifestPath, 'utf8'))
  manifest.dependencies ??= {}
  manifest.dependencies[plugin.name] = plugin.version
  await save(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await move(temporary, manifestPath)
}

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
    // The local tarball makes first boot fully offline. Once installed, expose
    // its exact published version in the profile manifest so DSH's normal
    // plugin manager and the built-in market can discover future npm updates.
    await promoteBundledPluginToRegistryLifecycle(profileRoot, plugin, adapters)
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
