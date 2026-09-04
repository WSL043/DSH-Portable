import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
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

function readSettings(filename, defaultUpdateChannel = 'stable') {
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
    updateChannel: ['stable', 'candidate'].includes(source.updateChannel)
      ? source.updateChannel
      : defaultUpdateChannel,
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

async function defaultRunCli(root, baseStateRoot, environmentId, args) {
  const forwarded = environmentId === 'default' ? args : [...args, '--environment', environmentId]
  const { stdout = '' } = await execFileAsync(process.execPath, [path.join(root, 'launcher', 'portable-cli.mjs'), ...forwarded], {
    cwd: root,
    env: { ...process.env, DSH_PORTABLE_STATE_ROOT: baseStateRoot },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  })
  const output = stdout.trim()
  return output ? JSON.parse(output.split(/\r?\n/).at(-1)) : {}
}

export async function windowsNotificationAvailability() {
  if (process.platform !== 'win32') return { status: 'not-windows' }
  try {
    const { stdout = '' } = await execFileAsync('reg.exe', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications',
      '/v', 'ToastEnabled',
    ], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
    const match = /ToastEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout)
    return { status: match && Number.parseInt(match[1], 16) === 0 ? 'disabled-system' : 'available' }
  } catch {
    // Windows normally omits the value when notifications use their default.
    return { status: 'available' }
  }
}

const ENVIRONMENT_ID = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/
const RESERVED_ENVIRONMENT_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function validEnvironmentId(value) {
  return ENVIRONMENT_ID.test(String(value || '')) && !RESERVED_ENVIRONMENT_ID.test(String(value || ''))
}

function readEnvironmentRegistry(filename) {
  const value = readJsonFile(filename)
  const items = Array.isArray(value?.environments) ? value.environments : []
  return {
    schemaVersion: 1,
    environments: items
      .map(item => ({ id: String(item?.id || ''), name: String(item?.name || '').trim() }))
      .filter(item => validEnvironmentId(item.id) && item.id !== 'default' && item.name),
  }
}

function environmentSnapshot(baseStateRoot, currentEnvironment, registryFile) {
  const registry = readEnvironmentRegistry(registryFile)
  const names = new Map(registry.environments.map(item => [item.id, item.name]))
  const ids = new Set(['default'])
  try {
    for (const entry of readdirSync(path.join(baseStateRoot, 'environments'), { withFileTypes: true })) {
      if (entry.isDirectory() && validEnvironmentId(entry.name) && entry.name !== 'default') ids.add(entry.name)
    }
  } catch {}
  return {
    current: currentEnvironment,
    items: [...ids]
      .map(id => ({ id, name: id === 'default' ? '' : names.get(id) || id }))
      .sort((left, right) => left.id === 'default' ? -1 : right.id === 'default' ? 1 : left.name.localeCompare(right.name)),
  }
}

function createEnvironment(baseStateRoot, registryFile, requestedName) {
  const name = String(requestedName || '').trim()
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('environment name must contain 1-40 visible characters')
  const current = environmentSnapshot(baseStateRoot, 'default', registryFile)
  if (current.items.some(item => (item.name || item.id).localeCompare(name, undefined, { sensitivity: 'accent' }) === 0))
    throw new Error('an environment with this name already exists')
  let id = name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 32)
  if (!validEnvironmentId(id) || id === 'default') id = `env-${randomBytes(5).toString('hex')}`
  const environmentRoot = path.join(baseStateRoot, 'environments')
  while (current.items.some(item => item.id === id)) id = `env-${randomBytes(5).toString('hex')}`
  const target = path.join(environmentRoot, id)
  mkdirSync(path.join(target, 'data'), { recursive: true })
  mkdirSync(path.join(target, 'workspace'), { recursive: true })
  const registry = readEnvironmentRegistry(registryFile)
  registry.environments.push({ id, name })
  writeSettings(registryFile, registry)
  return { id, name }
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
  const currentEnvironment = String(options.environmentId || process.env.DSH_PORTABLE_ENVIRONMENT || 'default')
  const baseStateRoot = path.resolve(options.baseStateRoot || process.env.DSH_PORTABLE_BASE_STATE_ROOT
    || (currentEnvironment === 'default' ? stateRoot : path.dirname(path.dirname(stateRoot))))
  const environmentRegistryFile = path.join(baseStateRoot, 'data', 'environment-registry.json')
  const settingsFile = path.join(baseStateRoot, 'data', 'launcher-settings.json')
  const componentsFile = path.join(root, 'licenses', 'COMPONENTS.json')
  const repairRequest = path.join(stateRoot, 'data', 'runtime', 'repair-requested.json')
  const repairResult = path.join(stateRoot, 'data', 'runtime', 'repair-result.json')
  const updateResult = path.join(stateRoot, 'data', 'runtime', 'last-update-result.json')
  const runCli = options.runCli || ((args) => defaultRunCli(root, baseStateRoot, currentEnvironment, args))
  const notificationAvailability = options.notificationAvailability || windowsNotificationAvailability
  const disposers = []
  const register = route => disposers.push(webServer.register(route))
  const installedUpdateChannel = () => {
    const components = readJsonFile(componentsFile)
    return components?.releaseChannel === 'candidate' ? 'candidate' : 'stable'
  }

  register({ kind: 'exact', path: '/dsh-portable/settings', handler: async (request, response) => {
    if (request.method === 'GET') return sendJson(response, 200, {
      settings: readSettings(settingsFile, installedUpdateChannel()),
      versions: (() => {
        const components = readJsonFile(componentsFile)
        return {
          portable: String(components?.portableVersion || ''),
          engine: String(components?.dshVersion || ''),
        }
      })(),
      lastRepair: readJsonFile(repairResult),
      lastUpdate: readJsonFile(updateResult),
      notificationAvailability: await notificationAvailability(),
      workspacePath: path.join(stateRoot, 'workspace'),
      environments: environmentSnapshot(baseStateRoot, currentEnvironment, environmentRegistryFile),
    })
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try {
      const body = await readJson(request)
      const current = readSettings(settingsFile, installedUpdateChannel())
      if (body.updateChannel === 'stable' || body.updateChannel === 'candidate') current.updateChannel = body.updateChannel
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

  register({ kind: 'exact', path: '/dsh-portable/environments', handler: async (request, response) => {
    if (request.method === 'GET') return sendJson(response, 200, environmentSnapshot(baseStateRoot, currentEnvironment, environmentRegistryFile))
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try {
      const body = await readJson(request)
      const created = createEnvironment(baseStateRoot, environmentRegistryFile, body.name)
      sendJson(response, 201, { created, ...environmentSnapshot(baseStateRoot, currentEnvironment, environmentRegistryFile) })
    } catch (error) { sendJson(response, 400, { error: String(error?.message || error) }) }
  } })

  register({ kind: 'exact', path: '/dsh-portable/check-update', handler: async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try {
      const body = await readJson(request)
      if (!['product', 'engine'].includes(body.scope)) return sendJson(response, 400, { error: 'invalid update scope' })
      const args = ['check-update', '--scope', body.scope, '--json']
      if (body.background !== true) args.push('--force')
      sendJson(response, 200, await runCli(args))
    } catch (error) { sendJson(response, 500, { error: String(error?.message || error) }) }
  } })

  register({ kind: 'exact', path: '/dsh-portable/engine-versions', handler: async (request, response) => {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' })
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
    try { sendJson(response, 200, await runCli(['list-updates', '--scope', 'engine', '--json'])) }
    catch (error) { sendJson(response, 500, { error: String(error?.message || error) }) }
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
    try {
      const body = await readJson(request)
      const requestedOutput = typeof body.output === 'string' ? body.output.trim() : ''
      if (!requestedOutput || !path.isAbsolute(requestedOutput)) return sendJson(response, 400, { error: 'output path must be absolute' })
      sendJson(response, 200, await runCli(['support-report', '--json', '--output', requestedOutput]))
    }
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
