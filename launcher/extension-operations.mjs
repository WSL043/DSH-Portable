import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { writeJsonAtomic } from './portable-core.mjs'

const PROFILE_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024
const EXTENSION_DOWNLOAD_TIMEOUT_MS = 60_000
const EXTENSION_PLUGIN_TIMEOUT_MS = 120_000
const TERMINAL = new Set(['applied', 'failed', 'rolled_back', 'rolled_back_after_boot_failure'])

function compatible(item, components) {
  return item.compatibility.portable === components.portableVersion
    && item.compatibility.dsh === components.dshVersion
    && item.compatibility.dshCommit === components.dshCommit
}

function validPending(value) {
  if (!value || value.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(value.id)) return false
  if (!['install', 'remove'].includes(value.action) || value.profile !== 'web' || !['queued', 'applying'].includes(value.status)) return false
  if (!/^[a-z0-9._@/-]+$/.test(value.packageName) || !/^\d+\.\d+\.\d+$/.test(value.version)) return false
  if (!Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > 2) return false
  return typeof value.operationId === 'string' && value.operationId.length >= 16 && value.operationId.length <= 128
}

async function defaultSnapshotProfile(layout, profile, operationId) {
  const profileRoot = path.join(layout.dshHome, 'profiles', profile)
  const backupRoot = path.join(layout.extensionRecovery, operationId)
  await mkdir(backupRoot, { recursive: true })
  const present = []
  for (const name of PROFILE_FILES) {
    const source = path.join(profileRoot, name)
    if (!existsSync(source)) continue
    await copyFile(source, path.join(backupRoot, name))
    present.push(name)
  }
  await writeFile(path.join(backupRoot, 'snapshot.json'), `${JSON.stringify({ schemaVersion: 1, present })}\n`, 'utf8')
  return { profileRoot, backupRoot, present }
}

async function defaultRestoreProfile(snapshot) {
  const marker = JSON.parse(await readFile(path.join(snapshot.backupRoot, 'snapshot.json'), 'utf8'))
  for (const name of PROFILE_FILES) {
    const target = path.join(snapshot.profileRoot, name)
    if (marker.present.includes(name)) await copyFile(path.join(snapshot.backupRoot, name), target)
    else await rm(target, { force: true })
  }
}

async function restoreAndRelink(snapshot, profile, restoreProfile, runPlugin) {
  await restoreProfile(snapshot)
  const relinkCode = await runPlugin(['plugin', '--profile', profile, 'install', '--force'])
  if (relinkCode !== 0) throw new Error('profile relink failed')
  const preflightCode = await runPlugin(['--profile', profile, '--dump-config'])
  if (preflightCode !== 0) throw new Error('restored profile preflight failed')
}

function terminatePluginTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      return
    } catch {
      try { child.kill('SIGKILL') } catch {}
      return
    }
  }
  try { process.kill(-child.pid, 'SIGKILL') } catch {
    try { child.kill('SIGKILL') } catch {}
  }
}

function defaultRunPlugin(layout, argv, timeoutMs = EXTENSION_PLUGIN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    let timeout
    let exitGuard
    const child = spawn(layout.nodeExe, [path.join(layout.root, 'launcher', 'dsh-cli.mjs'), ...argv], {
      cwd: layout.workspace,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false,
      detached: process.platform !== 'win32',
    })
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(exitGuard)
      handler(value)
    }
    child.once('error', error => finish(reject, error))
    child.once('exit', code => finish(resolve, timedOut ? 124 : Number.isInteger(code) ? code : 1))
    timeout = setTimeout(() => {
      timedOut = true
      terminatePluginTree(child)
      exitGuard = setTimeout(() => {
        finish(reject, new Error('timed-out plugin process tree did not exit'))
      }, 5_000)
    }, timeoutMs)
  })
}

async function fetchArtifactResponse(entry, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  let timeout
  const operation = Promise.resolve()
    .then(async () => {
      const response = await fetchImpl(entry.artifact.url, { redirect: 'follow', signal: controller.signal })
      if (!response?.ok) return { ok: false, code: 'download_failed' }
      return { ok: true, response, bytes: Buffer.from(await response.arrayBuffer()) }
    })
    .then(value => ({ value }), error => ({ error }))
  const expired = new Promise(resolve => {
    timeout = setTimeout(() => {
      controller.abort()
      resolve({ timedOut: true })
    }, timeoutMs)
  })
  const settled = await Promise.race([operation, expired])
  clearTimeout(timeout)
  if (settled.timedOut) return { ok: false, code: 'download_timeout' }
  if (settled.error) return { ok: false, code: 'download_failed' }
  return settled.value
}

async function downloadArtifact(entry, layout, fetchImpl, timeoutMs = EXTENSION_DOWNLOAD_TIMEOUT_MS) {
  const downloaded = await fetchArtifactResponse(entry, fetchImpl, timeoutMs)
  if (!downloaded.ok) return downloaded
  const { response, bytes } = downloaded
  if (!response?.ok) return { ok: false, code: 'download_failed' }
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && (declared < 1 || declared > MAX_ARTIFACT_BYTES)) {
    return { ok: false, code: 'artifact_size_invalid' }
  }
  if (bytes.length < 1 || bytes.length > MAX_ARTIFACT_BYTES || bytes.length !== entry.artifact.bytes && entry.artifact.bytes > 0) {
    return { ok: false, code: 'artifact_size_invalid' }
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== entry.artifact.sha256) return { ok: false, code: 'digest_mismatch' }
  await mkdir(layout.extensionCache, { recursive: true })
  const filename = path.join(layout.extensionCache, `sha256-${digest}.tgz`)
  if (!existsSync(filename)) {
    const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, filename)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }
  return { ok: true, filename, digest }
}

function publicResult(pending, status, code, extra = {}) {
  return {
    schemaVersion: 1,
    operationId: pending.operationId,
    id: pending.id,
    action: pending.action,
    packageName: pending.packageName,
    version: pending.version,
    status,
    code,
    attempts: pending.attempts + 1,
    updatedAt: new Date().toISOString(),
    ...extra,
  }
}

export async function processPendingExtensionOperation(options) {
  const { layout, pending, catalog, components } = options
  const writeResult = options.writeResult ?? (value => writeJsonAtomic(layout.extensionResult, value))
  const writePending = options.writePending ?? (value => writeJsonAtomic(layout.extensionPending, value))
  if (!validPending(pending)) {
    const value = publicResult(pending ?? { operationId: 'invalid', id: 'invalid', action: 'install', packageName: 'invalid', version: '0.0.0', attempts: 0 }, 'failed', 'invalid_pending')
    await writeResult(value)
    return value
  }
  const entry = catalog.items.find(item => item.id === pending.id)
  if (!entry || catalog.revision !== pending.catalogRevision
    || entry.packageName !== pending.packageName || entry.version !== pending.version
    || !compatible(entry, components)) {
    const value = publicResult(pending, 'failed', 'catalog_or_compatibility_changed')
    await writeResult(value)
    return value
  }
  const runPlugin = options.runPlugin ?? (argv => defaultRunPlugin(
    layout,
    argv,
    options.pluginTimeoutMs ?? EXTENSION_PLUGIN_TIMEOUT_MS,
  ))
  const snapshotProfile = options.snapshotProfile ?? ((profile, operationId) => defaultSnapshotProfile(layout, profile, operationId))
  const restoreProfile = options.restoreProfile ?? defaultRestoreProfile
  if (pending.action === 'install') {
    const artifact = await downloadArtifact(
      entry,
      layout,
      options.fetch ?? globalThis.fetch,
      options.downloadTimeoutMs ?? EXTENSION_DOWNLOAD_TIMEOUT_MS,
    )
    if (!artifact.ok) {
      const value = publicResult(pending, 'failed', artifact.code)
      await writeResult(value)
      return value
    }
    const snapshot = await snapshotProfile(pending.profile, pending.operationId)
    await writePending({ ...pending, status: 'applying', attempts: pending.attempts + 1 })
    const installTarget = entry.installAs ? `${entry.installAs}@${artifact.filename}` : artifact.filename
    const installCode = await runPlugin(['plugin', '--profile', pending.profile, 'add', installTarget])
    if (installCode !== 0) {
      await restoreAndRelink(snapshot, pending.profile, restoreProfile, runPlugin)
      const value = publicResult(pending, 'rolled_back', 'install_failed')
      await writeResult(value)
      return value
    }
    const preflightCode = await runPlugin(['--profile', pending.profile, '--dump-config'])
    if (preflightCode !== 0) {
      await restoreAndRelink(snapshot, pending.profile, restoreProfile, runPlugin)
      const value = publicResult(pending, 'rolled_back', 'preflight_failed')
      await writeResult(value)
      return value
    }
    const receipt = {
      schemaVersion: 1,
      id: entry.id,
      packageName: entry.packageName,
      dependencyName: entry.installAs ?? entry.packageName,
      version: entry.version,
      sha256: artifact.digest,
      catalogRevision: catalog.revision,
      installedAt: new Date().toISOString(),
    }
    const value = publicResult(pending, 'awaiting_host_health', 'applied_pending_health', { receipt })
    Object.defineProperty(value, 'snapshot', { value: snapshot, enumerable: false })
    await writeResult(value)
    return value
  }

  const receipts = options.receipts ?? []
  const installedReceipt = receipts.find(receipt => receipt.id === entry.id
    && receipt.packageName === entry.packageName
    && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(receipt.dependencyName ?? receipt.packageName))
  if (!installedReceipt) {
    const value = publicResult(pending, 'failed', 'receipt_required')
    await writeResult(value)
    return value
  }
  const snapshot = await snapshotProfile(pending.profile, pending.operationId)
  await writePending({ ...pending, status: 'applying', attempts: pending.attempts + 1 })
  const removeCode = await runPlugin(['plugin', '--profile', pending.profile, 'remove', installedReceipt.dependencyName ?? installedReceipt.packageName])
  if (removeCode !== 0) {
    await restoreAndRelink(snapshot, pending.profile, restoreProfile, runPlugin)
    const value = publicResult(pending, 'rolled_back', 'remove_failed')
    await writeResult(value)
    return value
  }
  const preflightCode = await runPlugin(['--profile', pending.profile, '--dump-config'])
  if (preflightCode !== 0) {
    await restoreAndRelink(snapshot, pending.profile, restoreProfile, runPlugin)
    const value = publicResult(pending, 'rolled_back', 'preflight_failed')
    await writeResult(value)
    return value
  }
  const value = publicResult(pending, 'awaiting_host_health', 'removed_pending_health', { receipt: installedReceipt })
  Object.defineProperty(value, 'snapshot', { value: snapshot, enumerable: false })
  await writeResult(value)
  return value
}

async function restoreRemovalReceipt(layout, transaction, options) {
  if (transaction.action !== 'remove' || !transaction.receipt) return
  const readReceipts = options.readReceipts ?? (async () => {
    try {
      const value = JSON.parse(await readFile(layout.extensionReceipts, 'utf8'))
      return Array.isArray(value) ? value : []
    } catch { return [] }
  })
  const writeReceipts = options.writeReceipts ?? (value => writeJsonAtomic(layout.extensionReceipts, value))
  const receipts = (await readReceipts()).filter(value => value.id !== transaction.id)
  receipts.push(transaction.receipt)
  await writeReceipts(receipts)
}

export async function finishExtensionOperation(layout, transaction, options = {}) {
  if (!transaction || transaction.status !== 'awaiting_host_health') return transaction
  const readReceipts = options.readReceipts ?? (async () => {
    try {
      const value = JSON.parse(await readFile(layout.extensionReceipts, 'utf8'))
      return Array.isArray(value) ? value : []
    } catch { return [] }
  })
  const writeReceipts = options.writeReceipts ?? (value => writeJsonAtomic(layout.extensionReceipts, value))
  const receipts = (await readReceipts()).filter(value => value.id !== transaction.id)
  if (transaction.action === 'install') receipts.push(transaction.receipt)
  await writeReceipts(receipts)
  const result = { ...transaction, status: 'applied', code: transaction.action === 'install' ? 'installed' : 'removed', updatedAt: new Date().toISOString() }
  delete result.snapshot
  await (options.writeResult ?? (value => writeJsonAtomic(layout.extensionResult, value)))(result)
  await rm(layout.extensionPending, { force: true })
  if (transaction.snapshot?.backupRoot) await rm(transaction.snapshot.backupRoot, { recursive: true, force: true })
  return result
}

export async function rollbackExtensionOperationAfterBootFailure(layout, transaction, options = {}) {
  if (!transaction?.snapshot) return transaction
  const restoreProfile = options.restoreProfile ?? defaultRestoreProfile
  const runPlugin = options.runPlugin ?? (argv => defaultRunPlugin(
    layout,
    argv,
    options.pluginTimeoutMs ?? EXTENSION_PLUGIN_TIMEOUT_MS,
  ))
  const writeResult = options.writeResult ?? (value => writeJsonAtomic(layout.extensionResult, value))
  const rollingBack = {
    ...transaction,
    status: 'rolling_back',
    code: 'host_health_failed',
    updatedAt: new Date().toISOString(),
  }
  delete rollingBack.snapshot
  await writeResult(rollingBack)
  try {
    await restoreAndRelink(transaction.snapshot, 'web', restoreProfile, runPlugin)
    await restoreRemovalReceipt(layout, transaction, options)
  } catch (error) {
    const result = { ...transaction, status: 'recovery_required', code: 'host_rollback_failed', updatedAt: new Date().toISOString() }
    delete result.snapshot
    await writeResult(result)
    throw new Error(`Portable extension recovery is required because the restored profile could not be relinked: ${error?.message ?? error}`)
  }
  const result = { ...transaction, status: 'rolled_back_after_boot_failure', code: 'host_health_failed', updatedAt: new Date().toISOString() }
  delete result.snapshot
  await writeResult(result)
  await rm(layout.extensionPending, { force: true })
  await rm(transaction.snapshot.backupRoot, { recursive: true, force: true })
  return result
}

export function extensionOperationTerminal(status) {
  return TERMINAL.has(status)
}

async function loadOperationSnapshot(layout, pending) {
  const backupRoot = path.join(layout.extensionRecovery, pending.operationId)
  return {
    profileRoot: path.join(layout.dshHome, 'profiles', pending.profile),
    backupRoot,
    present: JSON.parse(await readFile(path.join(backupRoot, 'snapshot.json'), 'utf8')).present,
  }
}

export async function preparePendingExtensionOperation(layout, options = {}) {
  let pending
  try { pending = JSON.parse(await readFile(layout.extensionPending, 'utf8')) } catch { return null }
  let catalog
  let components
  let receipts
  let priorResult
  try {
    catalog = JSON.parse(await readFile(path.join(
      layout.appDir,
      'node_modules', '@wsl043', 'dsh-portable-desktop-bridge', 'extensions', 'catalog.json',
    ), 'utf8'))
    components = JSON.parse(await readFile(path.join(layout.root, 'licenses', 'COMPONENTS.json'), 'utf8'))
    receipts = JSON.parse(await readFile(layout.extensionReceipts, 'utf8').catch(() => '[]'))
    priorResult = JSON.parse(await readFile(layout.extensionResult, 'utf8').catch(() => 'null'))
  } catch {
    const value = publicResult(pending, 'failed', 'extension_runtime_unavailable')
    await writeJsonAtomic(layout.extensionResult, value)
    await rm(layout.extensionPending, { force: true })
    return null
  }
  const receipt = Array.isArray(receipts) ? receipts.find(value => value.id === pending.id
    && value.packageName === pending.packageName && value.version === pending.version) : undefined
  if (priorResult?.operationId === pending.operationId && extensionOperationTerminal(priorResult.status)) {
    await rm(layout.extensionPending, { force: true })
    await rm(path.join(layout.extensionRecovery, pending.operationId), { recursive: true, force: true })
    return null
  }
  if (priorResult?.operationId === pending.operationId && priorResult.status === 'rolling_back') {
    const recovered = { ...priorResult }
    Object.defineProperty(recovered, 'snapshot', {
      value: await loadOperationSnapshot(layout, pending),
      enumerable: false,
    })
    await rollbackExtensionOperationAfterBootFailure(layout, recovered, options)
    return null
  }
  if (pending.action === 'install' && receipt) {
    const value = publicResult(pending, 'applied', 'recovered_committed_install', { receipt })
    await writeJsonAtomic(layout.extensionResult, value)
    await rm(layout.extensionPending, { force: true })
    return null
  }
  if (pending.action === 'remove'
    && priorResult?.operationId === pending.operationId
    && priorResult.status === 'applied'
    && priorResult.code === 'removed') {
    await rm(layout.extensionPending, { force: true })
    await rm(path.join(layout.extensionRecovery, pending.operationId), { recursive: true, force: true })
    return null
  }
  if (priorResult?.operationId === pending.operationId && priorResult.status === 'awaiting_host_health') {
    const recovered = { ...priorResult }
    Object.defineProperty(recovered, 'snapshot', {
      value: await loadOperationSnapshot(layout, pending),
      enumerable: false,
    })
    return recovered
  }
  if (pending.status === 'applying') {
    const backupRoot = path.join(layout.extensionRecovery, pending.operationId)
    try {
      const snapshot = await loadOperationSnapshot(layout, pending)
      await restoreAndRelink(
        snapshot,
        pending.profile,
        options.restoreProfile ?? defaultRestoreProfile,
        options.runPlugin ?? (argv => defaultRunPlugin(
          layout,
          argv,
          options.pluginTimeoutMs ?? EXTENSION_PLUGIN_TIMEOUT_MS,
        )),
      )
      await rm(backupRoot, { recursive: true, force: true })
    } catch (error) {
      const value = publicResult(pending, 'recovery_required', 'snapshot_restore_failed')
      await writeJsonAtomic(layout.extensionResult, value)
      throw new Error(`Portable extension snapshot recovery is required before DSH can start: ${error?.message ?? error}`)
    }
    const value = publicResult(pending, 'rolled_back', 'interrupted_operation_recovered')
    await writeJsonAtomic(layout.extensionResult, value)
    await rm(layout.extensionPending, { force: true })
    return null
  }
  try {
    const transaction = await processPendingExtensionOperation({ layout, pending, catalog, components, receipts, ...options })
    if (extensionOperationTerminal(transaction.status)) {
      await rm(layout.extensionPending, { force: true })
      if (transaction.snapshot?.backupRoot) await rm(transaction.snapshot.backupRoot, { recursive: true, force: true })
      return null
    }
    return transaction
  } catch (error) {
    let currentPending = pending
    try { currentPending = JSON.parse(await readFile(layout.extensionPending, 'utf8')) } catch {}
    if (currentPending?.status === 'applying') {
      const value = publicResult(currentPending, 'recovery_required', 'mutation_rollback_failed')
      await writeJsonAtomic(layout.extensionResult, value)
      throw new Error(`Portable extension recovery is required before DSH can start: ${error?.message ?? error}`)
    }
    const value = publicResult(pending, 'failed', 'operation_failed')
    await writeJsonAtomic(layout.extensionResult, value)
    await rm(layout.extensionPending, { force: true })
    return null
  }
}
