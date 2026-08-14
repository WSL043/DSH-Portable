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
  browserLaunchSpec,
  buildDshEnv,
  ensurePortableDirectories,
  isOwnedDshProcess,
  layoutForRoot,
  migratePortableRoot,
  parseCli,
  queryProcess,
  writeJsonAtomic,
} from './portable-core.mjs'
import {
  checkForUpdate,
  deferUpdate,
  installAvailableAppUpdate,
  rollbackPendingAppUpdate,
} from './update-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const layout = layoutForRoot(root, process.platform, process.env.DSH_PORTABLE_STATE_ROOT || root)

function requireRuntime() {
  for (const filename of [layout.nodeExe, layout.dshBin, layout.hostBin]) {
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

function ownedState(state) {
  if (!state?.pid || !state?.port) return false
  return isOwnedDshProcess(queryProcess(state.pid, layout.platform), layout, state.port)
}

function httpReady(port, timeout = 1200) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/', timeout }, (response) => {
      response.resume()
      resolve(Number(response.statusCode) >= 200 && Number(response.statusCode) < 500)
    })
    request.once('timeout', () => request.destroy())
    request.once('error', () => resolve(false))
  })
}

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

function openBrowser(url) {
  const executable = findBrowser()
  if (!executable) {
    const fallback = process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
    spawn(fallback.command, fallback.args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return { portableProfile: false, executable: 'default-browser' }
  }
  const spec = browserLaunchSpec(executable, url, layout)
  spawn(spec.command, spec.args, { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  return { portableProfile: true, executable }
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
  requireRuntime()
  await ensurePortableDirectories(layout)
  const migration = await migratePortableRoot(layout)
  const prior = readProcessState()
  if (ownedState(prior) && await httpReady(prior.port)) {
    const url = `http://127.0.0.1:${prior.port}`
    const browser = noBrowser ? null : openBrowser(url)
    return { status: 'already-running', pid: prior.pid, port: prior.port, url, browser, migration }
  }
  if (prior) {
    if (process.platform !== 'win32' && prior.controlPipe) rmSync(prior.controlPipe, { force: true })
    rmSync(layout.processState, { force: true })
  }

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
  const child = spawn(layout.nodeExe, [layout.hostBin, layout.dshBin, 'web', '--host', '127.0.0.1', '--port', String(port)], {
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
  if (!await waitForHost(state)) {
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
    throw new Error(`DeepSeek Harness failed to start.\n${details}`)
  }

  const url = `http://127.0.0.1:${port}`
  const browser = noBrowser ? null : openBrowser(url)
  return { status: 'started', pid: child.pid, port, url, browser, migration }
}

async function stop() {
  const state = readProcessState()
  if (!ownedState(state)) {
    rmSync(layout.processState, { force: true })
    return { status: 'not-running' }
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
  return { status: 'stopped', pid: state.pid, port: state.port, graceful: gracefulRequested && !forced, forced }
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
  return { ...current, browser: openBrowser(current.url) }
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
    })
    const running = await status()
    const browser = !options.noBrowser && running.status === 'running' ? openBrowser(running.url) : null
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
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('DSH-Portable supports Windows and macOS.')
  const options = parseCli(process.argv.slice(2))
  const release = await acquireLaunchLock(layout)
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
