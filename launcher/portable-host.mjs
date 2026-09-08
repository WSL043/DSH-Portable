import { timingSafeEqual } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireRuntimeLease } from './runtime-capsule.mjs'
import { appendStartupTrace, traceFromEnvironment } from './startup-trace.mjs'
import { startRuntimeHealth, startStartupProfile } from './runtime-health.mjs'

const [dshBin, ...dshArgs] = process.argv.slice(2)
const controlPipe = process.env.DSH_PORTABLE_CONTROL_PIPE
const controlToken = process.env.DSH_PORTABLE_CONTROL_TOKEN
const runtimeRoot = process.env.DSH_PORTABLE_RUNTIME_ROOT
const stateRoot = process.env.DSH_PORTABLE_STATE_ROOT
const logDirectory = stateRoot
  ? path.join(path.resolve(stateRoot), 'data', 'logs')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'logs')
const startupTrace = traceFromEnvironment(logDirectory)
appendStartupTrace(startupTrace, 'portable-host', 'module-begin')
const healthPhase = startRuntimeHealth(logDirectory, startupTrace?.startupId || '')

if (!dshBin) throw new Error('portable host requires the official DSH bin path')
if (!controlPipe || !controlToken) throw new Error('portable host control channel is not configured')

const releaseRuntimeLease = runtimeRoot ? await acquireRuntimeLease(runtimeRoot) : async () => {}

function tokenMatches(header) {
  const supplied = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''), 'utf8')
  const expected = Buffer.from(controlToken, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

let shutdownAccepted = false
function cleanupControlSocket() {
  if (process.platform !== 'win32' && controlPipe) rmSync(controlPipe, { force: true })
}

const control = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/shutdown') {
    response.writeHead(404).end()
    return
  }
  if (!tokenMatches(request.headers.authorization)) {
    response.writeHead(401).end()
    return
  }
  response.writeHead(202).end()
  if (shutdownAccepted) return
  shutdownAccepted = true
  healthPhase('shutdown-accepted')
  appendStartupTrace(startupTrace, 'portable-host', 'shutdown-accepted', { pid: process.pid })
  control.close()
  setImmediate(() => {
    if (!process.emit('SIGTERM')) process.exit(0)
  })
})
control.on('clientError', (_error, socket) => socket.destroy())
control.on('close', cleanupControlSocket)
process.on('beforeExit', releaseRuntimeLease)
process.on('exit', code => {
  appendStartupTrace(startupTrace, 'portable-host', 'process-exit', { pid: process.pid, exitCode: code })
  cleanupControlSocket()
  if (releaseRuntimeLease.filename) rmSync(releaseRuntimeLease.filename, { force: true })
})

await new Promise((resolve, reject) => {
  control.once('error', reject)
  control.listen(controlPipe, () => {
    if (process.platform !== 'win32') chmodSync(controlPipe, 0o600)
    control.off('error', reject)
    resolve()
  })
})
appendStartupTrace(startupTrace, 'portable-host', 'control-ready')

process.argv = [process.execPath, path.resolve(dshBin), ...dshArgs]
const finishStartupProfile = await startStartupProfile(logDirectory, startupTrace?.startupId || '',
  progress => healthPhase(null, progress))
appendStartupTrace(startupTrace, 'portable-host', 'official-dsh-import-begin')
healthPhase('official-dsh-import')
const importStartedAt = performance.now()
const importCpu = process.cpuUsage()
let startupOutcome = 'startup-complete'
try {
  const entry = await import(pathToFileURL(path.resolve(dshBin)).href)
  const explicitCli = typeof entry.runCli === 'function'
  appendStartupTrace(startupTrace, 'portable-host', 'official-dsh-entry-ready', {
    mode: explicitCli ? 'exported-cli' : 'self-executing',
    durationMs: Math.round(performance.now() - importStartedAt),
  })
  if (explicitCli) {
    healthPhase('official-dsh-cli-start')
    appendStartupTrace(startupTrace, 'portable-host', 'official-dsh-cli-start')
    await entry.runCli()
  }
  healthPhase('official-dsh-import-complete')
  const cpu = process.cpuUsage(importCpu)
  appendStartupTrace(startupTrace, 'portable-host', 'official-dsh-import-complete', {
    pid: process.pid, durationMs: Math.round(performance.now() - importStartedAt),
    cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000),
  })
} catch (error) {
  startupOutcome = 'startup-failed'
  healthPhase('official-dsh-import-failed')
  appendStartupTrace(startupTrace, 'portable-host', 'official-dsh-import-failed', {
    type: error?.constructor?.name || 'Error',
    code: error?.code || 'none',
  })
  control.close()
  throw error
} finally {
  await finishStartupProfile(startupOutcome)
}
