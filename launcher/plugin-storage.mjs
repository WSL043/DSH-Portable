// Portable plugin storage: keep third-party plugin data inside the portable drive.
//
// Many DSH plugins hardcode user-profile directories (for example
// `~/.dsh/memory`, `%APPDATA%\dsh-pet-electron-helper` or
// `%LOCALAPPDATA%\ego-lite-linux`). Those paths survive `data/` backups and a
// drive move, so plugin state silently stays on the host machine.
//
// A profile can list such directories in `data/plugin-storage.json`:
//
//   {
//     "version": 1,
//     "links": [
//       { "id": "mneme-memory", "link": "%USERPROFILE%\\.dsh\\memory",
//         "target": "%DSH_DATA%\\plugin-data\\mneme-memory" }
//     ]
//   }
//
// `applyPluginStorage` runs before the DSH app starts and only creates links for
// absent/empty sources; it never moves a live directory. `finalizePluginStorage`
// runs after the app exits and migrates a real source directory (copy -> backup
// -> link -> delete backup, with rollback), so SQLite/Electron files are moved
// only when nobody holds them. Both are idempotent.
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, rmdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const PLUGIN_STORAGE_MANIFEST = 'plugin-storage.json'
export const PLUGIN_STORAGE_DIR = 'plugin-data'
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const ENV_TOKEN = /%([^%]+)%|\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

export function pluginStorageManifestPath(dataDir) {
  return path.join(path.resolve(dataDir), PLUGIN_STORAGE_MANIFEST)
}

export function pluginStorageRoot(dataDir) {
  // Under dsh-home so the existing `sessions` data backup (which includes
  // dsh-home/storages) and profile exports carry plugin data with the drive.
  return path.join(path.resolve(dataDir), 'dsh-home', 'storages', PLUGIN_STORAGE_DIR)
}

function expandValue(value, { dataDir, dshHome, env = process.env }) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Plugin storage path must be a non-empty string.')
  let text = value.trim()
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) {
    text = path.join(os.homedir(), text.slice(1))
  }
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
  if (/%[^%]+%/.test(text)) throw new Error(`Unresolved plugin storage token in: ${value}`)
  return text
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function samePath(a, b) {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export function resolvePluginStorageEntry(entry, layout, { env = process.env } = {}) {
  if (!entry || typeof entry !== 'object') throw new Error('Plugin storage entry must be an object.')
  if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) throw new Error(`Invalid plugin storage id: ${entry.id}`)
  const dataDir = path.resolve(layout.dataDir)
  const targetRoot = pluginStorageRoot(dataDir)
  const link = path.resolve(expandValue(entry.link, { dataDir, dshHome: layout.dshHome, env }))
  const target = path.resolve(expandValue(entry.target, { dataDir, dshHome: layout.dshHome, env }))
  if (!isContained(targetRoot, target) || samePath(targetRoot, target)) {
    throw new Error(`Plugin storage target must stay under ${targetRoot}: ${entry.target}`)
  }
  if (samePath(link, target)) throw new Error(`Plugin storage link and target are identical: ${entry.link}`)
  if (isContained(dataDir, link) || (layout.root && isContained(layout.root, link))) {
    throw new Error(`Plugin storage link must live outside the portable root: ${entry.link}`)
  }
  return { id: entry.id, link, target }
}

export async function readPluginStorageManifest(dataDir, { layout, env = process.env } = {}) {
  const filename = pluginStorageManifestPath(dataDir)
  let raw
  try { raw = await readFile(filename, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return { filename, entries: [] }
    throw error
  }
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error(`Invalid plugin storage manifest JSON: ${filename}`) }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.links))
    throw new Error(`Unsupported plugin storage manifest: ${filename}`)
  const seen = new Set()
  const entries = parsed.links.map(entry => {
    const resolved = resolvePluginStorageEntry(entry, layout, { env })
    const key = process.platform === 'win32' ? resolved.id.toLowerCase() : resolved.id
    if (seen.has(key)) throw new Error(`Duplicate plugin storage id: ${resolved.id}`)
    seen.add(key)
    return resolved
  })
  return { filename, entries }
}

async function lstatIfPresent(filename) {
  try { return await lstat(filename) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function removeLink(link) {
  try { await rm(link, { force: true }) } catch {}
  if (await lstatIfPresent(link)) {
    try { await rmdir(link) } catch {}
  }
}

async function createLink(link, target, platform) {
  await mkdir(target, { recursive: true })
  await mkdir(path.dirname(link), { recursive: true })
  try {
    await symlink(target, link, platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    await removeLink(link)
    await symlink(target, link, platform === 'win32' ? 'junction' : 'dir')
  }
}

async function isEmptyDirectory(filename) {
  try {
    return (await readdir(filename)).length === 0
  } catch {
    return false
  }
}

async function migrate(source, target, platform) {
  await mkdir(target, { recursive: true })
  await cp(source, target, { recursive: true, force: true, errorOnExist: false, preserveTimestamps: true })
  const backup = `${source}.pre-portable-${Date.now()}`
  await rename(source, backup)
  try {
    await createLink(source, target, platform)
    await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (existsSync(backup) && !existsSync(source)) {
      try { await rename(backup, source) } catch {}
    }
    throw error
  }
}

/**
 * Create or repair links for the manifest.
 * mode 'safe'     — links absent/empty sources only; never moves a live directory.
 * mode 'finalize' — also migrates non-empty real directories (host must be stopped).
 */
export async function applyPluginStorage({ layout, mode = 'safe', dryRun = false, platform = process.platform, env = process.env, log = () => {} }) {
  if (mode !== 'safe' && mode !== 'finalize') throw new Error(`Unknown plugin storage mode: ${mode}`)
  const { filename, entries } = await readPluginStorageManifest(layout.dataDir, { layout, env })
  const result = { schemaVersion: 1, mode, dryRun, manifest: filename, entries: [], ok: 0, skipped: 0, failed: 0 }
  for (const entry of entries) {
    const item = { id: entry.id, link: entry.link, target: entry.target, action: 'none' }
    try {
      const stat = await lstatIfPresent(entry.link)
      if (!stat) {
        item.action = 'link'
        if (!dryRun) await createLink(entry.link, entry.target, platform)
      } else if (stat.isSymbolicLink()) {
        let current = ''
        try { current = String(await readlink(entry.link)).replace(/^\\\\\?\\/, '') } catch {}
        if (current && samePath(current, entry.target)) item.action = 'ok'
        else {
          item.action = 'relink'
          if (!dryRun) {
            await removeLink(entry.link)
            await createLink(entry.link, entry.target, platform)
          }
        }
      } else if (stat.isDirectory()) {
        const empty = await isEmptyDirectory(entry.link)
        if (mode === 'safe' && !empty) {
          item.action = 'skip-live'
        } else if (empty) {
          item.action = 'link'
          if (!dryRun) {
            await rm(entry.link, { recursive: true, force: true })
            await createLink(entry.link, entry.target, platform)
          }
        } else {
          item.action = 'migrate'
          if (!dryRun) await migrate(entry.link, entry.target, platform)
        }
      } else {
        item.action = 'skip-file'
      }
    } catch (error) {
      item.action = 'failed'
      item.error = error?.message || String(error)
      log(`plugin-storage ${entry.id}: ${item.error}`)
    }
    result.entries.push(item)
    if (item.action === 'failed') result.failed += 1
    else if (String(item.action).startsWith('skip')) result.skipped += 1
    else result.ok += 1
  }
  return result
}

export async function finalizePluginStorage(options) {
  return applyPluginStorage({ ...options, mode: 'finalize' })
}
