import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function matchesAsset(asset, size, digest) {
  return asset?.state === 'uploaded' && asset.size === size && asset.digest === `sha256:${digest}`
}

// Sequential, bounded uploads. A lost response is checked before any retry;
// immutable names must never silently acquire different bytes.
export async function uploadAssets({ repository, tag, files, mutable = false, verifyOnly = false, gh = runGh }) {
  const release = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`]))
  const list = () => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repository}/releases/${release.id}/assets?per_page=100`])).flat()
  for (const file of files) {
    const name = path.basename(file)
    const size = (await stat(file)).size
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    const digest = hash.digest('hex')
    let existing = list().find(asset => asset.name === name)
    if (matchesAsset(existing, size, digest)) { console.log(`Verified; reuse ${name}`); continue }
    if (verifyOnly) throw new Error(`Published asset missing or different: ${name}`)
    if (existing?.state === 'uploaded' && !mutable) throw new Error(`Immutable asset differs: ${name}`)
    if (existing) gh(['api', '--method', 'DELETE', `repos/${repository}/releases/assets/${existing.id}`])
    const start = Date.now()
    let failure
    try { gh(['release', 'upload', tag, file, '--repo', repository], 600_000) } catch (error) { failure = error }
    existing = list().find(asset => asset.name === name)
    if (!matchesAsset(existing, size, digest)) throw new Error(`Upload not verified: ${name}`, { cause: failure })
    console.log(`Verified ${name}: ${size} bytes, ${Math.round((Date.now() - start) / 1000)}s`)
  }
}

function runGh(args, timeout = 60_000) {
  return execFileSync('gh', args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, ...args] = process.argv.slice(2)
  const files = args.filter(arg => !['--mutable', '--verify-only'].includes(arg))
  if (!tag || !files.length || !process.env.GITHUB_REPOSITORY) throw new Error('Expected tag, files and GITHUB_REPOSITORY')
  await uploadAssets({ repository: process.env.GITHUB_REPOSITORY, tag, files, mutable: args.includes('--mutable'), verifyOnly: args.includes('--verify-only') })
}
