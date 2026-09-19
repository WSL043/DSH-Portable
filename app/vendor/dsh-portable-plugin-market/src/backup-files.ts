import { randomUUID } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'

const EXCLUDED = new Set(['node_modules', '.dsh-market', '.git', 'pnpm-lock.yaml'])

export function canonicalBackupPath(value: string, platform = process.platform): string {
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (!value || value.includes('\0') || isAbsolute(normalized) || win32.isAbsolute(normalized)
    || /^[A-Za-z]:/.test(normalized) || parts.some(p => p === '' || p === '.' || p === '..')) {
    throw new Error(`unsafe backup path: ${value}`)
  }
  if (parts.some(p => EXCLUDED.has(p.toLowerCase()))) throw new Error(`excluded backup path: ${value}`)
  if (normalized.toLowerCase() === 'package.json' && normalized !== 'package.json') {
    throw new Error(`unsafe backup manifest alias: ${value}`)
  }
  if (platform === 'win32' && parts.some(p => /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(p.split('.')[0]!.trimEnd()))) {
    throw new Error(`unsafe backup path: ${value}`)
  }
  return normalized
}

function statIfPresent(filename: string): ReturnType<typeof lstatSync> | null {
  try { return lstatSync(filename) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** The caller selects the profile root; package contents may not redirect descendants. */
export function backupFileTarget(root: string, value: string): string {
  const normalized = canonicalBackupPath(value)
  const base = resolve(root)
  const target = resolve(base, normalized)
  const suffix = relative(base, target)
  if (!suffix || isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) {
    throw new Error(`unsafe backup path: ${value}`)
  }
  mkdirSync(base, { recursive: true })
  let current = base
  for (const part of normalized.split('/').slice(0, -1)) {
    current = join(current, part)
    let stat = statIfPresent(current)
    if (!stat) {
      try { mkdirSync(current) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      stat = lstatSync(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe backup path: ${value}`)
  }
  const leaf = statIfPresent(target)
  if (leaf && (leaf.isSymbolicLink() || !leaf.isFile())) throw new Error(`backup path is not a file: ${value}`)
  return target
}

/** Exclusion is atomic; a pre-existing file or link is never opened for writing. */
export function writeBackupFileAtomic(target: string, content: string | Buffer): void {
  const temporary = join(dirname(target), `.dsh-profile-${randomUUID()}.tmp`)
  let fd = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(fd, content)
    closeSync(fd)
    fd = -1
    renameSync(temporary, target)
  } finally {
    if (fd !== -1) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}
