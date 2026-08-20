import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PORT_RANGE,
  acquireLaunchLock,
  acquireLaunchLockWithWait,
  browserLaunchSpec,
  buildDshEnv,
  ensureDesktopBridgeFallback,
  ensurePortableDirectories,
  isOwnedDshProcess,
  isOwnedPortableBrowserProcess,
  layoutForRoot,
  migratePortableRoot,
  parseCli,
  queryBrowserProcesses,
  queryProcess,
  writeJsonAtomic,
} from './portable-core.mjs'
import {
  checkForUpdate,
  deferUpdate,
  ignoreUpdate,
  installAvailableAppUpdate,
  rollbackPendingAppUpdate,
} from './update-core.mjs'
import {
  finishExtensionOperation,
  preparePendingExtensionOperation,
  rollbackExtensionOperationAfterBootFailure,
} from './extension-operations.mjs'
import { workspaceDocumentReady } from './http-readiness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const layout = layoutForRoot(root, process.platform, process.env.DSH_PORTABLE_STATE_ROOT || root)
const BROWSER_GRACEFUL_SHUTDOWN_MS = 5000
const BROWSER_FORCE_SHUTDOWN_MS = 15000

function requireRuntime({ desktopBridge = false } = {}) {
  const required = [layout.nodeExe, layout.dshBin, layout.hostBin]
  if (desktopBridge) required.push(layout.desktopBridgePatch)
  for (const filename of required) {
    if (!existsSync(filename)) throw new Error(`Portable runtime is incomplete: ${filename}`)
  }
}

function readProcessState() {
  try {
    return JSON.parse(readFileSync(layout.processState, 'utf8'))
  } catch {
    return null
  }
}

function readBrowserState() {
  try {
    return JSON.parse(readFileSync(layout.browserState, 'utf8'))
  } catch {
    return null
  }
}

function ownedState(state) {
  if (!state?.pid || !state?.port) return false
  return isOwnedDshProcess(queryProcess(state.pid, layout.platform), layout, state.port)
}

const httpReady = workspaceDocumentReady

function requestGracefulShutdown(state, timeout = 2500) {
  if (!state?.controlPipe || !state?.controlToken) return Promise.resolve(false)
  return new Promise((resolve) => {
    const request = http.request({
      socketPath: state.controlPipe,
      path: '/shutdown',
      method: 'POST',
      timeout,
      headers: { authorization: `Bearer ${state.controlToken}` },
    }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode === 202))
    })
    request.once('timeout', () => request.destroy())
    request.once('error', () => resolve(false))
    request.end()
  })
}

async function waitForHost(state, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await httpReady(state.port)) return true
    if (!ownedState(state)) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function extensionHostReady(port, timeout = 1200) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: '127.0.0.1', port, path: '/api/dsh-portable/extensions', timeout,
      headers: { host: `127.0.0.1:${port}` },
    }, (response) => {
      const chunks = []
      let length = 0
      response.on('data', (chunk) => {
        length += chunk.length
        if (length <= 64 * 1024) chunks.push(chunk)
        else request.destroy()
      })
      response.once('end', () => {
        if (response.statusCode !== 200 || length > 64 * 1024) return resolve(false)
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve(value?.schemaVersion === 1 && typeof value.catalogRevision === 'string' && Array.isArray(value.items))
        } catch { resolve(false) }
      })
    })
    request.once('timeout', () => request.destroy())
    request.once('error', () => resolve(false))
  })
}

async function waitForExtensionHost(state, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await extensionHostReady(state.port)) return true
    if (!ownedState(state)) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function selectPort(preferred) {
  const candidates = []
  if (Number.isInteger(preferred) && preferred >= PORT_RANGE.first && preferred <= PORT_RANGE.last) candidates.push(preferred)
  for (let port = PORT_RANGE.first; port <= PORT_RANGE.last; port += 1) {
    if (!candidates.includes(port)) candidates.push(port)
  }
  for (const port of candidates) if (await portAvailable(port)) return port
  throw new Error(`No free loopback port in ${PORT_RANGE.first}-${PORT_RANGE.last}.`)
}

function findBrowser() {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      path.join(os.homedir(), 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
    ].find((candidate) => existsSync(candidate)) ?? null
  }
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

async function openBrowser(url) {
  const executable = findBrowser()
  if (!executable) {
    const fallback = process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
    spawn(fallback.command, fallback.args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    rmSync(layout.browserState, { force: true })
    return { portableProfile: false, executable: 'default-browser' }
  }
  const spec = browserLaunchSpec(executable, url, layout)
  const child = spawn(spec.command, spec.args, { detached: true, stdio: 'ignore', windowsHide: false })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  await writeJsonAtomic(layout.browserState, {
    schemaVersion: 1,
    pid: child.pid,
    executable,
    profile: layout.browserProfile,
    url,
    startedAt: new Date().toISOString(),
  })
  return { portableProfile: true, executable, pid: child.pid }
}

function ownedBrowserProcesses() {
  return queryBrowserProcesses(layout.platform).filter((item) => (
    isOwnedPortableBrowserProcess(item, layout)
  ))
}

function browserProcessRoots(items) {
  const owned = new Set(items.map((item) => Number(item.pid)))
  const roots = items.filter((item) => !owned.has(Number(item.parentPid)))
  return roots.length ? roots : items.slice(0, 1)
}

function terminateBrowserProcess(processInfo, force) {
  const pid = Number(processInfo.pid)
  if (layout.platform === 'win32') {
    const args = ['/PID', String(pid), '/T']
    if (force) args.push('/F')
    execFileSync('taskkill.exe', args, { encoding: 'utf8', windowsHide: true })
  } else {
    const processGroupId = Number(processInfo.processGroupId)
    const target = Number.isSafeInteger(processGroupId) && processGroupId > 0 && processGroupId === pid
      ? -processGroupId
      : pid
    process.kill(target, force ? 'SIGKILL' : 'SIGTERM')
  }
}

async function stopPortableBrowser() {
  const recorded = Boolean(readBrowserState())
  const initial = ownedBrowserProcesses()
  let forced = false
  for (const item of browserProcessRoots(initial)) {
    try {
      terminateBrowserProcess(item, false)
    } catch {
      // A parent browser process may already have closed the rest of its tree.
    }
  }
  let deadline = Date.now() + BROWSER_GRACEFUL_SHUTDOWN_MS
  let remaining = ownedBrowserProcesses()
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    remaining = ownedBrowserProcesses()
  }
  if (remaining.length) {
    forced = true
    deadline = Date.now() + BROWSER_FORCE_SHUTDOWN_MS
    while (remaining.length && Date.now() < deadline) {
      for (const item of browserProcessRoots(remaining)) {
        try {
          terminateBrowserProcess(item, true)
        } catch {
          // taskkill can report a tree failure while its parent is already
          // exiting. A direct same-user PID termination handles the newly
          // orphaned root; ownership is re-checked before every retry.
          if (layout.platform === 'win32') {
            try { process.kill(Number(item.pid), 'SIGTERM') } catch {}
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
      remaining = ownedBrowserProcesses()
    }
  }
  remaining = ownedBrowserProcesses()
  if (remaining.length) throw new Error(`Portable browser processes did not stop: ${remaining.map((item) => item.pid).join(', ')}`)
  rmSync(layout.browserState, { force: true })
  return { found: initial.length, stopped: initial.length, forced, recorded }
}

function logSize(filename) {
  try {
    return statSync(filename).size
  } catch {
    return 0
  }
}

function tailSince(filename, offset, maxBytes = 8000) {
  try {
    const bytes = readFileSync(filename)
    const start = Math.max(Math.min(Number(offset) || 0, bytes.length), bytes.length - maxBytes)
    return bytes.subarray(start).toString('utf8').trim()
  } catch {
    return ''
  }
}

async function start(noBrowser) {
  requireRuntime({ desktopBridge: true })
  await ensurePortableDirectories(layout)
  await ensureDesktopBridgeFallback(layout)
  const migration = await migratePortableRoot(layout)
  const prior = readProcessState()
  if (ownedState(prior)) {
    if (await waitForHost(prior, 15000)) {
      const url = `http://127.0.0.1:${prior.port}`
      const browser = noBrowser ? null : await openBrowser(url)
      return { status: 'already-running', pid: prior.pid, port: prior.port, url, browser, migration }
    }
    throw new Error('DeepSeek Harness is still running but its local workspace is not ready. Stop the existing instance before retrying; Portable Extensions were not changed.')
  }
  if (prior) {
    if (process.platform !== 'win32' && prior.controlPipe) rmSync(prior.controlPipe, { force: true })
    rmSync(layout.processState, { force: true })
  }

  // Portable Extensions never mutate a live profile. A confirmed operation is
  // applied only after the existing Host check above proves DSH is stopped.
  const extensionTransaction = await preparePendingExtensionOperation(layout)

  const port = await selectPort(prior?.port)
  const stdoutLog = path.join(layout.logsDir, 'dsh.stdout.log')
  const stderrLog = path.join(layout.logsDir, 'dsh.stderr.log')
  const stdoutOffset = logSize(stdoutLog)
  const stderrOffset = logSize(stderrLog)
  const stdout = openSync(stdoutLog, 'a')
  const stderr = openSync(stderrLog, 'a')
  const controlPipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\dsh-portable-${randomUUID()}`
    : path.join('/tmp', `dshp-${process.pid}-${randomBytes(8).toString('hex')}.sock`)
  if (process.platform !== 'win32') rmSync(controlPipe, { force: true })
  const controlToken = randomBytes(32).toString('hex')
  const child = spawn(layout.nodeExe, [
    layout.hostBin,
    layout.dshBin,
    '--patch', layout.desktopBridgePatch,
    '--profile', 'web',
    '--no-open',
    '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: layout.workspace,
    env: {
      ...buildDshEnv(layout),
      DSH_PORTABLE_CONTROL_PIPE: controlPipe,
      DSH_PORTABLE_CONTROL_TOKEN: controlToken,
    },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
  })
  child.unref()
  closeSync(stdout)
  closeSync(stderr)

  const state = {
    schemaVersion: 1,
    pid: child.pid,
    port,
    controlPipe,
    controlToken,
    root: layout.root,
    startedAt: new Date().toISOString(),
  }
  await writeJsonAtomic(layout.processState, state)
  try {
    const hostUnavailable = !await waitForHost(state)
      || extensionTransaction && !await waitForExtensionHost(state)
    if (hostUnavailable) {
      const details = tailSince(stderrLog, stderrOffset) || tailSince(stdoutLog, stdoutOffset) || 'The DSH process exited before the Web UI became ready.'
      if (child.pid) {
        try {
          if (process.platform === 'win32') {
            execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
          } else {
            process.kill(-child.pid, 'SIGKILL')
          }
        } catch {
          // The process may already have exited; the state file is still removed below.
        }
      }
      rmSync(layout.processState, { force: true })
      if (process.platform !== 'win32') rmSync(controlPipe, { force: true })
      if (extensionTransaction) {
        await rollbackExtensionOperationAfterBootFailure(layout, extensionTransaction)
        return start(noBrowser)
      }
      throw new Error(`DeepSeek Harness failed to start.\n${details}`)
    }

    if (extensionTransaction) await finishExtensionOperation(layout, extensionTransaction)

    const url = `http://127.0.0.1:${port}`
    const browser = noBrowser ? null : await openBrowser(url)
    return { status: 'started', pid: child.pid, port, url, browser, migration }
  } catch (error) {
    let cleanupError = null
    if (ownedState(state)) {
      try { await stop() } catch (failedCleanup) { cleanupError = failedCleanup }
    }
    if (cleanupError) {
      throw new Error(`${error?.message ?? error}\nStartup cleanup failed: ${cleanupError?.message ?? cleanupError}`, { cause: error })
    }
    throw error
  }
}

async function stop() {
  let browser = null
  let browserError = null
  try {
    browser = await stopPortableBrowser()
  } catch (error) {
    browserError = error
  }
  const state = readProcessState()
  if (!ownedState(state)) {
    rmSync(layout.processState, { force: true })
    if (browserError) throw browserError
    return { status: browser?.stopped ? 'stopped' : 'not-running', browser }
  }
  let gracefulRequested = false
  gracefulRequested = await requestGracefulShutdown(state)

  let deadline = Date.now() + 7500
  while (Date.now() < deadline && ownedState(state)) await new Promise((resolve) => setTimeout(resolve, 100))
  let forced = false
  if (ownedState(state)) {
    forced = true
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
    } else {
      process.kill(-Number(state.pid), 'SIGKILL')
    }
    deadline = Date.now() + 5000
    while (Date.now() < deadline && ownedState(state)) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (ownedState(state)) throw new Error(`DSH process ${state.pid} did not stop.`)
  rmSync(layout.processState, { force: true })
  if (process.platform !== 'win32' && state.controlPipe) rmSync(state.controlPipe, { force: true })
  if (browserError) throw browserError
  return { status: 'stopped', pid: state.pid, port: state.port, graceful: gracefulRequested && !forced, forced, browser }
}

async function status() {
  const state = readProcessState()
  if (!ownedState(state)) return { status: 'stopped', root: layout.root }
  return {
    status: await httpReady(state.port) ? 'running' : 'starting',
    root: layout.root,
    pid: state.pid,
    port: state.port,
    url: `http://127.0.0.1:${state.port}`,
  }
}

async function openExisting() {
  const current = await status()
  if (current.status !== 'running') return start(false)
  return { ...current, browser: await openBrowser(current.url) }
}

async function checkUpdate(options) {
  requireRuntime()
  await ensurePortableDirectories(layout)
  await migratePortableRoot(layout)
  return checkForUpdate({
    layout,
    manifestUrl: options.updateManifest || undefined,
    allowHttp: options.allowHttp,
    force: options.force,
  })
}

async function update(options) {
  requireRuntime()
  await ensurePortableDirectories(layout)
  await migratePortableRoot(layout)
  const available = await checkForUpdate({
    layout,
    manifestUrl: options.updateManifest || undefined,
    allowHttp: options.allowHttp,
    force: true,
  })
  if (available.status !== 'available') return available

  const reportProgress = options.progressJson
    ? (event) => process.stdout.write(`${JSON.stringify({ type: 'update-progress', ...event })}\n`)
    : () => {}

  const prior = readProcessState()
  if (ownedState(prior)) await stop()
  try {
    const applied = await installAvailableAppUpdate({
      layout,
      update: available,
      allowHttp: options.allowHttp,
      healthCheck: async (metadata) => {
        const version = execFileSync(layout.nodeExe, [layout.dshBin, '--version'], {
          cwd: layout.workspace,
          env: buildDshEnv(layout),
          encoding: 'utf8',
          windowsHide: true,
        }).trim()
        if (version !== metadata.dshVersion) throw new Error(`Updated DSH reported ${version || 'no version'} instead of ${metadata.dshVersion}.`)
        await start(true)
        return true
      },
      beforeRollback: async () => {
        const current = readProcessState()
        if (ownedState(current)) await stop()
      },
      onProgress: reportProgress,
    })
    const running = await status()
    const browser = !options.noBrowser && running.status === 'running' ? await openBrowser(running.url) : null
    return { ...applied, running, browser }
  } catch (error) {
    await deferUpdate(layout).catch(() => {})
    let recovery = null
    try {
      recovery = await start(options.noBrowser)
    } catch (recoveryError) {
      throw new Error(`${error?.message ?? error}\nThe previous version was restored but could not restart: ${recoveryError?.message ?? recoveryError}`, { cause: error })
    }
    throw new Error(`${error?.message ?? error}\nThe previous version was restored and restarted.`, { cause: error, recovery })
  }
}

function print(result, json) {
  if (json) console.log(JSON.stringify(result))
  else if (result.url) console.log(`DeepSeek Harness ${result.status}: ${result.url}`)
  else console.log(`DeepSeek Harness: ${result.status}`)
  if (result.browser?.portableProfile === false) console.warn('Chrome/Edge was not found; the default browser opened without the portable browser profile.')
}

async function main() {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) throw new Error('DSH-Portable supports Windows, macOS, and Linux.')
  const options = parseCli(process.argv.slice(2))
  const release = options.waitForLockMs > 0
    ? await acquireLaunchLockWithWait(layout, options.waitForLockMs)
    : await acquireLaunchLock(layout)
  try {
    await ensurePortableDirectories(layout)
    if (existsSync(layout.updateJournal)) {
      await rollbackPendingAppUpdate(layout, {
        beforeRestore: async () => {
          const current = readProcessState()
          if (ownedState(current)) await stop()
        },
      })
    }
    let result
    if (options.command === 'start') result = await start(options.noBrowser)
    else if (options.command === 'stop') result = await stop()
    else if (options.command === 'status') result = await status()
    else if (options.command === 'open') result = await openExisting()
    else if (options.command === 'check-update') result = await checkUpdate(options)
    else if (options.command === 'defer-update') result = await deferUpdate(layout)
    else if (options.command === 'ignore-update') result = await ignoreUpdate(layout)
    else if (options.command === 'update') result = await update(options)
    else throw new Error(`Unsupported command: ${options.command}`)
    print(result, options.json)
  } finally {
    await release()
  }
}

main().catch((error) => {
  console.error(error?.stack ?? String(error))
  process.exitCode = 1
})
