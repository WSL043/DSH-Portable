// Decide whether the stable update channel is healthy: the in-app feed points at a published shell and the newest
// three official cores are qualified on exactly that shell. Used by .github/workflows/channel-health.yml, which opens
// an issue when this reports a problem, so a broken channel is noticed by us and not by a user (issue #163).
import { pathToFileURL } from 'node:url'
import { comparePortableVersions } from '../launcher/update-core.mjs'

const GRACE_MS = 3 * 60 * 60 * 1000

export function evaluateChannelHealth({ latestRelease, feedVersion, state, now = Date.now() }) {
  const problems = []
  if (!latestRelease?.tag || !latestRelease?.sha) return { healthy: false, problems: ['no published shell release was found'] }
  const latest = latestRelease.tag.replace(/^v/, '')
  const age = now - Date.parse(latestRelease.publishedAt)
  if (feedVersion !== latest) {
    // The feed is held on purpose while cores are qualified; only a hold that outlives the grace window is a problem.
    if (age > GRACE_MS) problems.push(`the in-app feed offers ${feedVersion || 'nothing'} but ${latest} was published ${Math.round(age / 3600000)} h ago`)
    return { healthy: problems.length === 0, problems, held: problems.length === 0 }
  }
  const versions = [...new Set((state ?? []).map(row => row.version))].sort((a, b) => comparePortableVersions(b, a)).slice(0, 3)
  const here = (state ?? []).filter(row => latestRelease.sha.startsWith(String(row.sourceSha).slice(0, 7)))
  for (const version of versions) {
    const row = here.find(item => item.version === version)
    if (!row) problems.push(`core ${version} has no qualification result on shell ${latest}`)
    else if (row.status !== 'success') problems.push(`core ${version} is ${row.status} on shell ${latest}`)
  }
  if (!versions.length) problems.push('the qualification state is empty')
  return { healthy: problems.length === 0, problems }
}

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-portable-channel-health' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const release = await json('https://api.github.com/repos/WSL043/DSH-Portable/releases/latest')
  const commit = await json(`https://api.github.com/repos/WSL043/DSH-Portable/commits/${release.tag_name}`)
  const feed = await json('https://github.com/WSL043/DSH-Portable/releases/download/update-channel-stable/portable-update-windows-x64.json')
  const state = await json('https://github.com/WSL043/DSH-Portable-Updates/releases/download/update-channel-core/qualification-state.json')
  const result = evaluateChannelHealth({
    latestRelease: { tag: release.tag_name, publishedAt: release.published_at, sha: commit.sha },
    feedVersion: feed.portableVersion,
    state,
  })
  console.log(JSON.stringify(result))
  process.exitCode = result.healthy ? 0 : 1
}
