import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildDshEnv, layoutForRoot } from './portable-core.mjs'

function platformPaths(platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

function environmentValue(source, name, platform) {
  if (platform !== 'win32') return source[name]
  const match = Object.entries(source).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return match?.[1]
}

function expandWindowsEnvironment(value, source) {
  return String(value).replace(/%([^%]+)%/g, (match, name) => {
    const replacement = environmentValue(source, name, 'win32')
    return replacement == null || replacement === '' ? match : replacement
  })
}

export async function resolveProductStateRoot(root, platform = process.platform, source = process.env, adapters = {}) {
  const paths = platformPaths(platform)
  const portableRoot = paths.resolve(root)
  const override = environmentValue(source, 'DSH_PORTABLE_STATE_ROOT', platform)
  if (override) return paths.resolve(String(override))

  const read = adapters.readFile ?? readFile
  let installedMode
  try {
    installedMode = JSON.parse(await read(paths.join(portableRoot, 'installed-mode.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return portableRoot
    throw new Error('installed-mode.json is invalid or unreadable.', { cause: error })
  }
  if (installedMode?.schemaVersion !== 1 || typeof installedMode.stateRoot !== 'string' || !installedMode.stateRoot.trim()) {
    throw new Error('installed-mode.json does not contain a supported stateRoot.')
  }

  const expanded = platform === 'win32'
    ? expandWindowsEnvironment(installedMode.stateRoot, source)
    : installedMode.stateRoot
  if (platform === 'win32' && /%[^%]+%/.test(expanded)) {
    throw new Error('installed-mode.json references an unavailable environment variable.')
  }
  return paths.resolve(expanded)
}

function quoteForWindowsPluginShell(argument) {
  if (/["\r\n\0]/.test(argument)) {
    throw new Error('DSH plugin arguments may not contain quotes or line breaks on Windows.')
  }
  return /[\s&|<>^()]/.test(argument) ? `"${argument}"` : argument
}

export function normalizeDshArgvForWindowsShell(argv, cwd = process.cwd()) {
  const pluginIndex = argv.indexOf('plugin')
  if (pluginIndex < 0) return [...argv]

  let forwardedIndex = pluginIndex + 1
  while (forwardedIndex < argv.length) {
    if (argv[forwardedIndex] === '--profile') {
      forwardedIndex += 2
      continue
    }
    break
  }
  return argv.map((argument, index) => {
    if (index < forwardedIndex) return argument
    const match = /^(?<prefix>(?:file|link):)?(?<relative>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
    const normalized = match?.groups?.relative === undefined
      ? argument
      : `${match.groups.prefix ?? ''}${path.win32.resolve(cwd, match.groups.relative)}`
    return quoteForWindowsPluginShell(normalized)
  })
}

const RELEASE_AGE_REMOVAL_OVERRIDE = '--config.minimumReleaseAge=0'
const RELEASE_AGE_VIOLATION = 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'
const CAPTURE_LIMIT = 1024 * 1024

function pluginOperationIndex(argv) {
  const pluginIndex = argv.indexOf('plugin')
  if (pluginIndex < 0) return -1
  let operationIndex = pluginIndex + 1
  while (operationIndex < argv.length) {
    if (argv[operationIndex] === '--profile') {
      operationIndex += 2
      continue
    }
    break
  }
  return operationIndex
}

export function normalizeFreshReleaseRemovalArgv(argv) {
  const output = [...argv]
  const operationIndex = pluginOperationIndex(output)
  if (operationIndex < 0 || output.includes(RELEASE_AGE_REMOVAL_OVERRIDE)) return output
  if (!['remove', 'rm', 'uninstall'].includes(output[operationIndex])) return output

  output.splice(operationIndex + 1, 0, RELEASE_AGE_REMOVAL_OVERRIDE)
  return output
}

export function retryFreshReleaseViolationArgv(argv, output) {
  if (!String(output ?? '').includes(RELEASE_AGE_VIOLATION)) return null
  if (argv.includes(RELEASE_AGE_REMOVAL_OVERRIDE)) return null
  const operationIndex = pluginOperationIndex(argv)
  if (operationIndex < 0 || !['add', 'install', 'update', 'up', 'remove', 'rm', 'uninstall'].includes(argv[operationIndex])) return null
  const retry = [...argv]
  retry.splice(operationIndex + 1, 0, RELEASE_AGE_REMOVAL_OVERRIDE)
  return retry
}

function appendBounded(current, chunk) {
  const combined = current + chunk
  return combined.length <= CAPTURE_LIMIT ? combined : combined.slice(-CAPTURE_LIMIT)
}

async function runPluginProcess(spec, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout = appendBounded(stdout, text)
      options.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr = appendBounded(stderr, text)
      if (options.mirrorStderr) options.stderr.write(text)
    })
    child.once('error', reject)
    child.once('close', (status) => resolve({ status, stdout, stderr }))
  })
}

export async function runPluginCommandWithFreshReleaseRecovery(spec, argv, makeSpec, adapters = {}) {
  const stdout = adapters.stdout ?? process.stdout
  const stderr = adapters.stderr ?? process.stderr
  const run = adapters.run ?? runPluginProcess
  const first = await run(spec, { args: spec.args, stdout, stderr, mirrorStderr: false })
  const retryArgv = retryFreshReleaseViolationArgv(argv, `${first.stderr ?? ''}\n${first.stdout ?? ''}`)
  if (retryArgv === null) {
    if (first.stderr) stderr.write(first.stderr)
    return first
  }

  stderr.write('A newly published package already present in this profile blocked pnpm lockfile verification; retrying once for this command only.\n')
  const retrySpec = makeSpec(retryArgv)
  return await run(retrySpec, { args: retrySpec.args, stdout, stderr, mirrorStderr: true })
}

export function buildPluginCliSpec(root, stateRoot, argv, platform = process.platform, source = process.env) {
  const layout = layoutForRoot(root, platform, stateRoot)
  const forwardedArgv = platform === 'win32' ? normalizeDshArgvForWindowsShell(argv) : [...argv]
  return {
    command: layout.nodeExe,
    args: [layout.dshBin, ...forwardedArgv],
    cwd: process.cwd(),
    env: buildDshEnv(layout, source),
    layout,
  }
}

function comparablePath(value, platform) {
  const paths = platformPaths(platform)
  const resolved = paths.resolve(String(value ?? ''))
  return platform === 'win32' ? resolved.replaceAll('/', '\\').toLowerCase() : resolved
}

function isInsidePath(filename, directory, platform) {
  const paths = platformPaths(platform)
  const child = comparablePath(filename, platform)
  const parent = comparablePath(directory, platform)
  return child === parent || child.startsWith(`${parent}${paths.sep}`)
}

function requestedProfile(argv) {
  const index = argv.indexOf('--profile')
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('-')) return ''
  return argv[index + 1]
}

const MAX_REMOTE_PLUGIN_ARCHIVE_BYTES = 256 * 1024 * 1024

function remotePluginArchive(argument) {
  try {
    const url = new URL(argument)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    return /\.(?:tgz|tar\.gz)$/i.test(url.pathname)
  } catch {
    return false
  }
}

export async function materializeRemotePluginArchives(argv, stateRoot, platform = process.platform, adapters = {}) {
  const output = [...argv]
  const pluginIndex = output.indexOf('plugin')
  const profile = requestedProfile(output)
  if (pluginIndex < 0 || !profile) return output
  const operation = output.slice(pluginIndex + 1).find((argument) => !['--profile', profile].includes(argument))
  if (!['add', 'install'].includes(operation)) return output

  const paths = platformPaths(platform)
  const profilesRoot = paths.join(paths.resolve(stateRoot), 'data', 'dsh-home', 'profiles')
  const profileRoot = paths.resolve(profilesRoot, profile)
  if (!isInsidePath(profileRoot, profilesRoot, platform)) {
    throw new Error('DSH profile name resolves outside the product profile directory.')
  }
  const fetchArchive = adapters.fetch ?? globalThis.fetch
  if (typeof fetchArchive !== 'function') throw new Error('This Node.js runtime cannot download remote plugin archives.')
  const makeDirectory = adapters.mkdir ?? mkdir
  const save = adapters.writeFile ?? writeFile
  const move = adapters.rename ?? rename
  const remove = adapters.rm ?? rm
  const cacheRoot = paths.join(profileRoot, '.dsh-portable-archives')

  for (let index = 0; index < output.length; index += 1) {
    const source = output[index]
    if (!remotePluginArchive(source)) continue
    const response = await fetchArchive(source, { redirect: 'follow' })
    if (!response?.ok) throw new Error(`Remote plugin archive download failed (HTTP ${response?.status ?? 'unknown'}).`)
    const declaredLength = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_PLUGIN_ARCHIVE_BYTES) {
      throw new Error('Remote plugin archive exceeds the 256 MiB safety limit.')
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) throw new Error('Remote plugin archive is empty.')
    if (bytes.length > MAX_REMOTE_PLUGIN_ARCHIVE_BYTES) throw new Error('Remote plugin archive exceeds the 256 MiB safety limit.')
    const digest = createHash('sha512').update(bytes).digest('hex')
    const filename = paths.join(cacheRoot, `sha512-${digest}.tgz`)
    if (!existsSync(filename)) {
      await makeDirectory(cacheRoot, { recursive: true })
      const temporary = paths.join(cacheRoot, `.download-${process.pid}-${Date.now()}-${index}.tmp`)
      try {
        await save(temporary, bytes, { flag: 'wx' })
        await move(temporary, filename)
      } finally {
        await remove(temporary, { force: true }).catch(() => {})
      }
    }
    const relative = paths.relative(profileRoot, filename).replaceAll('\\', '/')
    output[index] = `file:${relative}`
  }
  return output
}

export function profileNeedsRelink(profileRoot, storeRoot, modules, platform = process.platform) {
  if (!modules || typeof modules !== 'object') return true
  const paths = platformPaths(platform)
  const expectedVirtualStore = paths.join(profileRoot, 'node_modules', '.pnpm')
  return comparablePath(modules.virtualStoreDir, platform) !== comparablePath(expectedVirtualStore, platform)
    || !isInsidePath(modules.storeDir, storeRoot, platform)
}

async function relinkMovedProfileIfNeeded(spec, argv, adapters = {}) {
  const profile = requestedProfile(argv)
  if (!profile) return false
  const paths = platformPaths(spec.layout.platform)
  const profilesRoot = paths.join(spec.layout.dshHome, 'profiles')
  const profileRoot = paths.resolve(profilesRoot, profile)
  if (!isInsidePath(profileRoot, profilesRoot, spec.layout.platform)) {
    throw new Error('DSH profile name resolves outside the product profile directory.')
  }
  const packageFile = paths.join(profileRoot, 'package.json')
  const modulesFile = paths.join(profileRoot, 'node_modules', '.modules.yaml')
  if (!existsSync(packageFile) || !existsSync(modulesFile)) return false

  const read = adapters.readFile ?? readFile
  let modules
  try {
    modules = JSON.parse(await read(modulesFile, 'utf8'))
  } catch {
    modules = null
  }
  if (!profileNeedsRelink(profileRoot, spec.layout.packageManagerStore, modules, spec.layout.platform)) return false

  process.stderr.write(`DSH plugin profile moved; rebuilding its portable dependency links: ${profile}\n`)
  const modulesRoot = paths.join(profileRoot, 'node_modules')
  const backupRoot = paths.join(profileRoot, `.node_modules.dsh-portable-backup-${process.pid}-${Date.now()}`)
  await rename(modulesRoot, backupRoot)
  const run = adapters.spawnSync ?? spawnSync
  try {
    const repair = run(spec.command, [spec.layout.dshBin, 'plugin', '--profile', profile, 'install', '--force'], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: 'inherit',
      windowsHide: false,
    })
    if (repair.error) throw repair.error
    if (repair.status !== 0) throw new Error(`Could not rebuild the moved DSH plugin profile (${profile}).`)
    await rm(backupRoot, { recursive: true, force: true })
  } catch (error) {
    await rm(modulesRoot, { recursive: true, force: true }).catch(() => {})
    await rename(backupRoot, modulesRoot).catch(() => {})
    throw error
  }
  return true
}

export function processExists(pid, platform = process.platform, adapters = {}) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return false
  const kill = adapters.kill ?? process.kill.bind(process)
  try {
    kill(Number(pid), 0)
    return true
  } catch (error) {
    if (error?.code !== 'EPERM') return false
    if (platform !== 'win32') return true

    const run = adapters.spawnSync ?? spawnSync
    const result = run('tasklist.exe', ['/FI', `PID eq ${Number(pid)}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result?.error || result?.status !== 0 || typeof result?.stdout !== 'string') return true
    return result.stdout.split(/\r?\n/).some((line) => {
      const fields = /^"(?:[^"]|"")*","(?<pid>\d+)"(?:,|$)/.exec(line.trim())
      return Number(fields?.groups?.pid) === Number(pid)
    })
  }
}

export async function acquirePluginLock(layout) {
  await mkdir(layout.stateDir, { recursive: true })
  const filename = platformPaths(layout.platform).join(layout.stateDir, 'plugin-command.lock')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(filename, 'wx')
      await handle.writeFile(`${process.pid}\n`)
      return async () => {
        await handle.close().catch(() => {})
        await rm(filename, { force: true }).catch(() => {})
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const owner = Number.parseInt((await readFile(filename, 'utf8').catch(() => '')).trim(), 10)
      if (processExists(owner, layout.platform)) throw new Error('Another DSH plugin command is already running.')
      await rm(filename, { force: true }).catch(() => {})
    }
  }
  throw new Error('Another DSH plugin command is already running.')
}

export function portableDataArgv(argv) {
  if (argv[0] !== 'portable') return null
  const commands = { backup: 'backup-data', inspect: 'inspect-data', restore: 'restore-data' }
  const command = commands[argv[1]]
  if (!command) throw new Error('Use dsh portable backup, inspect, or restore.')
  if (command === 'backup-data') {
    return [command, '--categories', 'settings,sessions,plugins,credentials', '--allow-unencrypted-credentials', ...argv.slice(2)]
  }
  return [command, ...argv.slice(2)]
}

function isMutatingPluginCommand(argv) {
  const pluginIndex = argv.indexOf('plugin')
  if (pluginIndex < 0) return false
  return argv.slice(pluginIndex + 1).some((arg) => ['add', 'install', 'remove', 'rm', 'uninstall', 'update', 'up'].includes(arg))
}

export async function main(argv = process.argv.slice(2), source = process.env) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const stateRoot = await resolveProductStateRoot(root, process.platform, source)
  const portableArgv = portableDataArgv(argv)
  if (portableArgv !== null) {
    const layout = layoutForRoot(root, process.platform, stateRoot)
    const result = spawnSync(layout.nodeExe, [layout.portableCli, ...portableArgv], {
      cwd: process.cwd(), env: buildDshEnv(layout, source), stdio: 'inherit', windowsHide: false,
    })
    if (result.error) throw result.error
    return Number.isInteger(result.status) ? result.status : 1
  }
  let spec = buildPluginCliSpec(root, stateRoot, argv, process.platform, source)
  for (const [label, filename] of [
    ['bundled Node.js', spec.command],
    ['official DSH CLI', spec.layout.dshBin],
    ['bundled pnpm', spec.layout.packageManagerBin],
  ]) {
    if (!existsSync(filename)) throw new Error(`${label} is missing: ${filename}`)
  }

  const release = await acquirePluginLock(spec.layout)
  try {
    const materializedArgv = await materializeRemotePluginArchives(argv, stateRoot, process.platform)
    const normalizedArgv = normalizeFreshReleaseRemovalArgv(materializedArgv)
    spec = buildPluginCliSpec(root, stateRoot, normalizedArgv, process.platform, source)
    await relinkMovedProfileIfNeeded(spec, normalizedArgv)

    const result = await runPluginCommandWithFreshReleaseRecovery(
      spec,
      normalizedArgv,
      (retryArgv) => buildPluginCliSpec(root, stateRoot, retryArgv, process.platform, source),
    )
    const exitCode = Number.isInteger(result.status) ? result.status : 1
    if (exitCode === 0 && isMutatingPluginCommand(argv)) {
      process.stderr.write('\n插件已写入当前 DSH 配置。若 DSH 正在运行，请保存任务并手动停止、重新启动后加载；本工具不会自动重启。\n')
      process.stderr.write('Plugin configuration changed. Restart DSH manually when convenient; this tool never restarts it automatically.\n')
    }
    return exitCode
  } finally {
    await release()
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`DSH plugin command failed: ${error?.message || error}\n`)
    process.exitCode = 1
  })
}
