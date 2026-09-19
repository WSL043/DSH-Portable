import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, win32 } from 'node:path'

/**
 * Whether a package manifest value is a relative filesystem path.
 *
 * Package manifests are read from installed packages, so this is deliberately
 * stricter than Node's path resolver: both slash styles are treated as
 * separators and a parent segment is never accepted. Physical containment is
 * checked by resolvePackageRelativePath before any declared file is read.
 */
export function isSafePackageRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.includes('\0')) return false
  if (isAbsolute(value) || posix.isAbsolute(value) || win32.isAbsolute(value)) return false
  // A drive-relative Windows path (for example, `C:outside.js`) is not
  // absolute according to win32.isAbsolute(), but it is not package-relative
  // either. Reject drive prefixes on every platform for consistent manifests.
  if (/^[A-Za-z]:/u.test(value)) return false
  return !value.split(/[\\/]/u).some(segment => segment === '..')
}

/**
 * Resolve a package-manifest path only when it remains below packageRoot.
 * Returning the normalized absolute path keeps callers from reconstructing
 * the path with an unchecked `join(root, value)` later.
 */
export function resolvePackageRelativePath(packageRoot: string, value: unknown): string | null {
  if (!isSafePackageRelativePath(value)) return null
  const root = resolve(packageRoot)
  const candidate = resolve(root, value.replaceAll('\\', '/'))
  const escaped = relative(root, candidate)
  if (isAbsolute(escaped) || posix.isAbsolute(escaped) || win32.isAbsolute(escaped)) return null
  if (escaped.split(/[\\/]/u).some(segment => segment === '..')) return null

  // pnpm and linked development packages may symlink the package root itself.
  // Their real root is the boundary; links inside it cannot escape that root.
  let canonicalRoot: string
  try { canonicalRoot = realpathSync(root) } catch { return null }
  const parts = escaped.split(/[\\/]/u).filter(Boolean)
  let current = canonicalRoot
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!)
    try {
      if (lstatSync(current).isSymbolicLink()) current = realpathSync(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
      // A missing ordinary entry is still useful to callers that report a
      // missing bundle. A dangling link, unlike a missing entry, is rejected.
      try { lstatSync(current); return null } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') return null
      }
      return join(current, ...parts.slice(index + 1))
    }
    const physical = relative(canonicalRoot, current)
    if (isAbsolute(physical) || physical === '..' || physical.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) return null
  }
  return current
}
