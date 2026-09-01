import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PORT_RANGE,
  acquireLaunchLock,
  acquireLaunchLockWithWait,
  acquireProductMutationLockWithWait,
  browserLaunchSpec,
  buildDshEnv,
  clearPortableMoveLinks,
  ensureDesktopBridgeFallback,
  ensureManagedProfileModuleFallback,
  environmentStateRoot,
  findRunningPortableEnvironments,
  ensurePortableDirectories,
  isOwnedDshProcess,
  isOwnedPortableBrowserProcess,
  layoutForRoot,
  migratePortableRoot,
  parseCli,
  queryBrowserProcesses,
  queryProcess,
  retirePendingExtensionOperation,
  writeJsonAtomic,
} from './portable-core.mjs'
import {
  checkForUpdate,
  deferUpdate,
  ignoreUpdate,
  installAvailableAppUpdate,
  rollbackPendingAppUpdate,
} from './update-core.mjs'
import { officialWorkspaceUrl, workspaceDocumentReady } from './http-readiness.mjs'
import { seedDefaultPlugins } from './default-plugins.mjs'
import { diagnosePortable, exportPortableSupportReport, repairPortable } from './repair-core.mjs'
import { createDataArchive, inspectDataArchive, restoreDataArchive } from './data-transfer.mjs'
import { rehydrateImportedProfiles, repairIncompleteProfileDependencies } from './data-import-preflight.mjs'
import { cleanUnusedRuntimeCaches, ensureRuntimeCapsule, runtimeCacheStatus } from './runtime-capsule.mjs'
import { preflightStagedDshProfiles } from './update-preflight.mjs'
import { appendStartupTrace, beginStartupTrace, traceFromEnvironment } from './startup-trace.mjs'
import { portablePublicError, recordPortableDiagnostic } from './diagnostic-policy.mjs'
import { appendOperationTrace, beginOperationTrace } from './operation-trace.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseStateRoot = process.env.DSH_PORTABLE_STATE_ROOT || root
let layout = layoutForRoot(
  root,
  process.platform,
  baseStateRoot,
  process.env.DSH_PORTABLE_RUNTIME_ROOT || root,
)
let startupTrace = traceFromEnvironment(layout.logsDir)
let startupProgressJson = false
let activeOptions = null
const BROWSER_GRACEFUL_SHUTDOWN_MS = 5000
const BROWSER_FORCE_SHUTDOWN_MS = 15000

function startupLog(startedAt, phase, fields = {}) {
  appendStartupTrace(startupTrace, 'portable-cli', phase, fields)
  if (startupProgressJson) {
    const visiblePhase = {
      'default-plugins-ready': 'plugins-ready',
      'host-spawned': 'workspace-starting',
      'host-http-ready': 'workspace-ready',
    }[phase]
    if (visiblePhase) process.stdout.write(`${JSON.stringify({ type: 'startup-progress', phase: visiblePhase })}\n`)
  }
  try {
    mkdirSync(layout.logsDir, { recursive: true })
    const details = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${String(value).replace(/[\r\n\s]+/g, '-')}`)
      .join(' ')
    appendFileSync(
      path.join(layout.logsDir, 'launcher.log'),
      `${new Date().toISOString()} [startup-cli] phase=${phase} elapsedMs=${Date.now() - startedAt}${details ? ` ${details}` : ''}\n`,
      'utf8',
    )
  } catch {
    // Diagnostics must never prevent the product from starting.
  }
}

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

function environmentList(items) {
  return items.map((item) => item.environmentId).join(', ')
}

async function runningEnvironments() {
  return findRunningPortableEnvironments(layout)
}

async function assertSharedComponentsIdle({ allowCurrent = false, allowCurrentDesktop = false } = {}) {
  const running = await runningEnvironments()
  const blocking = running.filter((item) => {
    if (item.environmentId !== layout.environmentId) return true
    if (allowCurrent) return false
    if (allowCurrentDesktop && !item.pid) return false
    return true
  })
  if (blocking.length) {
    throw new Error(`Close the other Portable environment${blocking.length === 1 ? '' : 's'} before changing shared components: ${environmentList(blocking)}.`)
  }
  return running
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

async function waitForHost(state, timeoutMs = 60000, launchOutput = null, onPhase = null) {
  const deadline = Date.now() + timeoutMs
  const identityGraceDeadline = Date.now() + 3000
  let attempts = 0
  let urlReported = false
  if (onPhase) onPhase('host-wait-begin', { pid: state.pid, port: state.port })
  while (Date.now() < deadline) {
    attempts += 1
    if (!ownedState(state)) {
      // WMI/CIM can briefly lag a just-spawned process on Windows. A live PID
      // gets a short identity grace period; mismatched or exited processes do
      // not get treated as owned and are never terminated here.
      if (!(Date.now() < identityGraceDeadline && processExists(Number(state.pid)))) {
        if (onPhase) onPhase('host-process-exited', { attempts })
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    const loggedUrl = launchOutput
      ? officialWorkspaceUrl(tailSince(launchOutput.filename, launchOutput.offset, 16000), state.port)
      : null
    const url = loggedUrl || state.url || `http://127.0.0.1:${state.port}/`
    if (!urlReported && (loggedUrl || state.url)) {
      urlReported = true
      if (onPhase) onPhase('host-url-discovered', { attempts, port: state.port })
    }
    if (await httpReady(url, 1200, { preserveAccessToken: true })) {
      if (onPhase) onPhase('host-http-ready', { attempts, port: state.port })
      return url
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (onPhase) onPhase('host-wait-timeout', { attempts, timeoutMs })
  return null
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

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function acquirePortReservation(port) {
  const filename = path.join(os.tmpdir(), `dsh-portable-port-${port}.lock`)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomBytes(16).toString('hex')
    let handle
    try {
      handle = openSync(filename, 'wx')
      writeSync(handle, `${JSON.stringify({ pid: process.pid, token })}\n`)
    } catch (error) {
      if (handle !== undefined) {
        closeSync(handle)
        try { rmSync(filename, { force: true }) } catch {}
        throw error
      }
      if (error?.code !== 'EEXIST') throw error
      let ownerPid = 0
      try { ownerPid = Number(JSON.parse(readFileSync(filename, 'utf8')).pid) } catch { /* invalid locks are stale */ }
      if (processExists(ownerPid)) return null
      try { rmSync(filename, { force: true }) } catch { return null }
      continue
    }
    let released = false
    return {
      port,
      release() {
        if (released) return
        released = true
        closeSync(handle)
        try {
          const current = JSON.parse(readFileSync(filename, 'utf8'))
          if (current.pid === process.pid && current.token === token) rmSync(filename, { force: true })
        } catch { /* a crashed or externally cleaned reservation is already released */ }
      },
    }
  }
  return null
}

async function reservePort(preferred) {
  const candidates = []
  if (Number.isInteger(preferred) && preferred >= PORT_RANGE.first && preferred <= PORT_RANGE.last) candidates.push(preferred)
  for (let port = PORT_RANGE.first; port <= PORT_RANGE.last; port += 1) {
    if (!candidates.includes(port)) candidates.push(port)
  }
  for (const port of candidates) {
    const reservation = acquirePortReservation(port)
    if (!reservation) continue
    if (await portAvailable(port)) return reservation
    reservation.release()
  }
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
    execFileSync('taskkill.exe', args, { stdio: 'ignore', windowsHide: true })
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

async function start(noBrowser, portRetry = 0) {
  const startedAt = Number(process.env.DSH_PORTABLE_STARTUP_STARTED_AT) || Date.now()
  if (!startupTrace) {
    const startupId = randomUUID().replaceAll('-', '')
    process.env.DSH_PORTABLE_STARTUP_ID = startupId
    process.env.DSH_PORTABLE_STARTUP_STARTED_AT = String(startedAt)
    startupTrace = beginStartupTrace(layout.logsDir, { startupId, startedAt, component: 'portable-cli', phase: 'process-start' })
  }
  startupLog(startedAt, 'begin', { portRetry })
  try {
    const result = await startAttempt(noBrowser, portRetry, startedAt)
    startupLog(startedAt, 'complete', { status: result.status, port: result.port })
    return result
  } catch (error) {
    startupLog(startedAt, 'failed', { type: error?.constructor?.name || 'Error', code: error?.code || 'none' })
    throw error
  }
}

async function startAttempt(noBrowser, portRetry, startedAt) {
  requireRuntime({ desktopBridge: true })
  startupLog(startedAt, 'runtime-verified')
  await ensurePortableDirectories(layout)
  startupLog(startedAt, 'directories-ready')
  let requestedRepair = null
  if (existsSync(layout.repairRequest)) {
    requestedRepair = {
      ...await repairPortable(layout, { running: false }),
      completedAt: new Date().toISOString(),
    }
    await writeJsonAtomic(layout.repairResult, requestedRepair)
    await rm(layout.repairRequest, { force: true })
  }
  startupLog(startedAt, 'requested-repair-ready', { applied: requestedRepair !== null })
  const desktopBridgeFallback = await ensureDesktopBridgeFallback(layout)
  startupLog(startedAt, 'desktop-bridge-ready', { changed: desktopBridgeFallback })
  const repairedProfileFallback = await ensureManagedProfileModuleFallback(layout)
  startupLog(startedAt, 'profile-resolver-ready', {
    changed: repairedProfileFallback.changed,
    cached: repairedProfileFallback.cached,
    packages: repairedProfileFallback.packages,
  })
  const migration = await migratePortableRoot(layout)
  startupLog(startedAt, 'migration-ready', {
    moved: migration.moved,
    sessions: migration.sessionCount || 0,
    storages: migration.storageCount || 0,
  })
  const prior = readProcessState()
  if (ownedState(prior)) {
    const url = await waitForHost(prior, 15000)
    if (url) {
      const browser = noBrowser ? null : await openBrowser(url)
      startupLog(startedAt, 'prior-host-ready', { pid: prior.pid, port: prior.port })
      return { status: 'already-running', environment: layout.environmentId, pid: prior.pid, port: prior.port, url, browser, migration }
    }
    throw new Error('DeepSeek Harness is still running but its local workspace is not ready. Stop the existing instance before retrying.')
  }
  if (prior) {
    if (process.platform !== 'win32' && prior.controlPipe) rmSync(prior.controlPipe, { force: true })
    rmSync(layout.processState, { force: true })
  }

  await retirePendingExtensionOperation(layout)
  startupLog(startedAt, 'pending-extension-ready')

  const defaultPlugins = await seedDefaultPlugins(layout)
  startupLog(startedAt, 'default-plugins-ready', { status: defaultPlugins.status })
  if (defaultPlugins.status === 'warning') {
    process.stderr.write(`${JSON.stringify({ type: 'portable-warning', ...defaultPlugins })}\n`)
  }
  const repairedPluginProfiles = await repairIncompleteProfileDependencies({
    layout,
    trace: (phase, fields) => startupLog(startedAt, phase, fields),
  })
  startupLog(startedAt, 'plugin-profiles-ready', {
    status: repairedPluginProfiles.status,
    profiles: repairedPluginProfiles.profiles.length,
  })

  const portReservation = await reservePort(prior?.port)
  const port = portReservation.port
  startupLog(startedAt, 'port-reserved', { port })
  const stdoutLog = path.join(layout.logsDir, 'dsh.stdout.log')
  const stderrLog = path.join(layout.logsDir, 'dsh.stderr.log')
  const stdoutOffset = logSize(stdoutLog)
  const stderrOffset = logSize(stderrLog)
  const stdout = openSync(stdoutLog, 'a')
  const stderr = openSync(stderrLog, 'a')
  const startupBoundary = `${new Date().toISOString()} [startup-boundary] startupId=${startupTrace?.startupId || 'untracked'} phase=host-spawn-request\n`
  writeSync(stdout, startupBoundary)
  writeSync(stderr, startupBoundary)
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
      DSH_PORTABLE_STARTUP_ID: process.env.DSH_PORTABLE_STARTUP_ID || '',
      DSH_PORTABLE_STARTUP_STARTED_AT: process.env.DSH_PORTABLE_STARTUP_STARTED_AT || '',
    },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
  })
  child.unref()
  closeSync(stdout)
  closeSync(stderr)
  startupLog(startedAt, 'host-spawned', { pid: child.pid, port })

  const state = {
    schemaVersion: 1,
    pid: child.pid,
    port,
    controlPipe,
    controlToken,
    root: layout.root,
    environment: layout.environmentId,
    startedAt: new Date().toISOString(),
  }
  await writeJsonAtomic(layout.processState, state)
  try {
    const url = await waitForHost(
      state,
      60000,
      { filename: stdoutLog, offset: stdoutOffset },
      (phase, fields) => startupLog(startedAt, phase, fields),
    )
    const hostUnavailable = !url
    portReservation.release()
    if (hostUnavailable) {
      const details = tailSince(stderrLog, stderrOffset) || tailSince(stdoutLog, stdoutOffset) || 'The DSH process exited before the Web UI became ready.'
      const portConflict = /EADDRINUSE|address already in use/i.test(details)
      if (child.pid) {
        try {
          if (process.platform === 'win32') {
            execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
          } else {
            process.kill(-child.pid, 'SIGKILL')
          }
        } catch {
          // The process may already have exited; the state file is still removed below.
        }
      }
      rmSync(layout.processState, { force: true })
      if (process.platform !== 'win32') rmSync(controlPipe, { force: true })
      if (portConflict && portRetry < PORT_RANGE.last - PORT_RANGE.first) {
        startupLog(startedAt, 'port-conflict-retry', { port })
        return start(noBrowser, portRetry + 1)
      }
      throw new Error(`DeepSeek Harness failed to start.\n${details}`)
    }

    state.url = url
    startupLog(startedAt, 'host-ready', { pid: child.pid, port })
    await writeJsonAtomic(layout.processState, state)
    const browser = noBrowser ? null : await openBrowser(url)
    return { status: 'started', environment: layout.environmentId, pid: child.pid, port, url, browser, migration, defaultPlugins, repairedPluginProfiles, repairedProfileFallback, requestedRepair }
  } catch (error) {
    portReservation.release()
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
      execFileSync('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      process.kill(-Number(state.pid), 'SIGKILL')
    }
    deadline = Date.now() + 5000
    while (Date.now() < deadline && ownedState(state)) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (ownedState(state)) throw new Error(`DSH process ${state.pid} did not stop.`)
  rmSync(layout.processState, { force: true })
  await clearPortableMoveLinks(layout)
  if (process.platform !== 'win32' && state.controlPipe) rmSync(state.controlPipe, { force: true })
  if (browserError) throw browserError
  return { status: 'stopped', environment: layout.environmentId, pid: state.pid, port: state.port, graceful: gracefulRequested && !forced, forced, browser }
}

async function status() {
  const state = readProcessState()
  if (!ownedState(state)) return { status: 'stopped', environment: layout.environmentId, root: layout.root }
  return {
    status: await httpReady(state.url || state.port) ? 'running' : 'starting',
    environment: layout.environmentId,
    root: layout.root,
    pid: state.pid,
    port: state.port,
    url: state.url || `http://127.0.0.1:${state.port}`,
  }
}

async function openExisting() {
  const current = await status()
  if (current.status !== 'running') return start(false)
  return { ...current, browser: await openBrowser(current.url) }
}

async function doctor() {
  return diagnosePortable(layout)
}

async function repair() {
  const current = await status()
  return repairPortable(layout, { running: current.status !== 'stopped' })
}

async function supportReport(options) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
  const output = path.resolve(options.output || path.join(layout.logsDir, `DSH-Portable-support-${stamp}.json`))
  return exportPortableSupportReport(layout, output)
}

function dataPassword(options) {
  if (!options.passwordFile) return undefined
  const password = readFileSync(path.resolve(options.passwordFile), 'utf8').replace(/[\r\n]+$/, '')
  if (!password) throw new Error('The password file is empty.')
  return password
}

async function backupData(options) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
  const output = path.resolve(options.output || path.join(layout.dataDir, 'backups', `DSH-Portable-data-${stamp}.dshdata`))
  return createDataArchive(layout, output, {
    categories: options.categories,
    password: dataPassword(options),
    allowUnencryptedCredentials: options.allowUnencryptedCredentials,
  })
}

async function inspectData(options) {
  if (!options.input) throw new Error('inspect-data requires --input.')
  return inspectDataArchive(path.resolve(options.input), { password: dataPassword(options) })
}

async function restoreData(options) {
  if (!options.input) throw new Error('restore-data requires --input.')
  const current = await status()
  if (current.status !== 'stopped') throw new Error('Close DSH-Portable before importing user data.')
  const operationTrace = beginOperationTrace(layout.logsDir, 'data-import')
  const trace = (phase, fields) => appendOperationTrace(operationTrace, phase, fields)
  trace('begin')
  return restoreDataArchive(layout, path.resolve(options.input), {
    password: dataPassword(options),
    conflict: options.conflict,
    trace,
    validate: ({ changed, transaction }) => rehydrateImportedProfiles({ layout, changed, transaction, trace }),
  })
}

async function checkUpdate(options) {
  requireRuntime()
  await ensurePortableDirectories(layout)
  await migratePortableRoot(layout)
  return checkForUpdate({
    layout,
    scope: options.updateScope,
    releaseChannel: preferredUpdateChannel(options),
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
    scope: options.updateScope,
    releaseChannel: preferredUpdateChannel(options),
    manifestUrl: options.updateManifest || undefined,
    allowHttp: options.allowHttp,
    force: true,
  })
  if (available.status !== 'available') return available

  await assertSharedComponentsIdle({ allowCurrent: true })

  const reportProgress = options.progressJson
    ? (event) => process.stdout.write(`${JSON.stringify({ type: 'update-progress', ...event })}\n`)
    : () => {}

  let stoppedForApply = false
  try {
    const applied = await installAvailableAppUpdate({
      layout,
      update: available,
      allowHttp: options.allowHttp,
      beforeApply: async () => {
        reportProgress({ phase: 'stopping-current' })
        const current = readProcessState()
        if (ownedState(current)) {
          stoppedForApply = true
          await stop()
        }
        await assertSharedComponentsIdle({ allowCurrentDesktop: true })
      },
      preflight: preflightStagedDshProfiles,
      healthCheck: async (metadata) => {
        if (metadata.kind === 'dsh-runtime-capsule') {
          const prepared = await ensureRuntimeCapsule(root)
          layout = layoutForRoot(
            root,
            process.platform,
            layout.stateRoot,
            prepared.runtimeRoot,
            layout.environmentId,
          )
        }
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
    await deferUpdate(layout, { scope: options.updateScope }).catch(() => {})
    if (!stoppedForApply) throw error
    let recovery = null
    try {
      const unchanged = error?.code === 'DSH_PROFILE_PREFLIGHT_FAILED'
      reportProgress({ phase: unchanged ? 'restarting-current' : 'restarting-previous' })
      const restored = await ensureRuntimeCapsule(root)
      layout = layoutForRoot(
        root,
        process.platform,
        layout.stateRoot,
        restored.runtimeRoot,
        layout.environmentId,
      )
      recovery = await start(options.noBrowser)
      reportProgress({ phase: 'recovered' })
    } catch (recoveryError) {
      throw new Error(`${error?.message ?? error}\nThe previous version was restored but could not restart: ${recoveryError?.message ?? recoveryError}`, { cause: error })
    }
    if (error?.code === 'DSH_PROFILE_PREFLIGHT_FAILED') {
      const unchanged = new Error(`${error?.message ?? error}\nThe installed version was unchanged and restarted.`, { cause: error, recovery })
      unchanged.code = error.code
      throw unchanged
    }
    throw new Error(`${error?.message ?? error}\nThe previous version was restored and restarted.`, { cause: error, recovery })
  }
}

function preferredUpdateChannel(options) {
  if (options.updateChannel) return options.updateChannel
  try {
    const settings = JSON.parse(readFileSync(layout.launcherSettings, 'utf8'))
    return ['stable', 'candidate'].includes(settings.updateChannel) ? settings.updateChannel : undefined
  } catch {
    return undefined
  }
}

function print(result, json) {
  if (json) console.log(JSON.stringify(result))
  else if (result.url) console.log(`DeepSeek Harness ${result.status}: ${result.url}`)
  else if (typeof result.status === 'string') console.log(`DeepSeek Harness: ${result.status}`)
  else if (typeof result.output === 'string') console.log(`DSH-Portable: ${result.output}`)
  else if (typeof result.ok === 'boolean') console.log(`DSH-Portable: ${result.ok ? 'OK' : 'needs attention'}`)
  else console.log(JSON.stringify(result, null, 2))
  if (result.browser?.portableProfile === false) console.warn('Chrome/Edge was not found; the default browser opened without the portable browser profile.')
}

async function main() {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) throw new Error('DSH-Portable supports Windows, macOS, and Linux.')
  const options = parseCli(process.argv.slice(2))
  activeOptions = options
  startupProgressJson = options.command === 'start' && options.progressJson
  const environmentId = options.environment || process.env.DSH_PORTABLE_ENVIRONMENT || 'default'
  const stateRoot = environmentStateRoot(baseStateRoot, environmentId, process.platform)
  layout = layoutForRoot(
    root,
    process.platform,
    stateRoot,
    process.env.DSH_PORTABLE_RUNTIME_ROOT || root,
    environmentId,
  )
  const release = options.waitForLockMs > 0
    ? await acquireLaunchLockWithWait(layout, options.waitForLockMs)
    : await acquireLaunchLock(layout)
  const productLockedCommands = new Set([
    'start',
    'runtime-cache-clean',
    'update',
  ])
  const releaseProduct = productLockedCommands.has(options.command)
    ? await acquireProductMutationLockWithWait(layout, Math.max(5000, options.waitForLockMs || 0))
    : async () => {}
  try {
    await ensurePortableDirectories(layout)
    if (existsSync(layout.updateJournal) && ['start', 'runtime-cache-clean', 'update'].includes(options.command)) {
      await assertSharedComponentsIdle({ allowCurrentDesktop: options.command === 'start' })
      await rollbackPendingAppUpdate(layout, {
        beforeRestore: async () => {
          const current = readProcessState()
          if (ownedState(current)) await stop()
        },
      })
    }
    let result
    if (options.command === 'diagnostic-root') result = {
      status: 'ok',
      root: layout.root,
      stateRoot: layout.stateRoot,
      environment: layout.environmentId,
      dataDir: layout.dataDir,
      workspace: layout.workspace,
      platform: layout.platform,
    }
    else if (options.command === 'start') result = await start(options.noBrowser)
    else if (options.command === 'stop') result = await stop()
    else if (options.command === 'status') result = await status()
    else if (options.command === 'open') result = await openExisting()
    else if (options.command === 'doctor') result = await doctor()
    else if (options.command === 'repair') result = await repair()
    else if (options.command === 'support-report') result = await supportReport(options)
    else if (options.command === 'backup-data') result = await backupData(options)
    else if (options.command === 'inspect-data') result = await inspectData(options)
    else if (options.command === 'restore-data') result = await restoreData(options)
    else if (options.command === 'runtime-cache-status') result = await runtimeCacheStatus(root)
    else if (options.command === 'runtime-cache-clean') {
      await assertSharedComponentsIdle()
      result = await cleanUnusedRuntimeCaches(root)
    }
    else if (options.command === 'check-update') result = await checkUpdate(options)
    else if (options.command === 'defer-update') result = await deferUpdate(layout, { scope: options.updateScope })
    else if (options.command === 'ignore-update') result = await ignoreUpdate(layout, '', { scope: options.updateScope })
    else if (options.command === 'update') result = await update(options)
    else throw new Error(`Unsupported command: ${options.command}`)
    print(result, options.json)
  } finally {
    try { await releaseProduct() } finally { await release() }
  }
}

main().catch(async (error) => {
  await recordPortableDiagnostic(layout?.logsDir, {
    operation: activeOptions?.command || 'unknown',
    error,
  })
  const publicError = portablePublicError(error)
  if (activeOptions?.json) console.error(JSON.stringify({ type: 'portable-error', schemaVersion: 1, ...publicError }))
  else console.error(publicError.message)
  process.exitCode = 1
})
