import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'))
const pinned = lock.pluginMarket?.reviewedBasisTag
if (!/^v\d+\.\d+\.\d+$/.test(pinned ?? '')) throw new Error('pluginMarket.reviewedBasisTag is missing or invalid')

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
if (!/^v\d+\.\d+\.\d+$/.test(latest.tag_name ?? '') || latest.draft || latest.prerelease) {
  throw new Error('dsh-market latest release is not a stable semantic version')
}

const changed = latest.tag_name !== pinned
const result = { changed, pinned, latest: latest.tag_name, url: latest.html_url }
console.log(JSON.stringify(result, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${changed}`,
    `pinned=${pinned}`,
    `latest=${latest.tag_name}`,
    `url=${latest.html_url}`,
    '',
  ].join('\n'))
}
