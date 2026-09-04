import { pathToFileURL } from 'node:url'

export function classifyProductVersion(value) {
  const version = String(value ?? '').trim()
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/.exec(version)
  if (!match) {
    throw new Error(`${version || '<empty>'} is not a supported stable, alpha, beta, or release-candidate version.`)
  }
  const numbers = match.slice(1, 4).map(Number)
  const stage = match[4] ?? 'stable'
  const prereleaseNumber = match[5] ? Number(match[5]) : null
  if (numbers.some((part) => part > 65534) || (prereleaseNumber !== null && prereleaseNumber > 199)) {
    throw new Error(`${version} is outside the supported stable, alpha, beta, or release-candidate version range.`)
  }
  const channel = stage === 'stable' ? 'stable' : 'candidate'
  const windowsStageBase = { alpha: 10000, beta: 30000, rc: 50000 }
  const macStageBase = { alpha: 100, beta: 400, rc: 700 }
  return {
    version,
    tag: `v${version}`,
    channel,
    stage,
    updateChannelTag: `update-channel-${channel}`,
    prerelease: stage !== 'stable',
    windowsVersion: `${numbers.join('.')}.${stage === 'stable' ? 65534 : windowsStageBase[stage] + prereleaseNumber}`,
    macBuildVersion: String(numbers[0] * 1_000_000_000 + numbers[1] * 1_000_000 + numbers[2] * 1000 + (stage === 'stable' ? 999 : macStageBase[stage] + prereleaseNumber)),
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
