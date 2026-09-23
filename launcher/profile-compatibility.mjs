import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { safeDataTarget, writeDataFileAtomic } from './data-paths.mjs'

const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/

function packageManifest(root, name) {
  if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) return null
  const modules = path.resolve(root, 'node_modules')
  const filename = path.resolve(modules, ...name.split('/'), 'package.json')
  const relative = path.relative(modules, filename)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return filename
}

function isCommunityBundle(name) {
  return typeof name === 'string'
    && PACKAGE_NAME.test(name)
    && !name.startsWith('@deepseek-ai/')
    && name !== '@wsl043/dsh-portable-desktop-bridge'
    && name !== '@wsl043/dsh-portable-plugin-market'
}

export async function pauseIncompatibleProfileBundles(layout, { satisfies } = {}) {
  const candidate = path.join(layout.dshHome, 'profiles', 'web', 'package.json')
  // The selected state root is trusted; the following safeDataTarget call
  // rejects linked parents before any read or write reaches this file.
  if (!existsSync(candidate)) return { status: 'skipped', paused: [] } // lgtm[js/path-injection]
  const manifestFile = await safeDataTarget(layout.stateRoot, 'data/dsh-home/profiles/web/package.json')
  const profileRoot = path.dirname(manifestFile)
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return { status: 'skipped', paused: [] }
  const active = bundles.filter(isCommunityBundle)
  if (active.length === 0) return { status: 'skipped', paused: [] }

  // Use the exact semver implementation shipped with this DSH runtime. A
  // plugin's own peer range is the compatibility contract; no package-name
  // specific workaround is needed when the next DSH alpha changes its API.
  const semver = satisfies ? null : createRequire(layout.dshBin)('semver')
  const semverSatisfies = satisfies ?? semver.satisfies
  const paused = []
  for (const name of active) {
    const filename = packageManifest(profileRoot, name)
    if (!filename || !existsSync(filename)) continue // DSH reports an unresolved bundle separately.
    const plugin = JSON.parse(await readFile(filename, 'utf8'))
    const incompatiblePeers = []
    for (const [peer, range] of Object.entries(plugin.peerDependencies || {})) {
      if (!peer.startsWith('@deepseek-ai/') || !PACKAGE_NAME.test(peer) || typeof range !== 'string') continue
      const hostFilename = packageManifest(layout.appDir, peer)
      if (!hostFilename || !existsSync(hostFilename)) continue
      const host = JSON.parse(await readFile(hostFilename, 'utf8'))
      if (typeof host.version !== 'string') continue
      try {
        if (semver && !semver.validRange(range)) continue
        if (!semverSatisfies(host.version, range)) incompatiblePeers.push({ peer, required: range, installed: host.version })
      } catch { /* An invalid peer declaration cannot prove incompatibility. */ }
    }
    if (incompatiblePeers.length) paused.push({ name, version: plugin.version || 'unknown', incompatiblePeers })
  }
  if (paused.length === 0) return { status: 'passed', paused }
  const names = new Set(paused.map(item => item.name))
  manifest.dsh.profile.bundles = bundles.filter(name => !names.has(name))
  await writeDataFileAtomic(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  return { status: 'paused', paused }
}
