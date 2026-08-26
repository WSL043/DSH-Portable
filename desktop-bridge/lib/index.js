import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

export const name = 'dsh-portable-desktop-bridge'
export const inject = ['webServer']

const MAX_BODY = 16 * 1024
const execFileAsync = promisify(execFile)

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
  const legacyUpdateCheck = source.updateCheckEnabled === true
  const productUpdateCheckEnabled = typeof source.productUpdateCheckEnabled === 'boolean'
    ? source.productUpdateCheckEnabled
    : legacyUpdateCheck
  const engineUpdateCheckEnabled = typeof source.engineUpdateCheckEnabled === 'boolean'
    ? source.engineUpdateCheckEnabled
    : legacyUpdateCheck
  return {
    ...source,
    schemaVersion: 2,
    updateCheckEnabled: productUpdateCheckEnabled,
    productUpdateCheckEnabled,
    engineUpdateCheckEnabled,
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

async function defaultRunCli(root, stateRoot, args) {
  const { stdout = '' } = await execFileAsync(process.execPath, [path.join(root, 'launcher', 'portable-cli.mjs'), ...args], {
    cwd: root,
    env: { ...process.env, DSH_PORTABLE_STATE_ROOT: stateRoot },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  })
  const output = stdout.trim()
  return output ? JSON.parse(output.split(/\r?\n/).at(-1)) : {}
}

function encryptedDataPackage(filename) {
  const descriptor = openSync(path.resolve(filename), 'r')
  try {
    const magic = Buffer.alloc(8)
    if (readSync(descriptor, magic, 0, magic.length, 0) !== magic.length) throw new Error('The data package is incomplete.')
    if (magic.equals(Buffer.from('DSHDAT1E'))) return true
    if (magic.equals(Buffer.from('DSHDAT1U'))) return false
    throw new Error('Unsupported DSH-Portable data package.')
  } finally { closeSync(descriptor) }
}

function temporaryPasswordFile(stateRoot, password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('password must contain at least 8 characters')
  const runtime = path.join(stateRoot, 'data', 'runtime')
  mkdirSync(runtime, { recursive: true })
  const filename = path.join(runtime, `data-password-${process.pid}-${randomBytes(8).toString('hex')}.txt`)
  writeFileSync(filename, password, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return filename
}

export function mountPortableRoutes(webServer, options = {}) {
  const root = path.resolve(options.root || process.env.DSH_PORTABLE_ROOT || path.join(import.meta.dirname, '..', '..'))
  const stateRoot = path.resolve(options.stateRoot || process.env.DSH_PORTABLE_STATE_ROOT || root)
  const settingsFile = path.join(stateRoot, 'data', 'launcher-settings.json')
  const componentsFile = path.join(root, 'licenses', 'COMPONENTS.json')
  const repairRequest = path.join(stateRoot, 'data', 'runtime', 'repair-requested.json')
  const repairResult = path.join(stateRoot, 'data', 'runtime', 'repair-result.json')
  const runCli = options.runCli || ((args) => defaultRunCli(root, stateRoot, args))
  const disposers = []
  const register = route => disposers.push(webServer.register(route))

  register({ kind: 'exact', path: '/dsh-portable/settings', handler: async (request, response) => {
    if (request.method === 'GET') return sendJson(response, 200, {
      settings: readSettings(settingsFile),
      versions: (() => {
        const components = readJsonFile(componentsFile)
        return {
          portable: String(components?.portableVersion || ''),
          engine: String(components?.dshVersion || ''),
        }
      })(),
      lastRepair: readJsonFile(repairResult),
      workspacePath: path.join(stateRoot, 'workspace'),
    })
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try {
      const body = await readJson(request)
      const current = readSettings(settingsFile)
      if (typeof body.updateCheckEnabled === 'boolean') current.productUpdateCheckEnabled = body.updateCheckEnabled
      if (typeof body.productUpdateCheckEnabled === 'boolean') current.productUpdateCheckEnabled = body.productUpdateCheckEnabled
      if (typeof body.engineUpdateCheckEnabled === 'boolean') current.engineUpdateCheckEnabled = body.engineUpdateCheckEnabled
      current.updateCheckEnabled = current.productUpdateCheckEnabled
      if (typeof body.taskNotificationsEnabled === 'boolean') current.taskNotificationsEnabled = body.taskNotificationsEnabled
      if (body.closeBehavior === 'tray' || body.closeBehavior === 'exit') current.closeBehavior = body.closeBehavior
      writeSettings(settingsFile, current)
      sendJson(response, 200, { settings: current })
    } catch (error) { sendJson(response, 400, { error: String(error?.message || error) }) }
  } })

  register({ kind: 'exact', path: '/dsh-portable/check-update', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try {
      const body = await readJson(request)
      if (!['product', 'engine'].includes(body.scope)) return sendJson(response, 400, { error: 'invalid update scope' })
      sendJson(response, 200, await runCli(['check-update', '--scope', body.scope, '--json', '--force']))
    } catch (error) { sendJson(response, 500, { error: String(error?.message || error) }) }
  } })

  register({ kind: 'exact', path: '/dsh-portable/doctor', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try { sendJson(response, 200, await runCli(['doctor', '--json'])) }
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
    try { sendJson(response, 200, await runCli(['support-report', '--json'])) }
    catch (error) { sendJson(response, 500, { error: String(error?.message || error) }) }
  } })

  register({ kind: 'exact', path: '/dsh-portable/data-export', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    let passwordFile = ''
    try {
      const body = await readJson(request)
      const kind = body.kind === 'private' ? 'private' : body.kind === 'standard' ? 'standard' : ''
      if (!kind) return sendJson(response, 400, { error: 'invalid data package kind' })
      const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
      const requestedOutput = typeof body.output === 'string' ? body.output.trim() : ''
      if (requestedOutput && !path.isAbsolute(requestedOutput)) return sendJson(response, 400, { error: 'output path must be absolute' })
      const output = requestedOutput || path.join(stateRoot, 'data', 'backups', `DSH-Portable-${kind}-${stamp}.dshdata`)
      mkdirSync(path.dirname(output), { recursive: true })
      const args = ['backup-data', '--json', '--categories', 'settings,sessions,plugins,credentials', '--output', output]
      if (kind === 'standard') args.push('--allow-unencrypted-credentials')
      if (kind === 'private') {
        if (typeof body.password !== 'string' || body.password.length < 8)
          return sendJson(response, 400, { error: 'password must contain at least 8 characters' })
        passwordFile = temporaryPasswordFile(stateRoot, body.password)
        args.push('--password-file', passwordFile)
      }
      sendJson(response, 200, await runCli(args))
    } catch (error) { sendJson(response, 500, { error: String(error?.message || error) }) }
    finally { if (passwordFile) try { unlinkSync(passwordFile) } catch {} }
  } })

  register({ kind: 'exact', path: '/dsh-portable/data-inspect', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    let passwordFile = ''
    try {
      const body = await readJson(request)
      const input = typeof body.input === 'string' ? body.input.trim() : ''
      if (!input || !path.isAbsolute(input)) return sendJson(response, 400, { error: 'input path must be absolute' })
      const encrypted = encryptedDataPackage(input)
      if (encrypted && !body.password) return sendJson(response, 401, { requiresPassword: true, encrypted: true })
      const args = ['inspect-data', '--input', input, '--json']
      if (encrypted) {
        passwordFile = temporaryPasswordFile(stateRoot, body.password)
        args.push('--password-file', passwordFile)
      }
      sendJson(response, 200, { ...(await runCli(args)), input, encrypted })
    } catch (error) { sendJson(response, 400, { error: String(error?.message || error) }) }
    finally { if (passwordFile) try { unlinkSync(passwordFile) } catch {} }
  } })

  return () => { for (const dispose of disposers.reverse()) dispose?.() }
}

export function apply(ctx) {
  ctx.effect(() => mountPortableRoutes(ctx.webServer), 'dsh-portable: settings and maintenance routes')
}
