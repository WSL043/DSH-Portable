import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Run manually with an authenticated GitHub CLI. No client telemetry or tokens are stored.
const repo = 'WSL043/DSH-Portable'
const read = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/${repo}${endpoint}`], { encoding: 'utf8' }))
const metadata = read('')
const snapshot = {
  capturedAt: new Date().toISOString(), repo,
  stars: metadata.stargazers_count, forks: metadata.forks_count,
  views: read('/traffic/views'), clones: read('/traffic/clones'),
  referrers: read('/traffic/popular/referrers'), paths: read('/traffic/popular/paths'),
  releases: read('/releases?per_page=100').map(release => ({
    tag: release.tag_name, publishedAt: release.published_at, prerelease: release.prerelease,
    assets: release.assets.map(({ name, download_count }) => ({ name, downloads: download_count })),
  })),
  interpretation: 'GitHub rolling traffic windows may lag. Unique visitors are not installs; downloads and clones include repeats and automation. Do not add overlapping windows or infer retention from these counts.',
}
const directory = path.resolve(import.meta.dirname, '../.artifacts/traffic')
await mkdir(directory, { recursive: true })
const destination = path.join(directory, `${snapshot.capturedAt.replaceAll(':', '-')}.json`)
await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(destination)
