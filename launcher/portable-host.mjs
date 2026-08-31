import { timingSafeEqual } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireRuntimeLease } from './runtime-capsule.mjs'
import { appendStartupTrace, traceFromEnvironment } from './startup-trace.mjs'

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
  control.close()
  setImmediate(() => {
    if (!process.emit('SIGTERM')) process.exit(0)
  })
})
control.on('clientError', (_error, socket) => socket.destroy())
control.on('close', cleanupControlSocket)
process.on('beforeExit', releaseRuntimeLease)
process.on('exit', () => {
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
appendStartupTrace(startupTrace, 'portable-host', 'official-dsh-import-begin')
try {
  await import(pathToFileURL(path.resolve(dshBin)).href)
} catch (error) {
  appendStartupTrace(startupTrace, 'portable-host', 'official-dsh-import-failed', {
    type: error?.constructor?.name || 'Error',
    code: error?.code || 'none',
  })
  control.close()
  throw error
}
