import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PREVIEW_TTL_MS = 5 * 60 * 1000
const PENDING_LOCK_UNREADABLE_STALE_MS = 5 * 1000

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value, keys) {
  if (!plainObject(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function compatible(item, components) {
  return item.compatibility.portable === components.portableVersion
    && item.compatibility.dsh === components.dshVersion
    && item.compatibility.dshCommit === components.dshCommit
}

function assertCatalog(catalog) {
  if (!plainObject(catalog) || catalog.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}\.[1-9]\d*$/.test(catalog.revision)) {
    throw new Error('Portable extension catalog is invalid.')
  }
  if (!Array.isArray(catalog.items) || catalog.items.length < 1 || catalog.items.length > 5) {
    throw new Error('Portable extension catalog size is invalid.')
  }
  const ids = new Set()
  for (const item of catalog.items) {
    if (!plainObject(item) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(item.id) || ids.has(item.id)) {
      throw new Error('Portable extension catalog contains an invalid id.')
    }
    ids.add(item.id)
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(item.packageName)
      || item.installAs !== undefined && !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(item.installAs)
      || !/^\d+\.\d+\.\d+$/.test(item.version)
      || !['reviewed', 'experimental'].includes(item.channel)
      || item.defaultInstalled !== false
      || !/^https:\/\/github\.com\//.test(item.repository)
      || typeof item.license !== 'string'
      || !plainObject(item.permissions)
      || !Array.isArray(item.permissions.zh) || item.permissions.zh.length === 0
      || !Array.isArray(item.permissions.en) || item.permissions.en.length === 0
      || !plainObject(item.artifact)
      || !/^https:\/\/github\.com\//.test(item.artifact.url)
      || !Number.isSafeInteger(item.artifact.bytes) || item.artifact.bytes < 1 || item.artifact.bytes > 256 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(item.artifact.sha256)
      || !plainObject(item.compatibility)
      || typeof item.compatibility.portable !== 'string'
      || typeof item.compatibility.dsh !== 'string'
      || !/^[a-f0-9]{40}$/.test(item.compatibility.dshCommit)) {
      throw new Error(`Portable extension catalog item is invalid: ${item.id}`)
    }
  }
  return catalog
}

export async function loadBundledCatalog() {
  const filename = new URL('../extensions/catalog.json', import.meta.url)
  return assertCatalog(JSON.parse(await readFile(filename, 'utf8')))
}

export function createExtensionMarket(options) {
  const catalog = assertCatalog(options.catalog)
  const components = options.components
  const readState = options.readState
  const writePending = options.writePending
  const now = options.now ?? Date.now
  const token = options.token ?? (() => randomBytes(24).toString('hex'))
  const operationId = options.operationId ?? randomUUID
  const previews = new Map()

  function entry(id) {
    const item = catalog.items.find(candidate => candidate.id === id)
    if (!item) throw new Error('Extension is not available in this catalog.')
    if (!compatible(item, components)) throw new Error('Extension is incompatible with this DSH-Portable build.')
    return item
  }

  async function preview(request) {
    if (!exactKeys(request, ['action', 'id']) || !['install', 'remove'].includes(request.action)) {
      throw new Error('Invalid request.')
    }
    const item = entry(request.id)
    const state = await readState()
    if (state?.pending && !['applied', 'failed', 'rolled_back', 'rolled_back_after_boot_failure'].includes(state.pending.status)) {
      throw new Error('Another extension operation is already queued.')
    }
    const receipts = Array.isArray(state?.receipts) ? state.receipts : []
    const receipt = receipts.find(value => value.id === item.id && value.packageName === item.packageName)
    if (request.action === 'install' && receipt) throw new Error('Extension is already installed.')
    if (request.action === 'remove' && !receipt) throw new Error('Only extensions installed by Portable Extensions can be removed here.')
    const createdAt = now()
    const previewToken = token()
    const expiresAt = createdAt + PREVIEW_TTL_MS
    previews.set(previewToken, {
      action: request.action,
      id: item.id,
      createdAt,
      expiresAt,
      catalogRevision: catalog.revision,
    })
    return {
      previewToken,
      action: request.action,
      id: item.id,
      packageName: item.packageName,
      version: item.version,
      channel: item.channel,
      name: item.name,
      summary: item.summary,
      repository: item.repository,
      license: item.license,
      permissions: { zh: [...item.permissions.zh], en: [...item.permissions.en] },
      requiresRestart: true,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  async function confirm(request) {
    if (!exactKeys(request, ['experimentalAcknowledged', 'previewToken'])
      || typeof request.previewToken !== 'string' || typeof request.experimentalAcknowledged !== 'boolean') {
      throw new Error('Invalid request.')
    }
    const preview = previews.get(request.previewToken)
    if (!preview) throw new Error('Preview expired or was already used.')
    if (now() >= preview.expiresAt) throw new Error('Preview expired.')
    if (preview.catalogRevision !== catalog.revision) throw new Error('Catalog changed after preview.')
    const item = entry(preview.id)
    if (preview.action === 'install' && item.channel === 'experimental' && request.experimentalAcknowledged !== true) {
      throw new Error('Experimental capabilities must be acknowledged before confirmation.')
    }
    previews.delete(request.previewToken)
    const state = await readState()
    if (state?.pending && !['applied', 'failed', 'rolled_back', 'rolled_back_after_boot_failure'].includes(state.pending.status)) {
      throw new Error('Another extension operation is already queued.')
    }
    const pending = {
      schemaVersion: 1,
      operationId: operationId(),
      id: item.id,
      action: preview.action,
      packageName: item.packageName,
      version: item.version,
      profile: 'web',
      catalogRevision: catalog.revision,
      status: 'queued',
      attempts: 0,
      createdAt: new Date(now()).toISOString(),
    }
    await writePending(pending)
    return { operationId: pending.operationId, status: pending.status, requiresRestart: true }
  }

  async function state() {
    const current = await readState()
    const receipts = Array.isArray(current?.receipts) ? current.receipts : []
    return {
      schemaVersion: 1,
      catalogRevision: catalog.revision,
      items: catalog.items.map(item => ({
        id: item.id,
        packageName: item.packageName,
        version: item.version,
        channel: item.channel,
        name: item.name,
        summary: item.summary,
        repository: item.repository,
        license: item.license,
        permissions: { zh: [...item.permissions.zh], en: [...item.permissions.en] },
        compatible: compatible(item, components),
        installed: receipts.some(receipt => receipt.id === item.id && receipt.packageName === item.packageName),
      })),
      pending: current?.pending ?? null,
      result: current?.result ?? null,
    }
  }

  return { preview, confirm, state }
}

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.end(`${JSON.stringify(value)}\n`)
}

function requestAuthority(request, port, mutation) {
  const expected = `127.0.0.1:${port}`
  if (String(request.headers?.host ?? '').toLowerCase() !== expected) return false
  if (!mutation) return true
  return String(request.headers?.origin ?? '').toLowerCase() === `http://${expected}`
    && String(request.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')
}

async function readBoundedJson(request, maximum = 16 * 1024) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > maximum) throw new Error('Invalid request.')
    chunks.push(bytes)
  }
  if (length === 0) throw new Error('Invalid request.')
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!plainObject(parsed)) throw new Error('Invalid request.')
  return parsed
}

export function registerExtensionRoutes(ctx, options) {
  const market = createExtensionMarket(options)
  const port = Number(ctx.webServer.port)
  const disposers = [
    ctx.webServer.register({ kind: 'exact', path: '/api/dsh-portable/extensions', handler: async (request, response) => {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Portable extension state requires GET.' })
        return
      }
      if (!requestAuthority(request, port, false)) {
        sendJson(response, 403, { error: 'Portable extension request authority rejected.' })
        return
      }
      try {
        sendJson(response, 200, await market.state())
      } catch {
        sendJson(response, 500, { error: 'Portable extension state is unavailable.' })
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: '/api/dsh-portable/extensions/preview', handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Portable extension preview requires POST.' })
        return
      }
      if (!requestAuthority(request, port, true)) {
        sendJson(response, 403, { error: 'Portable extension request authority rejected.' })
        return
      }
      try {
        sendJson(response, 200, await market.preview(await readBoundedJson(request)))
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Preview failed.' })
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: '/api/dsh-portable/extensions/confirm', handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Portable extension confirmation requires POST.' })
        return
      }
      if (!requestAuthority(request, port, true)) {
        sendJson(response, 403, { error: 'Portable extension request authority rejected.' })
        return
      }
      try {
        sendJson(response, 200, await market.confirm(await readBoundedJson(request)))
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Confirmation failed.' })
      }
    }}),
  ]
  return () => disposers.splice(0).reverse().forEach(dispose => dispose())
}

export function extensionStatePaths(environment = process.env) {
  const dshHome = environment.DSH_HOME
  if (!dshHome) throw new Error('DSH_HOME is unavailable.')
  const stateRoot = path.join(path.dirname(dshHome), 'runtime')
  return {
    pending: path.join(stateRoot, 'pending-extension.json'),
    result: path.join(stateRoot, 'extension-result.json'),
    receipts: path.join(stateRoot, 'extension-receipts.json'),
  }
}

async function readJsonOr(filename, fallback) {
  try { return JSON.parse(await readFile(filename, 'utf8')) } catch { return fallback }
}

async function writeJsonAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try { await rename(temporary, filename) } catch (error) {
    await import('node:fs/promises').then(fs => fs.rm(temporary, { force: true })).catch(() => {})
    throw error
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function acquirePendingLock(filename) {
  const lock = `${filename}.lock`
  const owner = {
    schemaVersion: 1,
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle
    try {
      handle = await open(lock, 'wx')
      await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
      await handle.sync()
      return {
        token: owner.token,
        async release() {
          try {
            const current = JSON.parse(await readFile(lock, 'utf8'))
            if (current?.token === owner.token) await rm(lock, { force: true })
          } catch { /* a newer writer owns the path */ }
        },
        async verify() {
          try {
            return JSON.parse(await readFile(lock, 'utf8'))?.token === owner.token
          } catch { return false }
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    } finally {
      await handle?.close().catch(() => {})
    }

    let prior
    try {
      prior = JSON.parse(await readFile(lock, 'utf8'))
    } catch {
      let age = Number.NaN
      try { age = Date.now() - (await stat(lock)).mtimeMs } catch {}
      if (!Number.isFinite(age) || age < PENDING_LOCK_UNREADABLE_STALE_MS) {
        throw new Error('Another extension confirmation is still being recorded. Retry after it finishes.')
      }
      await rm(lock, { force: true })
      continue
    }
    if (!Number.isInteger(prior?.pid) || prior.pid < 1 || processIsAlive(prior.pid)) {
      throw new Error('Another extension operation is already queued.')
    }
    await rm(lock, { force: true })
  }
  throw new Error('Another extension operation is already queued.')
}

async function writePendingExclusive(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true })
  const release = await acquirePendingLock(filename)
  try {
    let present = false
    let malformed = false
    try {
      const current = JSON.parse(await readFile(filename, 'utf8'))
      present = true
      malformed = !plainObject(current) || !['queued', 'applying'].includes(current.status)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        present = true
        malformed = true
      }
    }
    if (present && !malformed) throw new Error('Another extension operation is already queued.')
    if (malformed) {
      const quarantine = `${filename}.corrupt-${Date.now()}-${randomUUID()}.json`
      try {
        await rename(filename, quarantine)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    if (!await release.verify()) throw new Error('Another extension operation is already queued.')
    await writeJsonAtomic(filename, value)
  } finally {
    await release.release()
  }
}

export function createFileExtensionState(environment = process.env) {
  const files = extensionStatePaths(environment)
  return {
    async readState() {
      const [pending, result, receipts] = await Promise.all([
        readJsonOr(files.pending, null),
        readJsonOr(files.result, null),
        readJsonOr(files.receipts, []),
      ])
      return { pending, result, receipts: Array.isArray(receipts) ? receipts : [] }
    },
    writePending: value => writePendingExclusive(files.pending, value),
  }
}

export { assertCatalog as validateExtensionCatalog }
