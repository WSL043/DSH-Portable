import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDshEnv } from './portable-core.mjs'
import { comparePortableVersions } from './update-core.mjs'
import { redactDiagnosticText } from './diagnostic-policy.mjs'

function pluginInstallError(result) {
  const detail = redactDiagnosticText(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`).trim().slice(-8192)
  return new Error(`Official DSH plugin add exited with status ${result?.status ?? 'unknown'}.${detail ? `\n${detail}` : ''}`)
}

export const DEFAULT_PLUGINS = Object.freeze([Object.freeze({
  name: 'dsh-image-viewer',
  version: '0.1.0-beta.10',
  spec: '0.1.0-beta.10',
  filename: 'dsh-image-viewer.tgz',
  url: 'https://registry.npmjs.org/dsh-image-viewer/-/dsh-image-viewer-0.1.0-beta.10.tgz',
  sha256: '0730b9c7e997e232a37d41225079e82bd34e5de24e51c6ed509f7b0f452af2b6',
  integrity: 'sha512-xMbDhY2BfWFWBJ6ljiL2s6qhYA2I6szcfyRG2mnBhujqJ1qjSpIIGsDTe4SoFm7SSW7sMQL6jCrPAdQ2wqn9cg==',
  license: 'MIT',
  reviewedCommit: 'c679dbe79fdea85107fc1dce3a1097e5652f4518',
}), Object.freeze({
  name: 'dsh-chat-manager',
  version: '1.3.2',
  spec: '1.3.2',
  filename: 'dsh-chat-manager.tgz',
  url: 'https://registry.npmjs.org/dsh-chat-manager/-/dsh-chat-manager-1.3.2.tgz',
  sha256: '663103fe37b087d0199d6422a5c7cb1d210cc4baceeed28b844f2cb416f5eb35',
  integrity: 'sha512-wYBqYb0FnClP63/+PNwNqfcwLh8MsfDyKQ0fXAqDPi4YAZsJLBomr5nx6B4tNs2ZiHddbZRVxuxdNT/rZ9S7/g==',
  license: 'MIT',
  reviewedCommit: 'edfb8d14499e57ec60cb807e79ae38adbd2a6714',
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
  for (const plugin of plugins) manifest.dependencies[plugin.name] = plugin.spec ?? plugin.version
  await save(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await move(temporary, manifestPath)
}

async function verifyPackagedArchive(filename, expectedSha256, adapters) {
  const load = adapters.readFile ?? readFile
  const actual = createHash('sha256').update(await load(filename)).digest('hex')
  if (actual !== expectedSha256) throw new Error('The packaged default plugin archive failed its integrity check.')
}

function exactVersionFromSpec(value) {
  const match = /^(?:v)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/.exec(String(value ?? '').trim())
  return match?.[1] ?? null
}

function installedDefaultVersion(profileRoot, plugin, adapters = {}) {
  const exists = adapters.existsSync ?? existsSync
  const load = adapters.readFileSync ?? readFileSync
  let manifest
  try {
    manifest = JSON.parse(load(path.join(profileRoot, 'package.json'), 'utf8'))
  } catch (error) {
    // Existing profiles may contain settings or migration markers before DSH
    // creates a package manifest. No dependency declaration means no default
    // plugin is installed; preserve that directory and let DSH initialize it.
    if (error?.code === 'ENOENT') return null
    throw error
  }
  const spec = manifest.dependencies?.[plugin.name]
  if (spec === undefined) return null
  const installedManifest = path.join(profileRoot, 'node_modules', plugin.name, 'package.json')
  if (exists(installedManifest)) {
    try {
      const version = exactVersionFromSpec(JSON.parse(load(installedManifest, 'utf8')).version)
      if (version !== null) return version
    } catch { /* fall back to an exact manifest dependency */ }
  }
  return exactVersionFromSpec(spec)
}

async function refreshInstalledDefaults(layout, profileRoot, profile, plugins, adapters = {}) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const candidates = plugins.filter((plugin) => {
    const installed = installedDefaultVersion(profileRoot, plugin, adapters)
    return installed !== null && comparePortableVersions(installed, plugin.version) < 0
  })
  if (candidates.length === 0) return { status: 'skipped', profile, reason: 'defaults-current' }

  const archiveRoot = paths.join(profileRoot, '.dsh-portable-archives')
  const makeDirectory = adapters.mkdir ?? mkdir
  const copy = adapters.copyFile ?? copyFile
  const load = adapters.readFile ?? readFile
  const save = adapters.writeFile ?? writeFile
  const move = adapters.rename ?? rename
  const run = adapters.spawnSync ?? spawnSync
  const manifestPath = paths.join(profileRoot, 'package.json')
  const manifestBefore = await load(manifestPath, 'utf8')
  try {
    await makeDirectory(archiveRoot, { recursive: true })
    const relativeArchives = []
    for (const plugin of candidates) {
      const packagedArchive = paths.join(layout.root, 'default-plugins', plugin.filename)
      const verify = adapters.verifyArchive ?? ((filename) => verifyPackagedArchive(filename, plugin.sha256, adapters))
      await verify(packagedArchive, plugin)
      const profileArchive = paths.join(archiveRoot, plugin.filename)
      await copy(packagedArchive, profileArchive)
      relativeArchives.push(`file:${paths.relative(profileRoot, profileArchive).replaceAll('\\', '/')}`)
    }
    const result = run(layout.nodeExe, [layout.dshBin, 'plugin', '--profile', profile, 'add', ...relativeArchives], {
      cwd: profileRoot,
      env: buildDshEnv(layout),
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result?.error) throw result.error
    if (result?.status !== 0) throw pluginInstallError(result)
    await promoteBundledPluginsToRegistryLifecycle(profileRoot, candidates, adapters)
    return { status: 'updated', profile, plugins: candidates.map(plugin => plugin.name) }
  } catch (error) {
    const temporary = `${manifestPath}.${process.pid}.restore.tmp`
    await save(temporary, manifestBefore, 'utf8').then(() => move(temporary, manifestPath)).catch(() => {})
    return { status: 'warning', code: 'default_plugin_update_failed', profile, message: error?.message ?? String(error) }
  }
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
  if (exists(profileRoot) && !recoveringInterruptedSeed) {
    return refreshInstalledDefaults(layout, profileRoot, profile, plugins, adapters)
  }

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
    const result = run(layout.nodeExe, [layout.dshBin, 'plugin', '--profile', profile, 'add', ...relativeArchives], {
      cwd: profileRoot,
      env: buildDshEnv(layout),
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result?.error) throw result.error
    if (result?.status !== 0) throw pluginInstallError(result)
    await promoteBundledPluginsToRegistryLifecycle(profileRoot, plugins, adapters)
    await remove(seedMarker, { force: true })
    return { status: 'seeded', profile, plugins: plugins.map(plugin => plugin.name) }
  } catch (error) {
    if (createdProfile) await remove(profileRoot, { recursive: true, force: true }).catch(() => {})
    return { status: 'warning', code: 'default_plugin_seed_failed', profile, profileRolledBack: createdProfile && !exists(profileRoot), message: error?.message ?? String(error) }
  }
}
