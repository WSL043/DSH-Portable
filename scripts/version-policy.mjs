import { pathToFileURL } from 'node:url'

export function classifyProductVersion(value) {
  const version = String(value ?? '').trim()
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/.exec(version)
  if (!match) {
    throw new Error(`${version || '<empty>'} is not a supported stable or release-candidate version.`)
  }
  const numbers = match.slice(1, 4).map(Number)
  const releaseCandidate = match[4] ? Number(match[4]) : null
  if (numbers.some((part) => part > 65534) || (releaseCandidate !== null && releaseCandidate > 65533)) {
    throw new Error(`${version} is outside the supported stable or release-candidate version range.`)
  }
  return {
    version,
    tag: `v${version}`,
    channel: releaseCandidate === null ? 'stable' : 'candidate',
    updateChannelTag: `update-channel-${releaseCandidate === null ? 'stable' : 'candidate'}`,
    prerelease: releaseCandidate !== null,
    windowsVersion: `${numbers.join('.')}.${releaseCandidate ?? 65534}`,
    macBuildVersion: String(numbers[0] * 1_000_000_000 + numbers[1] * 1_000_000 + numbers[2] * 1000 + (releaseCandidate ?? 999)),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const policy = classifyProductVersion(process.argv[2])
  const suppliedTag = String(process.argv[3] ?? '')
  if (suppliedTag && suppliedTag !== policy.tag) {
    throw new Error(`Release tag ${suppliedTag} does not match product version ${policy.version}; expected ${policy.tag}.`)
  }
  for (const [key, value] of Object.entries(policy)) process.stdout.write(`${key}=${value}\n`)
}
