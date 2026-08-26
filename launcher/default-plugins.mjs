import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDshEnv } from './portable-core.mjs'

export const DEFAULT_PLUGINS = Object.freeze([Object.freeze({
  name: 'dsh-native-session-delete',
  version: '1.1.2',
  filename: 'dsh-native-session-delete.tgz',
  url: 'https://registry.npmjs.org/dsh-native-session-delete/-/dsh-native-session-delete-1.1.2.tgz',
  sha256: '671db83c0d15afb17783ecd3f876bbb07acf256b3207136b7b991867c21bdc7e',
  integrity: 'sha512-P1imNSoUPQEYouxCkZCazeQlSPThFqhm7pm/4N2cntxoWRDsoabCyIwnbFMWrxcS+jbNtI1d8xqzCsU5rqVYjg==',
  license: 'MIT',
  reviewedCommit: '9c3202e21ff6fce412e5dc670816022eea1eae00',
}), Object.freeze({
  name: 'dsh-native-image-viewer',
  version: '0.1.0-beta.2',
  filename: 'dsh-native-image-viewer.tgz',
  url: 'https://registry.npmjs.org/dsh-native-image-viewer/-/dsh-native-image-viewer-0.1.0-beta.2.tgz',
  sha256: '8750aac5b6d7245142fc97815157c7dd0e374e54a11f7785d7d07ce2a4d6b0ea',
  integrity: 'sha512-eaXQceLNvF0FtFnOrJ2US66K9IaXE4HBP0+d97lx+UdJQ6cY7qBQYee3FQjwDa5zfvCzWFtPX2cPK7ga0rpzVg==',
  license: 'MIT',
  reviewedCommit: 'c857c21f75298075f99b90d8e23d26bf29dbb6a2',
})])

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
    for (const plugin of DEFAULT_PLUGINS) {
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
    await save(seedMarker, `${JSON.stringify({ schemaVersion: 2, plugins: DEFAULT_PLUGINS.map(plugin => plugin.name) })}\n`, 'utf8')
    await makeDirectory(archiveRoot, { recursive: true })
    const relativeArchives = []
    for (const plugin of DEFAULT_PLUGINS) {
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
    await promoteBundledPluginsToRegistryLifecycle(profileRoot, DEFAULT_PLUGINS, adapters)
    await remove(seedMarker, { force: true })
    return { status: 'seeded', profile, plugins: DEFAULT_PLUGINS.map(plugin => plugin.name) }
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
