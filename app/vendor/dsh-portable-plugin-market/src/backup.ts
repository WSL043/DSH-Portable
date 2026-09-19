/**
 * Portable profile backups: configuration only, never installed packages.
 *
 * The profile directory is plain user data — aside from package.json it can
 * hold API keys (config.toml) or tokens. Backups therefore behave like `dsh export` and carry the same
 * credential-warning disclaimer in the UI (review #63).
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
} from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { profileDir } from './profile.ts'
import { backupFileTarget, canonicalBackupPath, writeBackupFileAtomic } from './backup-files.ts'

export const BACKUP_FORMAT = 'dsh-profile-backup'
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024
const MAX_FILES = 256
const SKIP_NAMES = new Set(['node_modules', '.dsh-market', '.git', 'pnpm-lock.yaml'])
/** File names that routinely contain credentials (backup exports).
 *  Values are never masked in place — the export is one-to-one for
 *  faithful restores — but presence is surfaced by the UI warning. */
export const SECRET_FILE_HINTS = /(^|\/)(config\.toml|\.env(\.\w+)?|secrets?\.\w+t?j?s?o?n|pnpm-workspace\.yaml)$/i

/** Count of exported files whose names look like they carry credentials. */
export function secretFileCount(profile: string, explicitDir?: string): number {
  let count = 0
  for (const path of profileFiles(explicitDir ?? profileDir(profile))) {
    if (SECRET_FILE_HINTS.test(path)) count += 1
  }
  return count
}

export type BackupFile =
  | { path: 'package.json'; json: Record<string, unknown> }
  | { path: string; lines: string[] }

export interface ProfileBackup {
  format: typeof BACKUP_FORMAT
  version: 0.2
  createdAt: string
  profile: string
  files: BackupFile[]
}

function profileFiles(root: string, dir = root): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name.toLowerCase()) || /\.bak\b/.test(entry.name)) continue
    const path = resolve(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) files.push(...profileFiles(root, path))
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'))
    if (files.length > MAX_FILES) throw new Error(`profile has more than ${MAX_FILES} configuration files`)
  }
  return files
}

/** Serialize every profile file except dependencies, lock state, and market cache. */
export interface BackupOptions {
  /** Partial export: only these plugins (dependency names) are kept. */
  includeDeps?: string[]
  /**
   * With includeDeps, also carry the profile's other configuration files.
   * Config files are profile-scoped and cannot be attributed to individual
   * plugins, so this is all-or-nothing — the UI warns about secrets before
   * enabling it (the backup itself is one-to-one, never masked).
   */
  includeConfig?: boolean
}

/**
 * Serialize every profile file except dependencies, lock state, and market
 * cache — or, with {@link BackupOptions.includeDeps}, only the manifest with
 * the selected plugins (plus, optionally, the other config files).
 */
export function createProfileBackup(profile: string, explicitDir?: string, opts?: BackupOptions): ProfileBackup {
  const root = resolve(explicitDir ?? profileDir(profile))
  const manifestFile = resolve(root, 'package.json')
  if (!existsSync(manifestFile)) throw new Error('profile package.json is missing')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>

  if (opts?.includeDeps !== undefined) {
    const include = new Set(opts.includeDeps)
    if (include.size === 0) throw new Error('no plugins selected')
    const dependencies = manifest.dependencies === null || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)
      ? {}
      : manifest.dependencies as Record<string, unknown>
    const filteredDeps: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(dependencies)) if (include.has(name)) filteredDeps[name] = spec
    const dsh = manifest.dsh === null || typeof manifest.dsh !== 'object' || Array.isArray(manifest.dsh)
      ? undefined
      : manifest.dsh as { profile?: unknown }
    const profileBlock = dsh?.profile === null || typeof dsh?.profile !== 'object' || Array.isArray(dsh?.profile)
      ? undefined
      : dsh.profile as { bundles?: unknown }
    const bundles = Array.isArray(profileBlock?.bundles) ? profileBlock.bundles as unknown[] : []
    const filteredBundles = bundles.filter((name): name is string => typeof name === 'string' && include.has(name))
    if (Object.keys(filteredDeps).length === 0 && filteredBundles.length === 0) {
      throw new Error('none of the selected plugins are in this profile')
    }
    const filteredManifest: Record<string, unknown> = { ...manifest }
    filteredManifest.dependencies = filteredDeps
    if (dsh !== undefined) {
      filteredManifest.dsh = { ...dsh, profile: { ...(profileBlock ?? {}), bundles: filteredBundles } }
    }
    const files: BackupFile[] = [{ path: 'package.json', json: filteredManifest }]
    if (opts.includeConfig === true) {
      for (const path of profileFiles(root).sort()) {
        if (path === 'package.json') continue
        files.push({ path, lines: readFileSync(resolve(root, path), 'utf8').split(/\r?\n/) })
      }
    }
    const partial: ProfileBackup = { format: BACKUP_FORMAT, version: 0.2, createdAt: new Date().toISOString(), profile, files }
    if (Buffer.byteLength(JSON.stringify(partial)) > MAX_BACKUP_BYTES) throw new Error('profile configuration is too large to back up')
    return partial
  }

  const files: BackupFile[] = profileFiles(root).sort().map((path) => {
    const content = readFileSync(resolve(root, path), 'utf8')
    return path === 'package.json'
      ? { path, json: JSON.parse(content) as Record<string, unknown> }
      : { path, lines: content.split(/\r?\n/) }
  })
  if (!files.some(file => file.path === 'package.json')) throw new Error('profile package.json is missing')
  const backup: ProfileBackup = { format: BACKUP_FORMAT, version: 0.2, createdAt: new Date().toISOString(), profile, files }
  if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP_BYTES) throw new Error('profile configuration is too large to back up')
  return backup
}

export function validatedBackup(value: unknown): ProfileBackup {
  if (value === null || typeof value !== 'object') throw new Error('invalid backup')
  const backup = value as Partial<ProfileBackup>
  if (backup.format !== BACKUP_FORMAT || backup.version !== 0.2 || !Array.isArray(backup.files)) {
    throw new Error('unsupported backup format')
  }
  if (backup.files.length > MAX_FILES) throw new Error('invalid backup contents')
  const files: BackupFile[] = []
  const paths = new Set<string>()
  for (const value of backup.files as unknown[]) {
    if (value === null || typeof value !== 'object') throw new Error('invalid backup contents')
    const file = value as { path?: unknown; json?: unknown; lines?: unknown }
    if (typeof file.path !== 'string') throw new Error('invalid backup contents')
    const path = canonicalBackupPath(file.path)
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (paths.has(key)) throw new Error(`duplicate backup path: ${path}`)
    paths.add(key)
    if (path === 'package.json') {
      if (file.json === null || typeof file.json !== 'object' || Array.isArray(file.json)) throw new Error('backup package.json is invalid')
      files.push({ path, json: file.json as Record<string, unknown> })
    } else {
      if (!Array.isArray(file.lines) || !file.lines.every(line => typeof line === 'string')) throw new Error(`invalid file content: ${path}`)
      files.push({ path, lines: file.lines as string[] })
    }
  }
  if (!files.some(file => file.path === 'package.json')) throw new Error('invalid backup contents')
  if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP_BYTES) throw new Error('backup is too large')
  return { ...backup, files } as ProfileBackup
}

/** Atomically overwrite backed-up files and return a rollback for install failure. */
export function restoreProfileBackup(profile: string, value: unknown, explicitDir?: string): { files: number; rollback(): void } {
  const backup = validatedBackup(value)
  const root = resolve(explicitDir ?? profileDir(profile))
  const previous = new Map<string, Buffer | null>()
  mkdirSync(root, { recursive: true })
  const rollback = (): void => {
    for (const [target, content] of [...previous].reverse()) {
      backupFileTarget(root, relative(root, target).split(sep).join('/'))
      if (content === null) rmSync(target, { force: true })
      else writeBackupFileAtomic(target, content)
    }
  }
  try {
    for (const file of backup.files) {
      const { path } = file
      const target = backupFileTarget(root, path)
      const original = existsSync(target) ? readFileSync(target) : null
      writeBackupFileAtomic(target, 'json' in file ? `${JSON.stringify(file.json, null, 2)}\n` : file.lines.join('\n'))
      previous.set(target, original)
    }
  } catch (error) {
    rollback()
    throw error
  }
  return {
    files: previous.size,
    rollback,
  }
}

export interface PluginSelection {
  deps: Record<string, string>
  bundles: string[]
}

/**
 * The selected plugins' dependency specs and bundle entries from a backup's
 * manifest. Only string specs survive — everything else in the manifest is
 * untrusted and ignored (partial restore touches nothing but these).
 */
export function extractPluginSelection(backup: ProfileBackup, includeDeps: string[]): PluginSelection {
  const manifest = backup.files.find(file => file.path === 'package.json' && 'json' in file)
  if (manifest === undefined || !('json' in manifest)) throw new Error('backup has no package.json')
  const include = new Set(includeDeps)
  const json = manifest.json
  const dependencies = json.dependencies === null || typeof json.dependencies !== 'object' || Array.isArray(json.dependencies)
    ? {}
    : json.dependencies as Record<string, unknown>
  const deps: Record<string, string> = {}
  for (const [name, spec] of Object.entries(dependencies)) {
    if (typeof spec === 'string' && include.has(name)) deps[name] = spec
  }
  const dsh = json.dsh === null || typeof json.dsh !== 'object' || Array.isArray(json.dsh)
    ? undefined
    : json.dsh as { profile?: unknown }
  const profileBlock = dsh?.profile === null || typeof dsh?.profile !== 'object' || Array.isArray(dsh?.profile)
    ? undefined
    : dsh.profile as { bundles?: unknown }
  const bundles = Array.isArray(profileBlock?.bundles) ? profileBlock.bundles as unknown[] : []
  return {
    deps,
    bundles: bundles.filter((name): name is string => typeof name === 'string' && include.has(name)),
  }
}

/**
 * Merge a backup's manifest into the profile's current manifest so a restore
 * never deletes plugins the target machine already has: current deps stay,
 * backup specs win on name conflicts; bundle lists are unioned. When
 * `selection` is given, only the selected plugins are merged in.
 */
export function mergeRestoreManifest(
  backupManifest: Record<string, unknown>,
  current: Record<string, unknown>,
  selection?: PluginSelection,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...backupManifest }
  const backupDeps = backupManifest.dependencies === null || typeof backupManifest.dependencies !== 'object' || Array.isArray(backupManifest.dependencies)
    ? {}
    : backupManifest.dependencies as Record<string, unknown>
  const backupBundles = Array.isArray((backupManifest.dsh as { profile?: { bundles?: unknown } } | undefined)?.profile?.bundles)
    ? ((backupManifest.dsh as { profile: { bundles: unknown[] } }).profile.bundles)
    : []
  const currentDeps = current.dependencies === null || typeof current.dependencies !== 'object' || Array.isArray(current.dependencies)
    ? {}
    : current.dependencies as Record<string, unknown>
  const currentBundles = Array.isArray((current.dsh as { profile?: { bundles?: unknown } } | undefined)?.profile?.bundles)
    ? ((current.dsh as { profile: { bundles: unknown[] } }).profile.bundles)
    : []

  // Deps: keep the target's, overlay the backup's (or only the selection).
  const deps: Record<string, unknown> = { ...currentDeps }
  const sourceDeps = selection !== undefined ? selection.deps : backupDeps
  for (const [name, spec] of Object.entries(sourceDeps)) deps[name] = spec
  merged.dependencies = deps

  // Bundles: union of target and backup (or selection), de-duplicated.
  const bundles = new Set<string>()
  for (const name of currentBundles) if (typeof name === 'string') bundles.add(name)
  const sourceBundles = selection !== undefined ? selection.bundles : backupBundles
  for (const name of sourceBundles) if (typeof name === 'string') bundles.add(name)

  const currentDsh = current.dsh === null || typeof current.dsh !== 'object' || Array.isArray(current.dsh)
    ? undefined
    : current.dsh as { profile?: unknown }
  const currentProfile = currentDsh?.profile === null || typeof currentDsh?.profile !== 'object' || Array.isArray(currentDsh?.profile)
    ? undefined
    : currentDsh.profile as Record<string, unknown>
  const backupDsh = merged.dsh === null || typeof merged.dsh !== 'object' || Array.isArray(merged.dsh)
    ? undefined
    : merged.dsh as { profile?: unknown }
  const backupProfile = backupDsh?.profile === null || typeof backupDsh?.profile !== 'object' || Array.isArray(backupDsh?.profile)
    ? undefined
    : backupDsh.profile as Record<string, unknown>

  const profileMerged: Record<string, unknown> = { ...(backupProfile ?? {}), ...(currentProfile ?? {}), bundles: [...bundles] }
  const dshMerged: Record<string, unknown> = { ...(backupDsh ?? {}), ...(currentDsh ?? {}), profile: profileMerged }
  merged.dsh = dshMerged
  return merged
}

/** Absolute link:/file: specs that cannot travel with a profile backup. */
export function unportableDeps(dependencies: unknown): Array<{ name: string; spec: string }> {
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) return []
  const found: Array<{ name: string; spec: string }> = []
  for (const [name, raw] of Object.entries(dependencies as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue
    const match = /^(?:link|file):(.+)$/i.exec(raw)
    if (match === null) continue
    let value = match[1]
    try { value = decodeURIComponent(value) } catch { /* keep literal */ }
    if (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) found.push({ name, spec: raw })
  }
  return found
}
