import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cp, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDshEnv } from './portable-core.mjs'
import { comparePortableVersions } from './update-core.mjs'
import { redactDiagnosticText } from './diagnostic-policy.mjs'

function pluginInstallError(result) {
  const detail = redactDiagnosticText(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`).trim().slice(-8192)
  return new Error(`Official DSH plugin add exited with status ${result?.status ?? 'unknown'}.${detail ? `\n${detail}` : ''}`)
}

const PREVIOUS_DEFAULT_PLUGINS = Object.freeze([Object.freeze({
  name: 'dsh-image-viewer',
  version: '0.1.1',
  spec: '0.1.1',
  filename: 'dsh-image-viewer.tgz',
  url: 'https://registry.npmjs.org/dsh-image-viewer/-/dsh-image-viewer-0.1.1.tgz',
  sha256: 'e1ee6ba3de971f0535fd0ec832d2db0ef067b5fc431e9744ec523c299c95e08d',
  integrity: 'sha512-4wtSw7MnMK+NG6uXB3M5Q1Po6oSK+TwQ2hN6RD6vSt3i7kkCAS9lhSHH2iZQGFfRIZKJgeibBaqms9B6QaS5Sg==',
  license: 'MIT',
  reviewedCommit: '08578a2dea82c972aad73afc918afa8e347b5e0e',
}), Object.freeze({
  name: 'dsh-chat-manager',
  version: '1.3.5',
  spec: '1.3.5',
  filename: 'dsh-chat-manager.tgz',
  url: 'https://registry.npmjs.org/dsh-chat-manager/-/dsh-chat-manager-1.3.5.tgz',
  sha256: '5c65f0c247124a92a5604501666ffd1de0357b241406b3735cb08bef9bc746cc',
  integrity: 'sha512-25Kzz5ulHvXpRthShMveesuIkaF0p0n5XCT8PPeKykDSwByGsTri6Kvp0J+5asCFNGSPkGPw/vtgNL/sy+P6XA==',
  license: 'MIT',
  reviewedCommit: '7fabd0a2f10b57632cfcbd25a36bd7d74828baea',
})])

// Keep previous package identities for recovery of existing component manifests.
export const DEFAULT_PLUGINS = Object.freeze([
  {
    "name": "dsh-image-viewer",
    "version": "0.1.2",
    "spec": "0.1.2",
    "url": "https://registry.npmjs.org/dsh-image-viewer/-/dsh-image-viewer-0.1.2.tgz",
    "sha256": "a77562441e06e5ed642ce4e3e4151eb61dd33b113cb522bdf5c88f37858d8745",
    "integrity": "sha512-9ilOoT/JmgHK06bDZjcfr2L7vSrinCmvaSFnB3RKl6nwKifrxK90n/WVRKOPuH7ggwuGwcjGqqcZOlgXefu7rQ==",
    "license": "MIT",
    "reviewedCommit": "9e68c8a5b95c2621506efc9853433dbc5c3c60f8",
    "filename": "dsh-image-viewer.tgz"
  },
  {
    "name": "dsh-chat-manager",
    "version": "1.5.1",
    "spec": "1.5.1",
    "url": "https://registry.npmjs.org/dsh-chat-manager/-/dsh-chat-manager-1.5.1.tgz",
    "sha256": "ba0d411e21b09e8f4426c02d57ce4d619530e8235ea42ad4f1a5ccc4adc6899d",
    "integrity": "sha512-nOtQ2xhigFlQDka6IWVBmY6FiNhz+pSIJGQv+o37ejYWTpfMmsyZsQEZdpX0tgQ6WpvckryVW67Tmj0UiaSV5Q==",
    "license": "MIT",
    "reviewedCommit": "a17dec5904c2cee909f0a852e509b9aedc189a87",
    "filename": "dsh-chat-manager.tgz"
  }
].map(Object.freeze))

// Candidate builds may pin newer reviewed plugin versions without changing
// the released stable package identities above.
export const PREVIEW_DEFAULT_PLUGINS = Object.freeze([
  {
    name: 'dsh-image-viewer',
    version: '0.1.3-beta.1',
    spec: '0.1.3-beta.1',
    url: 'https://registry.npmjs.org/dsh-image-viewer/-/dsh-image-viewer-0.1.3-beta.1.tgz',
    sha256: '31770b60d9996b8cde8833e24c7c153c222dfa59e01d14ed97e0bb277da64d1f',
    integrity: 'sha512-mw/nOix6wPb0e8V4AdPE8lts8w9c7o6xGLMJk/i2ShyPJgVIE0YkZ0sMKJbTnJqwTaN4W/I+X20WNwvearQe4Q==',
    license: 'MIT',
    reviewedCommit: 'fa68a961ae2a23e53ef6554ca338ee771d79f647',
    filename: 'dsh-image-viewer.tgz',
  },
  {
    name: 'dsh-chat-manager',
    version: '1.5.2-beta.3',
    spec: '1.5.2-beta.3',
    url: 'https://registry.npmjs.org/dsh-chat-manager/-/dsh-chat-manager-1.5.2-beta.3.tgz',
    sha256: '93ec7f95d72be129d035ffe55ba666d2936d23ea4752a96b54cf2655088fbd90',
    integrity: 'sha512-1+VATIBbVhgsk++55PgZQHff1/KyG8wRkF8pmoZNKfj2v1CbO6MpR6GW+CN/DmPFQ3wfnx5Nf8aE/Z3zjz3Lyw==',
    license: 'MIT',
    reviewedCommit: '720579ecc27abfd21450312058af7e454cd465a5',
    filename: 'dsh-chat-manager.tgz',
  },
].map(Object.freeze))

export function defaultsForProduct(layout, adapters = {}) {
  const exists = adapters.existsSync ?? existsSync
  const load = adapters.readFileSync ?? readFileSync
  const components = path.join(layout.root, 'licenses', 'COMPONENTS.json')
  if (!exists(components)) return DEFAULT_PLUGINS
  const configured = JSON.parse(load(components, 'utf8')).defaultPlugins
  if (!Array.isArray(configured)) throw new Error('Portable component metadata has no default plugin list.')
  if (new Set(configured.map(entry => entry?.package)).size !== configured.length) {
    throw new Error('Portable component metadata contains duplicate default plugins.')
  }
  return Object.freeze(configured.map((entry) => {
    const matched = [...DEFAULT_PLUGINS, ...PREVIEW_DEFAULT_PLUGINS, ...PREVIOUS_DEFAULT_PLUGINS].find(plugin => plugin.name === entry?.package && plugin.version === entry?.version)
    if (!matched || matched.sha256 !== entry?.sha256 || matched.integrity !== entry?.integrity) {
      throw new Error(`Portable component metadata contains an unrecognized default plugin: ${entry?.package ?? 'unknown'}`)
    }
    return matched
  }))
}

async function promoteBundledPluginsToRegistryLifecycle(profileRoot, plugins, adapters = {}, disabledNames = []) {
  const load = adapters.readFile ?? readFile
  const save = adapters.writeFile ?? writeFile
  const move = adapters.rename ?? rename
  const manifestPath = path.join(profileRoot, 'package.json')
  const temporary = `${manifestPath}.${process.pid}.tmp`
  const manifest = JSON.parse(await load(manifestPath, 'utf8'))
  manifest.dependencies ??= {}
  for (const plugin of plugins) manifest.dependencies[plugin.name] = plugin.spec ?? plugin.version
  // Official add enables bundles. A product refresh must preserve the user's
  // explicit disabled state, especially when they disabled a broken version.
  if (Array.isArray(manifest.dsh?.profile?.bundles) && disabledNames.length) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => !disabledNames.includes(name))
  }
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

async function bundledInstallEnvironment(layout, adapters) {
  const store = path.join(layout.root, 'default-plugins', 'store')
  if ((adapters.existsSync ?? existsSync)(store)) {
    await (adapters.cp ?? cp)(store, layout.packageManagerStore, { recursive: true, force: false,
      filter: source => path.basename(source) !== 'projects' })
  }
  return { ...buildDshEnv(layout), pnpm_config_offline: 'true', npm_config_offline: 'true',
    pnpm_config_cache_dir: path.join(layout.packageManagerStore, 'metadata'),
    npm_config_cache_dir: path.join(layout.packageManagerStore, 'metadata') }
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
  const previousBundles = JSON.parse(manifestBefore).dsh?.profile?.bundles
  const disabledNames = Array.isArray(previousBundles)
    ? candidates.filter(plugin => !previousBundles.includes(plugin.name)).map(plugin => plugin.name)
    : []
  const installedChatVersion = installedDefaultVersion(profileRoot, { name: 'dsh-chat-manager' }, adapters)
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
      env: await bundledInstallEnvironment(layout, adapters),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    })
    if (result?.error) throw result.error
    if (result?.status !== 0) throw pluginInstallError(result)
    await promoteBundledPluginsToRegistryLifecycle(profileRoot, candidates, adapters, disabledNames)
    return { status: 'updated', profile, plugins: candidates.map(plugin => plugin.name) }
  } catch (error) {
    // Alpha 2 changed the workspace/session lifecycle. The old bundled
    // replacement prevents session creation if the offline upgrade fails.
    // Disable only the reproduced combination, keeping dependencies and data.
    let restoredManifest = manifestBefore
    const disabledPlugins = []
    const previous = JSON.parse(manifestBefore)
    const bundles = previous.dsh?.profile?.bundles
    const componentsPath = paths.join(layout.root, 'licenses', 'COMPONENTS.json')
    if (Array.isArray(bundles) && bundles.includes('dsh-chat-manager')
      && (adapters.existsSync ?? existsSync)(componentsPath)) {
      const components = JSON.parse(await load(componentsPath, 'utf8'))
      const incompatible = (components.dshVersion === '0.1.6-alpha.2' && installedChatVersion === '1.3.5')
        || (components.dshVersion === '0.1.7-alpha.1' && ['1.3.5', '1.4.0-beta.1', '1.4.0-beta.2', '1.4.0-beta.3'].includes(installedChatVersion))
      if (incompatible) {
        previous.dsh.profile.bundles = bundles.filter(name => name !== 'dsh-chat-manager')
        disabledPlugins.push('dsh-chat-manager')
        restoredManifest = `${JSON.stringify(previous, null, 2)}\n`
      }
    }
    const temporary = `${manifestPath}.${process.pid}.restore.tmp`
    // Do not claim a recovered profile if writing it failed.
    await save(temporary, restoredManifest, 'utf8')
    await move(temporary, manifestPath)
    return { status: 'warning', code: 'default_plugin_update_failed', profile,
      ...(disabledPlugins.length ? { disabledPlugins } : {}),
      message: `${disabledPlugins.length ? `Paused incompatible dsh-chat-manager ${installedChatVersion}; plugin files and session data are retained. Update the plugin before enabling it again. ` : ''}${error?.message ?? String(error)}` }
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
      env: await bundledInstallEnvironment(layout, adapters),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
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
