import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import path from 'node:path'

const DEFAULT_PORT = 3080
const MAX_PORT = 3180

export function layoutForRoot(root, platform = process.platform, stateRoot = root) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const portableRoot = paths.resolve(root)
  const durableRoot = paths.resolve(stateRoot)
  const dataDir = paths.join(durableRoot, 'data')
  const runtimeDir = paths.join(portableRoot, 'runtime')
  const nodeDir = paths.join(runtimeDir, 'node')
  const appDir = paths.join(portableRoot, 'app')
  const stateDir = paths.join(dataDir, 'runtime')
  return {
    root: portableRoot,
    appDir,
    browserProfile: paths.join(dataDir, 'browser'),
    dataDir,
    dshBin: paths.join(appDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    dshHome: paths.join(dataDir, 'dsh-home'),
    hostBin: paths.join(portableRoot, 'launcher', 'portable-host.mjs'),
    launchLock: paths.join(stateDir, 'launcher.lock'),
    logsDir: paths.join(dataDir, 'logs'),
    nodeDir,
    nodeExe: platform === 'win32' ? paths.join(nodeDir, 'node.exe') : paths.join(nodeDir, 'bin', 'node'),
    platform,
    portableCli: paths.join(portableRoot, 'launcher', 'portable-cli.mjs'),
    portableMeta: paths.join(dataDir, 'portable.json'),
    processState: paths.join(stateDir, 'process.json'),
    runtimeDir,
    stateRoot: durableRoot,
    stateDir,
    workspace: paths.join(durableRoot, 'workspace'),
  }
}

export function buildDshEnv(layout, source = process.env) {
  return {
    ...source,
    DSH_HOME: layout.dshHome,
    DSH_PORTABLE: '1',
    DSH_TELEMETRY_MODE: 'DISABLED',
    PATH: `${path.dirname(layout.nodeExe)}${path.delimiter}${source.PATH ?? ''}`,
  }
}

export function browserLaunchSpec(executable, url, layout) {
  return {
    command: executable,
    args: [
      `--app=${url}`,
      `--user-data-dir=${layout.browserProfile}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  }
}

export function parseCli(argv) {
  let command = 'start'
  let commandSeen = false
  let noBrowser = false
  let json = false
  for (const arg of argv) {
    if (arg === '--no-browser') noBrowser = true
    else if (arg === '--json') json = true
    else if (['start', 'stop', 'status', 'open'].includes(arg)) {
      if (commandSeen) throw new Error('Specify no more than one command.')
      command = arg
      commandSeen = true
    }
    else throw new Error(`Unknown command or option: ${arg}`)
  }
  return { command, noBrowser, json }
}

function comparable(value, platform = process.platform) {
  const source = String(value ?? '')
  if (platform === 'win32') return path.win32.resolve(source).replaceAll('/', '\\').toLowerCase()
  return path.posix.resolve(source.replaceAll('\\', '/'))
}

function comparableAliases(value, platform = process.platform) {
  const aliases = new Set([comparable(value, platform)])
  if (platform !== 'win32' || !value) return aliases
  try {
    aliases.add(comparable(realpathSync.native(String(value)), platform))
  } catch {
    // A missing path cannot have a filesystem alias; retain the normalized input.
  }
  return aliases
}

function sameComparablePath(left, right, platform = process.platform) {
  if (!left || !right) return false
  const leftAliases = comparableAliases(left, platform)
  return [...comparableAliases(right, platform)].some((alias) => leftAliases.has(alias))
}

function commandIncludesComparablePath(commandLine, expected, platform = process.platform) {
  if (!expected) return false
  return [...comparableAliases(expected, platform)].some((alias) => commandLine.includes(alias))
}

export function isOwnedDshProcess(processInfo, layout, port) {
  if (!processInfo) return false
  const platform = layout.platform ?? process.platform
  const commandLine = platform === 'win32'
    ? String(processInfo.commandLine ?? '').replaceAll('/', '\\').toLowerCase()
    : String(processInfo.commandLine ?? '').replaceAll('\\', '/')
  if (processInfo.executablePath && !sameComparablePath(processInfo.executablePath, layout.nodeExe, platform)) return false
  return commandIncludesComparablePath(commandLine, layout.nodeExe, platform)
    && commandIncludesComparablePath(commandLine, layout.hostBin, platform)
    && commandIncludesComparablePath(commandLine, layout.dshBin, platform)
    && commandLine.includes(`--port ${Number(port)}`)
}

export function isOwnedLauncherProcess(processInfo, layout) {
  if (!processInfo) return false
  const platform = layout.platform ?? process.platform
  const commandLine = platform === 'win32'
    ? String(processInfo.commandLine ?? '').replaceAll('/', '\\').toLowerCase()
    : String(processInfo.commandLine ?? '').replaceAll('\\', '/')
  if (processInfo.executablePath && !sameComparablePath(processInfo.executablePath, layout.nodeExe, platform)) return false
  return commandIncludesComparablePath(commandLine, layout.nodeExe, platform)
    && commandIncludesComparablePath(commandLine, layout.portableCli, platform)
}

export function queryWindowsProcess(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return null
  const script = [
    '$utf8 = New-Object System.Text.UTF8Encoding($false)',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${Number(pid)}\" -ErrorAction SilentlyContinue`,
    'if ($null -ne $p) {',
    '  [pscustomobject]@{ executablePath=$p.ExecutablePath; commandLine=$p.CommandLine } | ConvertTo-Json -Compress',
    '}',
  ].join('; ')
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
    return output ? JSON.parse(output) : null
  } catch {
    return null
  }
}

export function queryPosixProcess(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return null
  try {
    const commandLine = execFileSync('ps', ['-ww', '-p', String(Number(pid)), '-o', 'command='], {
      encoding: 'utf8',
    }).trim()
    return commandLine ? { executablePath: '', commandLine } : null
  } catch {
    return null
  }
}

export function queryProcess(pid, platform = process.platform) {
  return platform === 'win32' ? queryWindowsProcess(pid) : queryPosixProcess(pid)
}

export function projectKey(cwd) {
  if (!cwd) throw new Error('cannot encode an empty workspace path')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

async function atomicWrite(filename, bytes) {
  const temporary = `${filename}.portable-${process.pid}.tmp`
  await writeFile(temporary, bytes, { mode: 0o600 })
  await rename(temporary, filename)
}

async function readJson(filename, fallback = null) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true })
  await atomicWrite(filename, `${JSON.stringify(value, null, 2)}\n`)
}

function replaceExactStrings(value, before, after) {
  if (value === before) return after
  if (Array.isArray(value)) return value.map((item) => replaceExactStrings(item, before, after))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceExactStrings(item, before, after)]))
  }
  return value
}

async function migrateStorageJson(dshHome, before, after) {
  const storageDir = path.join(dshHome, 'storages')
  if (!existsSync(storageDir)) return 0
  let changed = 0
  for (const entry of await readdir(storageDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const filename = path.join(storageDir, entry.name)
    const parsed = await readJson(filename)
    const migrated = replaceExactStrings(parsed, before, after)
    if (JSON.stringify(migrated) === JSON.stringify(parsed)) continue
    await writeJsonAtomic(filename, migrated)
    changed += 1
  }
  return changed
}

async function migrateSessionHeader(filename, before, after, compressed) {
  const source = await readFile(filename)
  const decoded = compressed ? zstdDecompressSync(source) : source
  const newline = decoded.indexOf(10)
  if (newline < 0) throw new Error(`session artifact has no header: ${filename}`)
  const header = JSON.parse(decoded.subarray(0, newline).toString('utf8'))
  if (header.cwd !== before) return false
  header.cwd = after
  const rest = decoded.subarray(newline + 1)
  const next = Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), rest])
  await atomicWrite(filename, compressed ? zstdCompressSync(next) : next)
  return true
}

async function migrateSessionDirectory(dshHome, before, after) {
  const root = path.join(dshHome, 'sessions')
  if (!existsSync(root)) return 0
  const sourceDir = path.join(root, projectKey(before))
  const targetDir = path.join(root, projectKey(after))
  await mkdir(targetDir, { recursive: true })

  if (existsSync(sourceDir) && comparable(sourceDir) !== comparable(targetDir)) {
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const sourceSession = path.join(sourceDir, entry.name)
      const targetSession = path.join(targetDir, entry.name)
      if (existsSync(targetSession)) throw new Error(`portable session migration collision: ${entry.name}`)
      await rename(sourceSession, targetSession)
    }
    await rmdir(sourceDir)
  }

  let changed = 0
  for (const entry of await readdir(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sessionDir = path.join(targetDir, entry.name)
    const zstd = path.join(sessionDir, 'session.jsonl.zstd')
    const plain = path.join(sessionDir, 'session.jsonl')
    if (existsSync(zstd) && await migrateSessionHeader(zstd, before, after, true)) changed += 1
    else if (existsSync(plain) && await migrateSessionHeader(plain, before, after, false)) changed += 1
  }
  return changed
}

export async function migratePortableRoot(layout) {
  await ensurePortableDirectories(layout)
  const previous = await readJson(layout.portableMeta, null)
  const current = { schemaVersion: 1, lastRoot: layout.root, workspace: layout.workspace }
  if (!previous?.lastRoot || comparable(previous.lastRoot) === comparable(layout.root)) {
    await writeJsonAtomic(layout.portableMeta, current)
    return { moved: false, sessionCount: 0, storageCount: 0 }
  }

  const oldWorkspace = previous.workspace || path.join(previous.lastRoot, 'workspace')
  const storageCount = await migrateStorageJson(layout.dshHome, oldWorkspace, layout.workspace)
  const sessionCount = await migrateSessionDirectory(layout.dshHome, oldWorkspace, layout.workspace)
  await writeJsonAtomic(layout.portableMeta, current)
  return { moved: true, sessionCount, storageCount }
}

export async function ensurePortableDirectories(layout) {
  await Promise.all([
    mkdir(layout.browserProfile, { recursive: true }),
    mkdir(layout.dshHome, { recursive: true }),
    mkdir(layout.logsDir, { recursive: true }),
    mkdir(layout.stateDir, { recursive: true }),
    mkdir(layout.workspace, { recursive: true }),
  ])
}

function processExists(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export async function acquireLaunchLock(layout, adapters = {}) {
  await mkdir(layout.stateDir, { recursive: true })
  const processQuery = adapters.processQuery ?? ((pid) => queryProcess(pid, layout.platform))
  const pidExists = adapters.pidExists ?? processExists

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(layout.launchLock, 'wx')
      await handle.writeFile(`${process.pid}\n`)
      let released = false
      return async () => {
        if (released) return
        released = true
        await handle.close().catch(() => {})
        await rm(layout.launchLock, { force: true }).catch(() => {})
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error

      const ownerPid = Number.parseInt((await readFile(layout.launchLock, 'utf8').catch(() => '')).trim(), 10)
      let owner = null
      try {
        owner = processQuery(ownerPid)
      } catch {
        owner = null
      }
      if (isOwnedLauncherProcess(owner, layout) || (!owner && pidExists(ownerPid))) {
        throw new Error('Another portable launcher is already starting or stopping DSH.')
      }

      const stale = `${layout.launchLock}.stale-${process.pid}-${Date.now()}`
      try {
        await rename(layout.launchLock, stale)
        await rm(stale, { force: true })
      } catch (reclaimError) {
        if (reclaimError?.code !== 'ENOENT') {
          throw new Error('Another portable launcher is already starting or stopping DSH.')
        }
      }
    }
  }
  throw new Error('Another portable launcher is already starting or stopping DSH.')
}

export const PORT_RANGE = Object.freeze({ first: DEFAULT_PORT, last: MAX_PORT })
