import { createHash } from 'node:crypto'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
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

async function resolveTagCommit(repository, version) {
  const ref = await json(`https://api.github.com/repos/${repository}/git/ref/tags/v${version}`)
  if (ref?.object?.type === 'commit' && /^[0-9a-f]{40}$/.test(ref.object.sha ?? '')) return ref.object.sha
  if (ref?.object?.type === 'tag') {
    const tag = await json(`https://api.github.com/repos/${repository}/git/tags/${ref.object.sha}`)
    if (tag?.object?.type === 'commit' && /^[0-9a-f]{40}$/.test(tag.object.sha ?? '')) return tag.object.sha
  }
  throw new Error(`${repository} v${version} does not resolve to an immutable commit`)
}

function replacePluginBlock(source, current, next) {
  const start = source.indexOf(`  name: '${current.package}',`)
  if (start < 0) throw new Error(`default plugin source is missing ${current.package}`)
  const end = source.indexOf('\n})', start)
  if (end < 0) throw new Error(`default plugin source block is incomplete for ${current.package}`)
  let block = source.slice(start, end)
  for (const key of ['version', 'url', 'sha256', 'integrity', 'reviewedCommit']) {
    const before = `${key}: '${current[key]}'`
    const after = `${key}: '${next[key]}'`
    if (!block.includes(before)) throw new Error(`${current.package} source no longer has its ${key} marker`)
    block = block.replace(before, after)
  }
  return `${source.slice(0, start)}${block}${source.slice(end)}`
}

async function inspectPlugin(key, current) {
  if (!current?.package || !current?.repository || !current?.releaseChannel) {
    throw new Error(`default plugin ${key} is missing package, repository, or releaseChannel metadata`)
  }
  const registry = await json(`https://registry.npmjs.org/${current.package}`)
  const distTag = current.releaseChannel === 'stable' ? 'latest' : (registry?.['dist-tags']?.beta ? 'beta' : 'latest')
  const version = registry?.['dist-tags']?.[distTag]
  const published = registry?.versions?.[version]
  const semverPattern = current.releaseChannel === 'stable'
    ? /^\d+\.\d+\.\d+$/
    : /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
  if (!semverPattern.test(version ?? '') || !published?.dist?.tarball || !published?.dist?.integrity) {
    throw new Error(`npm ${distTag} does not describe an installable ${current.package} release`)
  }

  const release = await json(`https://api.github.com/repos/${current.repository}/releases/tags/v${version}`)
  const expectsPrerelease = current.releaseChannel === 'prerelease' && version.includes('-')
  if (release?.draft || Boolean(release?.prerelease) !== expectsPrerelease) {
    throw new Error(`${current.repository} v${version} release channel does not match ${current.releaseChannel}`)
  }
  const commit = await resolveTagCommit(current.repository, version)
  const asset = (release.assets ?? []).find(candidate => candidate.name === `${current.package}.tgz`)
  if (!asset || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? '')) {
    throw new Error(`v${version} does not publish a digest-bearing ${current.package}.tgz asset`)
  }

  const archiveResponse = await fetch(published.dist.tarball, {
    headers: { 'user-agent': 'DSH-Portable-default-plugin-candidate' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!archiveResponse.ok) throw new Error(`${current.package} npm archive returned HTTP ${archiveResponse.status}`)
  const sha256 = createHash('sha256').update(Buffer.from(await archiveResponse.arrayBuffer())).digest('hex')
  if (current.releaseChannel === 'stable' && asset.digest.toLowerCase() !== `sha256:${sha256}`) {
    throw new Error(`${current.package} npm archive and GitHub release asset digests differ`)
  }

  return {
    key,
    changed: current.version !== version || current.reviewedCommit !== commit,
    current,
    next: {
      ...current,
      version,
      url: published.dist.tarball,
      sha256,
      integrity: published.dist.integrity,
      license: published.license ?? current.license,
      reviewedCommit: commit,
    },
  }
}

const lockPath = path.join(root, 'upstream.lock.json')
const previewLockPath = path.join(root, 'upstream.preview.lock.json')
const sourcePath = path.join(root, 'launcher', 'default-plugins.mjs')
const [lockText, previewLockText, sourceText] = await Promise.all([
  readFile(lockPath, 'utf8'),
  readFile(previewLockPath, 'utf8'),
  readFile(sourcePath, 'utf8'),
])
const lock = JSON.parse(lockText)
const previewLock = JSON.parse(previewLockText)
const inspections = await Promise.all(Object.entries(lock.defaultPlugins ?? {}).map(([key, plugin]) => inspectPlugin(key, plugin)))
if (inspections.length === 0) throw new Error('no default plugins are locked')

const changed = inspections.filter(item => item.changed)
const nextDefaults = Object.fromEntries(inspections.map(item => [item.key, item.next]))
const previewDrift = !isDeepStrictEqual(previewLock.defaultPlugins, nextDefaults)
const needsUpdate = changed.length > 0 || previewDrift
if (needsUpdate && checkOnly) {
  const updates = changed.map(item => `${item.current.package}@${item.current.version} -> ${item.next.version}`)
  if (previewDrift) updates.push('preview default lock differs from the verified plugin set')
  throw new Error(`Bundled default plugins are behind their verified channels: ${updates.join(', ')}`)
}
if (needsUpdate) {
  let nextSource = sourceText
  for (const item of changed) {
    lock.defaultPlugins[item.key] = item.next
    nextSource = replacePluginBlock(nextSource, item.current, item.next)
  }
  previewLock.defaultPlugins = lock.defaultPlugins
  await writeFile(`${lockPath}.tmp`, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  await rename(`${lockPath}.tmp`, lockPath)
  await writeFile(`${previewLockPath}.tmp`, `${JSON.stringify(previewLock, null, 2)}\n`, 'utf8')
  await rename(`${previewLockPath}.tmp`, previewLockPath)
  await writeFile(`${sourcePath}.tmp`, nextSource, 'utf8')
  await rename(`${sourcePath}.tmp`, sourcePath)
}

const result = {
  changed: needsUpdate,
  plugins: inspections.map(item => ({ package: item.current.package, version: item.next.version, commit: item.next.reviewedCommit, changed: item.changed })),
}
console.log(JSON.stringify(result, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${result.changed}`,
    `versions=${JSON.stringify(Object.fromEntries(result.plugins.map(plugin => [plugin.package, plugin.version])))}`,
    '',
  ].join('\n'))
}
