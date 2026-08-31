import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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
import { redactDiagnosticText } from './diagnostic-policy.mjs'

const REPORT_SCHEMA = 1
const LOG_TAIL_BYTES = 64 * 1024
const LOG_NAMES = Object.freeze([
  'startup-latest.jsonl',
  'startup-previous.jsonl',
  'launcher.log',
  'launcher.log.previous',
  'dsh.stdout.log',
  'dsh.stderr.log',
  'portable-errors.jsonl',
  'portable-errors.jsonl.previous',
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
  const profileResolver = await inspectManagedProfileModuleFallback(layout)
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

async function logTail(filename) {
  try {
    const source = await readFile(filename)
    return redactDiagnosticText(source.subarray(Math.max(0, source.length - LOG_TAIL_BYTES)).toString('utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    return `unreadable: ${error?.code || error?.message || 'unknown'}`
  }
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
    result.logNames = (await readdir(layout.logsDir)).filter((name) => LOG_NAMES.includes(name)).sort()
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
  }
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (bytes.length >= 512 * 1024) throw new Error('Support report exceeded its privacy-safe size limit.')
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, bytes, { mode: 0o600 })
  return { schemaVersion: REPORT_SCHEMA, output, bytes: bytes.length }
}
