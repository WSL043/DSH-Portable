import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

function packageManifest(root, name) {
  return path.join(root, 'node_modules', ...name.split('/'), 'package.json')
}

function isCommunityBundle(name) {
  return typeof name === 'string'
    && /^(?:@[^/]+\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
    && !name.startsWith('@deepseek-ai/')
    && name !== '@wsl043/dsh-portable-desktop-bridge'
    && name !== '@wsl043/dsh-portable-plugin-market'
}

export async function pauseIncompatibleProfileBundles(layout, { satisfies } = {}) {
  const profileRoot = path.join(layout.dshHome, 'profiles', 'web')
  const manifestFile = path.join(profileRoot, 'package.json')
  if (!existsSync(manifestFile)) return { status: 'skipped', paused: [] }
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
    if (!existsSync(filename)) continue // DSH reports an unresolved bundle separately.
    const plugin = JSON.parse(await readFile(filename, 'utf8'))
    const incompatiblePeers = []
    for (const [peer, range] of Object.entries(plugin.peerDependencies || {})) {
      if (!peer.startsWith('@deepseek-ai/') || typeof range !== 'string') continue
      const hostFilename = packageManifest(layout.appDir, peer)
      if (!existsSync(hostFilename)) continue
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
  const temporary = `${manifestFile}.${process.pid}.compat.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporary, manifestFile)
  return { status: 'paused', paused }
}
