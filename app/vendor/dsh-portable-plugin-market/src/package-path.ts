import { isAbsolute, posix, relative, resolve, win32 } from 'node:path'

/**
 * Whether a package manifest value is a relative filesystem path.
 *
 * Package manifests are read from installed packages, so this is deliberately
 * stricter than Node's path resolver: both slash styles are treated as
 * separators and a parent segment is never accepted. The check is lexical;
 * callers still need an explicit policy if package-internal symlinks are to
 * be followed.
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
  const candidate = resolve(root, value)
  const escaped = relative(root, candidate)
  if (isAbsolute(escaped) || posix.isAbsolute(escaped) || win32.isAbsolute(escaped)) return null
  if (escaped.split(/[\\/]/u).some(segment => segment === '..')) return null
  return candidate
}
