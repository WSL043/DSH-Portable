import { realpath } from 'node:fs/promises'
import path from 'node:path'

// Package inputs may contain symlinks. Resolve them before reading or writing
// so a package cannot redirect a build or acceptance step outside its root.
export async function verifiedPackageFile(packageRoot, ...segments) {
  const root = await realpath(packageRoot)
  const candidate = await realpath(path.resolve(root, ...segments))
  const relative = path.relative(root, candidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Package file escapes its root: ${segments.join('/')}`)
  }
  return candidate
}
