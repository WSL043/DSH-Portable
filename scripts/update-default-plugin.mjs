import { createHash } from 'node:crypto'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageName = 'dsh-native-session-delete'
const repository = 'WSL043/dsh-native-session-delete'
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'DSH-Portable-default-plugin-candidate',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

async function json(url, requestHeaders = headers) {
  const response = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`default plugin source no longer has one exact ${label} marker`)
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`
}

const lockPath = path.join(root, 'upstream.lock.json')
const sourcePath = path.join(root, 'launcher', 'default-plugins.mjs')
const [lockText, sourceText, registry] = await Promise.all([
  readFile(lockPath, 'utf8'),
  readFile(sourcePath, 'utf8'),
  json(`https://registry.npmjs.org/${packageName}`),
])
const lock = JSON.parse(lockText)
const current = lock.defaultPlugins?.sessionDelete
if (!current || current.package !== packageName) throw new Error('the default session-delete lock is missing')

const version = registry?.['dist-tags']?.latest
const published = registry?.versions?.[version]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !published?.dist?.tarball || !published?.dist?.integrity) {
  throw new Error('npm latest does not describe a stable installable default plugin')
}
const release = await json(`https://api.github.com/repos/${repository}/releases/tags/v${version}`)
if (release?.draft || release?.prerelease || !/^[0-9a-f]{40}$/.test(release?.target_commitish ?? '')) {
  throw new Error(`v${version} is not an immutable stable GitHub release`)
}
const asset = (release.assets ?? []).find(candidate => candidate.name === `${packageName}.tgz`)
if (!asset || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? '')) {
  throw new Error(`v${version} does not publish a digest-bearing ${packageName}.tgz asset`)
}

const archiveResponse = await fetch(published.dist.tarball, {
  headers: { 'user-agent': 'DSH-Portable-default-plugin-candidate' },
  signal: AbortSignal.timeout(30_000),
})
if (!archiveResponse.ok) throw new Error(`npm archive returned HTTP ${archiveResponse.status}`)
const sha256 = createHash('sha256').update(Buffer.from(await archiveResponse.arrayBuffer())).digest('hex')
if (asset.digest.toLowerCase() !== `sha256:${sha256}`) {
  throw new Error('npm archive and immutable GitHub release asset digests differ')
}

const changed = current.version !== version
if (changed) {
  const next = {
    ...current,
    version,
    url: published.dist.tarball,
    sha256,
    integrity: published.dist.integrity,
    license: published.license ?? current.license,
    reviewedCommit: release.target_commitish,
  }
  lock.defaultPlugins.sessionDelete = next

  const markers = [
    ['version', `version: '${current.version}'`, `version: '${next.version}'`],
    ['url', `url: '${current.url}'`, `url: '${next.url}'`],
    ['sha256', `sha256: '${current.sha256}'`, `sha256: '${next.sha256}'`],
    ['integrity', `integrity: '${current.integrity}'`, `integrity: '${next.integrity}'`],
    ['reviewed commit', `reviewedCommit: '${current.reviewedCommit}'`, `reviewedCommit: '${next.reviewedCommit}'`],
  ]
  let nextSource = sourceText
  for (const [label, before, after] of markers) nextSource = replaceExactlyOnce(nextSource, before, after, label)

  await writeFile(`${lockPath}.tmp`, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  await rename(`${lockPath}.tmp`, lockPath)
  await writeFile(`${sourcePath}.tmp`, nextSource, 'utf8')
  await rename(`${sourcePath}.tmp`, sourcePath)
}

const result = { changed, package: packageName, version, commit: release.target_commitish, sha256 }
console.log(JSON.stringify(result, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${changed}`,
    `version=${version}`,
    `commit=${release.target_commitish}`,
    '',
  ].join('\n'))
}
