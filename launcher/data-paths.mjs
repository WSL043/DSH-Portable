import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export function normalizeDataPath(value, platform = process.platform) {
  if (typeof value !== 'string') throw new Error('Invalid data package path.')
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (path.win32.parse(normalized).root || normalized.includes('\0')
    || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe data package path: ${value}`)
  }
  if (platform === 'win32' && parts.some(part => {
    const basename = part.split('.')[0].trimEnd()
    return /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(basename)
  })) throw new Error(`Unsafe data package path: ${value}`)
  return normalized
}

export function dataPathKey(value, platform = process.platform) {
  const normalized = normalizeDataPath(value, platform)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export async function lstatIfPresent(filename) {
  try { return await lstat(filename) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

// The selected state root is trusted. Check every existing descendant, including
// dangling links. This does not lock parent directories against concurrent writers.
export async function safeDataTarget(root, relativePath, { leaf = 'file' } = {}) {
  const normalized = normalizeDataPath(relativePath)
  const base = path.resolve(root)
  const target = path.resolve(base, ...normalized.split('/'))
  const relative = path.relative(base, target)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Unsafe restore path: ${relativePath}`)
  }
  await mkdir(base, { recursive: true })
  let current = base
  for (const part of normalized.split('/').slice(0, -1)) {
    current = path.join(current, part)
    let stat = await lstatIfPresent(current)
    if (!stat) {
      try { await mkdir(current) } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      stat = await lstat(current)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe restore path: ${relativePath}`)
  }
  const stat = await lstatIfPresent(target)
  // 'any' is for moving a generated entry itself, never for following its link.
  if (stat && leaf !== 'any' && (!stat.isFile() || stat.isSymbolicLink())) {
    throw new Error(`Unsafe restore path: ${relativePath}`)
  }
  return target
}

export async function writeDataFileAtomic(filename, bytes) {
  const temporary = path.join(path.dirname(filename), `.dsh-data-${randomBytes(16).toString('hex')}.tmp`)
  // Exclusive creation prevents following a pre-existing file, link or hard link.
  // Open before entering try/finally: a failed open does not own the path to unlink.
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.close()
    await rename(temporary, filename)
  } finally {
    await handle.close().catch(() => {})
    await rm(temporary, { force: true })
  }
}
