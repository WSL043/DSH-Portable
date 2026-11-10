// Verify the stable feed and use the same signed core window as the release gate.
import { pathToFileURL } from 'node:url'
import { comparePortableVersions } from '../launcher/update-core.mjs'
import { verifyUpdateSignature } from '../launcher/update-signature.mjs'
import { checkReleaseCoreWindow, readStableCoreCatalogs } from './check-release-core-window.mjs'

const GRACE_MS = 3 * 60 * 60 * 1000
// Shells from this version on publish signed update metadata, which mirrors depend on.
const SIGNED_FROM = '0.8.13'

export function evaluateChannelHealth({ latestRelease, feedVersion, state, catalogs, contract, nodeVersion, signature = 'valid', now = Date.now() }) {
  const problems = []
  if (!latestRelease?.tag || !latestRelease?.sha) return { healthy: false, problems: ['no published shell release was found'] }
  const latest = latestRelease.tag.replace(/^v/, '')
  const age = now - Date.parse(latestRelease.publishedAt)
  if (feedVersion !== latest) {
    // The feed is held on purpose while cores are qualified; only a hold that outlives the grace window is a problem.
    if (age > GRACE_MS) problems.push(`the in-app feed offers ${feedVersion || 'nothing'} but ${latest} was published ${Math.round(age / 3600000)} h ago`)
    return { healthy: problems.length === 0, problems, held: problems.length === 0 }
  }
  if (signature === 'invalid') problems.push('the feed signature does not verify with the built-in public key, so mirrors cannot be used')
  else if (signature === 'missing' && comparePortableVersions(feedVersion, SIGNED_FROM) >= 0) problems.push(`the feed for ${feedVersion} has no signature`)
  const { statuses, exitCode } = checkReleaseCoreWindow(state ?? [], catalogs ?? {}, {
    sourceSha: latestRelease.sha, version: latest, contract, nodeVersion,
  })
  for (const [version, status] of statuses) {
    if (status === 'pending') problems.push(`core ${version} is missing from one or more compatible signed catalogs for shell ${latest}`)
    else if (status === 'failed' || status === 'blocked') problems.push(`core ${version} is ${status} on shell ${latest}`)
  }
  if (exitCode !== 0 && !problems.length) problems.push('the core window has no qualified version')
  return { healthy: problems.length === 0, problems }
}

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-portable-channel-health' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

async function readChannelHealth() {
  const release = await json('https://api.github.com/repos/WSL043/DSH-Portable/releases/latest')
  const commit = await json(`https://api.github.com/repos/WSL043/DSH-Portable/commits/${release.tag_name}`)
  const feedUrl = 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-update-windows-x64.json'
  const [response, feedSignature] = await Promise.all([fetch(feedUrl), fetch(`${feedUrl}.sig`)])
  if (!response.ok) throw new Error(`Stable product feed returned HTTP ${response.status}`)
  const feedBytes = Buffer.from(await response.arrayBuffer())
  const feed = JSON.parse(feedBytes)
  const signature = !feedSignature.ok
    ? 'missing'
    : verifyUpdateSignature(feedBytes, await feedSignature.text()) ? 'valid' : 'invalid'
  const offered = {
    latestRelease: { tag: release.tag_name, publishedAt: release.published_at, sha: commit.sha },
    feedVersion: feed.portableVersion,
    signature,
  }
  if (release.tag_name !== `v${feed.portableVersion}`) return evaluateChannelHealth(offered)
  const [state, catalogs, shell] = await Promise.all([
    json('https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core/qualification-state.json'),
    readStableCoreCatalogs(),
    json(`https://raw.githubusercontent.com/WSL043/DSH-Portable/${commit.sha}/config/shell-contract.json`),
  ])
  if (!Number.isSafeInteger(shell.contract) || typeof feed.component?.requiredNodeVersion !== 'string') {
    throw new Error('The published shell is missing its core contract or Node version')
  }
  return evaluateChannelHealth({ ...offered, state, catalogs, contract: shell.contract, nodeVersion: feed.component.requiredNodeVersion })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await readChannelHealth().catch(error => ({ healthy: false, problems: [error.message] }))
  console.log(JSON.stringify(result))
  process.exitCode = result.healthy ? 0 : 1
}
