import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDshEnv } from './portable-core.mjs'

export const DEFAULT_PLUGINS = Object.freeze([Object.freeze({
  name: 'dsh-chat-manager',
  version: '1.2.2',
  filename: 'dsh-chat-manager.tgz',
  url: 'https://registry.npmjs.org/dsh-chat-manager/-/dsh-chat-manager-1.2.2.tgz',
  sha256: 'cb32c1201d5ba2922e354c05e4dec1e17ad0affdc1c3bd0e243d4d84d7048a1e',
  integrity: 'sha512-yrBK7EliaXXwyftqG0AeNYa9qI+MeuuXqG164Q4ko5N3BxMg+5hR8X0cG/6IGrXZHC/X2kHKkph7ADY2F9QEqg==',
  license: 'MIT',
  reviewedCommit: '65ec7ed3aa26811343359379379d3e58a55c5a92',
}), Object.freeze({
  name: 'dsh-image-viewer',
  version: '0.1.0-beta.5',
  filename: 'dsh-image-viewer.tgz',
  url: 'https://registry.npmjs.org/dsh-image-viewer/-/dsh-image-viewer-0.1.0-beta.5.tgz',
  sha256: '8e72e84ac602b92cd26638d0303968303bc9bafc033eb921d99cf5f532ceedc2',
  integrity: 'sha512-9+98EVpcOnxikcAY9yVCcTLRWke5icqyPjek/1eiz9PQfidsgckEN9V00qQWM1AsqTWnZHa1lpHZEQajhqG1SA==',
  license: 'MIT',
  reviewedCommit: '36f70c920bf1ea1cd85fad0a5be0c64af1269d48',
})])

function defaultsForProduct(layout, adapters = {}) {
  const exists = adapters.existsSync ?? existsSync
  const load = adapters.readFileSync ?? readFileSync
  const components = path.join(layout.root, 'licenses', 'COMPONENTS.json')
  if (!exists(components)) return DEFAULT_PLUGINS
  const configured = JSON.parse(load(components, 'utf8')).defaultPlugins
  if (!Array.isArray(configured)) throw new Error('Portable component metadata has no default plugin list.')
  return Object.freeze(configured.map((entry) => {
    const matched = DEFAULT_PLUGINS.find(plugin => plugin.name === entry?.package && plugin.version === entry?.version)
    if (!matched || matched.sha256 !== entry?.sha256 || matched.integrity !== entry?.integrity) {
      throw new Error(`Portable component metadata contains an unrecognized default plugin: ${entry?.package ?? 'unknown'}`)
    }
    return matched
  }))
}

async function promoteBundledPluginsToRegistryLifecycle(profileRoot, plugins, adapters = {}) {
  const load = adapters.readFile ?? readFile
  const save = adapters.writeFile ?? writeFile
  const move = adapters.rename ?? rename
  const manifestPath = path.join(profileRoot, 'package.json')
  const temporary = `${manifestPath}.${process.pid}.tmp`
  const manifest = JSON.parse(await load(manifestPath, 'utf8'))
  manifest.dependencies ??= {}
  for (const plugin of plugins) manifest.dependencies[plugin.name] = plugin.version
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
  const plugins = defaultsForProduct(layout, adapters)
  if (plugins.length === 0) return { status: 'skipped', profile, reason: 'no-compatible-defaults' }
  const recoveringInterruptedSeed = exists(profileRoot) && exists(seedMarker)
  if (exists(profileRoot) && !recoveringInterruptedSeed) return { status: 'skipped', profile, reason: 'profile-exists' }

  const archiveRoot = paths.join(profileRoot, '.dsh-portable-archives')
  const makeDirectory = adapters.mkdir ?? mkdir
  const copy = adapters.copyFile ?? copyFile
  const remove = adapters.rm ?? rm
  const save = adapters.writeFile ?? writeFile
  const run = adapters.spawnSync ?? spawnSync
  let createdProfile = false

  try {
    for (const plugin of plugins) {
      const packagedArchive = paths.join(layout.root, 'default-plugins', plugin.filename)
      const verify = adapters.verifyArchive ?? ((filename) => verifyPackagedArchive(filename, plugin.sha256, adapters))
      await verify(packagedArchive, plugin)
    }
    if (recoveringInterruptedSeed) await remove(profileRoot, { recursive: true, force: true })
    await makeDirectory(profilesRoot, { recursive: true })
    try {
      await makeDirectory(profileRoot)
      createdProfile = true
    } catch (error) {
      if (error?.code === 'EEXIST') return { status: 'skipped', profile, reason: 'profile-exists' }
      throw error
    }
    await save(seedMarker, `${JSON.stringify({ schemaVersion: 2, plugins: plugins.map(plugin => plugin.name) })}\n`, 'utf8')
    await makeDirectory(archiveRoot, { recursive: true })
    const relativeArchives = []
    for (const plugin of plugins) {
      const packagedArchive = paths.join(layout.root, 'default-plugins', plugin.filename)
      const profileArchive = paths.join(archiveRoot, plugin.filename)
      await copy(packagedArchive, profileArchive)
      relativeArchives.push(`file:${paths.relative(profileRoot, profileArchive).replaceAll('\\', '/')}`)
    }
    const result = run(layout.nodeExe, [
      layout.dshBin, 'plugin', '--profile', profile, 'add', ...relativeArchives,
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
    await promoteBundledPluginsToRegistryLifecycle(profileRoot, plugins, adapters)
    await remove(seedMarker, { force: true })
    return { status: 'seeded', profile, plugins: plugins.map(plugin => plugin.name) }
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
