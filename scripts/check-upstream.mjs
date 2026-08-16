import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateUpstream } from './upstream-state.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'))
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'DSH-Portable-upstream-monitor',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

const [commit, npm] = await Promise.all([
  json('https://api.github.com/repos/deepseek-ai/deepseek-harness/commits/master'),
  json('https://registry.npmjs.org/@deepseek-ai%2Fdsh'),
])
const state = evaluateUpstream({ lock, registry: npm, commit })
const result = {
  changed: state.changed,
  packageChanged: state.packageChanged,
  sourceChanged: state.sourceChanged,
  pinned: { commit: lock.dsh.reviewedCommit, package: lock.dsh.version },
  upstream: {
    commit: state.commit,
    selectedTag: state.selectedTag,
    package: state.version,
  },
}

console.log(JSON.stringify(result, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${String(result.changed)}`,
    `commit=${state.commit}`,
    `version=${state.version}`,
    `source_changed=${String(state.sourceChanged)}`,
    '',
  ].join('\n'))
}
