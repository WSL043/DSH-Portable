import { spawnSync } from 'node:child_process'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tag = process.argv.includes('--latest') ? 'latest' : 'next'
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'DSH-Portable-upstream-candidate',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

async function json(url) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

const [registry, commit, currentLock] = await Promise.all([
  json('https://registry.npmjs.org/@deepseek-ai%2Fdsh'),
  json('https://api.github.com/repos/deepseek-ai/deepseek-harness/commits/master'),
  readFile(path.join(root, 'upstream.lock.json'), 'utf8').then(JSON.parse),
])
const version = registry['dist-tags']?.[tag]
const published = registry.versions?.[version]
if (!version || !published?.dist?.integrity) throw new Error(`official npm tag ${tag} has no verifiable package integrity`)

const changed = version !== currentLock.dsh.version || commit.sha !== currentLock.dsh.reviewedCommit
if (changed) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const install = spawnSync(npm, [
    'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact',
    `@deepseek-ai/dsh@${version}`, `pnpm@${currentLock.pnpm.version}`,
  ], { cwd: path.join(root, 'app'), encoding: 'utf8' })
  if (install.status !== 0) throw new Error(`npm lock refresh failed:\n${install.stderr || install.stdout}`)

  const packageLock = JSON.parse(await readFile(path.join(root, 'app', 'package-lock.json'), 'utf8'))
  const lockedDsh = packageLock.packages?.['node_modules/@deepseek-ai/dsh']
  if (lockedDsh?.version !== version || lockedDsh?.integrity !== published.dist.integrity) {
    throw new Error('refreshed package lock does not match the official npm version and integrity')
  }
  currentLock.dsh.version = version
  currentLock.dsh.integrity = published.dist.integrity
  currentLock.dsh.reviewedCommit = commit.sha
  const target = path.join(root, 'upstream.lock.json')
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(currentLock, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

const result = { changed, tag, version, commit: commit.sha }
console.log(JSON.stringify(result, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\nversion=${version}\ncommit=${commit.sha}\n`)
}
