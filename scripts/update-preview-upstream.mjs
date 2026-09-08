import { createHash } from 'node:crypto'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluatePreviewUpstream } from './upstream-state.mjs'
import { readOfficialSourceMetadata } from './upstream-source-metadata.mjs'
import { upstreamRequestHeaders } from './upstream-request-headers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function json(url) {
  const response = await fetch(url, {
    headers: upstreamRequestHeaders(url),
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

async function text(url) {
  const response = await fetch(url, { headers: upstreamRequestHeaders(url) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.text()
}

async function officialTagCommit(version) {
  const ref = await json(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/dsh-v${version}`)
  let object = ref?.object
  if (object?.type === 'tag') {
    const annotated = await json(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/tags/${object.sha}`)
    object = annotated?.object
  }
  if (object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(object.sha ?? '')) {
    throw new Error(`official tag dsh-v${version} does not resolve to a commit`)
  }
  return { sha: object.sha }
}

const lockPath = path.join(root, 'upstream.preview.lock.json')
const [registry, lock] = await Promise.all([
  json('https://registry.npmjs.org/@deepseek-ai%2Fdsh'),
  readFile(lockPath, 'utf8').then(JSON.parse),
])
const provisional = evaluatePreviewUpstream({
  lock,
  registry,
  packageCommit: { sha: lock.dsh.reviewedCommit },
})
const packageCommit = provisional.changed
  ? await officialTagCommit(provisional.version)
  : { sha: lock.dsh.reviewedCommit }
const state = evaluatePreviewUpstream({ lock, registry, packageCommit })

if (state.changed) {
  const sourceMetadata = await readOfficialSourceMetadata(state.commit, { json, text })
  const noticesResponse = await fetch(
    `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${state.commit}/THIRD_PARTY_NOTICES.md`,
    { headers: upstreamRequestHeaders('https://raw.githubusercontent.com/') },
  )
  if (!noticesResponse.ok) throw new Error(`official notices returned HTTP ${noticesResponse.status}`)
  const noticesSha256 = createHash('sha256')
    .update(Buffer.from(await noticesResponse.arrayBuffer()))
    .digest('hex')

  lock.dsh.version = state.version
  lock.dsh.tag = `dsh-v${state.version}`
  lock.dsh.npmIntegrity = state.integrity
  lock.dsh.reviewedCommit = state.commit
  lock.dsh.noticesSha256 = noticesSha256
  lock.dsh.packageManager = sourceMetadata.packageManager
  lock.dsh.packedFamilies = sourceMetadata.packedFamilies
  const temporary = `${lockPath}.tmp`
  await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  await rename(temporary, lockPath)
}

console.log(JSON.stringify(state, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${state.changed}`,
    `selectedTag=${state.selectedTag ?? ''}`,
    `version=${state.version}`,
    `commit=${state.commit}`,
    '',
  ].join('\n'))
}
