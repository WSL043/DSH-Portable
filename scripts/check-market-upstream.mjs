import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MARKET_VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function parseMarketVersion(value) {
  const match = MARKET_VERSION.exec(String(value ?? ''))
  return match ? match.slice(1).map(BigInt) : null
}

/**
 * Compare two stable dsh-market release tags.
 *
 * The monitor only accepts the exact vMAJOR.MINOR.PATCH form. Invalid values
 * throw so an unexpected registry response cannot become an update signal.
 */
export function compareMarketVersions(leftValue, rightValue) {
  const left = parseMarketVersion(leftValue)
  const right = parseMarketVersion(rightValue)
  if (!left || !right) throw new Error('dsh-market release must be a stable semantic version')
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return 1
    if (left[index] < right[index]) return -1
  }
  return 0
}

export function isNewerMarketRelease(latest, pinned) {
  return compareMarketVersions(latest, pinned) > 0
}

export function evaluateMarketRelease({ pinned, latest, url } = {}) {
  return {
    changed: isNewerMarketRelease(latest, pinned),
    pinned,
    latest,
    url,
  }
}

async function main() {
  const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'))
  const pinned = lock.pluginMarket?.reviewedBasisTag
  if (!/^v\d+\.\d+\.\d+$/.test(pinned ?? '')) {
    throw new Error('pluginMarket.reviewedBasisTag is missing or invalid')
  }

  const response = await fetch('https://api.github.com/repos/dsh-market/dsh-market/releases/latest', {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'DSH-Portable-market-upstream-monitor',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`dsh-market latest release returned HTTP ${response.status}`)
  const latest = await response.json()
  if (!MARKET_VERSION.test(latest.tag_name ?? '') || latest.draft || latest.prerelease) {
    throw new Error('dsh-market latest release is not a stable semantic version')
  }

  const result = evaluateMarketRelease({
    pinned,
    latest: latest.tag_name,
    url: latest.html_url,
  })
  console.log(JSON.stringify(result, null, 2))
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `changed=${result.changed}`,
      `pinned=${result.pinned}`,
      `latest=${result.latest}`,
      `url=${result.url}`,
      '',
    ].join('\n'))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
