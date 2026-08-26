import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import path from 'node:path'

const DEFAULT_PORT = 3080
const MAX_PORT = 3180

export function layoutForRoot(root, platform = process.platform, stateRoot = root, runtimeRoot = root) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const portableRoot = paths.resolve(root)
  const durableRoot = paths.resolve(stateRoot)
  const immutableRoot = paths.resolve(runtimeRoot)
  const dataDir = paths.join(durableRoot, 'data')
  const runtimeDir = paths.join(portableRoot, 'runtime')
  const nodeDir = paths.join(runtimeDir, 'node')
  const appDir = paths.join(immutableRoot, 'app')
  const appBinDir = paths.join(appDir, 'node_modules', '.bin')
  const stateDir = paths.join(dataDir, 'runtime')
  const dshHome = paths.join(dataDir, 'dsh-home')
  return {
    root: portableRoot,
    immutableRoot,
    capsuleMode: immutableRoot !== portableRoot,
    appDir,
    appBinDir,
    browserProfile: paths.join(dataDir, 'browser'),
    browserState: paths.join(stateDir, 'browser.json'),
    dataDir,
    desktopBridgePatch: paths.join(
      appDir,
      'node_modules',
      '@wsl043',
      'dsh-portable-desktop-bridge',
      'cordis.patch.yml',
    ),
    desktopBridgeFallback: paths.join(
      dshHome,
      'profiles',
      'node_modules',
      '@wsl043',
      'dsh-portable-desktop-bridge',
    ),
    desktopExe: platform === 'win32' ? paths.join(portableRoot, 'DeepSeek-Herness.exe') : null,
    pluginMarketRoot: paths.join(appDir, 'node_modules', '@wsl043', 'dsh-portable-plugin-market'),
    pluginMarketFallback: paths.join(dshHome, 'profiles', 'node_modules', '@wsl043', 'dsh-portable-plugin-market'),
    dshBin: paths.join(appDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    dshHome,
    extensionCache: paths.join(stateDir, 'extension-cache'),
    extensionPending: paths.join(stateDir, 'pending-extension.json'),
    extensionReceipts: paths.join(stateDir, 'extension-receipts.json'),
    extensionRecovery: paths.join(stateDir, 'extension-recovery'),
    extensionResult: paths.join(stateDir, 'extension-result.json'),
    hostBin: paths.join(portableRoot, 'launcher', 'portable-host.mjs'),
    launchLock: paths.join(stateDir, 'launcher.lock'),
    logsDir: paths.join(dataDir, 'logs'),
    nodeDir,
    nodeExe: platform === 'win32' ? paths.join(nodeDir, 'node.exe') : paths.join(nodeDir, 'bin', 'node'),
    packageManagerStore: paths.join(dataDir, 'pnpm-store'),
    packageManagerBin: platform === 'win32'
      ? paths.join(appBinDir, 'pnpm.cmd')
      : platform === 'linux'
        ? paths.join(portableRoot, 'launcher', 'pnpm')
        : paths.join(appBinDir, 'pnpm'),
    platform,
    portableCli: paths.join(portableRoot, 'launcher', 'portable-cli.mjs'),
    portableMeta: paths.join(dataDir, 'portable.json'),
    runtimeCapsule: paths.join(portableRoot, 'runtime-capsule.json'),
    processState: paths.join(stateDir, 'process.json'),
    repairRequest: paths.join(stateDir, 'repair-requested.json'),
    repairResult: paths.join(stateDir, 'repair-result.json'),
    runtimeDir,
    stateRoot: durableRoot,
    stateDir,
    updateCheckCache: paths.join(stateDir, 'update-check.json'),
    productUpdateCheckCache: paths.join(stateDir, 'update-check.json'),
    engineUpdateCheckCache: paths.join(stateDir, 'engine-update-check.json'),
    updateDir: paths.join(portableRoot, '.dsh-portable-update'),
    updateJournal: paths.join(stateDir, 'update.json'),
    webView2Core: platform === 'win32' ? paths.join(portableRoot, 'Microsoft.Web.WebView2.Core.dll') : null,
    webView2Loader: platform === 'win32' ? paths.join(portableRoot, 'WebView2Loader.dll') : null,
    webView2WinForms: platform === 'win32' ? paths.join(portableRoot, 'Microsoft.Web.WebView2.WinForms.dll') : null,
    workspace: paths.join(durableRoot, 'workspace'),
  }
}

export async function retirePendingExtensionOperation(layout) {
  let pendingText
  try {
    pendingText = await readFile(layout.extensionPending, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }

  let pending
  try {
    pending = JSON.parse(pendingText)
  } catch {
    throw new Error('A retired Portable Extensions operation requires recovery; the pending state was left unchanged.')
  }
  if (pending?.status !== 'queued') {
    throw new Error('A retired Portable Extensions operation requires recovery; the pending state was left unchanged.')
  }

  await writeJsonAtomic(layout.extensionResult, {
    schemaVersion: 1,
    operationId: String(pending.operationId || ''),
    id: String(pending.id || ''),
    action: String(pending.action || ''),
    status: 'failed',
    code: 'portable_extensions_retired',
  })
  await rm(layout.extensionPending, { force: true })
  return true
}

async function ensurePackageFallback(layout, target, fallback, label) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const packageFile = paths.join(target, 'package.json')
  if (!existsSync(packageFile)) throw new Error(`Portable ${label} is missing: ${packageFile}`)

  await mkdir(paths.dirname(fallback), { recursive: true })
  let current = null
  try {
    current = await lstat(fallback)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (current) {
    if (!current.isSymbolicLink()) {
      throw new Error(`Portable ${label} fallback is occupied by another file: ${fallback}`)
    }
    try {
      if (sameComparablePath(await realpath(fallback), await realpath(target), layout.platform)) return false
    } catch {
      // A moved portable directory leaves a broken link. Replace only this owned link.
    }
    await unlink(fallback)
  }

  await symlink(target, fallback, layout.platform === 'win32' ? 'junction' : 'dir')
  return true
}

export async function ensureDesktopBridgeFallback(layout) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const bridgeChanged = await ensurePackageFallback(
    layout,
    paths.dirname(layout.desktopBridgePatch),
    layout.desktopBridgeFallback,
    'desktop bridge',
  )
  const marketChanged = existsSync(path.join(layout.pluginMarketRoot, 'package.json'))
    ? await ensurePackageFallback(
      layout,
      layout.pluginMarketRoot,
      layout.pluginMarketFallback,
      'plugin market',
    )
    : false
  return bridgeChanged || marketChanged
}

function packageDirectoryFromAnchor(anchor, packageName) {
  for (const searchRoot of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = path.join(searchRoot, packageName)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  return null
}

async function packagedDshDependencyClosure(layout) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const dshRoot = paths.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh')
  const dshManifestPath = paths.join(dshRoot, 'package.json')
  if (!existsSync(dshManifestPath)) {
    throw new Error(`The packaged DSH runtime is incomplete: missing @deepseek-ai/dsh (${dshManifestPath}).`)
  }

  const links = new Map([['@deepseek-ai/dsh', dshRoot]])
  const queue = [{ anchor: dshManifestPath, manifest: JSON.parse(await readFile(dshManifestPath, 'utf8')) }]
  const missing = []
  while (queue.length) {
    const current = queue.shift()
    const requiredPeers = Object.keys(current.manifest.peerDependencies ?? {})
      .filter(name => current.manifest.peerDependenciesMeta?.[name]?.optional !== true)
    const required = new Set([
      ...Object.keys(current.manifest.dependencies ?? {}),
      ...requiredPeers,
    ])
    const optional = new Set([
      ...Object.keys(current.manifest.optionalDependencies ?? {}),
      ...Object.keys(current.manifest.peerDependencies ?? {})
        .filter(name => current.manifest.peerDependenciesMeta?.[name]?.optional === true),
    ])
    for (const name of [...required, ...optional]) {
      // DefinitelyTyped packages describe source types only. Some production
      // packages publish them as dependencies or required peers even though
      // Node never loads them at runtime, and production pruning legitimately
      // removes them from a finished application bundle.
      if (name.startsWith('@types/')) continue
      if (links.has(name)) continue
      const target = packageDirectoryFromAnchor(current.anchor, name)
      if (!target) {
        if (required.has(name)) missing.push(name)
        continue
      }
      const manifestPath = paths.join(target, 'package.json')
      let manifest
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      } catch (error) {
        throw new Error(`The packaged DSH runtime is incomplete: ${name} has an unreadable package manifest (${manifestPath}).`, { cause: error })
      }
      links.set(name, target)
      queue.push({ anchor: manifestPath, manifest })
    }
  }
  if (missing.length) {
    throw new Error(`The packaged DSH runtime is incomplete: missing ${[...new Set(missing)].sort().join(', ')}.`)
  }
  return links
}

export async function inspectPackagedDshRuntime(layout) {
  try {
    const closure = await packagedDshDependencyClosure(layout)
    return { ok: true, packages: closure.size, detail: `${closure.size} packages verified` }
  } catch (error) {
    return { ok: false, packages: 0, detail: error?.message ?? String(error) }
  }
}

function managedProfileExpectedPackages(layout, links) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const expected = new Set(links.keys())
  if (existsSync(paths.join(paths.dirname(layout.desktopBridgePatch), 'package.json'))) {
    expected.add('@wsl043/dsh-portable-desktop-bridge')
  }
  if (existsSync(paths.join(layout.pluginMarketRoot, 'package.json'))) {
    expected.add('@wsl043/dsh-portable-plugin-market')
  }
  return expected
}

async function managedProfileResolverEntries(fallbackRoot, paths) {
  const packages = []
  let topLevel = []
  try {
    topLevel = await readdir(fallbackRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return packages
    throw error
  }
  for (const entry of topLevel) {
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const child of await readdir(paths.join(fallbackRoot, entry.name), { withFileTypes: true })) {
        packages.push(`${entry.name}/${child.name}`)
      }
    } else {
      packages.push(entry.name)
    }
  }
  return packages
}

function resolverDetail({ missing, wrongTarget, stale }) {
  const parts = []
  const describe = (label, names) => {
    if (!names.length) return
    const shown = names.slice(0, 8)
    const suffix = names.length > shown.length ? ` (+${names.length - shown.length} more)` : ''
    parts.push(`${label}: ${shown.join(', ')}${suffix}`)
  }
  describe('missing', missing)
  describe('wrong-target', wrongTarget)
  describe('stale', stale)
  return parts.length ? parts.join('; ') : 'all managed profile packages resolve to the packaged runtime'
}

export async function inspectManagedProfileModuleFallback(layout) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const fallbackRoot = paths.join(layout.dshHome, 'profiles', 'node_modules')
  let links
  try {
    links = await packagedDshDependencyClosure(layout)
  } catch (error) {
    return {
      ok: false,
      repairable: false,
      expected: 0,
      missing: [],
      wrongTarget: [],
      stale: [],
      detail: error?.message ?? String(error),
    }
  }

  const expectedPackages = managedProfileExpectedPackages(layout, links)
  const missing = []
  const wrongTarget = []
  for (const [packageName, target] of links) {
    const fallback = paths.join(fallbackRoot, packageName)
    let info
    try {
      info = await lstat(fallback)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missing.push(packageName)
        continue
      }
      throw error
    }
    if (!info.isSymbolicLink()) {
      wrongTarget.push(packageName)
      continue
    }
    try {
      if (!sameComparablePath(await realpath(fallback), await realpath(target), layout.platform)) {
        wrongTarget.push(packageName)
      }
    } catch {
      wrongTarget.push(packageName)
    }
  }

  const presentPackages = await managedProfileResolverEntries(fallbackRoot, paths)
  const stale = presentPackages.filter(packageName => !expectedPackages.has(packageName)).sort()
  missing.sort()
  wrongTarget.sort()
  const result = { missing, wrongTarget, stale }
  return {
    ok: missing.length === 0 && wrongTarget.length === 0 && stale.length === 0,
    repairable: true,
    expected: links.size,
    ...result,
    detail: resolverDetail(result),
  }
}

export async function repairManagedProfileModuleFallback(layout) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const fallbackRoot = paths.join(layout.dshHome, 'profiles', 'node_modules')
  const links = await packagedDshDependencyClosure(layout)
  let changed = false

  // This root is DSH's generated module resolver, not a profile's plugin
  // installation directory. Reconcile stale packages left by an older app
  // component while preserving the two Portable-owned private bridges that
  // are refreshed immediately after this step.
  const expectedPackages = managedProfileExpectedPackages(layout, links)
  let topLevel = []
  try {
    topLevel = await readdir(fallbackRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  for (const entry of topLevel) {
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      const scopeRoot = paths.join(fallbackRoot, entry.name)
      for (const child of await readdir(scopeRoot, { withFileTypes: true })) {
        const packageName = `${entry.name}/${child.name}`
        if (expectedPackages.has(packageName)) continue
        const candidate = paths.join(scopeRoot, child.name)
        const info = await lstat(candidate)
        if (info.isSymbolicLink()) await unlink(candidate)
        else await rm(candidate, { recursive: true, force: true })
        changed = true
      }
      if ((await readdir(scopeRoot)).length === 0) await rmdir(scopeRoot)
      continue
    }
    if (expectedPackages.has(entry.name)) continue
    const candidate = paths.join(fallbackRoot, entry.name)
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) await unlink(candidate)
    else await rm(candidate, { recursive: true, force: true })
    changed = true
  }

  for (const [packageName, target] of links) {
    const fallback = paths.join(fallbackRoot, packageName)
    await mkdir(paths.dirname(fallback), { recursive: true })
    let current = null
    try {
      current = await lstat(fallback)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (current) {
      if (current.isSymbolicLink()) {
        try {
          if (sameComparablePath(await realpath(fallback), await realpath(target), layout.platform)) continue
        } catch {
          // A moved or partially updated portable directory leaves a dangling link.
        }
        await unlink(fallback)
      } else {
        // This location is DSH's generated installation fallback, never the
        // profile-local third-party plugin directory. Replace only this leaf.
        await rm(fallback, { recursive: true, force: true })
      }
    }
    await symlink(target, fallback, layout.platform === 'win32' ? 'junction' : 'dir')
    changed = true
  }
  return changed
}

export async function clearPortableMoveLinks(layout) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const fallbackRoot = paths.join(layout.dshHome, 'profiles', 'node_modules')
  let changed = false
  if (existsSync(fallbackRoot)) {
    await rm(fallbackRoot, { recursive: true, force: true })
    changed = true
  }

  let storeVersions = []
  try {
    storeVersions = await readdir(layout.packageManagerStore, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  for (const entry of storeVersions) {
    if (!entry.isDirectory() || !/^v\d+$/.test(entry.name)) continue
    const projects = paths.join(layout.packageManagerStore, entry.name, 'projects')
    if (!existsSync(projects)) continue
    await rm(projects, { recursive: true, force: true })
    changed = true
  }
  return changed
}

export function buildDshEnv(layout, source = process.env) {
  const paths = layout.platform === 'win32' ? path.win32 : path.posix
  const separator = layout.platform === 'win32' ? ';' : ':'
  const environment = {
    ...source,
    DSH_HOME: layout.dshHome,
    DSH_PORTABLE: '1',
    DSH_PORTABLE_ROOT: layout.root,
    DSH_PORTABLE_STATE_ROOT: layout.stateRoot,
    DSH_TELEMETRY_MODE: 'DISABLED',
    PATH: [paths.dirname(layout.nodeExe), paths.dirname(layout.packageManagerBin), source.PATH ?? ''].filter(Boolean).join(separator),
  }
  try {
    const components = JSON.parse(readFileSync(paths.join(layout.root, 'licenses', 'COMPONENTS.json'), 'utf8'))
    if (typeof components.portableVersion === 'string') environment.DSH_PORTABLE_VERSION = components.portableVersion
    if (typeof components.dshVersion === 'string') environment.DSH_PORTABLE_DSH_VERSION = components.dshVersion
    if (typeof components.dshCommit === 'string') environment.DSH_PORTABLE_DSH_COMMIT = components.dshCommit
  } catch {
    // Source checkouts and early bootstrap stages may not have COMPONENTS.json yet.
  }
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'pnpm_config_store_dir') delete environment[key]
  }
  environment.pnpm_config_store_dir = layout.packageManagerStore
  return environment
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
  let allowHttp = false
  let force = false
  let updateManifest = ''
  let updateScope = 'product'
  let progressJson = false
  let waitForLockMs = 0
  let output
  let input
  let passwordFile
  let categories
  let conflict
  let allowUnencryptedCredentials = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--diagnostic-root-json') {
      if (commandSeen) throw new Error('Specify no more than one command.')
      command = 'diagnostic-root'
      commandSeen = true
      json = true
    }
    else if (arg === '--no-browser') noBrowser = true
    else if (arg === '--allow-unencrypted-credentials') allowUnencryptedCredentials = true
    else if (arg === '--json') json = true
    else if (arg === '--allow-http') allowHttp = true
    else if (arg === '--force') force = true
    else if (arg === '--progress-json') progressJson = true
    else if (arg === '--wait-for-lock-ms') {
      const value = Number(argv[index + 1])
      if (!Number.isSafeInteger(value) || value < 0 || value > 60000) throw new Error('--wait-for-lock-ms requires an integer from 0 to 60000.')
      waitForLockMs = value
      index += 1
    }
    else if (arg === '--update-manifest') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--update-manifest requires a value.')
      updateManifest = argv[index + 1]
      index += 1
    }
    else if (arg === '--scope') {
      const value = argv[index + 1]
      if (!['product', 'engine'].includes(value)) throw new Error('--scope requires product or engine.')
      updateScope = value
      index += 1
    }
    else if (arg === '--output') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--output requires a value.')
      output = argv[index + 1]
      index += 1
    }
    else if (arg === '--input') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--input requires a value.')
      input = argv[index + 1]
      index += 1
    }
    else if (arg === '--password-file') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--password-file requires a value.')
      passwordFile = argv[index + 1]
      index += 1
    }
    else if (arg === '--categories') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--categories requires a comma-separated value.')
      categories = argv[index + 1].split(',').map(value => value.trim()).filter(Boolean)
      index += 1
    }
    else if (arg === '--conflict') {
      if (!['keep', 'replace'].includes(argv[index + 1])) throw new Error('--conflict requires keep or replace.')
      conflict = argv[index + 1]
      index += 1
    }
    else if (['start', 'stop', 'status', 'open', 'doctor', 'repair', 'support-report', 'backup-data', 'inspect-data', 'restore-data', 'runtime-cache-status', 'runtime-cache-clean', 'check-update', 'defer-update', 'ignore-update', 'update'].includes(arg)) {
      if (commandSeen) throw new Error('Specify no more than one command.')
      command = arg
      commandSeen = true
    }
    else throw new Error(`Unknown command or option: ${arg}`)
  }
  const result = { command, noBrowser, json, allowHttp, force, updateManifest, progressJson, waitForLockMs, updateScope }
  if (output !== undefined) result.output = output
  if (input !== undefined) result.input = input
  if (passwordFile !== undefined) result.passwordFile = passwordFile
  if (categories !== undefined) result.categories = categories
  if (conflict !== undefined) result.conflict = conflict
  if (allowUnencryptedCredentials) result.allowUnencryptedCredentials = true
  return result
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

function commandHasExactPathArgument(commandLine, flag, expected, platform = process.platform) {
  const source = platform === 'win32'
    ? String(commandLine ?? '').replaceAll('/', '\\').toLowerCase()
    : String(commandLine ?? '').replaceAll('\\', '/')
  for (const alias of comparableAliases(expected, platform)) {
    for (const prefix of [`${flag}=`, `"${flag}=`, `'${flag}=`]) {
      for (const value of [alias, `"${alias}`, `'${alias}`]) {
        const needle = `${prefix}${value}`
        let index = source.indexOf(needle)
        while (index >= 0) {
          const next = source[index + needle.length]
          if (!next || /[\s"']/.test(next)) return true
          index = source.indexOf(needle, index + 1)
        }
      }
    }
  }
  return false
}

function supportedBrowserExecutable(filename, platform = process.platform) {
  if (!filename) return false
  const paths = platform === 'win32' ? path.win32 : path.posix
  const name = paths.basename(String(filename)).toLowerCase()
  if (platform === 'win32') return name === 'chrome.exe' || name === 'msedge.exe'
  return name === 'google chrome' || name === 'microsoft edge'
}

function supportedBrowserCommandLine(commandLine, platform = process.platform) {
  if (platform === 'win32') return false
  const source = String(commandLine ?? '').toLowerCase()
  return source.includes('/google chrome.app/contents/macos/google chrome')
    || source.includes('/microsoft edge.app/contents/macos/microsoft edge')
}

export function isOwnedPortableBrowserProcess(processInfo, layout, executable = '') {
  if (!processInfo) return false
  const platform = layout.platform ?? process.platform
  const commandLine = String(processInfo.commandLine ?? '')
  if (!commandHasExactPathArgument(commandLine, '--user-data-dir', layout.browserProfile, platform)) return false
  if (executable) {
    if (platform === 'win32' && processInfo.executablePath && !sameComparablePath(processInfo.executablePath, executable, platform)) return false
    if ((platform !== 'win32' || !processInfo.executablePath) && !commandIncludesComparablePath(
      platform === 'win32' ? commandLine.replaceAll('/', '\\').toLowerCase() : commandLine.replaceAll('\\', '/'),
      executable,
      platform,
    )) return false
    return supportedBrowserExecutable(executable, platform)
  }
  return supportedBrowserExecutable(processInfo.executablePath, platform)
    || supportedBrowserExecutable(processInfo.processName, platform)
    || supportedBrowserCommandLine(commandLine, platform)
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

export function queryWindowsBrowserProcesses(adapters = {}) {
  const script = [
    '$utf8 = New-Object System.Text.UTF8Encoding($false)',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    '$items = @(Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\' OR Name = \'msedge.exe\'" -ErrorAction SilentlyContinue | ForEach-Object {',
    '  [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; processName=$_.Name; executablePath=$_.ExecutablePath; commandLine=$_.CommandLine }',
    '})',
    '$items | ConvertTo-Json -Compress',
  ].join('; ')
  try {
    const execute = adapters.execute ?? execFileSync
    const output = execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
    const parsed = output ? JSON.parse(output) : []
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch (error) {
    throw new Error('Could not inspect browser processes on Windows.', { cause: error })
  }
}

export function queryPosixBrowserProcesses(adapters = {}) {
  try {
    const execute = adapters.execute ?? execFileSync
    const output = execute('ps', ['-ww', '-A', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' })
    return output.split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
      if (!match) return null
      const commandLine = match[4]
      const executablePath = commandLine.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/)?.slice(1).find(Boolean) ?? ''
      return {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        processGroupId: Number(match[3]),
        executablePath,
        commandLine,
      }
    }).filter(Boolean)
  } catch (error) {
    throw new Error('Could not inspect browser processes on macOS.', { cause: error })
  }
}

export function queryBrowserProcesses(platform = process.platform, adapters = {}) {
  return platform === 'win32' ? queryWindowsBrowserProcesses(adapters) : queryPosixBrowserProcesses(adapters)
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

export async function acquireLaunchLockWithWait(layout, waitForLockMs = 0, adapters = {}) {
  const timeout = Math.max(0, Number(waitForLockMs) || 0)
  const deadline = Date.now() + timeout
  while (true) {
    try {
      return await acquireLaunchLock(layout, adapters)
    } catch (error) {
      if (!String(error?.message ?? error).includes('Another portable launcher is already starting or stopping DSH.') || Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))))
    }
  }
}

export const PORT_RANGE = Object.freeze({ first: DEFAULT_PORT, last: MAX_PORT })
