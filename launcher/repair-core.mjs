import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  ensureDesktopBridgeFallback,
  ensurePortableDirectories,
  inspectManagedProfileModuleFallback,
  inspectPackagedDshRuntime,
  repairManagedProfileModuleFallback,
} from './portable-core.mjs'
import { redactDiagnosticText, readLogTail } from './diagnostic-policy.mjs'
import { summarizeStartupRun } from './startup-summary.mjs'

const REPORT_SCHEMA = 1
const LOG_TAIL_BYTES = 64 * 1024
const LOG_ENTRY_MAX_BYTES = 24 * 1024
const LOG_OMISSION_MARKER = '[earlier log omitted]\n'
const HISTORY_MAX_RUNS = 30
const HISTORY_MAX_SERIALIZED_BYTES = 100 * 1024
const HISTORY_METADATA_RESERVE_BYTES = 16 * 1024
const HISTORY_MIN_LOG_DELTA_BYTES = 1
const HISTORY_LOG_NAMES = Object.freeze([
  'startup.jsonl',
  'startup.jsonl.previous',
  'runtime-health.jsonl',
  'runtime-health.jsonl.previous',
  'desktop-health.jsonl',
  'desktop-health.jsonl.previous',
])
const HISTORY_LOG_NAME_SET = new Set(HISTORY_LOG_NAMES)
const STARTUP_ID = /^[0-9a-f]{32}$/i
const LOG_NAMES = Object.freeze([
  'startup-latest.jsonl',
  'startup-previous.jsonl',
  'launcher.log',
  'launcher.log.previous',
  'dsh.stdout.log',
  'dsh.stderr.log',
  'portable-errors.jsonl',
  'portable-errors.jsonl.previous',
  'data-import-latest.jsonl',
  'data-import-previous.jsonl',
  'runtime-health.jsonl',
  'runtime-health.jsonl.previous',
  'desktop-health.jsonl',
  'desktop-health.jsonl.previous',
])
const execFileAsync = promisify(execFile)
const WINDOWS_DIAGNOSTIC_PROCESSES = Object.freeze([
  'DeepSeek-Herness.exe',
  'OpenConsole.exe',
  'WindowsTerminal.exe',
  'conhost.exe',
  'node.exe',
  'powershell.exe',
  'pwsh.exe',
])

async function runtimeChecks(layout) {
  const required = [
    ['runtime.node', layout.nodeExe],
    ['runtime.dsh', layout.dshBin],
    ['runtime.host', layout.hostBin],
    ['runtime.desktopBridge', layout.desktopBridgePatch],
    ['runtime.pluginMarket', path.join(layout.pluginMarketRoot, 'package.json')],
    ['runtime.packageManager', layout.packageManagerBin],
  ]
  if (layout.platform === 'win32') required.push(
    ['shell.desktopHost', layout.desktopExe],
    ['shell.webView2Core', layout.webView2Core],
    ['shell.webView2WinForms', layout.webView2WinForms],
    ['shell.webView2Loader', layout.webView2Loader],
  )
  const checks = required.map(([id, filename]) => ({
    id,
    status: existsSync(filename) ? 'ok' : 'error',
    repairable: false,
    detail: existsSync(filename) ? 'present' : 'missing-from-package',
  }))
  const closure = await inspectPackagedDshRuntime(layout)
  checks.push({
    id: 'runtime.dshDependencyClosure',
    status: closure.ok ? 'ok' : 'error',
    repairable: false,
    detail: closure.detail,
  })
  return checks
}

async function generatedChecks(layout) {
  // Normal shutdown removes these move-sensitive links; startup recreates them.
  const pendingStartup = !existsSync(path.join(layout.dshHome, 'profiles', 'node_modules'))
    && !existsSync(layout.processState)
  const profileResolver = pendingStartup
    ? { ok: true, repairable: true, detail: 'created-on-start' }
    : await inspectManagedProfileModuleFallback(layout)
  return [
    {
      id: 'generated.dshProfileResolver',
      status: profileResolver.ok ? 'ok' : 'error',
      repairable: profileResolver.repairable,
      detail: profileResolver.detail,
    },
    {
      id: 'generated.desktopBridgeResolver',
      status: 'ok',
      repairable: true,
      detail: existsSync(layout.desktopBridgeFallback) ? 'present' : 'created-on-start',
    },
    {
      id: 'generated.pluginMarketResolver',
      status: 'ok',
      repairable: true,
      detail: existsSync(path.join(layout.pluginMarketRoot, 'package.json'))
        ? (existsSync(layout.pluginMarketFallback) ? 'present' : 'created-on-start')
        : 'not-packaged',
    },
  ]
}

export async function diagnosePortable(layout) {
  const checks = [...await runtimeChecks(layout), ...await generatedChecks(layout)]
  const needsFullPackage = checks.some((check) => check.status === 'error' && !check.repairable)
  return {
    schemaVersion: REPORT_SCHEMA,
    ok: !checks.some((check) => check.status === 'error'),
    needsFullPackage,
    checks,
  }
}

export async function repairPortable(layout, { running = false } = {}) {
  const before = await diagnosePortable(layout)
  if (running) {
    return {
      schemaVersion: REPORT_SCHEMA,
      ok: false,
      deferred: true,
      needsFullPackage: before.needsFullPackage,
      actions: [],
      checks: before.checks,
    }
  }
  if (before.needsFullPackage) {
    return {
      schemaVersion: REPORT_SCHEMA,
      ok: false,
      deferred: false,
      needsFullPackage: true,
      actions: [],
      checks: before.checks,
    }
  }

  await ensurePortableDirectories(layout)
  const actions = []
  if (await repairManagedProfileModuleFallback(layout)) actions.push('rebuild-managed-profile-resolver')
  if (await ensureDesktopBridgeFallback(layout)) actions.push('rebuild-portable-plugin-resolvers')
  const after = await diagnosePortable(layout)
  return { ...after, deferred: false, actions }
}

async function safeLogTail(filename) {
  try {
    const info = await lstat(filename)
    if (info.isSymbolicLink() || !info.isFile()) return { value: '', truncated: false }
    let value = redactDiagnosticText(readLogTail(filename, LOG_TAIL_BYTES))
    let truncated = info.size > LOG_TAIL_BYTES
    while (Buffer.byteLength(JSON.stringify(value), 'utf8') > LOG_ENTRY_MAX_BYTES) {
      value = `${LOG_OMISSION_MARKER}${value.slice(Math.floor(value.length / 2))}`
      truncated = true
    }
    return { value, truncated }
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: '', truncated: false }
    return {
      value: redactDiagnosticText(`unreadable: ${error?.code || error?.message || 'unknown'}`),
      truncated: true,
    }
  }
}

async function logTail(filename) {
  return (await safeLogTail(filename)).value
}

function historySize(history) {
  return Buffer.byteLength(JSON.stringify(history), 'utf8')
}

function historyLogSize(logs) {
  return Buffer.byteLength(JSON.stringify(logs), 'utf8')
}

function fitHistoryLog(record, name, value, maxDelta) {
  const original = record.logs[name]
  const before = historyLogSize(record.logs)
  const deltaFor = (candidate) => {
    record.logs[name] = candidate
    const delta = historyLogSize(record.logs) - before
    record.logs[name] = original
    return delta
  }
  if (maxDelta < HISTORY_MIN_LOG_DELTA_BYTES) return { value: '', bytes: 0 }

  const fullBytes = deltaFor(value)
  if (fullBytes <= maxDelta) return { value, bytes: fullBytes }

  let low = 0
  let high = value.length
  let best = ''
  let bestBytes = 0
  while (low <= high) {
    const length = Math.floor((low + high) / 2)
    const candidate = `${LOG_OMISSION_MARKER}${value.slice(Math.max(0, value.length - length))}`
    const bytes = deltaFor(candidate)
    if (bytes <= maxDelta) {
      best = candidate
      bestBytes = bytes
      low = length + 1
    } else {
      high = length - 1
    }
  }

  if (!best) {
    for (const candidate of [value.slice(-1), '.']) {
      if (!candidate) continue
      const bytes = deltaFor(candidate)
      if (bytes <= maxDelta) {
        best = candidate
        bestBytes = bytes
        break
      }
    }
  }
  return { value: best, bytes: bestBytes }
}

function markHistoryLogTruncated(history, record, name, sourceTruncated, budgetTruncated) {
  if (!sourceTruncated && !budgetTruncated) return
  history.truncated = true
  history.truncation.fileTails += 1
  record.truncatedLogs.push(name)
}

function fillHistoryLogGroup(history, record, tails, names, maxPayloadBytes, perRunBytes) {
  const present = names.filter(name => tails[name].value !== '')
  let phaseRemaining = Math.max(0, maxPayloadBytes)
  let used = 0
  for (let index = 0; index < present.length; index += 1) {
    const name = present[index]
    const remainingMinimum = (present.length - index - 1) * HISTORY_MIN_LOG_DELTA_BYTES
    const globalRemaining = Math.max(0, perRunBytes - historyLogSize(record.logs))
    const available = Math.max(0, Math.min(phaseRemaining, globalRemaining - remainingMinimum))
    const tail = tails[name]
    const fitted = fitHistoryLog(record, name, tail.value, available)
    record.logs[name] = fitted.value
    used += fitted.bytes
    phaseRemaining = Math.max(0, phaseRemaining - fitted.bytes)
    if (fitted.value === '') {
      history.truncated = true
      history.truncation.omittedLogs += 1
      record.truncatedLogs.push(name)
      continue
    }
    markHistoryLogTruncated(history, record, name, tail.truncated, fitted.value !== tail.value)
  }
  return used
}

async function collectStartupHistory(layout) {
  const history = {
    runs: [],
    truncated: false,
    truncation: {
      maxRuns: HISTORY_MAX_RUNS,
      maxBytes: HISTORY_MAX_SERIALIZED_BYTES,
      metadataReserveBytes: HISTORY_METADATA_RESERVE_BYTES,
      perRunBytes: 0,
      omittedRuns: 0,
      omittedLogs: 0,
      fileTails: 0,
    },
  }
  const historyDirectory = path.join(layout.logsDir, 'history')
  let directoryInfo
  try {
    directoryInfo = await lstat(historyDirectory)
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) return history
  } catch {
    return history
  }

  let entries
  try { entries = await readdir(historyDirectory, { withFileTypes: true }) } catch { return history }
  const runs = []
  for (const entry of entries) {
    if (!STARTUP_ID.test(entry.name)) continue
    const directory = path.join(historyDirectory, entry.name)
    let runInfo
    try { runInfo = await lstat(directory) } catch { continue }
    if (runInfo.isSymbolicLink() || !runInfo.isDirectory()) continue

    let files
    try { files = await readdir(directory, { withFileTypes: true }) } catch { continue }
    let lastActivityAt = -Infinity
    for (const file of files) {
      if (!HISTORY_LOG_NAME_SET.has(file.name)) continue
      let info
      try { info = await lstat(path.join(directory, file.name)) } catch { continue }
      if (info.isSymbolicLink() || !info.isFile()) continue
      if (Number.isFinite(info.mtimeMs)) lastActivityAt = Math.max(lastActivityAt, info.mtimeMs)
    }
    if (!Number.isFinite(lastActivityAt)) lastActivityAt = Number.isFinite(runInfo.mtimeMs) ? runInfo.mtimeMs : 0
    runs.push({ startupId: entry.name, directory, lastActivityAt })
  }

  runs.sort((left, right) => left.lastActivityAt - right.lastActivityAt || left.startupId.localeCompare(right.startupId))
  const selected = runs.length > HISTORY_MAX_RUNS ? runs.slice(-HISTORY_MAX_RUNS) : runs
  history.truncation.omittedRuns = runs.length - selected.length
  if (history.truncation.omittedRuns > 0) history.truncated = true

  history.runs = selected.map(run => ({
      startupId: run.startupId,
      lastActivityAt: new Date(run.lastActivityAt).toISOString(),
      logs: Object.fromEntries(HISTORY_LOG_NAMES.map(name => [name, ''])),
      truncatedLogs: [],
      summary: null,
  }))

  // Read each bounded tail and summarize it before assigning any export
  // payload budget. The summary must see the largest safeLogTail evidence,
  // while its own metadata still counts against the 100 KiB history cap.
  const collected = []
  for (let index = 0; index < selected.length; index += 1) {
    const run = selected[index]
    const record = history.runs[index]
    const tails = Object.fromEntries(await Promise.all(HISTORY_LOG_NAMES.map(async name => [
      name,
      await safeLogTail(path.join(run.directory, name)),
    ])))
    record.summary = summarizeStartupRun(run.startupId, tails)
    collected.push({ run, record, tails })
  }

  const metadataBytes = historySize(history)
  const metadataReserveBytes = Math.max(HISTORY_METADATA_RESERVE_BYTES, metadataBytes + 1024)
  const perRunBytes = selected.length > 0
    ? Math.floor(Math.max(0, HISTORY_MAX_SERIALIZED_BYTES - metadataReserveBytes) / selected.length)
    : 0
  history.truncation.metadataReserveBytes = metadataReserveBytes
  history.truncation.perRunBytes = perRunBytes

  for (const { record, tails } of collected) {
    const baselineBytes = historyLogSize(record.logs)
    const payloadBytes = Math.max(0, perRunBytes - baselineBytes)
    const startupNames = ['startup.jsonl', 'startup.jsonl.previous']
    const healthNames = ['runtime-health.jsonl', 'runtime-health.jsonl.previous', 'desktop-health.jsonl', 'desktop-health.jsonl.previous']
    const startupBudget = startupNames.some(name => tails[name].value !== '')
      ? Math.floor(payloadBytes * 3 / 4)
      : 0
    const startupUsed = fillHistoryLogGroup(history, record, tails, startupNames, startupBudget, perRunBytes)
    fillHistoryLogGroup(history, record, tails, healthNames, Math.max(0, payloadBytes - startupUsed), perRunBytes)
    // A history-budget omission happens after summary collection. Preserve
    // the explicit uncertainty marker so consumers never mistake the bounded
    // tail for complete evidence.
    if (record.truncatedLogs.length > 0 && record.summary) record.summary.incompleteEvidence = true
  }
  return history
}

async function componentInventory(layout) {
  try {
    return JSON.parse(await readFile(path.join(layout.root, 'licenses', 'COMPONENTS.json'), 'utf8'))
  } catch {
    return null
  }
}

async function fileInventory(layout) {
  const result = {}
  for (const [name, filename] of Object.entries({
    node: layout.nodeExe,
    dsh: layout.dshBin,
    host: layout.hostBin,
    desktopBridge: layout.desktopBridgePatch,
  })) {
    try {
      const info = await stat(filename)
      result[name] = { present: true, bytes: info.size }
    } catch {
      result[name] = { present: false }
    }
  }
  try {
    result.logNames = (await readdir(layout.logsDir, { withFileTypes: true }))
      .filter(entry => LOG_NAMES.includes(entry.name) && entry.isFile() && !entry.isSymbolicLink())
      .map(entry => entry.name)
      .sort()
  } catch {
    result.logNames = []
  }
  return result
}

export function summarizeWindowsTasklist(source) {
  const tracked = Object.fromEntries(WINDOWS_DIAGNOSTIC_PROCESSES.map(name => [name, 0]))
  for (const line of String(source ?? '').split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)"/)
    if (!match) continue
    const key = WINDOWS_DIAGNOSTIC_PROCESSES.find(name => name.toLowerCase() === match[1].toLowerCase())
    if (key) tracked[key] += 1
  }
  return tracked
}

async function runtimeProcessSnapshot() {
  if (process.platform !== 'win32') return { status: 'unsupported', reason: 'windows-only' }
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    return {
      status: 'ok',
      sampledAt: new Date().toISOString(),
      counts: summarizeWindowsTasklist(stdout),
    }
  } catch (error) {
    return { status: 'unavailable', reason: String(error?.code || error?.message || 'unknown').slice(0, 160) }
  }
}

export async function exportPortableSupportReport(layout, output) {
  if (!output) throw new Error('A support report output path is required.')
  const logs = {}
  for (const name of LOG_NAMES) logs[name] = await logTail(path.join(layout.logsDir, name))
  const startupHistory = await collectStartupHistory(layout)
  const report = {
    schemaVersion: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    platform: { os: process.platform, arch: process.arch, release: os.release() },
    mode: layout.root === layout.stateRoot ? 'portable' : 'installed',
    diagnosis: await diagnosePortable(layout),
    components: await componentInventory(layout),
    files: await fileInventory(layout),
    runtimeProcesses: await runtimeProcessSnapshot(),
    logs,
    startupHistory,
  }
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (bytes.length >= 512 * 1024) throw new Error('Support report exceeded its privacy-safe size limit.')
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, bytes, { mode: 0o600 })
  return { schemaVersion: REPORT_SCHEMA, output, bytes: bytes.length }
}
