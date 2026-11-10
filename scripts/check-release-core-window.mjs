import { pathToFileURL } from 'node:url'
import { comparePortableVersions, coreWindow } from '../launcher/update-core.mjs'
import { verifyUpdateSignature } from '../launcher/update-signature.mjs'

const platforms = ['windows-x64', 'macos-arm64', 'macos-x64', 'linux-arm64', 'linux-x64']
const channel = 'https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core-stable'

export function checkReleaseCoreWindow(rows, catalogs, { sourceSha, version, contract, nodeVersion }) {
  const versions = coreWindow([...new Set(rows.map(row => row.version))].sort((a, b) => comparePortableVersions(b, a)))
  const qualified = new Set(rows.filter(row => row.status === 'success').map(row => row.version))
  const statuses = versions.map(core => {
    const row = rows.find(item => item.version === core && item.sourceSha === sourceSha)
    if (row?.status === 'blocked') return [core, qualified.has(core) ? 'blocked' : 'excused']
    if (row?.status === 'failed') return [core, 'failed']

    const visible = platforms.every(platform => {
      const index = catalogs[platform]
      if (index?.schemaVersion !== 1 || index.channel !== 'stable' || index.platform !== platform
        || !Array.isArray(index.versions)) return false
      return index.versions.some(({ version: offered, manifest }) =>
        offered === core && manifest?.platform === platform && manifest.updateKind === 'engine'
        && manifest.releaseChannel === 'stable' && manifest.component?.dshVersion === core
        && manifest.component.requiredNodeVersion === nodeVersion
        && (manifest.requiredShellContract === contract
          || (manifest.requiredShellContract == null && manifest.portableVersion === version && row?.status === 'success')))
    })
    return [core, visible ? 'success' : 'pending']
  })
  const states = statuses.map(([, state]) => state)
  return {
    statuses,
    exitCode: states.some(state => state === 'blocked' || state === 'failed') ? 3
      : states.includes('success') && !states.includes('pending') ? 0 : 1,
  }
}

async function fetchSignedCatalog(platform) {
  const url = `${channel}/dsh-core-index-${platform}.json`
  const signal = AbortSignal.timeout(15000)
  const [data, signature] = await Promise.all([fetch(url, { signal }), fetch(url + '.sig', { signal })])
  if (!data.ok || !signature.ok) throw new Error(`Core catalog unavailable for ${platform}`)
  const bytes = Buffer.from(await data.arrayBuffer())
  if (!verifyUpdateSignature(bytes, await signature.text())) throw new Error(`Core catalog signature mismatch for ${platform}`)
  return [platform, JSON.parse(bytes)]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sourceSha, version, contract, nodeVersion] = process.argv.slice(2)
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  try {
    const catalogs = Object.fromEntries(await Promise.all(platforms.map(fetchSignedCatalog)))
    const result = checkReleaseCoreWindow(JSON.parse(input), catalogs, { sourceSha, version, contract: Number(contract), nodeVersion })
    console.log(result.statuses.map(([core, status]) => `${core} ${status}`).join('; '))
    process.exitCode = result.exitCode
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
