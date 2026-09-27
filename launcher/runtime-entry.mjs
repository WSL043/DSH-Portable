import { appendLauncherLog } from './launcher-log.mjs'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireRuntimeLease, ensureRuntimeCapsule, runtimePreparationDiagnostic } from './runtime-capsule.mjs'
import { pruneLogHistory } from './log-history.mjs'
import { appendStartupTrace, beginStartupTrace, traceFromEnvironment } from './startup-trace.mjs'
import { environmentStateRoot, layoutForRoot, parseCli } from './portable-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [entryName, ...forwarded] = process.argv.slice(2)
if (!entryName || path.basename(entryName) !== entryName || !entryName.endsWith('.mjs')) {
  throw new Error('Runtime entry requires one launcher module name.')
}

const stateRoot = process.env.DSH_PORTABLE_STATE_ROOT
const cliOptions = entryName === 'portable-cli.mjs' ? parseCli(forwarded) : null
const requestedEnvironment = cliOptions?.environment || process.env.DSH_PORTABLE_ENVIRONMENT || 'default'
const effectiveStateRoot = environmentStateRoot(stateRoot || root, requestedEnvironment, process.platform)
const logDirectory = path.join(effectiveStateRoot, 'data', 'logs')
const isStart = cliOptions?.command === 'start'
function reportStartupProgress(phase, fields = {}) {
  if (!isStart || !cliOptions?.progressJson) return
  process.stdout.write(`${JSON.stringify({ type: 'startup-progress', phase, ...fields })}\n`)
}
let startupTrace = traceFromEnvironment(logDirectory)
if (!startupTrace && isStart) {
  const startupId = randomUUID().replaceAll('-', '')
  const startedAt = Date.now()
  process.env.DSH_PORTABLE_STARTUP_ID = startupId
  process.env.DSH_PORTABLE_STARTUP_STARTED_AT = String(startedAt)
  startupTrace = beginStartupTrace(logDirectory, { startupId, startedAt, phase: 'runtime-entry-begin' })
} else {
  appendStartupTrace(startupTrace, 'runtime-entry', 'runtime-entry-begin')
}
if (isStart) {
  pruneLogHistory(logDirectory, { currentStartupId: startupTrace?.startupId || process.env.DSH_PORTABLE_STARTUP_ID })
}
// Recovery must run before touching the possibly missing/damaged capsule.
// The direct CLI uses only shipped launcher modules, acquires the existing
// mutation locks, and refuses to restore while a Portable environment is live.
if (cliOptions?.command === 'repair') {
  const recoveryLayout = layoutForRoot(root, process.platform, effectiveStateRoot, root, requestedEnvironment)
  if (existsSync(path.join(recoveryLayout.dataDir, 'runtime', 'data-import.json'))) {
    await promisify(execFile)(process.execPath, [
      path.join(root, 'launcher', 'portable-cli.mjs'), 'recover-data', '--json',
      '--environment', requestedEnvironment,
    ], {
      cwd: root, windowsHide: true, timeout: 60000,
      env: { ...process.env, DSH_PORTABLE_RUNTIME_ROOT: root },
    })
  }
  if (existsSync(recoveryLayout.updateJournal)) {
    const { stdout } = await promisify(execFile)(process.execPath, [
      path.join(root, 'launcher', 'portable-cli.mjs'), 'recover-update', '--json',
      '--environment', requestedEnvironment,
    ], {
      cwd: root, windowsHide: true, timeout: 60000,
      env: { ...process.env, DSH_PORTABLE_RUNTIME_ROOT: root },
    })
    const recovery = JSON.parse(stdout.trim())
    await mkdir(logDirectory, { recursive: true })
    appendLauncherLog(logDirectory,
      `${new Date().toISOString()} [update-recovery] status=${recovery.status}\n`, 'utf8')
  }
}
reportStartupProgress('runtime-preparing')
const preparationStarted = performance.now()
const preparationPool = process.env.UV_THREADPOOL_SIZE || 'default'
const prepared = await ensureRuntimeCapsule(root, {
  onProgress: (phase, fields) => {
    appendStartupTrace(startupTrace, 'runtime-capsule', phase, fields)
    if (phase === 'extract-directories-progress') reportStartupProgress('runtime-directories', fields)
    else if (phase === 'extract-files-progress') reportStartupProgress('runtime-files', fields)
    else if (phase === 'cache-commit') reportStartupProgress('runtime-finalizing')
  },
  onRetry: fields => appendStartupTrace(startupTrace, 'runtime-entry', 'runtime-commit-retry', fields),
}).catch(error => {
  if (cliOptions?.command === 'repair' || cliOptions?.command === 'doctor') {
    throw new Error('运行组件尚未就绪，未继续修复。请保留原目录和 data/workspace，完全退出后重试；若运行包缺失或损坏，将完整离线包解压到新目录再迁移数据。\nRuntime preparation failed; repair did not continue. Keep the original folder and data/workspace. Quit Portable and retry; for missing or damaged runtime files, extract a full offline package to a new folder before migrating data.', { cause: error })
  }
  throw error
}).finally(() => {
  if (process.env.DSH_PORTABLE_PREPARATION_POOL === '16') {
    delete process.env.DSH_PORTABLE_PREPARATION_POOL
    if (process.env.UV_THREADPOOL_SIZE === '16') delete process.env.UV_THREADPOOL_SIZE
  }
})
const preparationElapsed = performance.now() - preparationStarted
reportStartupProgress('runtime-ready', { reused: prepared.reused === true })
appendStartupTrace(startupTrace, 'runtime-entry', 'runtime-capsule-ready', {
  mode: prepared.mode,
  reused: prepared.reused === true,
  elapsedMsRuntime: Math.round(preparationElapsed),
  fileThreadPool: preparationPool,
})
try {
  await mkdir(logDirectory, { recursive: true })
  appendLauncherLog(
    logDirectory,
    `${new Date().toISOString()} [runtime-capsule] ${runtimePreparationDiagnostic(prepared, preparationElapsed)}\n`,
    'utf8',
  )
} catch { /* diagnostics must never prevent the product from starting */ }
process.env.DSH_PORTABLE_RUNTIME_ROOT = prepared.runtimeRoot
process.argv = [process.execPath, path.join(root, 'launcher', entryName), ...forwarded]
const release = prepared.mode === 'capsule' ? await acquireRuntimeLease(prepared.runtimeRoot) : async () => {}

try {
  await import(pathToFileURL(process.argv[1]).href)
} finally {
  await release()
}
