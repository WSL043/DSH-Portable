// Opt-in host-path redirects. Only an explicit command migrates real directories.
import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, open, readFile, readdir, readlink, rename, symlink, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const PLUGIN_STORAGE_MANIFEST = 'plugin-storage.json'
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const ENV_TOKEN = /%([^%]+)%|\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

export function pluginStorageManifestPath(dataDir) {
  return path.join(path.resolve(dataDir), PLUGIN_STORAGE_MANIFEST)
}

export function pluginStorageRoot(dataDir) {
  return path.join(path.resolve(dataDir), 'dsh-home', 'storages', 'plugin-data')
}

function expandValue(value, { dataDir, dshHome, env }) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Plugin storage path must be a non-empty string.')
  let text = value.trim()
  if (text === '~' || /^~[/\\]/.test(text)) text = path.join(os.homedir(), text.slice(1))
  text = text.replace(ENV_TOKEN, (match, winName, bracedName, plainName) => {
    const name = String(winName ?? bracedName ?? plainName).trim()
    if (name === 'DSH_DATA') return path.resolve(dataDir)
    if (name === 'DSH_HOME') return path.resolve(dshHome)
    const found = env[name] ?? (process.platform === 'win32'
      ? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
      : undefined)
    if (found === undefined) throw new Error(`Unknown plugin storage token: ${match}`)
    return String(found)
  })
  if (!path.isAbsolute(text)) throw new Error(`Plugin storage path must be absolute: ${value}`)
  return path.resolve(text)
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function samePath(a, b) {
  return path.relative(path.resolve(a), path.resolve(b)) === ''
}

export function resolvePluginStorageEntry(entry, layout, { env = process.env } = {}) {
  if (!entry || typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) throw new Error('Invalid plugin storage id.')
  const context = { dataDir: layout.dataDir, dshHome: layout.dshHome, env }
  const link = expandValue(entry.link, context)
  const target = expandValue(entry.target, context)
  const targetRoot = pluginStorageRoot(layout.dataDir)
  if (!isContained(targetRoot, target) || samePath(targetRoot, target)) throw new Error(`Plugin storage target must stay under ${targetRoot}`)
  for (const root of [layout.root, layout.stateRoot, layout.baseStateRoot, layout.dataDir].filter(Boolean).map(value => path.resolve(value))) {
    if (isContained(root, link) || isContained(link, root)) throw new Error('Plugin storage link must be outside and not contain the portable root or data directory.')
  }
  return { id: entry.id, link, target }
}

export async function readPluginStorageManifest(dataDir, { layout, env = process.env } = {}) {
  const filename = pluginStorageManifestPath(dataDir)
  let raw
  try { raw = await readFile(filename, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return { filename, entries: [] }
    throw error
  }
  const parsed = JSON.parse(raw)
  if (parsed?.version !== 1 || !Array.isArray(parsed.links)) throw new Error(`Unsupported plugin storage manifest: ${filename}`)
  const entries = parsed.links.map(entry => resolvePluginStorageEntry(entry, layout, { env }))
  const seen = new Set()
  for (const [index, entry] of entries.entries()) {
    const key = process.platform === 'win32' ? entry.id.toLowerCase() : entry.id
    if (seen.has(key)) throw new Error(`Duplicate plugin storage id: ${entry.id}`)
    seen.add(key)
    for (const previous of entries.slice(0, index)) {
      for (const a of [entry.link, entry.target]) for (const b of [previous.link, previous.target]) {
        if (isContained(a, b) || isContained(b, a)) throw new Error(`Overlapping plugin storage paths: ${entry.id}, ${previous.id}`)
      }
    }
  }
  return { filename, entries }
}

async function statIfPresent(filename) {
  try { return await lstat(filename) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// Reject existing junction/symlink ancestors, including dangling ones.
async function checkParents(filename, create = false) {
  const directory = path.dirname(filename)
  let current = path.parse(directory).root
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    let stat = await statIfPresent(current)
    if (!stat) {
      if (!create) return
      try { await mkdir(current) } catch (error) { if (error.code !== 'EEXIST') throw error }
      stat = await lstat(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe plugin storage parent: ${current}`)
  }
}

async function checkTarget(target) {
  await checkParents(target)
  const stat = await statIfPresent(target)
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error(`Unsafe plugin storage target: ${target}`)
  return stat
}

async function createLink(link, target, platform) {
  await checkParents(target, true)
  if (!await checkTarget(target)) await mkdir(target)
  // EEXIST is a conflict; never remove an entry that appeared after inspection.
  await symlink(target, link, platform === 'win32' ? 'junction' : 'dir')
}

async function migrate(source, target, platform) {
  await checkParents(target, true)
  await mkdir(target) // Exclusive reservation: even an existing empty target conflicts.
  const backup = `${source}.pre-portable-${randomUUID()}`
  try {
    for (const name of await readdir(source)) await cp(path.join(source, name), path.join(target, name), {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
      filter: async filename => {
        const stat = await lstat(filename)
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported plugin storage entry: ${filename}`)
        return true
      },
    })
    await rename(source, backup)
    try { await createLink(source, target, platform) } catch (error) {
      if (!await statIfPresent(source)) await rename(backup, source)
      throw error
    }
    return backup // Keep the original until the user has verified plugin behavior.
  } catch (error) {
    throw new Error(`Migration stopped; inspect source ${source}, backup ${backup}, and target ${target} before retrying. ${error.message}`, { cause: error })
  }
}

export async function applyPluginStorage({ layout, mode = 'safe', platform = process.platform, env = process.env, log = () => {} }) {
  if (!['safe', 'migrate'].includes(mode)) throw new Error(`Unknown plugin storage mode: ${mode}`)
  const { filename, entries } = await readPluginStorageManifest(layout.dataDir, { layout, env })
  const result = { schemaVersion: 1, mode, manifest: filename, entries: [], ok: 0, skipped: 0, failed: 0 }
  for (const entry of entries) {
    const item = { ...entry, action: 'none' }
    let lock
    const lockPath = `${entry.link}.dsh-portable-lock`
    try {
      await checkParents(entry.link, true)
      // Shared by separate Portable copies. A crash leaves the lock for manual
      // inspection; an active or stale lock is never automatically stolen.
      lock = await open(lockPath, 'wx')
      await checkTarget(entry.target)
      const stat = await statIfPresent(entry.link)
      if (!stat) {
        await createLink(entry.link, entry.target, platform)
        item.action = 'link'
      } else if (stat.isSymbolicLink()) {
        const current = path.resolve(path.dirname(entry.link), String(await readlink(entry.link)).replace(/^\\\\\?\\/, ''))
        if (!samePath(current, entry.target)) throw new Error(`Existing link belongs to a different target; left unchanged: ${entry.link}`)
        if (!await statIfPresent(entry.target)) throw new Error(`Plugin storage target is missing; restore it before starting: ${entry.target}`)
        item.action = 'ok'
      } else if (stat.isDirectory()) {
        if (mode === 'safe') item.action = 'skip-live'
        else {
          item.backup = await migrate(entry.link, entry.target, platform)
          item.action = 'migrate'
        }
      } else throw new Error(`Plugin storage source is not a directory: ${entry.link}`)
    } catch (error) {
      item.action = 'failed'
      item.error = error.message
      log(`plugin-storage ${entry.id}: ${item.error}`)
    } finally {
      if (lock) { await lock.close(); await unlink(lockPath) }
    }
    result.entries.push(item)
    if (item.action === 'failed') result.failed += 1
    else if (item.action.startsWith('skip')) result.skipped += 1
    else result.ok += 1
  }
  return result
}
