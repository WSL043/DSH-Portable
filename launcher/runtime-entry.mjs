import { appendFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireRuntimeLease, cleanUnusedRuntimeCaches, ensureRuntimeCapsule, runtimePreparationDiagnostic } from './runtime-capsule.mjs'
import { appendStartupTrace, beginStartupTrace, traceFromEnvironment } from './startup-trace.mjs'
import { environmentStateRoot, parseCli } from './portable-core.mjs'

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
const preparationStarted = performance.now()
const prepared = await ensureRuntimeCapsule(root)
const preparationElapsed = performance.now() - preparationStarted
appendStartupTrace(startupTrace, 'runtime-entry', 'runtime-capsule-ready', {
  mode: prepared.mode,
  elapsedMsRuntime: Math.round(preparationElapsed),
})
try {
  await mkdir(logDirectory, { recursive: true })
  await appendFile(
    path.join(logDirectory, 'launcher.log'),
    `${new Date().toISOString()} [runtime-capsule] ${runtimePreparationDiagnostic(prepared, preparationElapsed)}\n`,
    'utf8',
  )
} catch { /* diagnostics must never prevent the product from starting */ }
process.env.DSH_PORTABLE_RUNTIME_ROOT = prepared.runtimeRoot
process.argv = [process.execPath, path.join(root, 'launcher', entryName), ...forwarded]
const release = prepared.mode === 'capsule' ? await acquireRuntimeLease(prepared.runtimeRoot) : async () => {}
if (prepared.mode === 'capsule' && entryName === 'portable-host.mjs') {
  // Cleanup is delayed until the desktop has had ample time to become usable.
  // Current and live old runtimes are protected by their leases.
  setTimeout(() => { cleanUnusedRuntimeCaches(root).catch(() => {}) }, 60_000).unref()
}
try {
  await import(pathToFileURL(process.argv[1]).href)
} finally {
  await release()
}
