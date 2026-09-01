import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDshEnv } from './portable-core.mjs'

export const DEFAULT_PLUGINS = Object.freeze([Object.freeze({
  name: 'dsh-image-viewer',
  version: '0.1.0-beta.8',
  spec: '0.1.0-beta.8',
  filename: 'dsh-image-viewer.tgz',
  url: 'https://registry.npmjs.org/dsh-image-viewer/-/dsh-image-viewer-0.1.0-beta.8.tgz',
  sha256: 'f0da55533daba11b3ae14561fe451ff84637113c38b8ca3e699548d9bae1780c',
  integrity: 'sha512-lMLQdMmXYJtkQAUWl4KgZDC15kztfYlJPjmxwQ/CpLPBQ7XmwvKUPq3Wz9OuWsZqG92kbt5Zv5/Uthpkt/Cu1w==',
  license: 'MIT',
  reviewedCommit: '65fecc574f01d635906a0aa049e8522ef8ca3dcb',
}), Object.freeze({
  name: 'dsh-session-recovery',
  version: '0.1.0-beta.1',
  spec: 'https://github.com/WSL043/dsh-session-recovery/releases/download/v0.1.0-beta.1/dsh-session-recovery-0.1.0-beta.1.tgz',
  filename: 'dsh-session-recovery.tgz',
  url: 'https://github.com/WSL043/dsh-session-recovery/releases/download/v0.1.0-beta.1/dsh-session-recovery-0.1.0-beta.1.tgz',
  sha256: '4d0243b280b1babc0cb2200e8f0d8972fd816be8af4ea3843e80947faf38aa9e',
  integrity: 'sha512-D02jzm05DAPsat7hQYQA2hxoFPDc+bjoWfBY+VOd8XWrVXUtiVTnn6Z67Hf/EalNLDcJhK4jydTXWkJoULzgYg==',
  license: 'MIT',
  reviewedCommit: '6c2879f4809b6797133187602f22160b940c4ed1',
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
    const result = run(layout.nodeExe, [layout.dshBin, 'plugin', '--profile', profile, 'add', ...relativeArchives], {
      cwd: profileRoot,
      env: buildDshEnv(layout),
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result?.error) throw result.error
    if (result?.status !== 0) throw new Error(`Official DSH plugin add exited with status ${result?.status ?? 'unknown'}.`)
    await promoteBundledPluginsToRegistryLifecycle(profileRoot, plugins, adapters)
    await remove(seedMarker, { force: true })
    return { status: 'seeded', profile, plugins: plugins.map(plugin => plugin.name) }
  } catch (error) {
    if (createdProfile) await remove(profileRoot, { recursive: true, force: true }).catch(() => {})
    return { status: 'warning', code: 'default_plugin_seed_failed', profile, profileRolledBack: createdProfile && !exists(profileRoot), message: error?.message ?? String(error) }
  }
}
