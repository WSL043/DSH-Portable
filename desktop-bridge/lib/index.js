import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const name = 'dsh-portable-desktop-bridge'
export const inject = ['webServer']

const MAX_BODY = 16 * 1024

function sendJson(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function sameOrigin(request) {
  const remote = String(request.socket?.remoteAddress || '')
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false
  const origin = String(request.headers?.origin || '')
  if (!origin) return true
  try {
    const url = new URL(origin)
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && url.host === request.headers.host
  } catch { return false }
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request too large')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function readSettings(filename) {
  let source = {}
  try { source = JSON.parse(readFileSync(filename, 'utf8')) } catch {}
  return {
    ...source,
    schemaVersion: 1,
    updateCheckEnabled: source.updateCheckEnabled === true,
    taskNotificationsEnabled: source.taskNotificationsEnabled !== false,
    closeBehavior: source.closeBehavior === 'exit' ? 'exit' : 'tray',
  }
}

function readJsonFile(filename) {
  try { return JSON.parse(readFileSync(filename, 'utf8')) } catch { return null }
}

function writeSettings(filename, settings) {
  mkdirSync(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  try { copyFileSync(temporary, filename) }
  finally { try { unlinkSync(temporary) } catch {} }
}

function defaultRunCli(root, stateRoot, args) {
  const output = execFileSync(process.execPath, [path.join(root, 'launcher', 'portable-cli.mjs'), ...args], {
    cwd: root,
    env: { ...process.env, DSH_PORTABLE_STATE_ROOT: stateRoot },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  }).trim()
  return output ? JSON.parse(output.split(/\r?\n/).at(-1)) : {}
}

export function mountPortableRoutes(webServer, options = {}) {
  const root = path.resolve(options.root || process.env.DSH_PORTABLE_ROOT || path.join(import.meta.dirname, '..', '..'))
  const stateRoot = path.resolve(options.stateRoot || process.env.DSH_PORTABLE_STATE_ROOT || root)
  const settingsFile = path.join(stateRoot, 'data', 'launcher-settings.json')
  const repairRequest = path.join(stateRoot, 'data', 'runtime', 'repair-requested.json')
  const repairResult = path.join(stateRoot, 'data', 'runtime', 'repair-result.json')
  const runCli = options.runCli || ((args) => defaultRunCli(root, stateRoot, args))
  const disposers = []
  const register = route => disposers.push(webServer.register(route))

  register({ kind: 'exact', path: '/dsh-portable/settings', handler: async (request, response) => {
    if (request.method === 'GET') return sendJson(response, 200, {
      settings: readSettings(settingsFile),
      lastRepair: readJsonFile(repairResult),
    })
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try {
      const body = await readJson(request)
      const current = readSettings(settingsFile)
      if (typeof body.updateCheckEnabled === 'boolean') current.updateCheckEnabled = body.updateCheckEnabled
      if (typeof body.taskNotificationsEnabled === 'boolean') current.taskNotificationsEnabled = body.taskNotificationsEnabled
      if (body.closeBehavior === 'tray' || body.closeBehavior === 'exit') current.closeBehavior = body.closeBehavior
      writeSettings(settingsFile, current)
      sendJson(response, 200, { settings: current })
    } catch (error) { sendJson(response, 400, { error: String(error?.message || error) }) }
  } })

  register({ kind: 'exact', path: '/dsh-portable/doctor', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try { sendJson(response, 200, runCli(['doctor', '--json'])) }
    catch (error) { sendJson(response, 500, { error: String(error?.message || error) }) }
  } })

  register({ kind: 'exact', path: '/dsh-portable/repair', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    mkdirSync(path.dirname(repairRequest), { recursive: true })
    writeFileSync(repairRequest, `${JSON.stringify({ schemaVersion: 1, requestedAt: new Date().toISOString() })}\n`, { mode: 0o600 })
    sendJson(response, 202, { scheduled: true, appliesOnNextStart: true })
  } })

  register({ kind: 'exact', path: '/dsh-portable/support-report', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try { sendJson(response, 200, runCli(['support-report', '--json'])) }
    catch (error) { sendJson(response, 500, { error: String(error?.message || error) }) }
  } })

  return () => { for (const dispose of disposers.reverse()) dispose?.() }
}

export function apply(ctx) {
  ctx.effect(() => mountPortableRoutes(ctx.webServer), 'dsh-portable: settings and maintenance routes')
}
