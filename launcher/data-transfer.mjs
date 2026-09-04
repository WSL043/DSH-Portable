import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

import { projectKey, relocateSessionHeaderBytes } from './portable-core.mjs'

const MAGIC_PLAIN = Buffer.from('DSHDAT1U')
const MAGIC_ENCRYPTED = Buffer.from('DSHDAT1E')
const FORMAT = 'dsh-portable-data'
const VERSION = 1
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 768 * 1024 * 1024
const MAX_FILES = 100_000
const DEFAULT_CATEGORIES = ['settings', 'sessions', 'plugins']
const ALL_CATEGORIES = new Set([...DEFAULT_CATEGORIES, 'credentials', 'workspace'])
const PROFILE_SKIP = new Set(['node_modules', '.git', 'pnpm-lock.yaml'])
const SECRET_NAME = /(^|\/)(\.credentials\.yaml|config\.toml|\.env(?:\.[^/]+)?|credentials?\.(?:json|ya?ml)|secrets?\.(?:json|ya?ml))$/i

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizedRelative(root, filename) {
  const value = path.relative(root, filename).split(path.sep).join('/')
  if (value === '' || value.startsWith('../') || path.isAbsolute(value)) throw new Error(`Unsafe data path: ${filename}`)
  return value
}

async function walkFiles(root, { skip = new Set(), filter = () => true } = {}) {
  if (!existsSync(root)) return []
  const found = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const filename = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await visit(filename)
      else if (entry.isFile() && filter(filename)) found.push(filename)
      if (found.length > MAX_FILES) throw new Error(`Backup contains more than ${MAX_FILES} files.`)
    }
  }
  await visit(root)
  return found
}

function addSpec(specs, category, root, filename) {
  if (!existsSync(filename)) return
  const relative = normalizedRelative(root, filename)
  if (!specs.has(relative)) specs.set(relative, { category, filename })
}

async function addTree(specs, category, root, directory, options) {
  for (const filename of await walkFiles(directory, options)) addSpec(specs, category, root, filename)
}

async function selectedFiles(layout, categories) {
  const specs = new Map()
  const stateRoot = layout.stateRoot
  const data = layout.dataDir
  const home = layout.dshHome
  if (categories.includes('settings')) {
    for (const filename of [
      path.join(data, 'launcher-settings.json'),
      path.join(data, 'window-state.json'),
      path.join(home, 'settings.yaml'),
    ]) addSpec(specs, 'settings', stateRoot, filename)
    await addTree(specs, 'settings', stateRoot, path.join(home, '.agent-presets'))
  }
  if (categories.includes('sessions')) {
    await addTree(specs, 'sessions', stateRoot, path.join(home, 'sessions'))
    await addTree(specs, 'sessions', stateRoot, path.join(home, 'storages'))
  }
  if (categories.includes('plugins')) {
    await addTree(specs, 'plugins', stateRoot, path.join(home, 'profiles'), {
      skip: PROFILE_SKIP,
      filter: filename => !SECRET_NAME.test(normalizedRelative(home, filename)),
    })
  }
  if (categories.includes('credentials')) {
    addSpec(specs, 'credentials', stateRoot, path.join(home, '.credentials.yaml'))
    await addTree(specs, 'credentials', stateRoot, path.join(home, 'profiles'), {
      skip: PROFILE_SKIP,
      filter: filename => SECRET_NAME.test(normalizedRelative(home, filename)),
    })
  }
  if (categories.includes('workspace')) await addTree(specs, 'workspace', stateRoot, layout.workspace)
  return [...specs.entries()].map(([archivePath, value]) => ({ archivePath, ...value }))
}

function normalizeCategories(value) {
  const source = value === undefined ? DEFAULT_CATEGORIES : value
  if (!Array.isArray(source) || source.length === 0) throw new Error('Select at least one backup category.')
  const categories = [...new Set(source)]
  for (const category of categories) if (!ALL_CATEGORIES.has(category)) throw new Error(`Unknown backup category: ${category}`)
  return categories
}

function encrypt(compressed, password) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(MAGIC_ENCRYPTED)
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  return Buffer.concat([MAGIC_ENCRYPTED, salt, iv, cipher.getAuthTag(), ciphertext])
}

function decodeArchive(bytes, password) {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Data package is too large.')
  const magic = bytes.subarray(0, 8)
  let compressed
  let encrypted = false
  if (magic.equals(MAGIC_PLAIN)) compressed = bytes.subarray(8)
  else if (magic.equals(MAGIC_ENCRYPTED)) {
    encrypted = true
    if (!password) throw new Error('This data package is encrypted. Enter its password.')
    if (bytes.length < 52) throw new Error('Encrypted data package is incomplete.')
    const salt = bytes.subarray(8, 24)
    const iv = bytes.subarray(24, 36)
    const tag = bytes.subarray(36, 52)
    const key = scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(MAGIC_ENCRYPTED)
      decipher.setAuthTag(tag)
      compressed = Buffer.concat([decipher.update(bytes.subarray(52)), decipher.final()])
    } catch {
      throw new Error('The password is incorrect or the encrypted data package was changed.')
    }
  } else throw new Error('Unsupported DSH-Portable data package.')
  let document
  try { document = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_DOCUMENT_BYTES }).toString('utf8')) } catch { throw new Error('The data package is damaged or unsupported.') }
  validateDocument(document)
  return { document, encrypted }
}

function validateDocument(document) {
  if (document?.format !== FORMAT || document?.version !== VERSION || !Array.isArray(document.files)) throw new Error('Unsupported data package format.')
  if (document.portableWorkspace !== undefined && (typeof document.portableWorkspace !== 'string' || document.portableWorkspace.length === 0)) {
    throw new Error('Invalid portable workspace metadata.')
  }
  const categories = normalizeCategories(document.categories)
  if (document.files.length > MAX_FILES) throw new Error('Data package contains too many files.')
  const seen = new Set()
  for (const file of document.files) {
    if (!file || typeof file.path !== 'string' || typeof file.category !== 'string' || typeof file.data !== 'string' || typeof file.sha256 !== 'string') throw new Error('Invalid data package entry.')
    const normalized = file.path.replaceAll('\\', '/')
    if (normalized === '' || normalized.startsWith('/') || normalized.split('/').includes('..') || path.win32.isAbsolute(normalized)) throw new Error(`Unsafe data package path: ${file.path}`)
    if (!categories.includes(file.category) || !ALL_CATEGORIES.has(file.category)) throw new Error(`Invalid data category: ${file.category}`)
    if (!pathAllowedForCategory(normalized, file.category)) throw new Error(`Data path does not belong to ${file.category}: ${file.path}`)
    if (seen.has(normalized)) throw new Error(`Duplicate data package path: ${file.path}`)
    seen.add(normalized)
    const bytes = Buffer.from(file.data, 'base64')
    if (!/^[0-9a-f]{64}$/i.test(file.sha256) || !timingSafeEqual(Buffer.from(sha256(bytes)), Buffer.from(file.sha256.toLowerCase()))) throw new Error(`Data package integrity check failed: ${file.path}`)
  }
}

function pathAllowedForCategory(value, category) {
  if (category === 'settings') return [
    'data/launcher-settings.json', 'data/window-state.json', 'data/dsh-home/settings.yaml',
  ].includes(value) || value.startsWith('data/dsh-home/.agent-presets/')
  if (category === 'sessions') return value.startsWith('data/dsh-home/sessions/') || value.startsWith('data/dsh-home/storages/')
  if (category === 'plugins') return value.startsWith('data/dsh-home/profiles/')
    && !value.split('/').some(part => PROFILE_SKIP.has(part)) && !SECRET_NAME.test(value)
  if (category === 'credentials') return value === 'data/dsh-home/.credentials.yaml'
    || (value.startsWith('data/dsh-home/profiles/') && SECRET_NAME.test(value))
  if (category === 'workspace') return value.startsWith('workspace/')
  return false
}

export async function createDataArchive(layout, output, options = {}) {
  const categories = normalizeCategories(options.categories)
  if (options.password && String(options.password).length < 8) throw new Error('Data package passwords must contain at least 8 characters.')
  if (categories.includes('credentials') && !options.password && options.allowUnencryptedCredentials !== true) {
    throw new Error('Credential backup requires a password or an explicit unencrypted-credentials choice.')
  }
  const specs = await selectedFiles(layout, categories)
  const files = []
  let sourceBytes = 0
  for (const spec of specs) {
    const bytes = await readFile(spec.filename)
    sourceBytes += bytes.length
    if (sourceBytes > MAX_ARCHIVE_BYTES) throw new Error('Selected user data is too large for one data package.')
    files.push({ path: spec.archivePath, category: spec.category, bytes: bytes.length, sha256: sha256(bytes), data: bytes.toString('base64') })
  }
  const document = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    categories,
    portableWorkspace: layout.workspace,
    files,
  }
  const compressed = gzipSync(Buffer.from(JSON.stringify(document)), { level: 6 })
  const archive = options.password ? encrypt(compressed, String(options.password)) : Buffer.concat([MAGIC_PLAIN, compressed])
  await mkdir(path.dirname(path.resolve(output)), { recursive: true })
  const temporary = `${path.resolve(output)}.part-${process.pid}`
  await writeFile(temporary, archive, { mode: 0o600 })
  await rename(temporary, path.resolve(output))
  return { output: path.resolve(output), categories, files: files.length, sourceBytes, archiveBytes: archive.length, encrypted: Boolean(options.password) }
}

export async function inspectDataArchive(filename, options = {}) {
  const { document, encrypted } = decodeArchive(await readFile(path.resolve(filename)), options.password)
  return {
    format: document.format,
    version: document.version,
    createdAt: document.createdAt,
    encrypted,
    categories: document.categories,
    files: document.files.map(file => file.path),
    bytes: document.files.reduce((total, file) => total + Number(file.bytes || Buffer.from(file.data, 'base64').length), 0),
  }
}

async function safeTarget(root, relativePath) {
  await mkdir(root, { recursive: true })
  const target = path.resolve(root, ...relativePath.split('/'))
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Unsafe restore path: ${relativePath}`)
  let current = path.resolve(root)
  for (const part of relativePath.split('/').slice(0, -1)) {
    current = path.join(current, part)
    if (!existsSync(current)) {
      await mkdir(current)
      continue
    }
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe restore path: ${relativePath}`)
  }
  if (existsSync(target)) {
    const stat = await lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe restore path: ${relativePath}`)
  }
  return target
}

function replaceExactStrings(value, before, after) {
  if (value === before) return after
  if (Array.isArray(value)) return value.map(item => replaceExactStrings(item, before, after))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceExactStrings(item, before, after)]))
  }
  return value
}

function relocatePortableWorkspaceEntry(file, bytes, before, after) {
  if (!before || before === after || file.category !== 'sessions') return { archivePath: file.path, bytes }
  const sourcePrefix = `data/dsh-home/sessions/${projectKey(before)}/`
  const targetPrefix = `data/dsh-home/sessions/${projectKey(after)}/`
  const archivePath = file.path.startsWith(sourcePrefix) ? targetPrefix + file.path.slice(sourcePrefix.length) : file.path
  if (file.path.startsWith('data/dsh-home/storages/') && file.path.endsWith('.json')) {
    const parsed = JSON.parse(bytes.toString('utf8'))
    return { archivePath, bytes: Buffer.from(`${JSON.stringify(replaceExactStrings(parsed, before, after), null, 2)}\n`, 'utf8') }
  }
  if (file.path.startsWith(sourcePrefix) && file.path.endsWith('/session.jsonl.zstd')) {
    return { archivePath, bytes: relocateSessionHeaderBytes(bytes, before, after, true) }
  }
  if (file.path.startsWith(sourcePrefix) && file.path.endsWith('/session.jsonl')) {
    return { archivePath, bytes: relocateSessionHeaderBytes(bytes, before, after, false) }
  }
  return { archivePath, bytes }
}

export async function restoreDataArchive(layout, filename, options = {}) {
  const conflict = options.conflict ?? 'keep'
  if (!['keep', 'replace'].includes(conflict)) throw new Error('Conflict mode must be keep or replace.')
  const { document, encrypted } = decodeArchive(await readFile(path.resolve(filename)), options.password)
  const trace = typeof options.trace === 'function' ? options.trace : () => {}
  trace('archive-validated', { files: document.files.length, categories: document.categories.length, encrypted })
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
  const rollbackDirectory = path.join(layout.dataDir, 'backups', `before-import-${stamp}-${randomBytes(6).toString('hex')}`)
  const conflicts = []
  const changed = []
  const generated = []
  let imported = 0
  let unchanged = 0
  let replaced = 0
  let retainedGeneratedBackup = false
  const restorePaths = new Set()

  async function prepareGeneratedPath(target) {
    const absolute = path.resolve(target)
    const relative = normalizedRelative(layout.stateRoot, absolute)
    if (generated.some(entry => entry.target === absolute)) return
    const rollback = path.join(rollbackDirectory, 'generated', ...relative.split('/'))
    if (existsSync(absolute)) {
      await mkdir(path.dirname(rollback), { recursive: true })
      await rename(absolute, rollback)
      generated.push({ target: absolute, rollback })
      retainedGeneratedBackup = true
    } else {
      generated.push({ target: absolute, rollback: null })
    }
  }

  async function rollbackImport() {
    trace('rollback-begin', { changed: changed.length, generated: generated.length })
    for (const entry of [...generated].reverse()) {
      await rm(entry.target, { recursive: true, force: true }).catch(() => {})
      if (entry.rollback && existsSync(entry.rollback)) {
        await mkdir(path.dirname(entry.target), { recursive: true })
        await rename(entry.rollback, entry.target)
      }
    }
    for (const entry of [...changed].reverse()) {
      await rm(entry.target, { force: true }).catch(() => {})
      if (entry.rollback && existsSync(entry.rollback)) {
        await mkdir(path.dirname(entry.target), { recursive: true })
        await rename(entry.rollback, entry.target)
      }
    }
    await rm(rollbackDirectory, { recursive: true, force: true }).catch(() => {})
    trace('rollback-complete')
  }

  try {
    for (const file of document.files) {
      const relocated = relocatePortableWorkspaceEntry(
        file,
        Buffer.from(file.data, 'base64'),
        document.portableWorkspace,
        layout.workspace,
      )
      const bytes = relocated.bytes
      if (restorePaths.has(relocated.archivePath)) throw new Error(`Duplicate relocated data package path: ${relocated.archivePath}`)
      restorePaths.add(relocated.archivePath)
      const target = await safeTarget(layout.stateRoot, relocated.archivePath)
      let rollback = null
      if (existsSync(target)) {
        const previous = await readFile(target)
        if (sha256(previous) === sha256(bytes)) { unchanged += 1; continue }
        if (conflict === 'keep') { conflicts.push(relocated.archivePath); continue }
        rollback = await safeTarget(rollbackDirectory, relocated.archivePath)
        await mkdir(path.dirname(rollback), { recursive: true })
        await writeFile(rollback, previous, { mode: 0o600 })
        replaced += 1
      }
      await mkdir(path.dirname(target), { recursive: true })
      const temporary = `${target}.dsh-import-${process.pid}`
      await writeFile(temporary, bytes, { mode: 0o600 })
      await rename(temporary, target)
      changed.push({ target, rollback, path: relocated.archivePath, category: file.category })
      imported += 1
    }
    if (typeof options.validate === 'function') {
      trace('operability-validation-begin', { imported, unchanged, conflicts: conflicts.length, replaced })
      await options.validate({
        changed: changed.map(({ path: archivePath, category }) => ({ path: archivePath, category })),
        transaction: { prepareGeneratedPath },
      })
      trace('operability-validation-complete')
    }
  } catch (error) {
    await rollbackImport()
    throw error
  }
  if (replaced === 0 && !retainedGeneratedBackup) await rm(rollbackDirectory, { recursive: true, force: true })
  trace('complete', { imported, unchanged, conflicts: conflicts.length, replaced })
  return {
    status: 'restored', encrypted, categories: document.categories, imported, unchanged, conflicts, replaced,
    rollbackDirectory: replaced > 0 || retainedGeneratedBackup ? rollbackDirectory : null,
  }
}
